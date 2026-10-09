// Test C-A (A3 + R2-2/R2-3/R2-8) — durable Audit fulfillment Queue consumers.
//
// astrant-audit-fulfill      → auditFulfillQueueHandler
// astrant-audit-fulfill-dlq  → auditFulfillDlqHandler
// Routed by batch.queue in lib/queue-router.ts (worker.ts `queue` handler).
//
// Consumer config (wrangler.jsonc): max_batch_size 1, max_retries 3 → up to 4
// deliveries; the 4th (message.attempts >= 4) is the final attempt. Only
// THROWN errors consume attempts: "not paid yet / not found yet" rechecks and
// Dim 6 cap deferrals ack and re-send a fresh message with a counter in the body.
//
// Operator alerts carry session id + error class only — never buyer PII.

import {
  readAuditSession,
  runAuditFulfillment,
  writeAuditSession,
  type AuditRunDeps,
  type AuditRunEnv,
  type AuditRunResult,
} from "./audit-fulfill-run";
import { alertOperator } from "./operator-alerts";
import { updateFunnelStatus } from "./audit-funnel";

export const AUDIT_FULFILL_QUEUE_NAME = "astrant-audit-fulfill";
export const AUDIT_FULFILL_DLQ_NAME = "astrant-audit-fulfill-dlq";

export type AuditFulfillMessage = {
  session_id: string;
  origin: string;
  // Dim 6 cap deferrals so far (R2-2: carried in the body, never in attempts).
  deferrals?: number;
  // "Not paid yet" / "not found yet" rechecks so far (same pattern).
  rechecks?: number;
};

export interface AuditFulfillConsumerEnv extends AuditRunEnv {
  AUDIT_FULFILL_QUEUE: Queue<AuditFulfillMessage>;
}

export const FINAL_ATTEMPT = 4; // max_retries 3 → deliveries 1..4
export const RECHECK_DELAY_SEC = 60;
export const MAX_RECHECKS = 10; // ~10 min of rechecks
export const CAP_DEFERRAL_DELAY_SEC = 6 * 3600; // 21600
export const CAP_DEFERRAL_ALERT_AT = 2;
// R2-8: the synthetic queue smoke uses `smoke-<uuid>` session ids.
export const SMOKE_SESSION_PREFIX = "smoke-";

type RunFn = (
  env: AuditRunEnv,
  sessionId: string,
  origin: string,
  deps?: AuditRunDeps,
) => Promise<AuditRunResult>;

const nonNegInt = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;

export function parseAuditFulfillMessage(body: unknown): Required<AuditFulfillMessage> | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.session_id !== "string" || b.session_id.length === 0) return null;
  if (typeof b.origin !== "string" || b.origin.length === 0) return null;
  return {
    session_id: b.session_id,
    origin: b.origin,
    deferrals: nonNegInt(b.deferrals),
    rechecks: nonNegInt(b.rechecks),
  };
}

// Fixed error class for logs/alerts (no message text — it can carry URLs).
// AuditReadyEmailError carries a fixed `reason` (pdf_not_found / send_error /
// copy_not_set), appended so the alert says why the buyer email failed.
export function errorClass(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const name = err.name || "Error";
  const reason = (err as { reason?: unknown }).reason;
  return name === "AuditReadyEmailError" && typeof reason === "string" && /^[a-z_]+$/.test(reason)
    ? `${name} reason=${reason}`
    : name;
}

// Final-attempt / DLQ terminal failure. Logs + alerts BEFORE any KV write so
// the operator hears about it even if the write then fails. Never writes
// `error` over `ready` (report delivered; email-step failure → alert
// AUDIT_READY_EMAIL_FAILED) or over `awaiting_payment` (alert only). Throws if
// its own session write fails (caller must NOT ack then).
async function markFailed(
  env: AuditRunEnv,
  sessionId: string,
  cls: string,
  alertCode: string,
): Promise<void> {
  const record = await readAuditSession(env, sessionId);
  const statusWas = record?.status ?? "not_found";
  const code = statusWas === "ready" ? "AUDIT_READY_EMAIL_FAILED" : alertCode;
  console.error(`${code} session_id=${sessionId} class=${cls} status_was=${statusWas}`);
  await alertOperator(env, code, sessionId, `error_class=${cls} status_was=${statusWas}`);
  if (!record || record.status === "ready" || record.status === "awaiting_payment") return;
  // No error_message: the status page then shows its existing generic
  // fallback copy instead of raw error text (no new user-facing string).
  await writeAuditSession(env, { ...record, status: "error" });
  await updateFunnelStatus(env.SESSIONS, sessionId, "failed");
  await releaseApAuditClaim(env, sessionId);
}

