import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSqliteD1, readMigration, type SqliteD1 } from "./test-support/sqlite-d1";
import type { ImplVerifier, VerificationCheck, CheckState } from "./impl-verification";

// Implementation verification report v1 — mark applied (Day 0), Day-N
// re-anchoring on applied_at, the Day-30 recheck and its email. Real SQL engine
// (node:sqlite) with the citation-tracking 0008 + 0016 + 0018 schema; the
// acceptance checker is an injected fake (the real one lives on
// claude/impl-verify-checks); Resend + scanner are mocked.

const h = vi.hoisted(() => ({
  sends: [] as Array<{ subject: string; text?: string; html?: string }>,
  scan: { composite: { score: 61, grade: "C" }, scoring_version: "1.3.1" } as unknown,
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (p: { subject: string; text?: string; html?: string }) => {
        h.sends.push({ subject: p.subject, text: p.text, html: p.html });
        return { data: { id: "em_1" }, error: null };
      },
    };
  },
}));
vi.mock("./audit-pipeline", () => ({ runScan: vi.fn(async () => h.scan) }));

const { markImplementationApplied, diffChecks } = await import("./impl-verification");
const { runImplDayAudit } = await import("./impl-day-audit-run");

const SID = "impl-pay_abc";
const PAID_AT = 1_700_000_000;
const APPLIED = new Date((PAID_AT + 20 * 86400) * 1000); // applied 20 days after payment
const APPLIED_SEC = PAID_AT + 20 * 86400;
const DAY = 86400;

let sq: SqliteD1;
let r2: Map<string, string>;

function env() {
  return {
    CITATION_DB: sq.d1,
    AUDITS: {
      put: async (k: string, v: string) => void r2.set(k, v),
      get: async (k: string) =>
        r2.has(k)
          ? {
              text: async () => r2.get(k)!,
              arrayBuffer: async () => new TextEncoder().encode(r2.get(k)!).slice().buffer,
            }
          : null,
    },
    INTERNAL_FULFILL_KEY: "k",
    RESEND_API_KEY: "re",
    OPERATOR_ALERT_EMAIL: "ops@example.test",
  } as never;
}

function check(artifact: string, state: CheckState): VerificationCheck {
  return { artifact, state, url: `https://example.com/${artifact}`, evidence: { status: 200 }, checkedAt: "t" };
}

function fakeVerifier(...runs: VerificationCheck[][]) {
  const calls: Array<{ delivery: unknown; siteUrl: string }> = [];
  let i = 0;
  const v: ImplVerifier = {
    expectedFromDelivery(delivery: unknown) {
      calls.push({ delivery, siteUrl: "" });
      return { fromDelivery: true };
    },
    async verifyArtifacts(input) {
      calls[calls.length - 1].siteUrl = input.siteUrl;
      return runs[Math.min(i++, runs.length - 1)];
    },
  };
  return { v, calls };
}

