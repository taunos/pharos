import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuditRunResult } from "./audit-fulfill-run";
import type { AuditFulfillConsumerEnv, AuditFulfillMessage } from "./audit-fulfill-queue-consumer";

// Test C-A (A3 + R2-2/R2-3/R2-8 + fix round) — astrant-audit-fulfill + DLQ
// consumers. Alerts go through the REAL lib/operator-alerts.ts; only Resend is
// mocked (so a Resend { error } result is exercised end to end).

const h = vi.hoisted(() => ({
  sends: [] as Array<{ to: unknown; subject: string; text: string }>,
  resendError: null as null | { message: string },
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (p: { to: unknown; subject: string; text: string }) => {
        h.sends.push(p);
        return h.resendError ? { data: null, error: h.resendError } : { data: { id: "em_1" }, error: null };
      },
    };
  },
}));

const { auditFulfillQueueHandler, auditFulfillDlqHandler } = await import("./audit-fulfill-queue-consumer");

const SID = "11111111-2222-4333-8444-555555555555";
let store: Map<string, string>;
let sends: Array<{ body: AuditFulfillMessage; opts?: { delaySeconds?: number } }>;
let putFails: boolean;
let events: string[];

const alertCodes = () => h.sends.map((s) => s.subject.replace(/^\[ALERT\] /, ""));

