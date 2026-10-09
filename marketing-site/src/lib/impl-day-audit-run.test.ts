import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSqliteD1, readMigration, type SqliteD1 } from "./test-support/sqlite-d1";

// Slice Q (Q4 + v1.1 A6) — runImplDayAudit against node:sqlite with the
// citation-tracking 0008 schema. f2-email is REAL (Resend mocked) so the
// idempotency key is observed. The A6 sequence runs citation-tracking's
// SHIPPED stale-claim cleanup SQL, read from its source.

const h = vi.hoisted(() => ({
  sends: [] as Array<{ subject: string; opts?: { idempotencyKey?: string } }>,
  emailError: null as null | { message: string },
  scanImpl: null as null | (() => Promise<unknown>),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (p: { subject: string }, opts?: { idempotencyKey?: string }) => {
        h.sends.push({ subject: p.subject, opts });
        return h.emailError ? { data: null, error: h.emailError } : { data: { id: "em_1" }, error: null };
      },
    };
  },
}));
vi.mock("./audit-pipeline", () => ({
  runScan: vi.fn(async () => (h.scanImpl ? h.scanImpl() : { composite: { score: 55, grade: "C" } })),
}));

const { runImplDayAudit } = await import("./impl-day-audit-run");

const SID = "impl-pay_abc";
let sq: SqliteD1;

const env = () =>
  ({
    CITATION_DB: sq.d1,
    AUDITS: { get: async () => null },
    INTERNAL_FULFILL_KEY: "k",
    RESEND_API_KEY: "re",
  }) as never;

