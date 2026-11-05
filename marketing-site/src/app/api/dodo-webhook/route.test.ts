import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSqliteD1, readMigration, PROBE_TARGETS_SQL, type SqliteD1 } from "@/lib/test-support/sqlite-d1";

// Test C-A (A3 + R2-1) — dodo-webhook audit branch: strict transition,
// enqueue-before-state-write, dedupe key last, 500 on enqueue failure.

const state: {
  store: Map<string, string>;
  send: ReturnType<typeof vi.fn>;
  queueBound: boolean;
  failSessionPut: boolean;
  publicOrigin: string | undefined;
  // Slice Q: implementation tier (D1 + astrant-fulfill producer).
  sq: SqliteD1 | null;
  fulfillSend: ReturnType<typeof vi.fn>;
  fulfillBound: boolean;
  maxProbeTargets: string | undefined;
  implGate: string | undefined;
} = {
  store: new Map(),
  send: vi.fn(),
  queueBound: true,
  failSessionPut: false,
  publicOrigin: undefined,
  sq: null,
  fulfillSend: vi.fn(),
  fulfillBound: true,
  maxProbeTargets: undefined,
  implGate: "true",
};

const kv = {
  get: vi.fn(async (k: string) => state.store.get(k) ?? null),
  put: vi.fn(async (k: string, v: string) => {
    if (state.failSessionPut && k.startsWith("audit:")) throw new Error("kv down");
    state.store.set(k, v);
  }),
};

// Real lib/operator-alerts.ts; only Resend is mocked.
const alerts = vi.hoisted(() => ({ subjects: [] as string[], texts: [] as string[] }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (p: { subject: string; text: string }) => {
        alerts.subjects.push(p.subject);
        alerts.texts.push(p.text);
        return { data: { id: "em_1" }, error: null };
      },
    };
  },
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      DODO_WEBHOOK_SECRET: "whsec_test",
      SESSIONS: kv,
      RESEND_API_KEY: "re",
      OPERATOR_ALERT_EMAIL: "ops@example.test",
      ...(state.queueBound ? { AUDIT_FULFILL_QUEUE: { send: state.send } } : {}),
      ...(state.publicOrigin !== undefined ? { PUBLIC_ORIGIN: state.publicOrigin } : {}),
      ...(state.sq ? { CITATION_DB: state.sq.d1 } : {}),
      ...(state.fulfillBound ? { FULFILL_QUEUE: { send: state.fulfillSend } } : {}),
      ...(state.maxProbeTargets !== undefined ? { MAX_PROBE_TARGETS: state.maxProbeTargets } : {}),
      ...(state.implGate !== undefined ? { IMPLEMENTATION_CHECKOUT_ENABLED: state.implGate } : {}),
    },
  }),
}));

