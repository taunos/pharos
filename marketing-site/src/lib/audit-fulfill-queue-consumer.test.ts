import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuditRunResult } from "./audit-fulfill-run";
import type { AuditFulfillConsumerEnv, AuditFulfillMessage } from "./audit-fulfill-queue-consumer";

// Test C-A (A3 + R2-2/R2-3/R2-8) — astrant-audit-fulfill + DLQ consumers.

const h = vi.hoisted(() => ({
  alerts: [] as Array<{ alert_code: string; session_id?: string; notes?: string }>,
}));
vi.mock("./operator-alerts", () => ({
  sendOperatorAlert: async (_env: unknown, p: { alert_code: string; session_id?: string; notes?: string }) => {
    h.alerts.push(p);
  },
}));

const { auditFulfillQueueHandler, auditFulfillDlqHandler } = await import("./audit-fulfill-queue-consumer");

const SID = "11111111-2222-4333-8444-555555555555";
let store: Map<string, string>;
let sends: Array<{ body: AuditFulfillMessage; opts?: { delaySeconds?: number } }>;
let putFails: boolean;

function makeEnv(): AuditFulfillConsumerEnv {
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      if (putFails) throw new Error("kv down");
      store.set(k, v);
    },
  } as unknown as KVNamespace;
  return {
    SESSIONS: kv,
    RESEND_API_KEY: "re",
    AUDIT_FULFILL_QUEUE: {
      send: async (body: AuditFulfillMessage, opts?: { delaySeconds?: number }) => {
        sends.push({ body, opts });
      },
    },
  } as unknown as AuditFulfillConsumerEnv;
}

function msg(body: unknown, attempts = 1) {
  return { id: "m1", timestamp: new Date(), body, attempts, ack: vi.fn(), retry: vi.fn() };
}
function batch(m: ReturnType<typeof msg>, queue = "astrant-audit-fulfill") {
  return { queue, messages: [m], ackAll: vi.fn(), retryAll: vi.fn() } as unknown as MessageBatch<AuditFulfillMessage>;
}
function seed(status: string) {
  store.set(
    `audit:${SID}`,
    JSON.stringify({ session_id: SID, url: "https://example.com/", email: "buyer@example.com", status, created_at: 1 }),
  );
  store.set(`funnel:audit:${SID}`, JSON.stringify({ created_at: 1, source_scan_id: null, status: "paid" }));
}
const read = () => JSON.parse(store.get(`audit:${SID}`)!);
const funnel = () => JSON.parse(store.get(`funnel:audit:${SID}`)!);
const runReturning = (r: AuditRunResult) => vi.fn(async () => r);
const BODY = { session_id: SID, origin: "https://astrant.io" };

beforeEach(() => {
  store = new Map();
  sends = [];
  putFails = false;
  h.alerts = [];
});

