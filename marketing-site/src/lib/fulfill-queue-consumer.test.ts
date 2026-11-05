import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSqliteD1, readMigration, type SqliteD1 } from "./test-support/sqlite-d1";
import type { ImplRunResult } from "./impl-fulfill-run";
import type { ImplDayRunResult } from "./impl-day-audit-run";
import type { FulfillConsumerEnv, FulfillDeps, FulfillMessage } from "./fulfill-queue-consumer";

// Slice Q (Q0/Q1e/Q1f/Q4 + v1.1 A1/A2/A4/A9) — astrant-fulfill + DLQ consumers.
// Runs are injected; alerts go through the REAL lib/operator-alerts.ts with
// only Resend mocked. The DLQ write runs against node:sqlite.

const h = vi.hoisted(() => ({ sends: [] as Array<{ subject: string; text: string }> }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (p: { subject: string; text: string }) => {
        h.sends.push(p);
        return { data: { id: "em_1" }, error: null };
      },
    };
  },
}));

const {
  fulfillQueueHandler,
  fulfillDlqHandler,
  parseFulfillMessage,
  implRecheckDelaySec,
  MAX_IMPL_RECHECKS,
} = await import("./fulfill-queue-consumer");

const SID = "impl-pay_abc";
let sq: SqliteD1;
let sends: Array<{ body: FulfillMessage; opts?: { delaySeconds?: number } }>;
const alertCodes = () => h.sends.map((s) => s.subject.replace(/^\[ALERT\] /, ""));

function makeEnv(): FulfillConsumerEnv {
  return {
    CITATION_DB: sq.d1,
    RESEND_API_KEY: "re",
    OPERATOR_ALERT_EMAIL: "ops@example.test",
    FULFILL_QUEUE: {
      send: async (body: FulfillMessage, opts?: { delaySeconds?: number }) => {
        sends.push({ body, opts });
      },
    },
  } as unknown as FulfillConsumerEnv;
}
function msg(body: unknown, attempts = 1) {
  return { id: "m1", timestamp: new Date(), body, attempts, ack: vi.fn(), retry: vi.fn() };
}
function batch(m: ReturnType<typeof msg>, queue = "astrant-fulfill") {
  return { queue, messages: [m], ackAll: vi.fn(), retryAll: vi.fn() } as unknown as MessageBatch<FulfillMessage>;
}
function deps(impl?: FulfillDeps["runImpl"], day?: FulfillDeps["runImplDay"]): FulfillDeps {
  return {
    runImpl: impl ?? vi.fn(async () => ({ kind: "done" }) as ImplRunResult),
    runImplDay: day ?? vi.fn(async () => ({ kind: "done" }) as ImplDayRunResult),
  };
}
const implReturning = (r: ImplRunResult) => vi.fn(async () => r);
const throwing = () => vi.fn(async () => {
  throw new TypeError("boom");
});
const IMPL = { kind: "impl", session_id: SID };
const DAY = { kind: "impl_day", f2_session_id: SID, day_n: 60 };

function seedImpl(status: string, processingStartedAt: number | null = null) {
  sq.db
    .prepare(
      `INSERT INTO implementation_sessions (session_id, dodo_payment_id, customer_email, customer_domain,
         brand_name, category, customer_id, status, payment_succeeded_at, processing_started_at,
         bundle_expires_at, created_at, updated_at)
       VALUES (?, 'pay_abc', 'buyer@example.com', 'https://example.com', 'Ex', 'saas', 'sub_c', ?, 1, ?, 2, 1, 1)`,
    )
    .run(SID, status, processingStartedAt);
}
const status = () =>
  (sq.db.prepare(`SELECT status, failed_reason FROM implementation_sessions WHERE session_id = ?`).get(SID) ??
    null) as { status: string; failed_reason: string | null } | null;

