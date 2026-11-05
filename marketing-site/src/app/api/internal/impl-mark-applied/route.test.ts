import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSqliteD1, readMigration, type SqliteD1 } from "@/lib/test-support/sqlite-d1";

// Verification report v1 — operator mark-applied endpoint: auth, input
// validation, and fail-closed when the acceptance checker is unavailable.
// End-to-end checks through the real checker: lib/impl-verify-adapter.test.ts.

const state: { env: Record<string, unknown>; unwired: boolean } = { env: {}, unwired: false };
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: state.env }) }));
vi.mock("@/lib/impl-verify-adapter", async (orig) => {
  const real = await orig<typeof import("@/lib/impl-verify-adapter")>();
  return { loadImplVerifier: () => (state.unwired ? null : real.loadImplVerifier()) };
});

const KEY = "internal-key-123";
const SID = "impl-pay_abc";
let sq: SqliteD1;

function req(body: unknown, key: string | null = KEY) {
  return new Request("https://astrant.io/api/internal/impl-mark-applied", {
    method: "POST",
    headers: key === null ? {} : { "x-internal-fulfill-key": key },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  sq = createSqliteD1([
    readMigration("0008_implementation_sessions.sql"),
    readMigration("0016_dayn_email_sent_at.sql"),
    readMigration("0018_impl_verification.sql"),
  ]);
  sq.db.exec(`INSERT INTO implementation_sessions
    (session_id, dodo_payment_id, customer_email, customer_domain, brand_name, category, customer_id,
     status, payment_succeeded_at, bundle_expires_at, patch_r2_key, created_at, updated_at)
    VALUES ('${SID}', 'pay_abc', 'b@example.com', 'https://example.com', 'Ex', 'saas', 'sub_1',
     'awaiting_application', 1, 2, 'f2-patches/${SID}.patch', 1, 1)`);
  state.env = { INTERNAL_FULFILL_KEY: KEY, CITATION_DB: sq.d1, AUDITS: { get: async () => null } };
  state.unwired = false;
});

describe("POST /api/internal/impl-mark-applied", () => {
  it.each([null, "", "wrong-key-1234567"])("key %s → 401, nothing read", async (k) => {
    const { POST } = await import("./route");
    expect((await POST(req({ session_id: SID }, k))).status).toBe(401);
    expect(sq.calls).toHaveLength(0);
  });

  it("401 when INTERNAL_FULFILL_KEY is unset (fail closed)", async () => {
    state.env = { CITATION_DB: sq.d1 };
    const { POST } = await import("./route");
    expect((await POST(req({ session_id: SID }))).status).toBe(401);
  });

  it.each([
    ["not json", "{"],
    ["missing id", {}],
    ["bad shape", { session_id: "pay_abc" }],
    ["NUL byte", { session_id: `impl-pay${String.fromCharCode(0)}x` }],
    ["non-boolean force", { session_id: SID, force: "yes" }],
    ["null body", "null"],
    ["non-string mcp_url", { session_id: SID, mcp_url: 42 }],
    ["non-URL mcp_url", { session_id: SID, mcp_url: "not a url" }],
    ["non-http mcp_url", { session_id: SID, mcp_url: "ftp://mcp.example.com/mcp" }],
    ["oversized mcp_url", { session_id: SID, mcp_url: `https://example.com/${"a".repeat(2048)}` }],
  ])("%s → 400, nothing read", async (_n, body) => {
    const { POST } = await import("./route");
    expect((await POST(req(body))).status).toBe(400);
    expect(sq.calls).toHaveLength(0);
  });

  it("unknown session → 404", async () => {
    const { POST } = await import("./route");
    expect((await POST(req({ session_id: "impl-pay_none" }))).status).toBe(404);
  });

  it("real checker wired: patch not in R2 → 409 PATCH_MISSING, row unchanged", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: SID, mcp_url: "https://mcp.example.com/mcp" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "PATCH_MISSING" });
    expect(sq.db.prepare(`SELECT status, applied_at, mcp_url FROM implementation_sessions`).get()).toEqual({
      status: "awaiting_application",
      applied_at: null,
      mcp_url: null,
    });
  });

  it("checker unavailable (adapter null) → 503 VERIFIER_UNAVAILABLE, row unchanged", async () => {
    state.unwired = true;
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: SID }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "VERIFIER_UNAVAILABLE" });
    expect(sq.db.prepare(`SELECT status, applied_at FROM implementation_sessions`).get()).toEqual({
      status: "awaiting_application",
      applied_at: null,
    });
  });
});
