import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSqliteD1, readMigration, type SqliteD1 } from "@/lib/test-support/sqlite-d1";

// Verification report v1 — operator mark-applied endpoint: auth, input
// validation, and fail-closed while the acceptance checker is not wired.

const state: { env: Record<string, unknown> } = { env: {} };
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: state.env }) }));

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
  ])("%s → 400, nothing read", async (_n, body) => {
    const { POST } = await import("./route");
    expect((await POST(req(body))).status).toBe(400);
    expect(sq.calls).toHaveLength(0);
  });

  it("unknown session → 404", async () => {
    const { POST } = await import("./route");
    expect((await POST(req({ session_id: "impl-pay_none" }))).status).toBe(404);
  });

  it("checker not wired yet → 503 VERIFIER_UNAVAILABLE, row unchanged", async () => {
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
