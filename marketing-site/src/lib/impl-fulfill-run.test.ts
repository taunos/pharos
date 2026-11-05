import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSqliteD1, readMigration, PROBE_TARGETS_SQL, type SqliteD1 } from "./test-support/sqlite-d1";

// Slice Q (Q1a-Q1d + v1.1 A2/A3/A4/A8/A9) — runImplFulfillment against a real
// SQL engine (node:sqlite) with the citation-tracking 0008 schema. Scanner,
// generators and patch validation are stubbed; f2-email + operator-alerts are
// REAL with only Resend mocked, so idempotency keys and alerts are observed.

const h = vi.hoisted(() => ({
  sends: [] as Array<{ subject: string; text: string; opts?: { idempotencyKey?: string } }>,
  events: [] as string[],
  patchEmailError: null as null | { message: string },
  scanImpl: null as null | (() => Promise<unknown>),
  emailHook: null as null | (() => void),
  validateOk: true,
  validateThrows: false,
  validatedInputs: [] as unknown[],
  assembleTimes: [] as Date[],
  assembledFiles: [] as Record<string, string>[],
  openApi: "openapi: 3.1.0" as string | null,
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (p: { subject: string; text: string }, opts?: { idempotencyKey?: string }) => {
        h.sends.push({ subject: p.subject, text: p.text, opts });
        const isAlert = p.subject.startsWith("[ALERT]");
        h.events.push(isAlert ? `alert:${p.subject.slice(8)}` : "email:patch");
        if (!isAlert) h.emailHook?.();
        if (!isAlert && h.patchEmailError) return { data: null, error: h.patchEmailError };
        return { data: { id: "em_1" }, error: null };
      },
    };
  },
}));
vi.mock("./audit-pipeline", () => ({
  runScan: vi.fn(async () => (h.scanImpl ? h.scanImpl() : { composite: { score: 40, grade: "D" } })),
}));
vi.mock("./f2-generators/llms-txt", () => ({ generateLlmsTxt: async () => "# llms" }));
vi.mock("./f2-generators/mcp-server-config", () => ({
  generateMcpServerConfig: async () => ({
    capabilities: [{ name: "get_capabilities" }, { name: "get_pricing" }, { name: "get_case_studies" }, { name: "get_contact_tools" }],
  }),
}));
vi.mock("./f2-generators/openapi", () => ({ generateOpenApi: async () => h.openApi }));
vi.mock("./f2-generators/jsonld", () => ({ generateJsonLd: async () => "<script></script>" }));
vi.mock("./f2-mcp-server-template", () => ({ renderMcpServerWorker: () => ({ "mcp-server/index.ts": "x" }) }));
vi.mock("./f2-patch-assembler", () => ({
  assembleGitAmPatch: (i: { fulfillment_time: Date; files: Record<string, string> }) => {
    h.assembleTimes.push(i.fulfillment_time);
    h.assembledFiles.push(i.files);
    return "PATCH";
  },
}));
vi.mock("./f2-patch-validate", () => ({
  validateGitAmPatch: (bytes: unknown) => {
    h.validatedInputs.push(bytes);
    if (h.validateThrows) throw new Error("boom");
    return h.validateOk
      ? { ok: true }
      : { ok: false, categories: ["hunk_count", "path_unsafe"], failures: ["hunk_count:file#1 declared 2, found 1"] };
  },
}));

const { runImplFulfillment, IMPL_LEASE_SEC } = await import("./impl-fulfill-run");
const { runScan } = await import("./audit-pipeline");

const SID = "impl-pay_abc";
const PAID_AT = 1_700_000_000;
let sq: SqliteD1;
let r2: Map<string, string | Uint8Array>;
let r2Puts: string[];

function env(extra: Record<string, unknown> = {}) {
  return {
    CITATION_DB: sq.d1,
    AUDITS: {
      put: async (k: string, v: string | Uint8Array) => {
        r2Puts.push(k);
        r2.set(k, v);
      },
      get: async (k: string) =>
        r2.has(k)
          ? {
              arrayBuffer: async () => {
                const v = r2.get(k)!;
                return (typeof v === "string" ? new TextEncoder().encode(v) : v).slice().buffer;
              },
            }
          : null,
    },
    INTERNAL_FULFILL_KEY: "k",
    RESEND_API_KEY: "re",
    OPERATOR_ALERT_EMAIL: "ops@example.test",
    ...extra,
  } as never;
}

