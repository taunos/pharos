import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSqliteD1, readMigration, type SqliteD1 } from "@/lib/test-support/sqlite-d1";
import { AUDIT_REVIEW_HOLD_STATUS_MESSAGE } from "@/lib/audit-review-hold";

// Audit review hold — the read-side gates (results-page status, PDF, JSON)
// and the operator review endpoint (list / fetch / release).

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  sends: [] as Array<{ payload: Record<string, unknown>; opts?: Record<string, unknown> }>,
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: state.env }) }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>, opts?: Record<string, unknown>) => {
        state.sends.push({ payload, opts });
        return { data: { id: "em_1" }, error: null };
      },
    };
  },
}));

const KEY = "internal-key-123";
const SID = "11111111-2222-4333-8444-555555555555";
let sq: SqliteD1;
let kv: Map<string, string>;
let r2: Map<string, string>;

function seedReady() {
  kv.set(
    `audit:${SID}`,
    JSON.stringify({
      session_id: SID,
      url: "https://example.com/",
      email: "buyer@example.com",
      status: "ready",
      created_at: 1,
      paid_at: 2,
      pdf_url: `/audit-results/${SID}/pdf`,
      json_url: `/audit-results/${SID}/json`,
      composite_score: 70,
      grade: "B",
    }),
  );
  r2.set(`audits/${SID}.pdf`, "PDF");
  r2.set(
    `audits/${SID}.json`,
    JSON.stringify({ scan: { dimensions: [{ dimension_id: 6, sub_checks: [{ id: "c" }] }] }, gaps: [] }),
  );
  r2.set(`audits/${SID}.dim6-review.json`, JSON.stringify({ cells: [{ modelId: "m" }] }));
}
const hold = (released: boolean) =>
  sq.db
    .prepare(`INSERT INTO audit_review_holds (session_id, held, decided_at, released_at) VALUES (?, 1, 1, ?)`)
    .run(SID, released ? 5 : null);

