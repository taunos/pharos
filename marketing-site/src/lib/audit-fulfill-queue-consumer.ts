// Test C-A (A3 + R2-2/R2-3/R2-8) — durable Audit fulfillment Queue consumers.
//
// astrant-audit-fulfill      → auditFulfillQueueHandler
// astrant-audit-fulfill-dlq  → auditFulfillDlqHandler
// Routed by batch.queue in lib/queue-router.ts (worker.ts `queue` handler).
//
// Consumer config (wrangler.jsonc): max_batch_size 1, max_retries 3 → up to 4
// deliveries; the 4th (message.attempts >= 4) is the final attempt.
//
// Operator alerts carry session id + error class only — never buyer PII.

import {
  alertOperator,
  readAuditSession,
  runAuditFulfillment,
  writeAuditSession,
  type AuditRunDeps,
  type AuditRunEnv,
  type AuditRunResult,
} from "./audit-fulfill-run";
import { updateFunnelStatus } from "./audit-funnel";

export const AUDIT_FULFILL_QUEUE_NAME = "astrant-audit-fulfill";
export const AUDIT_FULFILL_DLQ_NAME = "astrant-audit-fulfill-dlq";

export type AuditFulfillMessage = {
  session_id: string;
  origin: string;
  // Dim 6 cap deferrals so far (R2-2: carried in the body, never in attempts).
  deferrals?: number;
};

export interface AuditFulfillConsumerEnv extends AuditRunEnv {
  AUDIT_FULFILL_QUEUE: Queue<AuditFulfillMessage>;
}

export const FINAL_ATTEMPT = 4; // max_retries 3 → deliveries 1..4
export const NOT_YET_PAID_DELAY_SEC = 30;
export const CAP_DEFERRAL_DELAY_SEC = 6 * 3600; // 21600
export const CAP_DEFERRAL_ALERT_AT = 2;

type RunFn = (
  env: AuditRunEnv,
  sessionId: string,
  origin: string,
  deps?: AuditRunDeps,
) => Promise<AuditRunResult>;

export function parseAuditFulfillMessage(body: unknown): AuditFulfillMessage | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.session_id !== "string" || b.session_id.length === 0) return null;
  if (typeof b.origin !== "string" || b.origin.length === 0) return null;
  const deferrals =
    typeof b.deferrals === "number" && Number.isInteger(b.deferrals) && b.deferrals >= 0
      ? b.deferrals
      : 0;
  return { session_id: b.session_id, origin: b.origin, deferrals };
}

// Fixed error class for logs/alerts (no message text — it can carry URLs).
export function errorClass(err: unknown): string {
  return err instanceof Error ? err.name || "Error" : typeof err;
}

// Final-attempt / DLQ terminal failure. Never downgrades a `ready` session.
// Throws if its own session write fails (caller must NOT ack then).
async function markFailed(
  env: AuditRunEnv,
  sessionId: string,
  cls: string,
  alertCode: string,
): Promise<void> {
  const record = await readAuditSession(env, sessionId);
  if (!record) {
    console.error(`${alertCode} session_id=${sessionId} class=${cls} session=not_found`);
    return;
  }
  if (record.status !== "ready") {
    // No error_message: the status page then shows its existing generic
    // fallback copy instead of raw error text (no new user-facing string).
    await writeAuditSession(env, { ...record, status: "error" });
    await updateFunnelStatus(env.SESSIONS, sessionId, "failed");
  }
  console.error(`${alertCode} session_id=${sessionId} class=${cls} status_was=${record.status}`);
  await alertOperator(env, alertCode, sessionId, `error_class=${cls}`);
}

export async function auditFulfillQueueHandler(
  batch: MessageBatch<AuditFulfillMessage>,
  env: AuditFulfillConsumerEnv,
  run: RunFn = runAuditFulfillment,
): Promise<void> {
  for (const message of batch.messages) {
    const msg = parseAuditFulfillMessage(message.body);
    if (!msg) {
      console.error("AUDIT_FULFILL_NOOP reason=malformed_message");
      message.ack();
      continue;
    }
    const sessionId = msg.session_id;
    try {
      const result = await run(env, sessionId, msg.origin);
      switch (result.kind) {
        case "done":
          console.log(`AUDIT_FULFILL_DONE session_id=${sessionId}`);
          message.ack();
          break;
        case "noop_terminal":
          console.log(`AUDIT_FULFILL_NOOP session_id=${sessionId} reason=terminal status=${result.status}`);
          message.ack();
          break;
        case "not_found":
          // R2-8: the synthetic smoke enqueues a bogus session id → logged noop + ack.
          console.log(`AUDIT_FULFILL_NOOP session_id=${sessionId} reason=not_found`);
          message.ack();
          break;
        case "not_yet_paid":
          // Webhook enqueues BEFORE writing `fulfilling` (R2-1) — give it a moment.
          message.retry({ delaySeconds: NOT_YET_PAID_DELAY_SEC });
          break;
        case "cap_deferred": {
          // Fresh message so cap deferrals never consume `attempts` (R2-2).
          const deferrals = (msg.deferrals ?? 0) + 1;
          await env.AUDIT_FULFILL_QUEUE.send(
            { session_id: sessionId, origin: msg.origin, deferrals },
            { delaySeconds: CAP_DEFERRAL_DELAY_SEC },
          );
          console.error(`AUDIT_FULFILL_CAP_DEFERRED session_id=${sessionId} deferrals=${deferrals}`);
          if (deferrals === CAP_DEFERRAL_ALERT_AT) {
            await alertOperator(env, "AUDIT_DIM6_CAP_DEFERRED", sessionId, `deferrals=${deferrals}`);
          }
          message.ack();
          break;
        }
      }
    } catch (err) {
      const cls = errorClass(err);
      if (message.attempts >= FINAL_ATTEMPT) {
        // Throws (no ack) if the error write itself fails → DLQ path.
        await markFailed(env, sessionId, cls, "AUDIT_FULFILL_FAILED_FINAL");
        message.ack();
      } else {
        console.error(
          `AUDIT_FULFILL_RETRY session_id=${sessionId} attempt=${message.attempts} class=${cls}`,
        );
        message.retry({ delaySeconds: 60 * message.attempts });
      }
    }
  }
}

// R2-3: DLQ consumer. Sets `error` (unless already `ready`), funnel `failed`,
// alerts, acks. If its own write fails it rethrows (no ack) — DLQ messages
// are retained for retry.
export async function auditFulfillDlqHandler(
  batch: MessageBatch<AuditFulfillMessage>,
  env: AuditRunEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const msg = parseAuditFulfillMessage(message.body);
    if (!msg) {
      console.error("AUDIT_FULFILL_DLQ_NOOP reason=malformed_message");
      message.ack();
      continue;
    }
    await markFailed(env, msg.session_id, "dead_lettered", "AUDIT_FULFILL_DLQ");
    message.ack();
  }
}
