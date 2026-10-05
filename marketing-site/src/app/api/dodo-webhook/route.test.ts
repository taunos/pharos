import { describe, it, expect, vi, beforeEach } from "vitest";

// Test C-A (A3 + R2-1) — dodo-webhook audit branch: strict transition,
// enqueue-before-state-write, dedupe key last, 500 on enqueue failure.

const state: {
  store: Map<string, string>;
  send: ReturnType<typeof vi.fn>;
  queueBound: boolean;
} = { store: new Map(), send: vi.fn(), queueBound: true };

const kv = {
  get: vi.fn(async (k: string) => state.store.get(k) ?? null),
  put: vi.fn(async (k: string, v: string) => {
    state.store.set(k, v);
  }),
};

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      DODO_WEBHOOK_SECRET: "whsec_test",
      SESSIONS: kv,
      ...(state.queueBound ? { AUDIT_FULFILL_QUEUE: { send: state.send } } : {}),
    },
  }),
}));

vi.mock("@/lib/dodo", () => ({
  verifyWebhook: async () => ({ valid: true }),
}));

const SID = "11111111-2222-4333-8444-555555555555";

function seed(status: string, extra: Record<string, unknown> = {}) {
  state.store.set(
    `audit:${SID}`,
    JSON.stringify({
      session_id: SID,
      url: "https://example.com/",
      email: "buyer@example.com",
      status,
      created_at: 1,
      ...extra,
    }),
  );
}

function webhook(id = "wh_1", sessionId = SID) {
  return new Request("https://astrant.io/api/dodo-webhook", {
    method: "POST",
    headers: {
      "webhook-id": id,
      "webhook-timestamp": "0",
      "webhook-signature": "v1,x",
    },
    body: JSON.stringify({
      type: "payment.succeeded",
      data: { metadata: { tier: "audit", session_id: sessionId } },
    }),
  });
}

function session() {
  return JSON.parse(state.store.get(`audit:${SID}`)!);
}

beforeEach(() => {
  state.store = new Map();
  state.send = vi.fn(async () => undefined);
  state.queueBound = true;
  kv.get.mockClear();
  kv.put.mockClear();
});

describe("POST /api/dodo-webhook — audit tier", () => {
  it("awaiting_payment → enqueue, then fulfilling + paid_at + enqueued_at, dedupe last", async () => {
    seed("awaiting_payment");
    state.store.set(
      `funnel:audit:${SID}`,
      JSON.stringify({ created_at: 1, source_scan_id: null, status: "checkout_created" }),
    );
    const { POST } = await import("./route");
    const res = await POST(webhook());
    expect(res.status).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send).toHaveBeenCalledWith({ session_id: SID, origin: "https://astrant.io" });
    const s = session();
    expect(s.status).toBe("fulfilling");
    expect(typeof s.paid_at).toBe("number");
    expect(typeof s.enqueued_at).toBe("number");
    expect(JSON.parse(state.store.get(`funnel:audit:${SID}`)!).status).toBe("paid");
    // Ordering: session write before the dedupe key, and dedupe key is the last put.
    const keys = kv.put.mock.calls.map((c) => c[0]);
    expect(keys.indexOf(`audit:${SID}`)).toBeLessThan(keys.indexOf("webhook:wh_1"));
    expect(keys[keys.length - 1]).toBe("webhook:wh_1");
    // Enqueue happened before any session write.
    expect(state.send.mock.invocationCallOrder[0]).toBeLessThan(kv.put.mock.invocationCallOrder[0]);
  });

  it("fulfilling WITHOUT enqueued_at (pre-C-A / crashed write) → enqueue, keeps paid_at", async () => {
    seed("fulfilling", { paid_at: 42 });
    const { POST } = await import("./route");
    expect((await POST(webhook())).status).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(session().paid_at).toBe(42);
    expect(typeof session().enqueued_at).toBe("number");
  });

  it.each([
    ["fulfilling", { enqueued_at: 5 }],
    ["ready", {}],
    ["error", {}],
  ])("%s → no enqueue, state unchanged, 200", async (status, extra) => {
    seed(status, extra);
    const before = state.store.get(`audit:${SID}`);
    const { POST } = await import("./route");
    const res = await POST(webhook());
    expect(res.status).toBe(200);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.store.get(`audit:${SID}`)).toBe(before);
  });

  it("enqueue throws → 500, no state change, no dedupe key", async () => {
    seed("awaiting_payment");
    state.send = vi.fn(async () => {
      throw new Error("queue down");
    });
    const before = state.store.get(`audit:${SID}`);
    const { POST } = await import("./route");
    const res = await POST(webhook());
    expect(res.status).toBe(500);
    expect(state.store.get(`audit:${SID}`)).toBe(before);
    expect(state.store.has("webhook:wh_1")).toBe(false);
  });

  it("queue binding missing → 500, no state change, no dedupe key", async () => {
    seed("awaiting_payment");
    state.queueBound = false;
    const { POST } = await import("./route");
    const res = await POST(webhook());
    expect(res.status).toBe(500);
    expect(session().status).toBe("awaiting_payment");
    expect(state.store.has("webhook:wh_1")).toBe(false);
  });

  it("unknown session → log, 200, no enqueue", async () => {
    const { POST } = await import("./route");
    const res = await POST(webhook("wh_2", "no-such-session"));
    expect(res.status).toBe(200);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.store.has("webhook:wh_2")).toBe(true);
  });

  it("Dodo retry after an enqueue failure re-enters cleanly", async () => {
    seed("awaiting_payment");
    state.send = vi.fn(async () => {
      throw new Error("queue down");
    });
    const { POST } = await import("./route");
    expect((await POST(webhook())).status).toBe(500);
    state.send = vi.fn(async () => undefined);
    expect((await POST(webhook())).status).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(session().status).toBe("fulfilling");
  });
});
