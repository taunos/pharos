// Slice Q (Q0/Q1e/Q1f/Q4 + v1.1 A1/A2/A4/A9) — generic durable fulfillment
// Queue consumers.
//
// astrant-fulfill      → fulfillQueueHandler
// astrant-fulfill-dlq  → fulfillDlqHandler
// Routed by batch.queue in lib/queue-router.ts (worker.ts `queue` handler).
//
// Message kinds:
//   impl      → lib/impl-fulfill-run.ts (Implementation patch fulfillment)
//   impl_day  → lib/impl-day-audit-run.ts (F2 Day-30/60/90 audit)
//
// Consumer config (wrangler.jsonc): max_batch_size 1, max_retries 3 → up to 4
// deliveries; the 4th (message.attempts >= FINAL_ATTEMPT) is the final attempt.
// A1: every branch ends in an explicit ack() or retry(), or throws (→ queue
// retry / DLQ). A shape problem is never thrown: logged + acked.

import { FINAL_ATTEMPT, errorClass } from "./audit-fulfill-queue-consumer";
import {
  IMPL_LEASE_SEC,
  runImplFulfillment,
  type ImplRunEnv,
  type ImplRunResult,
} from "./impl-fulfill-run";
import {
  runImplDayAudit,
  type ImplDayRunEnv,
  type ImplDayRunResult,
} from "./impl-day-audit-run";
import { alertOperator, sendOperatorAlert } from "./operator-alerts";

export const FULFILL_QUEUE_NAME = "astrant-fulfill";
export const FULFILL_DLQ_NAME = "astrant-fulfill-dlq";

export type FulfillMessage =
  | { kind: "impl"; session_id: string; rechecks?: number }
  | { kind: "impl_day"; f2_session_id: string; day_n: 30 | 60 | 90 };

type ParsedFulfillMessage =
  | { kind: "impl"; session_id: string; rechecks: number }
  | { kind: "impl_day"; f2_session_id: string; day_n: 30 | 60 | 90 };

export interface FulfillConsumerEnv extends ImplRunEnv, ImplDayRunEnv {
  FULFILL_QUEUE: Queue<FulfillMessage>;
}

export const MAX_IMPL_RECHECKS = 3;
// Q5: the synthetic smoke uses `impl-smoke-<uuid>` ids (real ids are impl-pay_…).
export const IMPL_SMOKE_PREFIX = "impl-smoke-";

const IMPL_ID_RE = /^impl-[A-Za-z0-9_-]+$/;
const MIN_RECHECK_DELAY_SEC = 60;
const MAX_RECHECK_DELAY_SEC = 43200;

export interface FulfillDeps {
  runImpl: (env: ImplRunEnv, sessionId: string, opts: { finalAttempt: boolean }) => Promise<ImplRunResult>;
  runImplDay: (
    env: ImplDayRunEnv,
    implAudit: { day_n: 30 | 60 | 90; f2_session_id: string },
  ) => Promise<ImplDayRunResult>;
}

const DEFAULT_DEPS: FulfillDeps = { runImpl: runImplFulfillment, runImplDay: runImplDayAudit };

const nonNegInt = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;

export function parseFulfillMessage(body: unknown): ParsedFulfillMessage | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.kind === "impl") {
    if (typeof b.session_id !== "string" || !IMPL_ID_RE.test(b.session_id)) return null;
    return { kind: "impl", session_id: b.session_id, rechecks: nonNegInt(b.rechecks) };
  }
  if (b.kind === "impl_day") {
    if (typeof b.f2_session_id !== "string" || !IMPL_ID_RE.test(b.f2_session_id)) return null;
    if (b.day_n !== 30 && b.day_n !== 60 && b.day_n !== 90) return null;
    return { kind: "impl_day", f2_session_id: b.f2_session_id, day_n: b.day_n };
  }
  return null;
}