beforeEach(() => {
  sq = createSqliteD1([readMigration("0019_audit_review_holds.sql")]);
  kv = new Map();
  r2 = new Map();
  state.sends = [];
  state.env = {
    INTERNAL_FULFILL_KEY: KEY,
    PUBLIC_ORIGIN: "https://astrant.io",
    AUDIT_CHECKOUT_ENABLED: "true",
    RESEND_API_KEY: "re_test",
    CITATION_DB: sq.d1,
    SESSIONS: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
    },
    AUDITS: {
      get: async (k: string) => {
        const v = r2.get(k);
        return v === undefined
          ? null
          : { body: v, text: async () => v, arrayBuffer: async () => new TextEncoder().encode(v).buffer };
      },
    },
  };
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  seedReady();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const params = { params: Promise.resolve({ sessionId: SID }) };
const get = (path: string) => new Request(`https://astrant.io${path}`);

describe("results-page status gate (/api/audit-status)", async () => {
  const { GET } = await import("@/app/api/audit-status/[sessionId]/route");

  it("held → in_review with the placeholder message and NO report links", async () => {
    hold(false);
    const body = (await (await GET(get(`/api/audit-status/${SID}`), params)).json()) as J;
    expect(body).toEqual({ ok: true, status: "in_review", message: AUDIT_REVIEW_HOLD_STATUS_MESSAGE });
  });

  it("still running + held → fulfilling with review_hold (page swaps its intro); not held → no flag", async () => {
    kv.set(`audit:${SID}`, JSON.stringify({ ...JSON.parse(kv.get(`audit:${SID}`)!), status: "fulfilling" }));
    let body = (await (await GET(get(`/api/audit-status/${SID}`), params)).json()) as J;
    expect(body.status).toBe("fulfilling");
    expect(body.review_hold).toBeUndefined();
    hold(false);
    body = (await (await GET(get(`/api/audit-status/${SID}`), params)).json()) as J;
    expect(body).toMatchObject({ status: "fulfilling", review_hold: true });
  });

  it("released → ready with links", async () => {
    hold(true);
    const body = (await (await GET(get(`/api/audit-status/${SID}`), params)).json()) as J;
    expect(body).toMatchObject({ status: "ready", pdf_url: `/audit-results/${SID}/pdf` });
  });

  it("no hold row (not held / pre-hold session) → ready", async () => {
    const body = (await (await GET(get(`/api/audit-status/${SID}`), params)).json()) as J;
    expect(body.status).toBe("ready");
  });

  it("D1 down → fail-closed in_review", async () => {
    sq.failWhen = () => true;
    const body = (await (await GET(get(`/api/audit-status/${SID}`), params)).json()) as J;
    expect(body.status).toBe("in_review");
    expect(body.pdf_url).toBeUndefined();
  });
});

describe("PDF / JSON download gates", async () => {
  const pdf = await import("@/app/audit-results/[sessionId]/pdf/route");
  const json = await import("@/app/audit-results/[sessionId]/json/route");

  for (const [name, route] of [
    ["pdf", pdf],
    ["json", json],
  ] as const) {
    it(`${name}: held → 404; released → 200; no row → 200; D1 down → 503`, async () => {
      const call = () => route.GET(get(`/audit-results/${SID}/${name}`), params);
      hold(false);
      expect((await call()).status).toBe(404);
      sq.db.prepare(`UPDATE audit_review_holds SET released_at = 5`).run();
      expect((await call()).status).toBe(200);
      sq.db.prepare(`DELETE FROM audit_review_holds`).run();
      expect((await call()).status).toBe(200);
      sq.failWhen = () => true;
      expect((await call()).status).toBe(503);
    });
  }
});

describe("operator review endpoint (/api/internal/audit-review)", async () => {
  const { GET, POST } = await import("./route");
  const authed = (path: string, init: RequestInit = {}) =>
    new Request(`https://astrant.io/api/internal/audit-review${path}`, {
      ...init,
      headers: { "x-internal-fulfill-key": KEY, "content-type": "application/json" },
    });
  const release = () => POST(authed("", { method: "POST", body: JSON.stringify({ session_id: SID }) }));

  it("rejects a missing or wrong key", async () => {
    expect((await GET(get("/api/internal/audit-review"))).status).toBe(401);
    const wrong = new Request("https://astrant.io/api/internal/audit-review", {
      method: "POST",
      headers: { "x-internal-fulfill-key": "nope" },
      body: JSON.stringify({ session_id: SID }),
    });
    expect((await POST(wrong)).status).toBe(401);
    expect(state.sends).toHaveLength(0);
  });

  it("lists, fetches report + Dim 6 evidence, and serves the held PDF", async () => {
    hold(false);
    const list = (await (await GET(authed(""))).json()) as J;
    expect(list.held).toHaveLength(1);
    const one = (await (await GET(authed(`?session_id=${SID}`))).json()) as {
      dim6_dimension: unknown;
      dim6_evidence: { cells: unknown[] };
      session: Record<string, unknown>;
    };
    expect(one.dim6_dimension).toMatchObject({ dimension_id: 6 });
    expect(one.dim6_evidence.cells).toHaveLength(1);
    expect(one.session.email).toBeUndefined();
    const p = await GET(authed(`?session_id=${SID}&format=pdf`));
    expect(p.status).toBe(200);
    expect(p.headers.get("content-type")).toBe("application/pdf");
    expect((await GET(authed(`?session_id=bad%20id`))).status).toBe(400);
  });

  it("release twice → one email, then the public gates open", async () => {
    hold(false);
    const first = await release();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, email: "sent" });
    const second = await release();
    expect(await second.json()).toMatchObject({ ok: true, email: "already_sent" });
    expect(state.sends).toHaveLength(1);
    expect(String(state.sends[0].payload.text)).toContain(`https://astrant.io/audit-results/${SID}/pdf`);
    const { GET: status } = await import("@/app/api/audit-status/[sessionId]/route");
    const after = (await (await status(get(`/api/audit-status/${SID}`), params)).json()) as { status: string };
    expect(after.status).toBe("ready");
  });

  it("reconcile_send: validated, and 409 when nothing to reconcile", async () => {
    hold(true);
    const bad = await POST(authed("", { method: "POST", body: JSON.stringify({ session_id: SID, reconcile_send: "x" }) }));
    expect(bad.status).toBe(400);
    const none = await POST(
      authed("", { method: "POST", body: JSON.stringify({ session_id: SID, reconcile_send: "not_sent" }) }),
    );
    expect(none.status).toBe(409);
    sq.db.prepare(`UPDATE audit_review_holds SET send_claimed_at = 1`).run();
    const ok = await POST(
      authed("", { method: "POST", body: JSON.stringify({ session_id: SID, reconcile_send: "delivered" }) }),
    );
    expect(ok.status).toBe(200);
    expect(state.sends).toHaveLength(0);
  });

  it("release of a session that is not held → 404, nothing sent", async () => {
    expect((await release()).status).toBe(404);
    expect(state.sends).toHaveLength(0);
  });
});
