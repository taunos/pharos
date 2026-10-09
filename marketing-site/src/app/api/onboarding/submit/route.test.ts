import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSqliteD1, PROBE_TARGETS_SQL, SUBSCRIPTIONS_SQL, type SqliteD1 } from "@/lib/test-support/sqlite-d1";

// Slice Q (Q2 + v1.1 A5) — the LIVE ap- welcome audit dispatch: durable enqueue
// onto AUDIT_FULFILL_QUEUE instead of ctx.waitUntil(fetch). KV put + send in one
// try; any failure alerts, releases audit_fired_at (guarded) and still 303s.

const state = vi.hoisted(() => ({
  sq: null as unknown as SqliteD1,
  kv: new Map<string, string>(),
  events: [] as string[],
  send: null as unknown as ReturnType<typeof vi.fn>,
  queueBound: true,
  waitUntil: null as unknown as ReturnType<typeof vi.fn>,
  alerts: [] as Array<{ subject: string; text: string }>,
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (p: { subject: string; text: string }) => {
        state.alerts.push(p);
        state.events.push(`alert:${p.subject}`);
        return { data: { id: "em_1" }, error: null };
      },
    };
  },
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      CITATION_DB: state.sq.d1,
      SESSIONS: {
        put: async (k: string, v: string) => {
          state.events.push(`kv:${k}`);
          state.kv.set(k, v);
        },
        get: async (k: string) => state.kv.get(k) ?? null,
      },
      PUBLIC_ORIGIN: "https://astrant.io",
      RESEND_API_KEY: "re",
      OPERATOR_ALERT_EMAIL: "ops@example.test",
      STANDARD_PRODUCT_ID: "pdt_std",
      PRO_PRODUCT_ID: "pdt_pro",
      ...(state.queueBound ? { AUDIT_FULFILL_QUEUE: { send: state.send } } : {}),
    },
    ctx: { waitUntil: state.waitUntil },
  }),
}));
vi.mock("@/lib/onboarding-token", () => ({
  verifyOnboardingToken: async () => ({ ok: true, subscriptionId: "sub_abc" }),
}));
vi.mock("@/lib/account-link", () => ({ signSubscriptionId: async () => "sig" }));
vi.mock("@/lib/customer-categories", () => ({ isValidCustomerCategory: () => true }));

const SUB = "sub_abc";

function submit() {
  const form = new FormData();
  form.set("t", "tok");
  form.set("brand_name", "Example");
  form.set("domain", "example.com");
  form.set("category", "saas");
  form.set("competitors_csv", "");
  // Arrives on the workers.dev host; the enqueued origin must be PUBLIC_ORIGIN.
  return new Request("https://pharos-marketing.pharos-dev.workers.dev/api/onboarding/submit", {
    method: "POST",
    body: form,
  });
}
const firedAt = () =>
  (sq().db.prepare(`SELECT audit_fired_at FROM subscriptions WHERE subscription_id = ?`).get(SUB) as {
    audit_fired_at: number | null;
  }).audit_fired_at;
const sq = () => state.sq;

beforeEach(() => {
  state.sq = createSqliteD1([SUBSCRIPTIONS_SQL, PROBE_TARGETS_SQL]);
  state.sq.db
    .prepare(
      `INSERT INTO subscriptions (subscription_id, customer_id, customer_email, product_id, status)
       VALUES (?, 'sub_cus1', 'buyer@example.com', 'pdt_std', 'active')`,
    )
    .run(SUB);
  state.kv = new Map();
  state.events = [];
  state.alerts = [];
  state.queueBound = true;
  state.send = vi.fn(async () => {
    state.events.push("send");
  });
  state.waitUntil = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/onboarding/submit — ap- audit dispatch (Slice Q)", () => {
  it("CAS won → KV put BEFORE send, payload {session_id: ap-…, origin: PUBLIC_ORIGIN} → 303", async () => {
    const { POST } = await import("./route");
    const res = await POST(submit());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/onboarding/done");
    expect(state.send).toHaveBeenCalledTimes(1);
    const body = state.send.mock.calls[0][0] as { session_id: string; origin: string };
    const fired = firedAt();
    expect(fired).not.toBeNull();
    expect(body).toEqual({ session_id: `ap-${SUB}-${fired}`, origin: "https://astrant.io" });
    expect(state.events).toEqual([`kv:audit:ap-${SUB}-${fired}`, "send"]);
    expect(JSON.parse(state.kv.get(`audit:ap-${SUB}-${fired}`)!).status).toBe("fulfilling");
    expect(state.alerts).toEqual([]);
    expect(state.waitUntil).not.toHaveBeenCalled();
  });

  it("send throws → F3_AUDIT_ENQUEUE_FAILED alert + audit_fired_at released → still 303", async () => {
    state.send = vi.fn(async () => {
      throw new Error("queue down");
    });
    const { POST } = await import("./route");
    const res = await POST(submit());
    expect(res.status).toBe(303);
    expect(state.alerts.map((a) => a.subject)).toEqual(["[ALERT] F3_AUDIT_ENQUEUE_FAILED"]);
    expect(firedAt()).toBeNull();
    const release = sq().calls.find((c) => c.sql.includes("SET audit_fired_at = NULL"))!;
    expect(release.params[0]).toBe(SUB);
    expect(typeof release.params[1]).toBe("number");
    expect(state.waitUntil).not.toHaveBeenCalled();
  });

  it("binding missing → same as a throw (alert + release + 303)", async () => {
    state.queueBound = false;
    const { POST } = await import("./route");
    const res = await POST(submit());
    expect(res.status).toBe(303);
    expect(state.alerts.map((a) => a.subject)).toEqual(["[ALERT] F3_AUDIT_ENQUEUE_FAILED"]);
    expect(firedAt()).toBeNull();
  });

  it("A5: the release is keyed on the claim — a newer claim is not cleared", async () => {
    state.send = vi.fn(async () => {
      sq().db.prepare(`UPDATE subscriptions SET audit_fired_at = 7 WHERE subscription_id = ?`).run(SUB);
      throw new Error("queue down");
    });
    const { POST } = await import("./route");
    expect((await POST(submit())).status).toBe(303);
    expect(firedAt()).toBe(7);
  });

  it("A5: release itself throws → still 303 (guarded), alert sent", async () => {
    state.send = vi.fn(async () => {
      throw new Error("queue down");
    });
    state.sq.failWhen = (sql) => sql.includes("SET audit_fired_at = NULL");
    const { POST } = await import("./route");
    expect((await POST(submit())).status).toBe(303);
    expect(state.alerts.map((a) => a.subject)).toEqual(["[ALERT] F3_AUDIT_ENQUEUE_FAILED"]);
  });

  it("resubmit after a released failure re-fires the audit", async () => {
    state.send = vi.fn(async () => {
      throw new Error("queue down");
    });
    const { POST } = await import("./route");
    await POST(submit());
    state.send = vi.fn(async () => undefined);
    expect((await POST(submit())).status).toBe(303);
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("CAS lost (audit already fired) → no KV put, no send, 303", async () => {
    sq().db.prepare(`UPDATE subscriptions SET audit_fired_at = 5 WHERE subscription_id = ?`).run(SUB);
    const { POST } = await import("./route");
    const res = await POST(submit());
    expect(res.status).toBe(303);
    expect(state.send).not.toHaveBeenCalled();
    expect([...state.kv.keys()].filter((k) => k.startsWith("audit:"))).toEqual([]);
    expect(state.waitUntil).not.toHaveBeenCalled();
  });
});