function seed(status = "awaiting_application", extra: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    session_id: SID,
    dodo_payment_id: "pay_abc",
    customer_email: "buyer@example.com",
    customer_domain: "https://example.com",
    brand_name: "Example",
    category: "saas",
    customer_id: "sub_cus1",
    status,
    payment_succeeded_at: PAID_AT,
    bundle_expires_at: PAID_AT + 91 * DAY,
    patch_r2_key: `f2-patches/${SID}.patch`,
    patch_delivered_at: PAID_AT + 60,
    baseline_scan_id: `f2-baseline-${SID}`,
    baseline_scoring_version: "1.3.0",
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
const verifications = () =>
  sq.db
    .prepare(`SELECT * FROM implementation_verifications WHERE session_id = ? ORDER BY checkpoint`)
    .all(SID) as Array<Record<string, unknown>>;

function ctSql(re: RegExp): string {
  const src = readFileSync(
    fileURLToPath(new URL("../../../citation-tracking/src/index.ts", import.meta.url)),
    "utf8",
  );
  const m = src.match(re);
  if (!m) throw new Error(`SQL not found in citation-tracking/src/index.ts: ${re}`);
  return m[1];
}
// citation-tracking STEP B (Day-N dispatch) and STEP C (Day-91 overlap), as shipped.
const dueSql = () => ctSql(/`(SELECT session_id,\s+day30_audit_due_at[\s\S]*?)`/);
const expirySql = () => ctSql(/`(SELECT i\.customer_id,[\s\S]*?)`/);
const due = (now: number) => sq.db.prepare(dueSql()).all(now, now, now) as Array<{ session_id: string }>;

beforeEach(() => {
  sq = createSqliteD1([
    readMigration("0008_implementation_sessions.sql"),
    readMigration("0016_dayn_email_sent_at.sql"),
    readMigration("0018_impl_verification.sql"),
    `CREATE TABLE subscriptions (customer_id TEXT, status TEXT)`,
  ]);
  r2 = new Map([
    [`f2-patches/${SID}.patch`, "PATCH-BYTES"],
    [`f2-baseline-scans/f2-baseline-${SID}.json`, JSON.stringify({ composite: { score: 40 }, scoring_version: "1.3.0" })],
  ]);
  h.sends = [];
  h.scan = { composite: { score: 61, grade: "C" }, scoring_version: "1.3.1" };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("markImplementationApplied — Day 0", () => {
  it("awaiting_application → active; Day-0 record stored; Day-N + bundle anchored on applied_at", async () => {
    seed();
    const { v, calls } = fakeVerifier([check("llms.txt", "working"), check("openapi.yaml", "absent")]);
    const res = await markImplementationApplied(env(), SID, "operator", { verifier: v, now: () => APPLIED });
    expect(res).toMatchObject({ kind: "applied", applied_at: APPLIED_SEC });

    const r = row();
    expect(r.status).toBe("active");
    expect(r.applied_at).toBe(APPLIED_SEC);
    expect(r.applied_by).toBe("operator");
    expect(r.day30_audit_due_at).toBe(APPLIED_SEC + 30 * DAY);
    expect(r.day60_audit_due_at).toBe(APPLIED_SEC + 60 * DAY);
    expect(r.day90_audit_due_at).toBe(APPLIED_SEC + 90 * DAY);
    expect(r.bundle_expires_at).toBe(APPLIED_SEC + 91 * DAY);

    const rec = verifications();
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ checkpoint: "day0", verified_at: APPLIED_SEC });
    expect(JSON.parse(rec[0].checks_json as string).map((c: VerificationCheck) => c.state)).toEqual(["working", "absent"]);

    // The checker gets the delivered patch and the order's site.
    expect(calls[0].delivery).toEqual({
      sessionId: SID,
      siteUrl: "https://example.com",
      patchR2Key: `f2-patches/${SID}.patch`,
      patch: "PATCH-BYTES",
    });
    expect(calls[0].siteUrl).toBe("https://example.com");
  });

  it("idempotent: a second mark → already_applied, checker not run, nothing rewritten", async () => {
    seed();
    const { v, calls } = fakeVerifier([check("llms.txt", "working")]);
    await markImplementationApplied(env(), SID, "operator", { verifier: v, now: () => APPLIED });
    const before = { row: row(), rec: verifications() };
    const later = new Date(APPLIED.getTime() + 5 * DAY * 1000);
    expect(await markImplementationApplied(env(), SID, "operator", { verifier: v, now: () => later })).toEqual({
      kind: "already_applied",
      applied_at: APPLIED_SEC,
    });
    expect(calls).toHaveLength(1);
    expect(row()).toEqual(before.row);
    expect(verifications()).toEqual(before.rec);
  });

  it("two concurrent marks → exactly one flip and one Day-0 record", async () => {
    seed();
    const a = fakeVerifier([check("llms.txt", "working")]);
    const b = fakeVerifier([check("llms.txt", "working")]);
    const [ra, rb] = await Promise.all([
      markImplementationApplied(env(), SID, "operator", { verifier: a.v, now: () => APPLIED }),
      markImplementationApplied(env(), SID, "operator", { verifier: b.v, now: () => APPLIED }),
    ]);
    expect([ra.kind, rb.kind].sort()).toEqual(["already_applied", "applied"]);
    expect(verifications()).toHaveLength(1);
  });

  it("no artifact working → not_verified; Day 0 NOT anchored, nothing written", async () => {
    seed();
    const { v } = fakeVerifier([check("llms.txt", "absent"), check("mcp", "blocked")]);
    const res = await markImplementationApplied(env(), SID, "operator", { verifier: v, now: () => APPLIED });
    expect(res.kind).toBe("not_verified");
    expect(row().status).toBe("awaiting_application");
    expect(row().applied_at).toBeNull();
    expect(row().day30_audit_due_at).toBeNull();
    expect(verifications()).toHaveLength(0);
  });

  it("checker not wired → verifier_unavailable, nothing written", async () => {
    seed();
    expect(await markImplementationApplied(env(), SID, "operator", { verifier: null })).toEqual({
      kind: "verifier_unavailable",
    });
    expect(row().status).toBe("awaiting_application");
    expect(verifications()).toHaveLength(0);
  });

  it.each(["queued", "processing", "failed", "failed_validation", "failed_ceiling", "active_email_pending", "active"])(
    "status %s (no applied_at) → wrong_status, checker not run",
    async (s) => {
      seed(s);
      const { v, calls } = fakeVerifier([check("llms.txt", "working")]);
      expect(await markImplementationApplied(env(), SID, "operator", { verifier: v })).toEqual({
        kind: "wrong_status",
        status: s,
      });
      expect(calls).toHaveLength(0);
      expect(row().status).toBe(s);
    },
  );

  it("not_found / bundle_expired / patch_missing", async () => {
    const { v } = fakeVerifier([check("llms.txt", "working")]);
    expect(await markImplementationApplied(env(), SID, "operator", { verifier: v })).toEqual({ kind: "not_found" });
    seed("awaiting_application", { bundle_expired_at: PAID_AT + 92 * DAY });
    expect(await markImplementationApplied(env(), SID, "operator", { verifier: v })).toEqual({ kind: "bundle_expired" });
    sq.db.exec(`UPDATE implementation_sessions SET bundle_expired_at = NULL`);
    r2.delete(`f2-patches/${SID}.patch`);
    expect(await markImplementationApplied(env(), SID, "operator", { verifier: v })).toEqual({ kind: "patch_missing" });
    expect(row().status).toBe("awaiting_application");
  });

  it("atomic: if the status flip fails, the Day-0 record is rolled back", async () => {
    seed();
    sq.failWhen = (sql) => sql.includes("SET status = 'active'");
    const { v } = fakeVerifier([check("llms.txt", "working")]);
    await expect(markImplementationApplied(env(), SID, "operator", { verifier: v, now: () => APPLIED })).rejects.toThrow(
      /injected/,
    );
    expect(verifications()).toHaveLength(0);
    expect(row().status).toBe("awaiting_application");
  });
});

describe("Day-N re-anchoring (citation-tracking STEP B as shipped + Day-N claim)", () => {
  it("awaiting_application never dispatches, however long after payment", async () => {
    seed();
    expect(due(PAID_AT + 400 * DAY)).toEqual([]);
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID }, { verifier: null })).toEqual({
      kind: "deduped",
    });
    expect(h.sends).toHaveLength(0);
  });

  it("after mark applied, Day 30 is due at applied_at + 30d, not payment + 30d", async () => {
    seed();
    const { v } = fakeVerifier([check("llms.txt", "working")]);
    await markImplementationApplied(env(), SID, "operator", { verifier: v, now: () => APPLIED });
    expect(due(PAID_AT + 31 * DAY)).toEqual([]); // payment-anchored Day 30 would fire here
    expect(due(APPLIED_SEC + 30 * DAY - 1)).toEqual([]);
    expect(due(APPLIED_SEC + 30 * DAY + 1).map((r) => r.session_id)).toEqual([SID]);
  });

  it("STEP C: an unexpired awaiting_application order counts as overlap (probes retained)", () => {
    seed("awaiting_application", { session_id: "impl-pay_new", dodo_payment_id: "pay_new" });
    // An older, expired order for the same customer.
    seed("active", { bundle_expires_at: PAID_AT - DAY });
    const now = PAID_AT;
    const rows = sq.db.prepare(expirySql()).all(now, now) as Array<{ has_unexpired_f2: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].has_unexpired_f2).toBe(1);
  });
});