export function implRecheckDelaySec(processingStartedAt: number, nowSec: number): number {
  const raw = processingStartedAt + IMPL_LEASE_SEC - nowSec + 30;
  return Math.min(MAX_RECHECK_DELAY_SEC, Math.max(MIN_RECHECK_DELAY_SEC, raw));
}

async function handleImpl(
  message: Message<FulfillMessage>,
  msg: Extract<ParsedFulfillMessage, { kind: "impl" }>,
  env: FulfillConsumerEnv,
  run: FulfillDeps["runImpl"],
): Promise<void> {
  const sessionId = msg.session_id;
  const finalAttempt = message.attempts >= FINAL_ATTEMPT;
  let result: ImplRunResult;
  try {
    result = await run(env, sessionId, { finalAttempt });
  } catch (err) {
    const cls = errorClass(err);
    if (!finalAttempt) {
      // The run already released its claim (Q1c).
      console.error(`IMPL_FULFILL_RETRY session_id=${sessionId} attempt=${message.attempts} class=${cls}`);
      message.retry({ delaySeconds: 60 * message.attempts });
      return;
    }
    // Final attempt: the run catches and writes `failed`; reaching here means
    // that write itself threw. Alert, then rethrow (no ack) → DLQ.
    console.error(`F2_FULFILL_FAILED_FINAL_UNWRITTEN session_id=${sessionId} class=${cls}`);
    await alertOperator(env, "F2_FULFILL_FAILED_FINAL_UNWRITTEN", sessionId, `error_class=${cls}`);
    throw err;
  }

  switch (result.kind) {
    case "done":
      console.log(`IMPL_FULFILL_DONE session_id=${sessionId}`);
      break;
    case "terminal_outcome":
      console.log(`IMPL_FULFILL_TERMINAL_OUTCOME session_id=${sessionId} status=${result.status}`);
      break;
    case "failed_final":
      console.error(`IMPL_FULFILL_FAILED_FINAL session_id=${sessionId}`);
      break;
    case "noop_terminal":
      console.log(`IMPL_FULFILL_NOOP session_id=${sessionId} reason=terminal status=${result.status}`);
      break;
    case "in_flight":
      if (msg.rechecks < MAX_IMPL_RECHECKS) {
        const delaySeconds = implRecheckDelaySec(result.processing_started_at, Math.floor(Date.now() / 1000));
        await env.FULFILL_QUEUE.send({ ...msg, rechecks: msg.rechecks + 1 }, { delaySeconds });
        console.log(
          `IMPL_FULFILL_RECHECK session_id=${sessionId} reason=in_flight rechecks=${msg.rechecks + 1} delay=${delaySeconds}`,
        );
      } else {
        console.error(`F2_FULFILL_STUCK_PROCESSING session_id=${sessionId} rechecks=${msg.rechecks}`);
        await alertOperator(env, "F2_FULFILL_STUCK_PROCESSING", sessionId, `rechecks=${msg.rechecks}`);
      }
      break;
    case "not_found":
      if (sessionId.startsWith(IMPL_SMOKE_PREFIX)) {
        console.log(`IMPL_FULFILL_NOOP session_id=${sessionId} reason=smoke`);
      } else {
        // The webhook inserts the row BEFORE it sends (D1 read-your-writes) —
        // a real id that is missing will not appear later. No recheck loop.
        console.error(`F2_FULFILL_SESSION_NOT_FOUND session_id=${sessionId}`);
        await alertOperator(env, "F2_FULFILL_SESSION_NOT_FOUND", sessionId);
      }
      break;
  }
  message.ack();
}