describe("auditFulfillQueueHandler", () => {
  it("done → ack", async () => {
    const m = msg(BODY);
    const run = runReturning({ kind: "done" });
    await auditFulfillQueueHandler(batch(m), makeEnv(), run);
    expect(run).toHaveBeenCalledWith(expect.anything(), SID, "https://astrant.io");
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
  });

  it("noop_terminal → ack", async () => {
    const m = msg(BODY);
    await auditFulfillQueueHandler(batch(m), makeEnv(), runReturning({ kind: "noop_terminal", status: "ready" }));
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("not_found (synthetic smoke) → logged noop + ack", async () => {
    const m = msg({ session_id: "smoke-abc", origin: "https://astrant.io" });
    const log = vi.spyOn(console, "log");
    await auditFulfillQueueHandler(batch(m), makeEnv(), runReturning({ kind: "not_found" }));
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.some((c) => /AUDIT_FULFILL_NOOP session_id=smoke-abc reason=not_found/.test(String(c[0])))).toBe(true);
    log.mockRestore();
  });

  it("not_yet_paid → retry after 30s", async () => {
    const m = msg(BODY);
    await auditFulfillQueueHandler(batch(m), makeEnv(), runReturning({ kind: "not_yet_paid" }));
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(m.ack).not.toHaveBeenCalled();
  });

  it("thrown error (non-final) → retry with 60 × attempts delay, no state change", async () => {
    seed("fulfilling");
    const m = msg(BODY, 2);
    const run = vi.fn(async () => {
      throw new Error("scanner down https://example.com");
    });
    await auditFulfillQueueHandler(batch(m), makeEnv(), run);
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(m.ack).not.toHaveBeenCalled();
    expect(read().status).toBe("fulfilling");
    expect(h.alerts).toHaveLength(0);
  });

  it("final attempt (attempts >= 4) fails → status error + funnel failed + alert (no PII) + ack", async () => {
    seed("fulfilling");
    const m = msg(BODY, 4);
    const run = vi.fn(async () => {
      throw new TypeError("boom for https://example.com buyer@example.com");
    });
    await auditFulfillQueueHandler(batch(m), makeEnv(), run);
    expect(read().status).toBe("error");
    expect(read().error_message).toBeUndefined();
    expect(funnel().status).toBe("failed");
    expect(typeof funnel().failed_at).toBe("number");
    expect(h.alerts).toEqual([
      { alert_code: "AUDIT_FULFILL_FAILED_FINAL", session_id: SID, notes: "error_class=TypeError" },
    ]);
    expect(JSON.stringify(h.alerts)).not.toMatch(/example\.com/);
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
  });

  it("final attempt on a READY session (email step) → never downgraded to error", async () => {
    seed("ready");
    const m = msg(BODY, 4);
    await auditFulfillQueueHandler(batch(m), makeEnv(), vi.fn(async () => {
      throw new Error("AUDIT_READY_EMAIL_FAILED");
    }));
    expect(read().status).toBe("ready");
    expect(funnel().status).toBe("paid");
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("final attempt whose error write fails → throws (no ack) so the DLQ takes it", async () => {
    seed("fulfilling");
    putFails = true;
    const m = msg(BODY, 4);
    await expect(
      auditFulfillQueueHandler(batch(m), makeEnv(), vi.fn(async () => {
        throw new Error("x");
      })),
    ).rejects.toThrow("kv down");
    expect(m.ack).not.toHaveBeenCalled();
  });

  it("cap_deferred → ack + fresh message delayed 6h with deferrals+1 (attempts not consumed)", async () => {
    const m = msg(BODY, 1);
    await auditFulfillQueueHandler(batch(m), makeEnv(), runReturning({ kind: "cap_deferred" }));
    expect(sends).toEqual([
      { body: { session_id: SID, origin: "https://astrant.io", deferrals: 1 }, opts: { delaySeconds: 21600 } },
    ]);
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    expect(h.alerts).toHaveLength(0);
  });

  it("cap_deferred alerts exactly once, at the 2nd deferral, and keeps deferring", async () => {
    const env = makeEnv();
    const run = runReturning({ kind: "cap_deferred" });
    await auditFulfillQueueHandler(batch(msg({ ...BODY, deferrals: 1 })), env, run);
    await auditFulfillQueueHandler(batch(msg({ ...BODY, deferrals: 2 })), env, run);
    expect(sends.map((s) => s.body.deferrals)).toEqual([2, 3]);
    expect(h.alerts.map((a) => a.alert_code)).toEqual(["AUDIT_DIM6_CAP_DEFERRED"]);
  });

  it("malformed message → ack without running", async () => {
    const m = msg({ nope: true });
    const run = vi.fn();
    await auditFulfillQueueHandler(batch(m), makeEnv(), run);
    expect(run).not.toHaveBeenCalled();
    expect(m.ack).toHaveBeenCalledTimes(1);
  });
});

describe("auditFulfillDlqHandler (R2-3)", () => {
  it("sets error + funnel failed + alert + ack", async () => {
    seed("fulfilling");
    const m = msg(BODY);
    await auditFulfillDlqHandler(batch(m, "astrant-audit-fulfill-dlq"), makeEnv());
    expect(read().status).toBe("error");
    expect(funnel().status).toBe("failed");
    expect(h.alerts.map((a) => a.alert_code)).toEqual(["AUDIT_FULFILL_DLQ"]);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("leaves a READY session ready", async () => {
    seed("ready");
    const m = msg(BODY);
    await auditFulfillDlqHandler(batch(m, "astrant-audit-fulfill-dlq"), makeEnv());
    expect(read().status).toBe("ready");
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("own write fails → rethrows, no ack", async () => {
    seed("fulfilling");
    putFails = true;
    const m = msg(BODY);
    await expect(auditFulfillDlqHandler(batch(m, "astrant-audit-fulfill-dlq"), makeEnv())).rejects.toThrow();
    expect(m.ack).not.toHaveBeenCalled();
  });

  it("unknown session → ack (nothing to mark)", async () => {
    const m = msg({ session_id: "smoke-x", origin: "o" });
    await auditFulfillDlqHandler(batch(m, "astrant-audit-fulfill-dlq"), makeEnv());
    expect(m.ack).toHaveBeenCalledTimes(1);
  });
});