function seed(status = "active", extra: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    session_id: SID,
    dodo_payment_id: "pay_abc",
    customer_email: "buyer@example.com",
    customer_domain: "https://example.com",
    brand_name: "Example",
    category: "saas",
    customer_id: "sub_cus1",
    status,
    payment_succeeded_at: 1,
    bundle_expires_at: 2,
    created_at: 1,
    updated_at: 1,
    day30_audit_due_at: 10,
    ...extra,
  };
  const cols = Object.keys(row);
  sq.db
    .prepare(`INSERT INTO implementation_sessions (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...(Object.values(row) as never[]));
}
const row = () =>
  sq.db
    .prepare(
      `SELECT day30_audit_fired_at AS fired, day30_audit_succeeded_at AS succeeded, day30_audit_failed_at AS failed
       FROM implementation_sessions WHERE session_id = ?`,
    )
    .get(SID) as { fired: number | null; succeeded: number | null; failed: number | null };

// citation-tracking STEP A (stale-claim cleanup), exactly as shipped.
function staleCleanupSql(dayN: number): string {
  const src = readFileSync(
    fileURLToPath(new URL("../../../citation-tracking/src/index.ts", import.meta.url)),
    "utf8",
  );
  const m = src.match(/`(UPDATE implementation_sessions\s+SET day\$\{dayN\}_audit_fired_at = NULL[\s\S]*?)`/);
  if (!m) throw new Error("stale-claim cleanup SQL not found in citation-tracking/src/index.ts");
  return m[1].replace(/\$\{dayN\}/g, String(dayN));
}

beforeEach(() => {
  sq = createSqliteD1([readMigration("0008_implementation_sessions.sql"), readMigration("0016_dayn_email_sent_at.sql")]);
  h.sends = [];
  h.emailError = null;
  h.scanImpl = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("runImplDayAudit", () => {
  it("claim → scan → email (idempotencyKey f2-day{N}:{id}) → succeeded_at → done", async () => {
    seed();
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID })).toEqual({ kind: "done" });
    const r = row();
    expect(r.fired).not.toBeNull();
    expect(r.succeeded).not.toBeNull();
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].opts).toEqual({ idempotencyKey: `f2-day30:${SID}` });
  });

  it("CAS lost (already fired, or not active, or no row) → deduped, nothing sent", async () => {
    seed("active", { day30_audit_fired_at: 5 });
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID })).toEqual({ kind: "deduped" });
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: "impl-smoke-x" })).toEqual({ kind: "deduped" });
    expect(h.sends).toHaveLength(0);
  });

  it("error after claim → fired_at NULL + failed_at set → failed_reset", async () => {
    seed();
    h.emailError = { message: "rate_limited" };
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID })).toEqual({ kind: "failed_reset" });
    const r = row();
    expect(r.fired).toBeNull();
    expect(r.failed).not.toBeNull();
    expect(r.succeeded).toBeNull();
  });

  it("A6: the claim clears failed_at atomically", async () => {
    seed("active", { day30_audit_failed_at: 99 });
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID })).toEqual({ kind: "done" });
    expect(row().failed).toBeNull();
    const claim = sq.calls[0].sql;
    expect(claim).toContain("day30_audit_failed_at = NULL");
  });

  it("A6: failure → daily retry → crash → cleanup → re-claim", async () => {
    seed();
    // 1. Day-30 fails: fired_at NULL, failed_at set.
    h.emailError = { message: "down" };
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID })).toEqual({ kind: "failed_reset" });
    expect(row().failed).not.toBeNull();

    // 2. Next daily sweep re-claims, then the run crashes mid-pipeline (never settles).
    h.emailError = null;
    h.scanImpl = () => new Promise(() => {});
    void runImplDayAudit(env(), { day_n: 30, f2_session_id: SID });
    await new Promise((r) => setTimeout(r, 0));
    const crashed = row();
    expect(crashed.fired).not.toBeNull();
    expect(crashed.failed).toBeNull(); // A6: claim cleared it
    expect(crashed.succeeded).toBeNull();

    // 3. citation-tracking stale-claim cleanup (30 min later) resets fired_at.
    const later = (crashed.fired as number) + 1801;
    sq.db.prepare(staleCleanupSql(30)).run(later - 1800);
    expect(row().fired).toBeNull();

    // 4. The next sweep re-claims and completes.
    h.scanImpl = null;
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID })).toEqual({ kind: "done" });
    expect(row().succeeded).not.toBeNull();
  });

  it("A6: cleanup also resets a legacy stuck claim that still carries failed_at", () => {
    seed("active", { day30_audit_fired_at: 100, day30_audit_failed_at: 50 });
    sq.db.prepare(staleCleanupSql(30)).run(100 + 1);
    expect(row().fired).toBeNull();
  });

  it("fix round: email sent → succeeded_at write throws → alert, row stays claimed, throws; re-run + cleanup → no second send", async () => {
    seed();
    sq.failWhen = (sql) => sql.includes("SET day30_audit_succeeded_at");
    await expect(runImplDayAudit(env(), { day_n: 30, f2_session_id: SID })).rejects.toThrow(/injected/);
    expect(h.sends.filter((s) => !s.subject.startsWith("[ALERT]"))).toHaveLength(1);
    expect(h.sends.map((s) => s.subject)).toContain("[ALERT] F2_DAYN_SENT_UNRECORDED");
    const r = row();
    expect(r.fired).not.toBeNull(); // NOT cleared
    expect(r.failed).toBeNull(); // NOT set
    const sent = sq.db
      .prepare(`SELECT day30_audit_email_sent_at AS s FROM implementation_sessions WHERE session_id = ?`)
      .get(SID) as { s: number | null };
    expect(sent.s).not.toBeNull();

    // citation-tracking cleanup (long after) must not reset a sent day.
    sq.db.prepare(staleCleanupSql(30)).run((r.fired as number) + 100_000);
    expect(row().fired).not.toBeNull();

    // Queue retry: re-run skips scan + send, only writes succeeded_at.
    sq.failWhen = null;
    const { runScan } = await import("./audit-pipeline");
    vi.mocked(runScan).mockClear();
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID })).toEqual({ kind: "done" });
    expect(runScan).not.toHaveBeenCalled();
    expect(h.sends.filter((s) => !s.subject.startsWith("[ALERT]"))).toHaveLength(1);
    expect(row().succeeded).not.toBeNull();

    // And a delivered day is then deduped.
    expect(await runImplDayAudit(env(), { day_n: 30, f2_session_id: SID })).toEqual({ kind: "deduped" });
  });

  it("cleanup never resets a delivered day", () => {
    seed("active", { day30_audit_fired_at: 100, day30_audit_succeeded_at: 120 });
    sq.db.prepare(staleCleanupSql(30)).run(10_000);
    expect(row().fired).toBe(100);
  });
});