// Slice Q (v1.1 A5): an ap- welcome audit that ends in `error` releases the
// onboarding CAS (subscriptions.audit_fired_at) so a resubmit re-fires it.
// Keyed on the claim timestamp embedded in the id (ap-{sub}-{audit_fired_at}),
// so it never clears a newer claim. Throws if the write fails (caller must NOT
// ack then; the alert has already been sent).
async function releaseApAuditClaim(env: AuditRunEnv, sessionId: string): Promise<void> {
  const m = sessionId.match(/^ap-(sub_[A-Za-z0-9_-]+)-(\d+)$/);
  if (!m) return;
  const res = await env.CITATION_DB.prepare(
    `UPDATE subscriptions SET audit_fired_at = NULL WHERE subscription_id = ? AND audit_fired_at = ?`,
  )
    .bind(m[1], Number(m[2]))
    .run();
  console.error(`F3_AUDIT_FIRED_AT_RELEASED session_id=${sessionId} changes=${res.meta.changes}`);
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
      const result = await run(env, sessionId, msg.origin, { onCap: "defer" });
      let recheckReason: "not_yet_paid" | "not_found" | null = null;
      switch (result.kind) {
        case "done":
          console.log(`AUDIT_FULFILL_DONE session_id=${sessionId}`);
          break;
        case "noop_terminal":
          console.log(`AUDIT_FULFILL_NOOP session_id=${sessionId} reason=terminal status=${result.status}`);
          break;
        case "not_found":
          if (sessionId.startsWith(SMOKE_SESSION_PREFIX)) {
            // R2-8: the synthetic smoke enqueues a bogus session id → logged noop + ack.
            console.log(`AUDIT_FULFILL_NOOP session_id=${sessionId} reason=not_found`);
          } else {
            // A real id may not be visible yet (KV propagation) — recheck.
            recheckReason = "not_found";
          }
          break;
        case "not_yet_paid":
          // Webhook enqueues BEFORE writing `fulfilling` (R2-1) — recheck.
          recheckReason = "not_yet_paid";
          break;
        case "cap_deferred": {
          // Fresh message so cap deferrals never consume `attempts` (R2-2).
          const deferrals = msg.deferrals + 1;
          await env.AUDIT_FULFILL_QUEUE.send(
            { ...msg, deferrals },
            { delaySeconds: CAP_DEFERRAL_DELAY_SEC },
          );
          console.error(`AUDIT_FULFILL_CAP_DEFERRED session_id=${sessionId} deferrals=${deferrals}`);
          if (deferrals === CAP_DEFERRAL_ALERT_AT) {
            await alertOperator(env, "AUDIT_DIM6_CAP_DEFERRED", sessionId, `deferrals=${deferrals}`);
          }
          break;
        }
      }
      if (recheckReason !== null) {
        if (msg.rechecks >= MAX_RECHECKS) {
          // Exhausted: alert only — no state write (the session may be unpaid).
          console.error(
            `AUDIT_FULFILL_RECHECKS_EXHAUSTED session_id=${sessionId} reason=${recheckReason} rechecks=${msg.rechecks}`,
          );
          await alertOperator(
            env,
            "AUDIT_FULFILL_RECHECKS_EXHAUSTED",
            sessionId,
            `reason=${recheckReason} rechecks=${msg.rechecks}`,
          );
        } else {
          await env.AUDIT_FULFILL_QUEUE.send(
            { ...msg, rechecks: msg.rechecks + 1 },
            { delaySeconds: RECHECK_DELAY_SEC },
          );
          console.log(
            `AUDIT_FULFILL_RECHECK session_id=${sessionId} reason=${recheckReason} rechecks=${msg.rechecks + 1}`,
          );
        }
      }
      message.ack();
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

// R2-3: DLQ consumer. Logs + alerts, then sets `error` (never over `ready` or
// `awaiting_payment`) and funnel `failed`, then acks. If its own write fails it
// rethrows (no ack) and the DLQ consumer retries the message — up to its
// max_retries (10, wrangler.jsonc); after that the message is dropped, the
// operator alert having already been sent on every attempt.
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