function makeEnv(): AuditFulfillConsumerEnv {
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      events.push(`put:${k}`);
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
const throwing = (e: Error) => vi.fn(async () => {
  throw e;
});
const BODY = { session_id: SID, origin: "https://astrant.io" };

beforeEach(() => {
  store = new Map();
  sends = [];
  putFails = false;
  events = [];
  h.sends = [];
  h.resendError = null;
});

describe("auditFulfillQueueHandler — outcomes", () => {
  it('done → ack; run is called with onCap "defer"', async () => {
    const m = msg(BODY);
    const run = runReturning({ kind: "done" });
    await auditFulfillQueueHandler(batch(m), makeEnv(), run);
    expect(run).toHaveBeenCalledWith(expect.anything(), SID, "https://astrant.io", { onCap: "defer" });
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
  });

  it("noop_terminal → ack", async () => {
    const m = msg(BODY);
    await auditFulfillQueueHandler(batch(m), makeEnv(), runReturning({ kind: "noop_terminal", status: "ready" }));
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(sends).toHaveLength(0);
  });

  it("not_found for a smoke- id → logged noop + ack, no recheck", async () => {
    const m = msg({ session_id: "smoke-abc", origin: "https://astrant.io" });
    const log = vi.spyOn(console, "log");
    await auditFulfillQueueHandler(batch(m), makeEnv(), runReturning({ kind: "not_found" }));
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(sends).toHaveLength(0);
    expect(log.mock.calls.some((c) => /AUDIT_FULFILL_NOOP session_id=smoke-abc reason=not_found/.test(String(c[0])))).toBe(true);
    log.mockRestore();
  });

  it.each([
    ["not_yet_paid", { kind: "not_yet_paid" } as AuditRunResult],
    ["not_found (real id)", { kind: "not_found" } as AuditRunResult],
  ])("%s → ack + fresh message in 60s with rechecks+1 (no message.retry)", async (_label, result) => {
    const m = msg({ ...BODY, rechecks: 3, deferrals: 1 });
    await auditFulfillQueueHandler(batch(m), makeEnv(), runReturning(result));
    expect(m.retry).not.toHaveBeenCalled();
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(sends).toEqual([
      { body: { ...BODY, rechecks: 4, deferrals: 1 }, opts: { delaySeconds: 60 } },
    ]);
    expect(h.sends).toHaveLength(0);
  });

  it("rechecks exhausted (10) → operator alert, NO state write, ack, no re-send", async () => {
    seed("awaiting_payment");
    const before = store.get(`audit:${SID}`);
    const m = msg({ ...BODY, rechecks: 10 });
    await auditFulfillQueueHandler(batch(m), makeEnv(), runReturning({ kind: "not_yet_paid" }));
    expect(sends).toHaveLength(0);
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(store.get(`audit:${SID}`)).toBe(before);
    expect(events).toEqual([]);
    expect(alertCodes()).toEqual(["AUDIT_FULFILL_RECHECKS_EXHAUSTED"]);
    expect(h.sends[0].text).toContain(`Session: ${SID}`);
    expect(h.sends[0].text).toContain("reason=not_yet_paid rechecks=10");
  });

  it("cap_deferred → ack + fresh message delayed 6h with deferrals+1 (attempts not consumed)", async () => {
    const m = msg(BODY, 1);
    await auditFulfillQueueHandler(batch(m), makeEnv(), runReturning({ kind: "cap_deferred" }));
    expect(sends).toEqual([
      { body: { ...BODY, deferrals: 1, rechecks: 0 }, opts: { delaySeconds: 21600 } },
    ]);
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    expect(h.sends).toHaveLength(0);
  });

  it("cap_deferred alerts exactly once, at the 2nd deferral, and keeps deferring", async () => {
    const env = makeEnv();
    const run = runReturning({ kind: "cap_deferred" });
    await auditFulfillQueueHandler(batch(msg({ ...BODY, deferrals: 1 })), env, run);
    await auditFulfillQueueHandler(batch(msg({ ...BODY, deferrals: 2 })), env, run);
    expect(sends.map((s) => s.body.deferrals)).toEqual([2, 3]);
    expect(alertCodes()).toEqual(["AUDIT_DIM6_CAP_DEFERRED"]);
  });

  it("malformed message → ack without running", async () => {
    const m = msg({ nope: true });
    const run = vi.fn();
    await auditFulfillQueueHandler(batch(m), makeEnv(), run);
    expect(run).not.toHaveBeenCalled();
    expect(m.ack).toHaveBeenCalledTimes(1);
  });
});

describe("auditFulfillQueueHandler — thrown errors", () => {
  it("non-final → retry with 60 × attempts delay, no state change, no alert", async () => {
    seed("fulfilling");
    const m = msg(BODY, 2);
    await auditFulfillQueueHandler(batch(m), makeEnv(), throwing(new Error("scanner down https://example.com")));
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(m.ack).not.toHaveBeenCalled();
    expect(read().status).toBe("fulfilling");
    expect(h.sends).toHaveLength(0);
  });

  it("final attempt (attempts >= 4) → alert (no PII) BEFORE write, then error + funnel failed, ack", async () => {
    seed("fulfilling");
    const m = msg(BODY, 4);
    const errLog = vi.spyOn(console, "error");
    await auditFulfillQueueHandler(batch(m), makeEnv(), throwing(new TypeError("boom https://example.com buyer@example.com")));
    expect(read().status).toBe("error");
    expect(read().error_message).toBeUndefined();
    expect(funnel().status).toBe("failed");
    expect(alertCodes()).toEqual(["AUDIT_FULFILL_FAILED_FINAL"]);
    expect(h.sends[0].text).toContain("error_class=TypeError");
    expect(JSON.stringify(h.sends)).not.toMatch(/example\.com/);
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    expect(errLog.mock.calls.some((c) => String(c[0]).startsWith(`AUDIT_FULFILL_FAILED_FINAL session_id=${SID}`))).toBe(true);
    errLog.mockRestore();
  });

  it("final attempt on a READY session (email step) → AUDIT_READY_EMAIL_FAILED alert once with error class; never downgraded", async () => {
    seed("ready");
    const emailErr = new Error("AUDIT_READY_EMAIL_FAILED");
    emailErr.name = "AuditReadyEmailError";
    const env = makeEnv();
    for (const attempt of [1, 2, 3]) {
      await auditFulfillQueueHandler(batch(msg(BODY, attempt)), env, throwing(emailErr));
    }
    expect(h.sends).toHaveLength(0); // no alert on non-final attempts
    const m = msg(BODY, 4);
    await auditFulfillQueueHandler(batch(m), env, throwing(emailErr));
    expect(alertCodes()).toEqual(["AUDIT_READY_EMAIL_FAILED"]);
    expect(h.sends[0].text).toContain("error_class=AuditReadyEmailError");
    expect(read().status).toBe("ready");
    expect(funnel().status).toBe("paid");
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("final attempt on an AWAITING_PAYMENT session → alert only, no error write", async () => {
    seed("awaiting_payment");
    const m = msg(BODY, 4);
    await auditFulfillQueueHandler(batch(m), makeEnv(), throwing(new Error("x")));
    expect(read().status).toBe("awaiting_payment");
    expect(events).toEqual([]);
    expect(alertCodes()).toEqual(["AUDIT_FULFILL_FAILED_FINAL"]);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("final attempt whose error write fails → alert already sent, throws (no ack) so the DLQ takes it", async () => {
    seed("fulfilling");
    putFails = true;
    const m = msg(BODY, 4);
    await expect(auditFulfillQueueHandler(batch(m), makeEnv(), throwing(new Error("x")))).rejects.toThrow("kv down");
    expect(alertCodes()).toEqual(["AUDIT_FULFILL_FAILED_FINAL"]);
    expect(m.ack).not.toHaveBeenCalled();
  });
});

describe("operator alert send failure (real helper, Resend returns { error })", () => {
  it("logs OPERATOR_ALERT_SEND_FAILED code=<code> and stays fail-open (consumer still acks)", async () => {
    seed("fulfilling");
    h.resendError = { message: "domain_not_verified" };
    const errLog = vi.spyOn(console, "error");
    const m = msg(BODY, 4);
    await auditFulfillQueueHandler(batch(m), makeEnv(), throwing(new Error("x")));
    expect(
      errLog.mock.calls.some((c) =>
        String(c[0]).startsWith("OPERATOR_ALERT_SEND_FAILED code=AUDIT_FULFILL_FAILED_FINAL"),
      ),
    ).toBe(true);
    expect(read().status).toBe("error");
    expect(m.ack).toHaveBeenCalledTimes(1);
    errLog.mockRestore();
  });
});

describe("auditFulfillDlqHandler (R2-3)", () => {
  it("alerts BEFORE the KV write, then error + funnel failed + ack", async () => {
    seed("fulfilling");
    const m = msg(BODY);
    const order: string[] = [];
    const errLog = vi.spyOn(console, "error").mockImplementation((s: unknown) => {
      order.push(`log:${String(s).split(" ")[0]}`);
    });
    const env = makeEnv();
    const kvPut = env.SESSIONS.put.bind(env.SESSIONS);
    (env.SESSIONS as unknown as { put: typeof kvPut }).put = async (k: string, v: string) => {
      order.push(`put:${k}:alerts=${h.sends.length}`);
      return kvPut(k, v);
    };
    await auditFulfillDlqHandler(batch(m, "astrant-audit-fulfill-dlq"), env);
    errLog.mockRestore();
    expect(order[0]).toBe("log:AUDIT_FULFILL_DLQ");
    expect(order[1]).toBe(`put:audit:${SID}:alerts=1`);
    expect(read().status).toBe("error");
    expect(funnel().status).toBe("failed");
    expect(alertCodes()).toEqual(["AUDIT_FULFILL_DLQ"]);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("leaves a READY session ready (alerts AUDIT_READY_EMAIL_FAILED)", async () => {
    seed("ready");
    const m = msg(BODY);
    await auditFulfillDlqHandler(batch(m, "astrant-audit-fulfill-dlq"), makeEnv());
    expect(read().status).toBe("ready");
    expect(alertCodes()).toEqual(["AUDIT_READY_EMAIL_FAILED"]);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("leaves an AWAITING_PAYMENT session untouched (alert only)", async () => {
    seed("awaiting_payment");
    const m = msg(BODY);
    await auditFulfillDlqHandler(batch(m, "astrant-audit-fulfill-dlq"), makeEnv());
    expect(read().status).toBe("awaiting_payment");
    expect(events).toEqual([]);
    expect(alertCodes()).toEqual(["AUDIT_FULFILL_DLQ"]);
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("own write fails → alert already sent, rethrows, no ack", async () => {
    seed("fulfilling");
    putFails = true;
    const m = msg(BODY);
    await expect(auditFulfillDlqHandler(batch(m, "astrant-audit-fulfill-dlq"), makeEnv())).rejects.toThrow();
    expect(alertCodes()).toEqual(["AUDIT_FULFILL_DLQ"]);
    expect(m.ack).not.toHaveBeenCalled();
  });

  it("unknown session → alert + ack (nothing to mark)", async () => {
    const m = msg({ session_id: "smoke-x", origin: "o" });
    await auditFulfillDlqHandler(batch(m, "astrant-audit-fulfill-dlq"), makeEnv());
    expect(m.ack).toHaveBeenCalledTimes(1);
  });
});