beforeEach(() => {
  sq = createSqliteD1([readMigration("0008_implementation_sessions.sql"), readMigration("0016_dayn_email_sent_at.sql")]);
  sends = [];
  h.sends = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("parseFulfillMessage", () => {
  it("accepts valid impl / impl_day; normalises rechecks", () => {
    const base = { kind: "impl", session_id: SID, rechecks: 0, dlq_requeues: 0 };
    expect(parseFulfillMessage(IMPL)).toEqual(base);
    expect(parseFulfillMessage({ ...IMPL, rechecks: 2 })).toEqual({ ...base, rechecks: 2 });
    expect(parseFulfillMessage({ ...IMPL, rechecks: -1 })).toEqual(base);
    expect(parseFulfillMessage({ ...IMPL, dlq_requeues: 1 })).toEqual({ ...base, dlq_requeues: 1 });
    expect(parseFulfillMessage({ ...IMPL, dlq_requeues: "x" })).toEqual(base);
    expect(parseFulfillMessage(DAY)).toEqual(DAY);
  });

  it.each([
    null,
    "x",
    {},
    { kind: "audit", session_id: SID },
    { kind: "impl", session_id: "pay_abc" },
    { kind: "impl", session_id: "impl-a b" },
    { kind: "impl_day", f2_session_id: "nope", day_n: 30 },
    { kind: "impl_day", f2_session_id: SID, day_n: 45 },
    { kind: "impl_day", f2_session_id: SID, day_n: "30" },
  ])("rejects %j", (b) => {
    expect(parseFulfillMessage(b)).toBeNull();
  });
});

describe("fulfillQueueHandler — malformed", () => {
  it("unknown kind → FULFILL_NOOP + ack, no run", async () => {
    const m = msg({ kind: "weird" });
    const d = deps();
    await fulfillQueueHandler(batch(m), makeEnv(), d);
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    expect(d.runImpl).not.toHaveBeenCalled();
    expect(d.runImplDay).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.some((c) => c[0] === "FULFILL_NOOP reason=malformed_message")).toBe(true);
  });
});

describe("fulfillQueueHandler — impl", () => {
  it.each<ImplRunResult>([
    { kind: "done" },
    { kind: "terminal_outcome", status: "failed_validation" },
    { kind: "terminal_outcome", status: "failed_ceiling" },
    { kind: "terminal_outcome", status: "active_email_pending" },
    { kind: "noop_terminal", status: "active" },
    { kind: "failed_final" },
  ])("%j → ack, no alert, no send", async (r) => {
    const m = msg(IMPL);
    await fulfillQueueHandler(batch(m), makeEnv(), deps(implReturning(r)));
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    expect(sends).toEqual([]);
    expect(alertCodes()).toEqual([]);
  });

  it("in_flight → re-send with rechecks+1 and a clamped delay, then ack", async () => {
    const now = Math.floor(Date.now() / 1000);
    const m = msg(IMPL);
    await fulfillQueueHandler(batch(m), makeEnv(), deps(implReturning({ kind: "in_flight", processing_started_at: now - 100 })));
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toEqual({ kind: "impl", session_id: SID, rechecks: 1, dlq_requeues: 0 });
    const d = sends[0].opts!.delaySeconds!;
    expect(d).toBeGreaterThanOrEqual(1200 - 100 + 30 - 2);
    expect(d).toBeLessThanOrEqual(1200 - 100 + 30);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("recheck delay clamps to [60, 43200]", () => {
    expect(implRecheckDelaySec(0, 10_000_000)).toBe(60);
    expect(implRecheckDelaySec(10_000_000, 0)).toBe(43200);
    expect(implRecheckDelaySec(1000, 1000)).toBe(1230);
  });

  it("in_flight at rechecks=MAX → F2_FULFILL_STUCK_PROCESSING + ack, no send", async () => {
    const m = msg({ ...IMPL, rechecks: MAX_IMPL_RECHECKS });
    await fulfillQueueHandler(batch(m), makeEnv(), deps(implReturning({ kind: "in_flight", processing_started_at: 1 })));
    expect(sends).toEqual([]);
    expect(alertCodes()).toEqual(["F2_FULFILL_STUCK_PROCESSING"]);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("not_found with an impl-smoke- id → ack, no alert", async () => {
    const m = msg({ kind: "impl", session_id: "impl-smoke-1234" });
    await fulfillQueueHandler(batch(m), makeEnv(), deps(implReturning({ kind: "not_found" })));
    expect(alertCodes()).toEqual([]);
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.log).mock.calls.some((c) => String(c[0]).includes("IMPL_FULFILL_NOOP") && String(c[0]).includes("smoke"))).toBe(true);
  });

  it("not_found with a real id → F2_FULFILL_SESSION_NOT_FOUND + ack, no recheck", async () => {
    const m = msg(IMPL);
    await fulfillQueueHandler(batch(m), makeEnv(), deps(implReturning({ kind: "not_found" })));
    expect(alertCodes()).toEqual(["F2_FULFILL_SESSION_NOT_FOUND"]);
    expect(sends).toEqual([]);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2, 3])("thrown at attempt %i → retry(60·n), run called with finalAttempt:false, no ack", async (n) => {
    const run = throwing();
    const m = msg(IMPL, n);
    await fulfillQueueHandler(batch(m), makeEnv(), deps(run));
    expect(run).toHaveBeenCalledWith(expect.anything(), SID, { finalAttempt: false });
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 60 * n });
    expect(m.ack).not.toHaveBeenCalled();
    expect(alertCodes()).toEqual([]);
  });

  it("attempt 4 → run called with finalAttempt:true", async () => {
    const run = implReturning({ kind: "failed_final" });
    const m = msg(IMPL, 4);
    await fulfillQueueHandler(batch(m), makeEnv(), deps(run));
    expect(run).toHaveBeenCalledWith(expect.anything(), SID, { finalAttempt: true });
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("A1/A2: thrown at the final attempt (failure write failed) → alert, rethrow, never acked", async () => {
    const m = msg(IMPL, 4);
    await expect(fulfillQueueHandler(batch(m), makeEnv(), deps(throwing()))).rejects.toThrow("boom");
    expect(alertCodes()).toEqual(["F2_FULFILL_FAILED_FINAL_UNWRITTEN"]);
    expect(m.ack).not.toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
  });
});

describe("fulfillQueueHandler — impl_day", () => {
  it.each<ImplDayRunResult>([{ kind: "done" }, { kind: "deduped" }, { kind: "failed_reset" }])(
    "%j → ack (no queue retry)",
    async (r) => {
      const day = vi.fn(async () => r);
      const m = msg(DAY);
      await fulfillQueueHandler(batch(m), makeEnv(), deps(undefined, day));
      expect(day).toHaveBeenCalledWith(expect.anything(), { day_n: 60, f2_session_id: SID });
      expect(m.ack).toHaveBeenCalledTimes(1);
      expect(m.retry).not.toHaveBeenCalled();
    },
  );

  it("thrown before final → retry(60·n)", async () => {
    const m = msg(DAY, 2);
    await fulfillQueueHandler(batch(m), makeEnv(), deps(undefined, throwing()));
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(m.ack).not.toHaveBeenCalled();
  });

  it("thrown at the final attempt → F2_DAYN_FAILED_FINAL + ack", async () => {
    const m = msg(DAY, 4);
    await fulfillQueueHandler(batch(m), makeEnv(), deps(undefined, throwing()));
    expect(alertCodes()).toEqual(["F2_DAYN_FAILED_FINAL"]);
    expect(h.sends[0].text).toContain("day_n=60");
    expect(m.ack).toHaveBeenCalledTimes(1);
  });
});

describe("fulfillDlqHandler", () => {
  it("impl, queued row → alert (with customer email) FIRST, then failed('dead_lettered'), ack", async () => {
    seedImpl("queued");
    const m = msg(IMPL);
    await fulfillDlqHandler(batch(m, "astrant-fulfill-dlq"), makeEnv());
    expect(alertCodes()).toEqual(["F2_FULFILLMENT_DLQ"]);
    expect(h.sends[0].text).toContain("Customer: buyer@example.com");
    expect(h.sends[0].text).toContain("Dodo payment: pay_abc");
    expect(status()).toEqual({ status: "failed", failed_reason: "dead_lettered" });
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("A4: impl, processing past the lease → failed", async () => {
    seedImpl("processing", Math.floor(Date.now() / 1000) - 1300);
    await fulfillDlqHandler(batch(msg(IMPL), "astrant-fulfill-dlq"), makeEnv());
    expect(status()!.status).toBe("failed");
  });

  it.each(["active", "failed_validation"])("A4: impl, %s (not reclaimable) → alert only, row unchanged, no re-send, ack", async (s) => {
    seedImpl(s, null);
    const m = msg(IMPL);
    await fulfillDlqHandler(batch(m, "astrant-fulfill-dlq"), makeEnv());
    expect(alertCodes()).toEqual(["F2_FULFILLMENT_DLQ"]);
    expect(status()!.status).toBe(s);
    expect(sends).toEqual([]);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("fix round: processing under a FRESH lease → alert, row unchanged, delayed re-send past the lease (dlq_requeues+1), ack", async () => {
    const started = Math.floor(Date.now() / 1000) - 10;
    seedImpl("processing", started);
    const m = msg(IMPL);
    await fulfillDlqHandler(batch(m, "astrant-fulfill-dlq"), makeEnv());
    expect(alertCodes()).toEqual(["F2_FULFILLMENT_DLQ"]);
    expect(status()!.status).toBe("processing");
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toEqual({ kind: "impl", session_id: SID, rechecks: 0, dlq_requeues: 1 });
    const d = sends[0].opts!.delaySeconds!;
    expect(d).toBeGreaterThan(1200 - 10 - 2); // past the lease remainder
    expect(d).toBeLessThanOrEqual(1200 - 10 + 30);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("fix round: fresh lease with dlq_requeues exhausted → F2_FULFILLMENT_DLQ_REQUEUES_EXHAUSTED, no re-send, ack", async () => {
    seedImpl("processing", Math.floor(Date.now() / 1000) - 10);
    const m = msg({ ...IMPL, dlq_requeues: 2 });
    await fulfillDlqHandler(batch(m, "astrant-fulfill-dlq"), makeEnv());
    expect(alertCodes()).toEqual(["F2_FULFILLMENT_DLQ", "F2_FULFILLMENT_DLQ_REQUEUES_EXHAUSTED"]);
    expect(sends).toEqual([]);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("fix round: the re-send throws → rethrow, no ack (DLQ retries)", async () => {
    seedImpl("processing", Math.floor(Date.now() / 1000) - 10);
    const env = makeEnv();
    (env as unknown as { FULFILL_QUEUE: { send: () => Promise<void> } }).FULFILL_QUEUE = {
      send: async () => {
        throw new Error("queue down");
      },
    };
    const m = msg(IMPL);
    await expect(fulfillDlqHandler(batch(m, "astrant-fulfill-dlq"), env)).rejects.toThrow("queue down");
    expect(m.ack).not.toHaveBeenCalled();
  });

  it("impl, the write throws → alert already sent, rethrow, no ack", async () => {
    seedImpl("queued");
    sq.failWhen = (sql) => sql.includes("dead_lettered");
    const m = msg(IMPL);
    await expect(fulfillDlqHandler(batch(m, "astrant-fulfill-dlq"), makeEnv())).rejects.toThrow(/injected/);
    expect(alertCodes()).toEqual(["F2_FULFILLMENT_DLQ"]);
    expect(m.ack).not.toHaveBeenCalled();
  });

  it("impl, the contact SELECT throws → alert still sent (session id only)", async () => {
    seedImpl("queued");
    sq.failWhen = (sql) => sql.startsWith("SELECT customer_email");
    await fulfillDlqHandler(batch(msg(IMPL), "astrant-fulfill-dlq"), makeEnv());
    expect(alertCodes()).toEqual(["F2_FULFILLMENT_DLQ"]);
    expect(h.sends[0].text).toContain(`Session: ${SID}`);
    expect(status()!.status).toBe("failed");
  });

  it("impl_day → alert only, no state write, ack", async () => {
    seedImpl("active");
    const m = msg(DAY);
    await fulfillDlqHandler(batch(m, "astrant-fulfill-dlq"), makeEnv());
    expect(alertCodes()).toEqual(["F2_DAYN_DLQ"]);
    expect(status()!.status).toBe("active");
    expect(sq.calls.filter((c) => c.sql.startsWith("UPDATE") || c.sql.includes("UPDATE "))).toEqual([]);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("malformed → ack", async () => {
    const m = msg({ kind: "nope" });
    await fulfillDlqHandler(batch(m, "astrant-fulfill-dlq"), makeEnv());
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(alertCodes()).toEqual([]);
  });
});