const dodoApi = vi.hoisted(() => ({
  getPaymentProducts: vi.fn(async (_env: unknown, _id: string) => ({
    product_cart: [{ product_id: "pdt_0NdQDsS4Shhe1BrDzQDaa", quantity: 1 }],
    subscription_id: null as string | null,
    subscription_ids: [] as unknown[],
  })),
}));
vi.mock("@/lib/dodo", () => ({
  verifyWebhook: async () => ({ valid: true }),
  getPaymentProducts: dodoApi.getPaymentProducts,
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

function webhook(
  id = "wh_1",
  sessionId = SID,
  host = "https://astrant.io",
  extraData: Record<string, unknown> = { product_cart: [{ product_id: "pdt_0NdQDsS4Shhe1BrDzQDaa" }] },
) {
  return new Request(`${host}/api/dodo-webhook`, {
    method: "POST",
    headers: {
      "webhook-id": id,
      "webhook-timestamp": "0",
      "webhook-signature": "v1,x",
    },
    body: JSON.stringify({
      type: "payment.succeeded",
      data: { metadata: { tier: "audit", session_id: sessionId }, ...extraData },
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
  state.failSessionPut = false;
  state.publicOrigin = undefined;
  state.sq = null;
  state.fulfillSend = vi.fn(async () => undefined);
  state.fulfillBound = true;
  state.maxProbeTargets = undefined;
  state.implGate = "true";
  alerts.subjects = [];
  alerts.texts = [];
  kv.get.mockClear();
  kv.put.mockClear();
});

describe("POST /api/dodo-webhook — audit tier", () => {
  const WORKERS_DEV = "https://pharos-marketing.pharos-dev.workers.dev";

  it("Test C-B: webhook on workers.dev + PUBLIC_ORIGIN → enqueues the canonical origin", async () => {
    seed("awaiting_payment");
    state.publicOrigin = "https://astrant.io";
    const { POST } = await import("./route");
    expect((await POST(webhook("wh_po1", SID, WORKERS_DEV))).status).toBe(200);
    expect(state.send).toHaveBeenCalledWith({ session_id: SID, origin: "https://astrant.io" });
  });

  it("Test C-B: PUBLIC_ORIGIN unset or not https → falls back to the request origin", async () => {
    const { POST } = await import("./route");
    for (const [i, po] of [undefined, "http://astrant.io", "not a url"].entries()) {
      state.store = new Map();
      state.send = vi.fn(async () => undefined);
      seed("awaiting_payment");
      state.publicOrigin = po;
      expect((await POST(webhook(`wh_po_fb${i}`, SID, WORKERS_DEV))).status).toBe(200);
      expect(state.send).toHaveBeenCalledWith({ session_id: SID, origin: WORKERS_DEV });
    }
  });

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

  it("unknown session → operator alert, 200 + dedupe, no enqueue", async () => {
    const { POST } = await import("./route");
    const res = await POST(webhook("wh_2", "no-such-session"));
    expect(res.status).toBe(200);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.store.has("webhook:wh_2")).toBe(true);
    expect(alerts.subjects).toEqual(["[ALERT] AUDIT_PAID_SESSION_NOT_FOUND"]);
    expect(alerts.texts[0]).toContain("Session: no-such-session");
  });

  it("unparseable session record → operator alert, 200 + dedupe, no enqueue", async () => {
    state.store.set(`audit:${SID}`, "{not json");
    const { POST } = await import("./route");
    const res = await POST(webhook("wh_3"));
    expect(res.status).toBe(200);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.store.has("webhook:wh_3")).toBe(true);
    expect(alerts.subjects).toEqual(["[ALERT] AUDIT_PAID_SESSION_UNREADABLE"]);
  });

  it("session write fails after enqueue → 500, no dedupe key (Dodo retries)", async () => {
    seed("awaiting_payment");
    state.failSessionPut = true;
    const { POST } = await import("./route");
    const res = await POST(webhook("wh_4"));
    expect(res.status).toBe(500);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(session().status).toBe("awaiting_payment");
    expect(state.store.has("webhook:wh_4")).toBe(false);
  });

  it("happy path sends no operator alert", async () => {
    seed("awaiting_payment");
    const { POST } = await import("./route");
    await POST(webhook("wh_5"));
    expect(alerts.subjects).toEqual([]);
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

describe("POST /api/dodo-webhook — implementation tier (Slice Q)", () => {
  const IMPL_SID = "impl-pay_1";

  function implWebhook(id = "wh_i1") {
    return new Request("https://astrant.io/api/dodo-webhook", {
      method: "POST",
      headers: { "webhook-id": id, "webhook-timestamp": "0", "webhook-signature": "v1,x" },
      body: JSON.stringify({
        type: "payment.succeeded",
        timestamp: "2026-10-08T00:00:00Z",
        data: {
          metadata: { tier: "implementation" },
          payment_id: "pay_1",
          product_cart: [{ product_id: "pdt_0NdQE5vccUUgOHMsF6Pzz" }],
          customer: { customer_id: "sub_cus1", email: "buyer@example.com" },
          custom_field_responses: [
            { key: "site_url", value: "https://example.com" },
            { key: "brand_name", value: "Example" },
            { key: "category", value: "saas" },
          ],
        },
      }),
    });
  }
  const implRow = () =>
    state.sq!.db.prepare(`SELECT status FROM implementation_sessions WHERE session_id = ?`).get(IMPL_SID) as
      | { status: string }
      | undefined;

  beforeEach(() => {
    state.sq = createSqliteD1([readMigration("0008_implementation_sessions.sql"), readMigration("0016_dayn_email_sent_at.sql"), PROBE_TARGETS_SQL]);
  });

  it("new insert → send {kind:impl} → 200 + dedupe; row inserted BEFORE the send", async () => {
    let rowAtSend: unknown = "unset";
    state.fulfillSend = vi.fn(async () => {
      rowAtSend = implRow();
    });
    const { POST } = await import("./route");
    const res = await POST(implWebhook());
    expect(res.status).toBe(200);
    expect(state.fulfillSend).toHaveBeenCalledTimes(1);
    expect(state.fulfillSend).toHaveBeenCalledWith({ kind: "impl", session_id: IMPL_SID });
    expect(rowAtSend).toEqual({ status: "queued" });
    expect(state.store.has("webhook:wh_i1")).toBe(true);
  });

  it("send throws → 500, no webhook: dedupe key", async () => {
    state.fulfillSend = vi.fn(async () => {
      throw new Error("queue down");
    });
    const { POST } = await import("./route");
    const res = await POST(implWebhook());
    expect(res.status).toBe(500);
    expect(implRow()).toEqual({ status: "queued" });
    expect(state.store.has("webhook:wh_i1")).toBe(false);
  });

  it("binding missing → 500, no dedupe", async () => {
    state.fulfillBound = false;
    const { POST } = await import("./route");
    expect((await POST(implWebhook())).status).toBe(500);
    expect(state.store.has("webhook:wh_i1")).toBe(false);
  });

  it("Dodo re-delivery with an existing queued row → send again (recovers a lost enqueue)", async () => {
    state.fulfillSend = vi.fn(async () => {
      throw new Error("queue down");
    });
    const { POST } = await import("./route");
    expect((await POST(implWebhook())).status).toBe(500);
    state.fulfillSend = vi.fn(async () => undefined);
    expect((await POST(implWebhook())).status).toBe(200);
    expect(state.fulfillSend).toHaveBeenCalledWith({ kind: "impl", session_id: IMPL_SID });
    expect(state.store.has("webhook:wh_i1")).toBe(true);
  });

  it.each(["processing", "active", "failed"])("existing %s row → no send, deduped", async (s) => {
    const { POST } = await import("./route");
    expect((await POST(implWebhook("wh_a"))).status).toBe(200);
    state.sq!.db.prepare(`UPDATE implementation_sessions SET status = ? WHERE session_id = ?`).run(s, IMPL_SID);
    state.fulfillSend = vi.fn(async () => undefined);
    const res = await POST(implWebhook("wh_b"));
    expect(res.status).toBe(200);
    expect(state.fulfillSend).not.toHaveBeenCalled();
    expect(state.store.has("webhook:wh_b")).toBe(true);
    expect(implRow()).toEqual({ status: s });
  });

  it("fix round: insert → enqueue fails → capacity fills → Dodo retry → re-send (no capacity gate for a recorded payment)", async () => {
    state.fulfillSend = vi.fn(async () => {
      throw new Error("queue down");
    });
    const { POST } = await import("./route");
    expect((await POST(implWebhook())).status).toBe(500);
    expect(implRow()).toEqual({ status: "queued" });
    // Capacity fills meanwhile.
    state.maxProbeTargets = "1";
    state.sq!.db.exec(`INSERT INTO customer_probe_targets (customer_id, status) VALUES ('sub_other', 'active')`);
    state.fulfillSend = vi.fn(async () => undefined);
    const res = await POST(implWebhook());
    expect(res.status).toBe(200);
    expect(state.fulfillSend).toHaveBeenCalledWith({ kind: "impl", session_id: IMPL_SID });
    expect(state.store.has("webhook:wh_i1")).toBe(true);
    expect(alerts.subjects).toEqual([]);
  });

  it("AT_CAPACITY → 503 AND dedupe write (unchanged), no insert, no send", async () => {
    state.maxProbeTargets = "1";
    state.sq!.db.exec(`INSERT INTO customer_probe_targets (customer_id, status) VALUES ('sub_other', 'active')`);
    const { POST } = await import("./route");
    const res = await POST(implWebhook());
    expect(res.status).toBe(503);
    expect(state.store.has("webhook:wh_i1")).toBe(true);
    expect(implRow()).toBeUndefined();
    expect(state.fulfillSend).not.toHaveBeenCalled();
  });
});

describe("POST /api/dodo-webhook — security pass 2026-11-04 (product binding + gate)", () => {
  it("audit tier paid with a DIFFERENT product → no enqueue, no state change, alert, 200 + dedupe", async () => {
    seed("awaiting_payment");
    const { POST } = await import("./route");
    const res = await POST(
      webhook("wh_wp", SID, "https://astrant.io", {
        payment_id: "pay_x",
        product_cart: [{ product_id: "pdt_SOMETHING_ELSE" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(state.send).not.toHaveBeenCalled();
    expect(session().status).toBe("awaiting_payment");
    expect(alerts.subjects.some((s) => s.includes("AUDIT_PAYMENT_REJECTED"))).toBe(true);
    expect(state.store.has("webhook:wh_wp")).toBe(true);
  });

  it("audit tier paid with the Audit product → fulfilled, no alert", async () => {
    seed("awaiting_payment");
    const { POST } = await import("./route");
    const res = await POST(
      webhook("wh_ok", SID, "https://astrant.io", {
        payment_id: "pay_ok",
        product_cart: [{ product_id: "pdt_0NdQDsS4Shhe1BrDzQDaa" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(alerts.subjects).toHaveLength(0);
  });

  it("no cart in the webhook → looks the payment up in Dodo; Audit product → fulfilled, no alert", async () => {
    seed("awaiting_payment");
    dodoApi.getPaymentProducts.mockClear();
    const { POST } = await import("./route");
    const res = await POST(webhook("wh_np", SID, "https://astrant.io", { payment_id: "pay_np" }));
    expect(res.status).toBe(200);
    expect(dodoApi.getPaymentProducts).toHaveBeenCalledWith(expect.anything(), "pay_np");
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(alerts.subjects).toHaveLength(0);
  });

  it("no cart and the Dodo lookup fails → 503, no enqueue, NO dedupe (Dodo redelivers)", async () => {
    seed("awaiting_payment");
    dodoApi.getPaymentProducts.mockRejectedValueOnce(new Error("Dodo payment lookup failed: 502"));
    const { POST } = await import("./route");
    const res = await POST(webhook("wh_lf", SID, "https://astrant.io", { payment_id: "pay_lf" }));
    expect(res.status).toBe(503);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.store.has("webhook:wh_lf")).toBe(false);
    expect(session().status).toBe("awaiting_payment");
  });

  it("no cart and no payment_id → rejected (no blind allow)", async () => {
    seed("awaiting_payment");
    const { POST } = await import("./route");
    const res = await POST(webhook("wh_none", SID, "https://astrant.io", {}));
    expect(res.status).toBe(200);
    expect(state.send).not.toHaveBeenCalled();
    expect(alerts.subjects.some((s) => s.includes("AUDIT_PAYMENT_REJECTED"))).toBe(true);
  });

  it("cart = [Audit, other product] → rejected (every item is checked, not just [0])", async () => {
    seed("awaiting_payment");
    const { POST } = await import("./route");
    const res = await POST(
      webhook("wh_mix", SID, "https://astrant.io", {
        payment_id: "pay_mix",
        product_cart: [{ product_id: "pdt_0NdQDsS4Shhe1BrDzQDaa" }, { product_id: "pdt_OTHER" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.store.has("manual-review:audit:pay_mix")).toBe(true);
  });

  it("a subscription payment tagged tier=audit → rejected", async () => {
    seed("awaiting_payment");
    const { POST } = await import("./route");
    const res = await POST(
      webhook("wh_sub", SID, "https://astrant.io", {
        payment_id: "pay_sub",
        subscription_id: "sub_123",
        product_cart: [{ product_id: "pdt_0NdQDsS4Shhe1BrDzQDaa" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("implementation tier while IMPLEMENTATION_CHECKOUT_ENABLED is not \"true\" → no insert, no enqueue, alert, 200 + dedupe", async () => {
    state.implGate = "false";
    state.sq = createSqliteD1([readMigration("0008_implementation_sessions.sql"), readMigration("0016_dayn_email_sent_at.sql"), PROBE_TARGETS_SQL]);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://astrant.io/api/dodo-webhook", {
        method: "POST",
        headers: { "webhook-id": "wh_ic", "webhook-timestamp": "0", "webhook-signature": "v1,x" },
        body: JSON.stringify({
          type: "payment.succeeded",
          data: {
            metadata: { tier: "implementation" },
            payment_id: "pay_ic",
            product_cart: [{ product_id: "pdt_0NdQE5vccUUgOHMsF6Pzz" }],
            customer: { customer_id: "cus_ic", email: "buyer@example.com" },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.fulfillSend).not.toHaveBeenCalled();
    const rows = state.sq!.db.prepare(`SELECT COUNT(*) AS n FROM implementation_sessions`).get() as { n: number };
    expect(rows.n).toBe(0);
    expect(alerts.subjects.some((s) => s.includes("IMPLEMENTATION_PAID_WHILE_CLOSED"))).toBe(true);
    expect(state.store.has("manual-review:implementation:pay_ic")).toBe(true);
    expect(state.store.has("webhook:wh_ic")).toBe(true);
  });

  it("lookup fails twice → 503 both times, ONE pending-verification record and ONE alert", async () => {
    seed("awaiting_payment");
    dodoApi.getPaymentProducts.mockRejectedValueOnce(new Error("401")).mockRejectedValueOnce(new Error("401"));
    const { POST } = await import("./route");
    expect((await POST(webhook("wh_pv", SID, "https://astrant.io", { payment_id: "pay_pv" }))).status).toBe(503);
    expect((await POST(webhook("wh_pv", SID, "https://astrant.io", { payment_id: "pay_pv" }))).status).toBe(503);
    expect(state.store.has("pending-verification:audit:pay_pv")).toBe(true);
    expect(alerts.subjects.filter((s) => s.includes("AUDIT_PAYMENT_LOOKUP_FAILED"))).toHaveLength(1);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("API lookup shows a multi-subscription payment (subscription_ids) → rejected", async () => {
    seed("awaiting_payment");
    dodoApi.getPaymentProducts.mockResolvedValueOnce({
      product_cart: [{ product_id: "pdt_0NdQDsS4Shhe1BrDzQDaa", quantity: 1 }],
      subscription_id: null,
      subscription_ids: ["sub_a"],
    });
    const { POST } = await import("./route");
    expect((await POST(webhook("wh_ms", SID, "https://astrant.io", { payment_id: "pay_ms" }))).status).toBe(200);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("rejected payment but the manual-review record can't be written → 503, no dedupe (Dodo retries)", async () => {
    seed("awaiting_payment");
    const origPut = kv.put.getMockImplementation();
    kv.put.mockImplementation(async (k: string, v: string) => {
      if (k.startsWith("manual-review:")) throw new Error("kv down");
      state.store.set(k, v);
    });
    const { POST } = await import("./route");
    const res = await POST(
      webhook("wh_kvf", SID, "https://astrant.io", {
        payment_id: "pay_kvf",
        product_cart: [{ product_id: "pdt_OTHER" }],
      }),
    );
    expect(res.status).toBe(503);
    expect(state.store.has("webhook:wh_kvf")).toBe(false);
    if (origPut) kv.put.mockImplementation(origPut);
  });
});