describe("Day-30 recheck — rescan + acceptance checks vs Day 0 and baseline", () => {
  async function applied(day0: VerificationCheck[]) {
    seed();
    const { v } = fakeVerifier(day0);
    await markImplementationApplied(env(), SID, "operator", { verifier: v, now: () => APPLIED });
  }
  const DAY0 = [check("llms.txt", "working"), check("openapi.yaml", "absent"), check("mcp-server", "working")];
  const DAY30 = [check("llms.txt", "working"), check("openapi.yaml", "working"), check("mcp-server", "blocked")];

  it("stores the day30 record (scan + checks) and emails check-level changes and remaining issues", async () => {
    await applied(DAY0);
    const { v, calls } = fakeVerifier(DAY30);
    const res = await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID }, {
      verifier: v,
      verificationCopyApproved: true,
    });
    expect(res).toEqual({ kind: "done" });
    expect(calls).toHaveLength(1);

    const rec = verifications().find((x) => x.checkpoint === "day30")!;
    expect(rec).toMatchObject({
      composite_score: 61,
      scoring_version: "1.3.1",
      scan_r2_key: `f2-recheck-scans/${SID}-day30.json`,
    });
    expect(r2.has(`f2-recheck-scans/${SID}-day30.json`)).toBe(true);
    expect(verifications().find((x) => x.checkpoint === "day0")).toBeDefined(); // Day 0 untouched

    expect(h.sends).toHaveLength(1);
    const { text, html } = h.sends[0];
    expect(text).toContain("Scanner score: 40/100 → 61/100");
    expect(text).toContain("Scoring version: 1.3.0 → 1.3.1");
    expect(text).toContain("  - llms.txt: working → working (https://example.com/llms.txt)");
    expect(text).toContain("  - openapi.yaml: absent → working (https://example.com/openapi.yaml)");
    expect(text).toContain("  - mcp-server: working → blocked (https://example.com/mcp-server)");
    const issues = text!.slice(text!.indexOf("Remaining issues:"));
    expect(issues).toContain("mcp-server: blocked");
    expect(issues).not.toContain("llms.txt");
    expect(html).toContain('href="https://example.com/mcp-server"');
  });

  it("the verification email never claims outcomes (citations, traffic, AI recommendations, sales)", async () => {
    await applied(DAY0);
    const { v } = fakeVerifier(DAY30);
    await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID }, { verifier: v, verificationCopyApproved: true });
    const { subject, text, html } = h.sends[0];
    for (const body of [subject, text!, html!]) {
      expect(body).not.toMatch(/cite|citation|traffic|recommend|sales|revenue|trajectory|ranking|visibility/i);
    }
  });

  it("copy not approved (default) → no customer email; failed_reset records why; Day-30 record still stored", async () => {
    await applied(DAY0);
    const { v } = fakeVerifier(DAY30);
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID }, { verifier: v })).toEqual({
      kind: "failed_reset",
    });
    expect(h.sends).toHaveLength(0);
    expect(row().failed_reason).toMatch(/verification_copy_pending/);
    expect(row().day30_audit_fired_at).toBeNull();
  });

  it("checker not wired at Day 30 → failed_reset, no email (retried by the next sweep)", async () => {
    await applied(DAY0);
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID }, { verifier: null })).toEqual({
      kind: "failed_reset",
    });
    expect(h.sends).toHaveLength(0);
    expect(row().failed_reason).toMatch(/F2_VERIFIER_UNAVAILABLE/);
  });

  it("a retried Day 30 overwrites its record (INSERT OR REPLACE), never duplicates", async () => {
    await applied(DAY0);
    const { v } = fakeVerifier(DAY30);
    await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID }, { verifier: v }); // copy pending → reset
    h.scan = { composite: { score: 63, grade: "C" }, scoring_version: "1.3.1" };
    await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID }, { verifier: v, verificationCopyApproved: true });
    const day30 = verifications().filter((x) => x.checkpoint === "day30");
    expect(day30).toHaveLength(1);
    expect(day30[0].composite_score).toBe(63);
  });

  it("legacy active row without applied_at keeps the old Day-30 email (checker not run)", async () => {
    seed("active", { day30_audit_due_at: PAID_AT + 30 * DAY });
    const { v, calls } = fakeVerifier(DAY30);
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID }, { verifier: v })).toEqual({ kind: "done" });
    expect(calls).toHaveLength(0);
    expect(h.sends[0].text).toContain("Trajectory:");
    expect(verifications()).toHaveLength(0);
  });

  it("Day 60 of a verified session: rescan only, no checker run", async () => {
    await applied(DAY0);
    const { v, calls } = fakeVerifier(DAY30);
    expect(await runImplDayAudit(env(), { day_n: 60, f2_session_id: SID }, { verifier: v })).toEqual({ kind: "done" });
    expect(calls).toHaveLength(0);
  });
});

describe("diffChecks", () => {
  it("keeps Day-0 order, flags changes, includes artifacts only seen on one side", () => {
    const rows = diffChecks(
      [check("a", "working"), check("b", "absent"), check("c", "working")],
      [check("b", "working"), check("a", "working"), check("d", "mismatch")],
    );
    expect(rows.map((r) => [r.artifact, r.day0, r.current, r.changed])).toEqual([
      ["a", "working", "working", false],
      ["b", "absent", "working", true],
      ["c", "working", null, true],
      ["d", null, "mismatch", true],
    ]);
  });
});