function seed(status = "queued", extra: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    session_id: SID,
    dodo_payment_id: "pay_abc",
    customer_email: "buyer@example.com",
    customer_domain: "https://example.com",
    brand_name: "Example",
    category: "saas",
    competitors: "[]",
    customer_id: "sub_cus1",
    status,
    payment_succeeded_at: PAID_AT,
    bundle_expires_at: PAID_AT + 91 * 86400,
    created_at: 1,
    updated_at: 1,
    ...extra,
  };
  const cols = Object.keys(row);
  sq.db
    .prepare(`INSERT INTO implementation_sessions (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...(Object.values(row) as never[]));
}
const row = () =>
  sq.db.prepare(`SELECT * FROM implementation_sessions WHERE session_id = ?`).get(SID) as Record<string, unknown>;
const alertCodes = () => h.sends.filter((s) => s.subject.startsWith("[ALERT]")).map((s) => s.subject.slice(8));
const patchEmails = () => h.sends.filter((s) => !s.subject.startsWith("[ALERT]"));
const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  sq = createSqliteD1([readMigration("0008_implementation_sessions.sql"), readMigration("0016_dayn_email_sent_at.sql"), readMigration("0018_impl_verification.sql"), PROBE_TARGETS_SQL]);
  r2 = new Map();
  r2Puts = [];
  h.sends = [];
  h.events = [];
  h.patchEmailError = null;
  h.scanImpl = null;
  h.emailHook = null;
  h.validateOk = true;
  h.validateThrows = false;
  h.validatedInputs = [];
  h.assembleTimes = [];
  h.assembledFiles = [];
  h.openApi = "openapi: 3.1.0";
  vi.mocked(runScan).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("runImplFulfillment — claim (Q1b)", () => {
  it("claim SQL carries the lease predicate and binds IMPL_LEASE_SEC", async () => {
    seed();
    await runImplFulfillment(env(), SID, { finalAttempt: false });
    const claim = sq.calls[0];
    expect(claim.sql).toContain("status = 'queued' OR (status = 'processing' AND processing_started_at < ?1 - ?3)");
    expect(claim.params[1]).toBe(SID);
    expect(claim.params[2]).toBe(IMPL_LEASE_SEC);
    expect(IMPL_LEASE_SEC).toBe(1200);
  });

  it("no row → not_found", async () => {
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({ kind: "not_found" });
  });

  it("processing inside the lease → in_flight with processing_started_at; nothing run", async () => {
    const t = nowSec() - 60;
    seed("processing", { processing_started_at: t });
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({
      kind: "in_flight",
      processing_started_at: t,
    });
    expect(runScan).not.toHaveBeenCalled();
  });

  it("processing past the lease → reclaimed and run", async () => {
    seed("processing", { processing_started_at: nowSec() - IMPL_LEASE_SEC - 5 });
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({ kind: "done" });
    expect(row().status).toBe("awaiting_application");
  });

  it.each(["active", "awaiting_application", "failed", "failed_validation", "active_email_pending"])("%s → noop_terminal", async (s) => {
    seed(s);
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({ kind: "noop_terminal", status: s });
    expect(runScan).not.toHaveBeenCalled();
  });
});

describe("runImplFulfillment — happy path", () => {
  it("awaiting_application + patch_delivered_at, probe target enrolled, patch email with idempotencyKey f2-patch:{id}", async () => {
    seed();
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({ kind: "done" });
    const r = row();
    expect(r.status).toBe("awaiting_application");
    expect(typeof r.patch_delivered_at).toBe("number");
    // Verification v1: Day 0 = verified application, not payment — no Day-N
    // due dates until the application is marked and verified.
    expect(r.day30_audit_due_at).toBeNull();
    expect(r.day60_audit_due_at).toBeNull();
    expect(r.day90_audit_due_at).toBeNull();
    expect(r.applied_at).toBeNull();
    expect(r.bundle_expires_at).toBe(PAID_AT + 91 * 86400);
    expect(r.patch_r2_key).toBe(`f2-patches/${SID}.patch`);
    expect(sq.db.prepare(`SELECT status FROM customer_probe_targets WHERE customer_id='sub_cus1'`).get()).toEqual({
      status: "active",
    });
    expect(patchEmails()).toHaveLength(1);
    expect(patchEmails()[0].opts).toEqual({ idempotencyKey: `f2-patch:${SID}` });
    expect(alertCodes()).toEqual([]);
  });

  it("baseline scan is kept in R2 before delivery and linked on the row with its scoring_version", async () => {
    seed();
    h.scanImpl = async () => ({ composite: { score: 40, grade: "D" }, scoring_version: "1.3.1" });
    await runImplFulfillment(env(), SID, { finalAttempt: false });
    const r = row();
    expect(r.baseline_scan_id).toBe(`f2-baseline-${SID}`);
    expect(r.baseline_scoring_version).toBe("1.3.1");
    expect(JSON.parse(r2.get(`f2-baseline-scans/f2-baseline-${SID}.json`) as string)).toMatchObject({
      scoring_version: "1.3.1",
    });
    expect(r2Puts.indexOf(`f2-baseline-scans/f2-baseline-${SID}.json`)).toBeLessThan(
      r2Puts.indexOf(`f2-patches/${SID}.patch`),
    );
  });

  it("A3: patch timestamps are deterministic (payment_succeeded_at, not now)", async () => {
    seed();
    await runImplFulfillment(env(), SID, { finalAttempt: false });
    expect(h.assembleTimes).toEqual([new Date(PAID_AT * 1000)]);
  });

  it("no API operations (generator returns null) → no OpenAPI file, and README + email do not list one", async () => {
    h.openApi = null;
    seed();
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({ kind: "done" });
    const files = h.assembledFiles[0];
    expect(Object.keys(files)).not.toContain("public/openapi.yaml");
    expect(files["ASTRANT_IMPLEMENTATION.md"]).not.toContain("openapi");
    expect(patchEmails()[0].text).not.toContain("OpenAPI");
    // The MCP health check speaks JSON-RPC and checks every delivered tool.
    const check = files["monitoring/check-mcp-server.sh"];
    expect(check).toContain('"method":"initialize"');
    expect(check).toContain("for tool in get_capabilities get_pricing get_case_studies get_contact_tools; do");
    expect(check).not.toContain("/mcp/call");
  });

  it("an OpenAPI spec, when generated, is delivered and listed", async () => {
    seed();
    await runImplFulfillment(env(), SID, { finalAttempt: false });
    const files = h.assembledFiles[0];
    expect(files["public/openapi.yaml"]).toBe("openapi: 3.1.0");
    expect(files["ASTRANT_IMPLEMENTATION.md"]).toContain("- `public/openapi.yaml` — OpenAPI 3.1 scaffold");
    expect(patchEmails()[0].text).toContain("  - OpenAPI spec scaffold for your category");
  });
});

describe("runImplFulfillment — terminal outcomes (unchanged writes + alerts)", () => {
  it("patch validation fails → failed_validation + F2_PATCH_VALIDATION_FAILED, no email", async () => {
    seed();
    h.validateOk = false;
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({
      kind: "terminal_outcome",
      status: "failed_validation",
    });
    expect(row().status).toBe("failed_validation");
    expect(row().failed_reason).toBe("patch_validation_failed:hunk_count|path_unsafe");
    expect(alertCodes()).toEqual(["F2_PATCH_VALIDATION_FAILED"]);
    expect(patchEmails()).toHaveLength(0);
    // Category-only alert: no customer email, no failure detail text.
    const alert = h.sends.find((s) => s.subject.startsWith("[ALERT]"))!;
    expect(alert.text).toContain("hunk_count|path_unsafe");
    expect(alert.text).not.toContain("buyer@example.com");
    expect(alert.text).not.toContain("declared");
    // The patch stays in R2 for inspection; no probe-target enrollment.
    expect(r2.has(`f2-patches/${SID}.patch`)).toBe(true);
    expect(sq.db.prepare(`SELECT COUNT(*) AS n FROM customer_probe_targets`).get()).toEqual({ n: 0 });
  });

  it("validator gets the exact bytes stored in R2", async () => {
    seed();
    await runImplFulfillment(env(), SID, { finalAttempt: false });
    const stored = r2.get(`f2-patches/${SID}.patch`);
    expect(stored).toBeInstanceOf(Uint8Array);
    expect(h.validatedInputs).toEqual([stored]);
  });

  it("validator throwing fails closed → failed_validation, no email", async () => {
    seed();
    h.validateThrows = true;
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({
      kind: "terminal_outcome",
      status: "failed_validation",
    });
    expect(row().failed_reason).toBe("patch_validation_failed:validator_error");
    expect(patchEmails()).toHaveLength(0);
  });

  it("ceiling at Stage 3 → failed_ceiling + F2_OVER_CAPACITY_ATOMIC_FAILED", async () => {
    seed();
    sq.db.exec(`INSERT INTO customer_probe_targets (customer_id, status) VALUES ('sub_other', 'active')`);
    expect(await runImplFulfillment(env({ MAX_PROBE_TARGETS: "1" }), SID, { finalAttempt: false })).toEqual({
      kind: "terminal_outcome",
      status: "failed_ceiling",
    });
    expect(row().status).toBe("failed_ceiling");
    expect(row().failed_reason).toBe("F2_OVER_CAPACITY_ATOMIC_FAILED");
    expect(alertCodes()).toEqual(["F2_OVER_CAPACITY_ATOMIC_FAILED"]);
  });

  it("re-run after a release passes the ceiling (ON CONFLICT update counts as 1 change)", async () => {
    seed();
    sq.db.exec(`INSERT INTO customer_probe_targets (customer_id, status) VALUES ('sub_cus1', 'active')`);
    expect(await runImplFulfillment(env({ MAX_PROBE_TARGETS: "1" }), SID, { finalAttempt: false })).toEqual({
      kind: "done",
    });
  });

  it("email send fails → active_email_pending + F2_EMAIL_SEND_FAILED", async () => {
    seed();
    h.patchEmailError = { message: "rate_limited" };
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({
      kind: "terminal_outcome",
      status: "active_email_pending",
    });
    expect(row().status).toBe("active_email_pending");
    expect(row().failed_reason).toBe("email_send_failed:rate_limited");
    expect(row().patch_delivered_at).toBeNull();
    expect(alertCodes()).toEqual(["F2_EMAIL_SEND_FAILED"]);
  });
});

describe("runImplFulfillment — failures (Q1c + A2/A4/A8/A9)", () => {
  it("non-final throw → release to queued (keyed on claimedAt), rethrow, no failed write, no alert", async () => {
    seed();
    h.scanImpl = async () => {
      throw new Error("scanner 502");
    };
    await expect(runImplFulfillment(env(), SID, { finalAttempt: false })).rejects.toThrow("scanner 502");
    expect(row().status).toBe("queued");
    expect(alertCodes()).toEqual([]);
    const release = sq.calls.find((c) => c.sql.includes("SET status = 'queued'"))!;
    expect(release.sql).toContain("processing_started_at = ?");
    expect(release.params[2]).toBe(sq.calls[0].params[0]); // claimedAt
  });

  it("non-final release never releases a later reclaim", async () => {
    seed();
    h.scanImpl = async () => {
      // Another delivery reclaimed the row meanwhile.
      sq.db.exec(`UPDATE implementation_sessions SET processing_started_at = 42 WHERE session_id = '${SID}'`);
      throw new Error("boom");
    };
    await expect(runImplFulfillment(env(), SID, { finalAttempt: false })).rejects.toThrow("boom");
    expect(row().status).toBe("processing");
    expect(row().processing_started_at).toBe(42);
  });

  it("final throw → F2_FULFILLMENT_FAILED alert FIRST, then failed write → failed_final", async () => {
    seed();
    h.scanImpl = async () => {
      throw new Error("scanner 502");
    };
    expect(await runImplFulfillment(env(), SID, { finalAttempt: true })).toEqual({ kind: "failed_final" });
    expect(row().status).toBe("failed");
    expect(row().failed_reason).toBe("scanner 502");
    expect(alertCodes()).toEqual(["F2_FULFILLMENT_FAILED"]);
    const alert = h.sends[0].text;
    expect(alert).toContain(`Session: ${SID}`);
    expect(alert).toContain("Customer: buyer@example.com");
    // A9: alert precedes the terminal write.
    const failIdx = sq.calls.findIndex((c) => c.sql.includes("SET status = 'failed'"));
    expect(failIdx).toBeGreaterThan(-1);
    expect(h.events).toEqual(["alert:F2_FULFILLMENT_FAILED"]);
  });

  it("A4: final failure write keyed on claimedAt — a reclaimed row is not overwritten (alert only)", async () => {
    seed();
    h.scanImpl = async () => {
      sq.db.exec(`UPDATE implementation_sessions SET processing_started_at = 42 WHERE session_id = '${SID}'`);
      throw new Error("boom");
    };
    expect(await runImplFulfillment(env(), SID, { finalAttempt: true })).toEqual({ kind: "failed_final" });
    expect(row().status).toBe("processing");
    expect(alertCodes()).toEqual(["F2_FULFILLMENT_FAILED"]);
  });

  it("A2: SELECT fails on the final attempt → alert still sent (session id), failed write throws (not swallowed)", async () => {
    seed();
    sq.failWhen = (sql) => sql.includes("FROM implementation_sessions WHERE session_id") && !sql.includes("SELECT status,")
      || sql.includes("SET status = 'failed'");
    await expect(runImplFulfillment(env(), SID, { finalAttempt: true })).rejects.toThrow(/injected failure/);
    expect(alertCodes()).toEqual(["F2_FULFILLMENT_FAILED"]);
    expect(h.sends[0].text).toContain(`Session: ${SID}`);
  });

  it("A8: invalid customer_id → failed + alert on the FIRST attempt, no scan, no retry", async () => {
    seed("queued", { customer_id: "astrant" });
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({ kind: "failed_final" });
    expect(runScan).not.toHaveBeenCalled();
    expect(row().status).toBe("failed");
    expect(String(row().failed_reason)).toMatch(/^F2_CUSTOMER_ID_INVALID/);
    expect(alertCodes()).toEqual(["F2_FULFILLMENT_FAILED"]);
  });
});

describe("runImplFulfillment — A3 re-run safety after the email was sent", () => {
  it("email success → D1 failure → re-run sends nothing and rebuilds nothing", async () => {
    seed();
    sq.failWhen = (sql) => sql.includes("SET status = 'awaiting_application'");
    await expect(runImplFulfillment(env(), SID, { finalAttempt: false })).rejects.toThrow(/injected failure/);
    expect(row().status).toBe("queued"); // released
    expect(typeof row().patch_delivered_at).toBe("number");
    expect(patchEmails()).toHaveLength(1);

    sq.failWhen = null;
    vi.mocked(runScan).mockClear();
    r2Puts = [];
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({ kind: "done" });
    expect(runScan).not.toHaveBeenCalled();
    expect(r2Puts).toEqual([]);
    expect(patchEmails()).toHaveLength(1);
    expect(row().status).toBe("awaiting_application");
  });

  it("fix round: final attempt, email sent then the marker write fails → F2_DELIVERED_STATE_UNRECORDED, NO failed write", async () => {
    seed();
    sq.failWhen = (sql) => sql.includes("SET patch_delivered_at");
    expect(await runImplFulfillment(env(), SID, { finalAttempt: true })).toEqual({ kind: "failed_final" });
    expect(patchEmails()).toHaveLength(1);
    expect(alertCodes()).toEqual(["F2_DELIVERED_STATE_UNRECORDED"]);
    expect(row().status).toBe("processing");
    expect(sq.calls.some((c) => c.sql.includes("SET status = 'failed'"))).toBe(false);
  });

  it("fix round: final attempt resuming a delivered row, Step 11 fails → F2_DELIVERED_STATE_UNRECORDED, NO failed write", async () => {
    seed("queued", { patch_delivered_at: 123 });
    sq.failWhen = (sql) => sql.includes("SET status = 'awaiting_application'");
    expect(await runImplFulfillment(env(), SID, { finalAttempt: true })).toEqual({ kind: "failed_final" });
    expect(alertCodes()).toEqual(["F2_DELIVERED_STATE_UNRECORDED"]);
    expect(row().status).toBe("processing");
    expect(patchEmails()).toHaveLength(0);
  });

  it.each([
    ["failed_validation", () => { h.validateOk = false; }, "F2_PATCH_VALIDATION_FAILED"],
    ["failed_ceiling", () => {
      sq.db.exec(`INSERT INTO customer_probe_targets (customer_id, status) VALUES ('sub_other', 'active')`);
    }, "F2_OVER_CAPACITY_ATOMIC_FAILED"],
    ["active_email_pending", () => { h.patchEmailError = { message: "x" }; }, "F2_EMAIL_SEND_FAILED"],
  ] as Array<[string, () => void, string]>)(
    "fix round: %s write is fenced on the claim — a reclaimed row is not overwritten; alert says lease lost",
    async (st, setup, code) => {
      seed();
      setup();
      h.scanImpl = async () => {
        sq.db.exec(`UPDATE implementation_sessions SET processing_started_at = 42 WHERE session_id = '${SID}'`);
        return { composite: { score: 40, grade: "D" } };
      };
      const res = await runImplFulfillment(env({ MAX_PROBE_TARGETS: "1" }), SID, { finalAttempt: false });
      expect(res).toEqual({ kind: "terminal_outcome", status: st });
      expect(row().status).toBe("processing");
      expect(row().processing_started_at).toBe(42);
      expect(alertCodes()).toEqual([code]);
      expect(h.sends.find((s) => s.subject.startsWith("[ALERT]"))!.text).toContain("lease lost");
    },
  );

  it("A4: Step 11 is keyed on the claim — a reclaimed row is left to its new holder", async () => {
    seed();
    h.emailHook = () =>
      sq.db.exec(`UPDATE implementation_sessions SET processing_started_at = 42 WHERE session_id = '${SID}'`);
    expect(await runImplFulfillment(env(), SID, { finalAttempt: false })).toEqual({
      kind: "noop_terminal",
      status: "lease_lost",
    });
    expect(row().status).toBe("processing");
    expect(typeof row().patch_delivered_at).toBe("number");
  });
});