async function handleImplDay(
  message: Message<FulfillMessage>,
  msg: Extract<ParsedFulfillMessage, { kind: "impl_day" }>,
  env: FulfillConsumerEnv,
  run: FulfillDeps["runImplDay"],
): Promise<void> {
  const id = msg.f2_session_id;
  let result: ImplDayRunResult;
  try {
    result = await run(env, { day_n: msg.day_n, f2_session_id: id });
  } catch (err) {
    const cls = errorClass(err);
    if (message.attempts < FINAL_ATTEMPT) {
      console.error(`IMPL_DAY_RETRY session_id=${id} day_n=${msg.day_n} attempt=${message.attempts} class=${cls}`);
      message.retry({ delaySeconds: 60 * message.attempts });
      return;
    }
    // No state write: fired_at is either still NULL (next daily sweep re-sends)
    // or reset by citation-tracking's 30-min stale-claim cleanup.
    console.error(`F2_DAYN_FAILED_FINAL session_id=${id} day_n=${msg.day_n} class=${cls}`);
    await alertOperator(env, "F2_DAYN_FAILED_FINAL", id, `day_n=${msg.day_n} error_class=${cls}`);
    message.ack();
    return;
  }
  // failed_reset keeps "retry at the next daily sweep" — the queue does not
  // also retry (no double runs).
  console.log(`IMPL_DAY_${result.kind.toUpperCase()} session_id=${id} day_n=${msg.day_n}`);
  message.ack();
}

export async function fulfillQueueHandler(
  batch: MessageBatch<FulfillMessage>,
  env: FulfillConsumerEnv,
  deps: FulfillDeps = DEFAULT_DEPS,
): Promise<void> {
  for (const message of batch.messages) {
    const msg = parseFulfillMessage(message.body);
    if (!msg) {
      console.error("FULFILL_NOOP reason=malformed_message");
      message.ack();
      continue;
    }
    if (msg.kind === "impl") await handleImpl(message, msg, env, deps.runImpl);
    else await handleImplDay(message, msg, env, deps.runImplDay);
  }
}

// Q1f + A4/A9: DLQ consumer. impl → alert FIRST (F2 convention: customer email
// + payment id, fetched best-effort), then `failed('dead_lettered')` only for a
// row that is queued or whose processing lease has expired; otherwise alert
// only. If the write throws, rethrow (no ack) and the DLQ retries (max_retries
// 10). impl_day → alert only (no state write; the daily sweep owns retries).
export async function fulfillDlqHandler(
  batch: MessageBatch<FulfillMessage>,
  env: FulfillConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const msg = parseFulfillMessage(message.body);
    if (!msg) {
      console.error("FULFILL_DLQ_NOOP reason=malformed_message");
      message.ack();
      continue;
    }
    if (msg.kind === "impl_day") {
      console.error(`F2_DAYN_DLQ session_id=${msg.f2_session_id} day_n=${msg.day_n}`);
      await alertOperator(env, "F2_DAYN_DLQ", msg.f2_session_id, `day_n=${msg.day_n}`);
      message.ack();
      continue;
    }
    const sessionId = msg.session_id;
    let contact: { customer_email: string; dodo_payment_id: string } | null = null;
    try {
      contact = await env.CITATION_DB.prepare(
        `SELECT customer_email, dodo_payment_id FROM implementation_sessions WHERE session_id = ?`,
      )
        .bind(sessionId)
        .first<{ customer_email: string; dodo_payment_id: string }>();
    } catch {
      contact = null;
    }
    console.error(`F2_FULFILLMENT_DLQ session_id=${sessionId}`);
    await sendOperatorAlert(env, {
      alert_code: "F2_FULFILLMENT_DLQ",
      customer_email: contact?.customer_email,
      session_id: sessionId,
      dodo_payment_id: contact?.dodo_payment_id,
      notes: "dead_lettered",
    });
    const now = Math.floor(Date.now() / 1000);
    const w = await env.CITATION_DB.prepare(
      `UPDATE implementation_sessions
       SET status = 'failed', failed_reason = 'dead_lettered', updated_at = ?1
       WHERE session_id = ?2
         AND (status = 'queued' OR (status = 'processing' AND processing_started_at < ?1 - ?3))`,
    )
      .bind(now, sessionId, IMPL_LEASE_SEC)
      .run();
    if (w.meta.changes !== 1) {
      console.error(`F2_FULFILLMENT_DLQ_WRITE_SKIPPED session_id=${sessionId} reason=not_reclaimable`);
    }
    message.ack();
  }
}
