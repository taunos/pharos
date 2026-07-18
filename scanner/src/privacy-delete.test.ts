// P0-C2 Chunk G — privacy-delete integration proofs (tG1–tG17) over the REAL
// migration chain (node:sqlite, schema.sql + 0001–0004) with an RPC-level
// MarketingR2Client mock. Production SQL only (PRIVACY_SQL / the guarded
// capture statement); helper-only assertions satisfy nothing. PASS is
// enumerated per test ID in the ship-report.
import { describe, it, expect, vi, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  runPrivacyDelete,
  runGuardedCaptureEmail,
  parseIntegrationMode,
  PdError,
  PRIVACY_SQL,
  PD_LEASE_MS,
  PD_PURGE_BUDGET_MS,
  PD_REQUEST_BUDGET_MS,
  PD_TAIL_MARGIN_MS,
  MIN_RPC_WINDOW_MS,
  LEASE_RENEW_MARGIN_MS,
  REPLAY_PER_MIN,
} from "./privacy-delete";
import { RETENTION_SQL, prepRetentionSql } from "./retention-sweep";
import { CAPTURE_SET_EMAIL_SQL, CAPTURE_SET_EMAIL_GUARDED_SQL } from "./score-sql";
import scannerWorker from "./index";
import type { Env } from "./types";

// ── Harness (F1/F2 conventions: real migration chain, per-statement hooks) ───
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
function freshSqlite(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(read("../schema.sql"));
  db.exec(read("../migrations/0001_email_capture_columns.sql"));
  db.exec(read("../migrations/0002_tier_column.sql"));
  db.exec(read("../migrations/0003_p0c2_capture_retention.sql"));
  db.exec(read("../migrations/0004_retention_replay_audit_terminal_ts.sql"));
  return db;
}

type Executed = { sql: string; changes: number };
// hooks.before may be async (tG15 interposes a full route dispatch inside it).
type Hooks = { before?: (sql: string, args: unknown[]) => void | Promise<void> };
const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i;

function makeD1(sqlite: DatabaseSync, hooks: Hooks = {}) {
  const executed: Executed[] = [];
  const record = (sql: string, changes: number) => {
    executed.push({ sql, changes });
  };
  const prepare = (sql: string) => {
    const stmt = {
      _b: [] as unknown[],
      bind(...a: unknown[]) {
        stmt._b = a;
        return stmt;
      },
      async run() {
        await hooks.before?.(sql, stmt._b);
        const i = sqlite.prepare(sql).run(...(stmt._b as never[]));
        const changes = Number(i.changes);
        record(sql, changes);
        return { success: true, meta: { changes }, results: [] };
      },
      async first<T = unknown>() {
        await hooks.before?.(sql, stmt._b);
        const row = (sqlite.prepare(sql).get(...(stmt._b as never[])) ?? null) as T | null;
        record(sql, WRITE_RE.test(sql) && row !== null ? 1 : 0);
        return row;
      },
      async all<T = unknown>() {
        await hooks.before?.(sql, stmt._b);
        const rows = sqlite.prepare(sql).all(...(stmt._b as never[])) as T[];
        record(sql, 0);
        return { success: true, results: rows };
      },
    };
    return stmt;
  };
  const batch = async (stmts: Array<{ run: () => Promise<{ meta: { changes: number } }> }>) => {
    sqlite.exec("BEGIN");
    const out: Array<{ meta: { changes: number } }> = [];
    try {
      for (const st of stmts) out.push(await st.run());
      sqlite.exec("COMMIT");
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
    return out;
  };
  return { prepare, batch, executed };
}

type R2Mode = "ok" | "transport" | "rpc_failed" | "malformed" | "unconfirmed";
function makeR2(opts: { modes?: R2Mode[]; onPurge?: (n: number) => void | Promise<void> } = {}) {
  const state = { purges: [] as string[], modes: opts.modes ?? [] };
  const fetcher = {
    fetch: async (req: Request) => {
      const op = new URL(req.url).pathname.split("/").pop();
      if (op !== "purge-prefix") return new Response("{}", { status: 404 });
      const body = (await req.json()) as { prefix: string };
      const n = state.purges.length;
      if (opts.onPurge) await opts.onPurge(n);
      state.purges.push(body.prefix);
      const mode: R2Mode = state.modes[n] ?? "ok";
      switch (mode) {
        case "transport":
          throw new Error("boom");
        case "rpc_failed":
          return new Response("{}", { status: 500 });
        case "malformed":
          return new Response(JSON.stringify({ ok: false }), { status: 200 });
        case "unconfirmed":
          return new Response(JSON.stringify({ ok: true, status: "purged", purged: -1 }), { status: 200 });
        default:
          return new Response(JSON.stringify({ ok: true, status: "purged", purged: 2 }), { status: 200 });
      }
    },
  };
  return { fetcher: fetcher as unknown as Fetcher, state };
}

const NOW = 1_800_000_000_000; // stable base timestamp (ms)
const OLD = NOW - 120 * 24 * 3_600_000;
const FAR = NOW + 3_600_000;
const KEY = "rk-secret";
const uuid = () => crypto.randomUUID();
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

function seedScan(
  s: DatabaseSync,
  o: {
    id: string;
    tier?: string | null;
    opted?: number;
    created_at?: number;
    email?: string | null;
    unsubscribe_token?: string | null;
    user_ip?: string | null;
    unsubscribed_at?: number | null;
    op_lease_id?: string | null;
    op_lease_expires_at?: number | null;
    op_fence?: number;
    retention_locked_at?: number | null;
    retention_job_id?: string | null;
    pdf_r2_key?: string | null;
  }
) {
  const cols = ["id", "url", "dimensions_scored", "dimensions_total", "results_json", "created_at", "email_opted_in_rescan", "tier"];
  const vals: unknown[] = [o.id, "https://x", 6, 6, "{}", o.created_at ?? OLD, o.opted ?? 0, o.tier === undefined ? "free" : o.tier];
  const push = (c: string, v: unknown) => {
    cols.push(c);
    vals.push(v);
  };
  if (o.email !== undefined) push("email", o.email);
  if (o.unsubscribe_token !== undefined) push("unsubscribe_token", o.unsubscribe_token);
  if (o.user_ip !== undefined) push("user_ip", o.user_ip);
  if (o.unsubscribed_at !== undefined) push("unsubscribed_at", o.unsubscribed_at);
  if (o.op_lease_id !== undefined) push("op_lease_id", o.op_lease_id);
  if (o.op_lease_expires_at !== undefined) push("op_lease_expires_at", o.op_lease_expires_at);
  if (o.op_fence !== undefined) push("op_fence", o.op_fence);
  if (o.retention_locked_at !== undefined) push("retention_locked_at", o.retention_locked_at);
  if (o.retention_job_id !== undefined) push("retention_job_id", o.retention_job_id);
  if (o.pdf_r2_key !== undefined) push("pdf_r2_key", o.pdf_r2_key);
  s.prepare(`INSERT INTO scans (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...(vals as never[]));
}
function insertRJob(
  s: DatabaseSync,
  o: {
    scan_id: string;
    job_id: string;
    status?: string;
    claim_id?: string | null;
    lease_expires_at?: number | null;
    attempts?: number;
    next_attempt_at?: number;
    alert_state?: string | null;
    dead_lettered_at?: number | null;
  }
) {
  s.prepare(
    `INSERT INTO retention_jobs (scan_id, job_id, status, claim_id, lease_expires_at, attempts, next_attempt_at, last_error_class, enqueued_at, dead_lettered_at, alert_state)
     VALUES (?,?,?,?,?,?,?,NULL,?,?,?)`
  ).run(
    o.scan_id,
    o.job_id,
    o.status ?? "pending",
    o.claim_id ?? null,
    o.lease_expires_at ?? null,
    o.attempts ?? 0,
    o.next_attempt_at ?? 0,
    OLD,
    o.dead_lettered_at ?? null,
    o.alert_state ?? null
  );
}
function insertCapture(
  s: DatabaseSync,
  o: { job_id: string; scan_id: string; phase: string; email?: string | null; pdf_r2_key?: string | null; delivery_snapshot?: string | null; updated_at?: number }
) {
  s.prepare(
    `INSERT INTO capture_jobs (job_id, scan_id, email, pdf_r2_key, phase, delivery_snapshot, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(o.job_id, o.scan_id, o.email ?? null, o.pdf_r2_key ?? null, o.phase, o.delivery_snapshot ?? null, OLD, o.updated_at ?? OLD);
}
function insertArtifact(s: DatabaseSync, o: { r2_key: string; scan_id: string; status?: string }) {
  s.prepare(`INSERT INTO r2_artifacts (r2_key, scan_id, capture_job_id, op_fence, created_at, status) VALUES (?,?,?,?,?,?)`).run(
    o.r2_key,
    o.scan_id,
    "cap-x",
    1,
    OLD,
    o.status ?? "active"
  );
}
const scanRow = (s: DatabaseSync, id: string) => s.prepare("SELECT * FROM scans WHERE id=?").get(id) as Record<string, unknown> | undefined;
const jobRow = (s: DatabaseSync, id: string) => s.prepare("SELECT * FROM retention_jobs WHERE scan_id=?").get(id) as Record<string, unknown> | undefined;
const capRow = (s: DatabaseSync, jid: string) => s.prepare("SELECT * FROM capture_jobs WHERE job_id=?").get(jid) as Record<string, unknown> | undefined;
const artCount = (s: DatabaseSync, id: string) => (s.prepare("SELECT COUNT(*) AS n FROM r2_artifacts WHERE scan_id=?").get(id) as { n: number }).n;
const auditRows = (s: DatabaseSync, id: string) => s.prepare("SELECT * FROM retention_replay_audit WHERE scan_id=?").all(id) as Record<string, unknown>[];

// Statement markers over the executed (comment-stripped, ?N-converted) SQL.
const M = {
  p1: (q: string) => q.includes("op_owner='privacy_delete'"),
  p2: (q: string) => q.includes("UPDATE scans SET op_lease_expires_at"),
  p3: (q: string) => q.includes("AS scan_expiry"),
  p4: (q: string) => q.includes("SET phase='cancelled'"),
  p6: (q: string) => q.includes("DELETE FROM r2_artifacts"),
  p7: (q: string) => q.includes("SET email=NULL, pdf_r2_key=NULL"),
  p8: (q: string) => q.includes("UPDATE scans SET email=NULL"),
  p10: (q: string) => q.includes("SET op_owner=NULL"),
  a4: (q: string) => q.includes("retention_locked_at, retention_job_id"),
  gd7: (q: string) => q.includes("SELECT status FROM retention_jobs"),
};
const stole = (s: DatabaseSync, id: string) =>
  s.prepare("UPDATE scans SET op_lease_id='thief', op_fence=op_fence+1, op_lease_expires_at=? WHERE id=?").run(FAR, id);

type D1 = ReturnType<typeof makeD1>;
function envOf(d1: D1, extra: Record<string, unknown> = {}): Env {
  return { DB: d1 as unknown, INTERNAL_SCANNER_ADMIN_KEY: "admin-key", ...extra } as unknown as Env;
}
const captureReq = (id: string, email: string, opted = 1) =>
  new Request(`https://scanner.astrant.io/api/scan/${id}/capture-email`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-scanner-admin-key": "admin-key" },
    body: JSON.stringify({ email, unsubscribe_token: "tok", email_opted_in_rescan: opted }),
  });
const deleteReq = (id: string) =>
  new Request(`https://scanner.astrant.io/api/scan/${id}/delete-pii`, {
    method: "POST",
    headers: { "x-internal-scanner-admin-key": "admin-key" },
  });
const replayReq = (body: unknown, key?: string) =>
  new Request(`https://scanner.astrant.io/api/internal/retention/replay`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "x-internal-scanner-admin-key": key } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

// A fully-populated deletable world: scan with PII + versioned/legacy artifacts
// + a non-terminal capture job carrying PII.
function seedHappy(sqlite: DatabaseSync, id: string, cj: string) {
  seedScan(sqlite, {
    id,
    email: "u@x.com",
    unsubscribe_token: "tok",
    user_ip: "1.2.3.4",
    opted: 1,
    pdf_r2_key: `score-reports/${id}/h/1.pdf`,
  });
  insertCapture(sqlite, { job_id: cj, scan_id: id, phase: "uploaded", email: "u@x.com", pdf_r2_key: `score-reports/${id}/h/1.pdf`, delivery_snapshot: "{}" });
  insertArtifact(sqlite, { r2_key: `score-reports/${id}/h/1.pdf`, scan_id: id, status: "active" });
  insertArtifact(sqlite, { r2_key: `score-reports/${id}/h/0.pdf`, scan_id: id, status: "superseded" });
}

afterEach(() => vi.restoreAllMocks());

describe("Chunk G tG1–tG8 — gate, machine, guards", () => {
  it("tG1: gate parse fail-closed; gate off/absent/unknown → all three surfaces byte-identical legacy (statement-text), replay route 404 with zero statements", async () => {
    for (const v of [undefined, null, "", "ON", "On", " on", "on ", "true", "1", "enforce", 0, {}]) {
      expect(parseIntegrationMode(v)).toBe("off");
    }
    expect(parseIntegrationMode("on")).toBe("on");
    // capture-email, gate absent → the literal legacy statement text
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const id = uuid();
      seedScan(sqlite, { id });
      const res = await scannerWorker.fetch(captureReq(id, "a@b.com"), envOf(d1), ctx);
      expect(res.status).toBe(200);
      const upd = d1.executed.filter((e) => WRITE_RE.test(e.sql));
      expect(upd).toHaveLength(1);
      expect(upd[0].sql).toBe(CAPTURE_SET_EMAIL_SQL);
      expect(d1.executed.some((e) => e.sql.includes("retention_locked_at"))).toBe(false);
    }
    // capture-email, gate case-variant ('ON') → still legacy
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const id = uuid();
      seedScan(sqlite, { id });
      const res = await scannerWorker.fetch(captureReq(id, "a@b.com"), envOf(d1, { PRIVACY_INTEGRATION_MODE: "ON" }), ctx);
      expect(res.status).toBe(200);
      expect(d1.executed.some((e) => e.sql.includes("retention_locked_at"))).toBe(false);
    }
    // delete-pii, gate absent → the legacy inline statement; no lease machinery
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const id = uuid();
      seedScan(sqlite, { id, email: "a@b.com" });
      const res = await scannerWorker.fetch(deleteReq(id), envOf(d1), ctx);
      expect(res.status).toBe(200);
      const upd = d1.executed.filter((e) => WRITE_RE.test(e.sql));
      expect(upd).toHaveLength(1);
      expect(upd[0].sql).toContain("deletion_requested_at = COALESCE(deletion_requested_at, ?)");
      expect(d1.executed.some((e) => e.sql.includes("op_lease_id"))).toBe(false);
    }
    // replay route, gate absent → 404, zero statements
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const res = await scannerWorker.fetch(replayReq({ scan_id: "x", actor: "a", reason: "r" }, "admin-key"), envOf(d1), ctx);
      expect(res.status).toBe(404);
      expect(d1.executed).toHaveLength(0);
    }
  });

  it("tG2: happy path — acquire → cancel (stamped) → prefix purge → registry DELETE → capture scrub (NO stamp) → scan clear incl. pdf_r2_key → release; 200", async () => {
    const sqlite = freshSqlite();
    const id = uuid();
    const cj = uuid();
    seedHappy(sqlite, id, cj);
    let capUpdatedAtAtP7: unknown = "unset";
    const d1 = makeD1(sqlite, {
      before: (sql) => {
        if (M.p7(sql)) capUpdatedAtAtP7 = capRow(sqlite, cj)!.updated_at;
      },
    });
    const r2 = makeR2();
    let t = NOW;
    const out = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id, { clock: () => (t += 7) });
    expect(out.status).toBe("ok");
    expect(r2.state.purges).toEqual([`score-reports/${id}/`]);
    expect(artCount(sqlite, id)).toBe(0);
    const cap = capRow(sqlite, cj)!;
    expect(cap.phase).toBe("cancelled");
    expect(cap.email).toBeNull();
    expect(cap.delivery_snapshot).toBeNull();
    expect(cap.pdf_r2_key).toBeNull();
    // P4 stamped updated_at; P7 (the scrub) did NOT re-stamp it
    expect(cap.updated_at).not.toBe(OLD);
    expect(cap.updated_at).toBe(capUpdatedAtAtP7);
    const s = scanRow(sqlite, id)!;
    expect(s.email).toBeNull();
    expect(s.unsubscribe_token).toBeNull();
    expect(s.user_ip).toBeNull();
    expect(s.email_opted_in_rescan).toBe(0);
    expect(s.pdf_r2_key).toBeNull();
    expect(s.deletion_requested_at).not.toBeNull();
    expect(s.op_owner).toBeNull();
    expect(s.op_lease_id).toBeNull();
    expect(s.op_lease_expires_at).toBeNull();
    expect(s.op_fence).toBe(1);
  });

  it("tG3: tombstoned + free/expired lease — coordinated subset runs (fence++); stale retention claimant 0-rows; tombstone columns untouched; scan row survives", async () => {
    const sqlite = freshSqlite();
    const id = uuid();
    const cj = uuid();
    seedHappy(sqlite, id, cj);
    // tombstoned by retention at fence 3, but the retention scan-plane lease has EXPIRED
    sqlite
      .prepare("UPDATE scans SET retention_locked_at=?, retention_job_id='J', op_owner='retention', op_lease_id='ret-cid', op_lease_expires_at=?, op_fence=3 WHERE id=?")
      .run(OLD, NOW - 1000, id);
    insertRJob(sqlite, { scan_id: id, job_id: "J", status: "claimed", claim_id: "ret-cid", lease_expires_at: FAR });
    const d1 = makeD1(sqlite);
    const r2 = makeR2();
    let t = NOW;
    const out = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id, { clock: () => (t += 7) });
    expect(out.status).toBe("ok");
    const s = scanRow(sqlite, id)!;
    expect(s).toBeDefined(); // scan row survives — privacy-delete never hard-deletes
    expect(s.retention_locked_at).toBe(OLD); // tombstone untouched by every P-statement
    expect(s.retention_job_id).toBe("J");
    expect(s.op_fence).toBe(4); // fence monotonicity: acquisition incremented past the stale claimant
    expect(s.email).toBeNull();
    // steal simulation: the stale retention claimant's next scan-plane authorization 0-rows
    const p = prepRetentionSql(RETENTION_SQL.s2);
    const r = sqlite.prepare(p.text).run(FAR, id, "ret-cid", 3, "J");
    expect(Number(r.changes)).toBe(0);
  });

  it("tG4: tombstoned + LIVE retention lease — pd_busy, zero R2 calls, D1 byte-unchanged", async () => {
    const sqlite = freshSqlite();
    const id = uuid();
    seedScan(sqlite, {
      id,
      email: "orig@x.com",
      retention_locked_at: OLD,
      retention_job_id: "J",
      op_lease_id: "retention-cid",
      op_lease_expires_at: FAR,
    });
    const before = scanRow(sqlite, id)!;
    const d1 = makeD1(sqlite);
    const r2 = makeR2();
    const out = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id);
    expect(out.status).toBe("pd_busy");
    expect(r2.state.purges).toHaveLength(0);
    expect(scanRow(sqlite, id)).toEqual(before);
  });

  it("tG5: purge failure classes → pd_purge_failed (502 via route); scan PII retained; cancelled-but-pdf_r2_key intermediate; token retry completes to the tG2 end-state", async () => {
    for (const mode of ["transport", "rpc_failed", "malformed", "unconfirmed"] as R2Mode[]) {
      const sqlite = freshSqlite();
      const id = uuid();
      const cj = uuid();
      seedHappy(sqlite, id, cj);
      const d1 = makeD1(sqlite);
      const r2 = makeR2({ modes: [mode] }); // first purge fails, retry succeeds
      const env = envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY });
      const out = await runPrivacyDelete(env, id);
      expect(out.status).toBe("pd_purge_failed");
      const s1 = scanRow(sqlite, id)!;
      expect(s1.email).toBe("u@x.com"); // retain-on-failure
      expect(s1.unsubscribe_token).toBe("tok");
      const cap1 = capRow(sqlite, cj)!;
      expect(cap1.phase).toBe("cancelled"); // recorded intermediate:
      expect(cap1.email).toBeNull(); //   email/snapshot already nulled at P4
      expect(cap1.delivery_snapshot).toBeNull();
      expect(cap1.pdf_r2_key).not.toBeNull(); //   ONLY pdf_r2_key survives until P7
      // token retry re-runs the full path and completes
      const out2 = await runPrivacyDelete(env, id);
      expect(out2.status).toBe("ok");
      const s2 = scanRow(sqlite, id)!;
      expect(s2.email).toBeNull();
      expect(s2.unsubscribe_token).toBeNull();
      expect(s2.pdf_r2_key).toBeNull();
      expect(capRow(sqlite, cj)!.pdf_r2_key).toBeNull();
      expect(artCount(sqlite, id)).toBe(0);
      expect(s2.op_lease_id).toBeNull();
    }
    // route mapping: 502
    {
      const sqlite = freshSqlite();
      const id = uuid();
      seedScan(sqlite, { id, email: "u@x.com" });
      const d1 = makeD1(sqlite);
      const r2 = makeR2({ modes: ["transport"] });
      const res = await scannerWorker.fetch(
        deleteReq(id),
        envOf(d1, { PRIVACY_INTEGRATION_MODE: "on", MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }),
        ctx
      );
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: string }).error).toBe("pd_purge_failed");
    }
  });

  it("tG6: idempotent re-run on an already-cleared scan — 200; every P-statement re-runnable; deletion_requested_at preserved (COALESCE)", async () => {
    const sqlite = freshSqlite();
    const id = uuid();
    const cj = uuid();
    seedHappy(sqlite, id, cj);
    const d1 = makeD1(sqlite);
    const r2 = makeR2();
    const env = envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY });
    const out1 = await runPrivacyDelete(env, id);
    expect(out1.status).toBe("ok");
    const requestedAt = scanRow(sqlite, id)!.deletion_requested_at;
    const out2 = await runPrivacyDelete(env, id);
    expect(out2.status).toBe("ok");
    const s = scanRow(sqlite, id)!;
    expect(s.email).toBeNull();
    expect(s.deletion_requested_at).toBe(requestedAt); // COALESCE keeps the first stamp
    expect(s.op_fence).toBe(2); // two acquisitions
    expect(s.op_lease_id).toBeNull();
    expect(r2.state.purges).toHaveLength(2);
  });

  it("tG7: steal-between-every-pair — pre-purge steals abort before the RPC; post-purge steals have zero effective mutation; own-fence-only release; 409 class", async () => {
    type Case = { name: string; trigger: "p4" | "p3" | "purge" | "p7" | "p8" };
    const cases: Case[] = [
      { name: "after P1, before P4", trigger: "p4" },
      { name: "after P4, before P3", trigger: "p3" },
      { name: "during purge, before unconditional P2", trigger: "purge" },
      { name: "after P6, before P7", trigger: "p7" },
      { name: "after P7, before P8", trigger: "p8" },
    ];
    for (const cse of cases) {
      const sqlite = freshSqlite();
      const id = uuid();
      const cj = uuid();
      seedHappy(sqlite, id, cj);
      let fired = false;
      const fire = () => {
        if (!fired) {
          fired = true;
          stole(sqlite, id);
        }
      };
      const d1 = makeD1(sqlite, {
        before: (sql) => {
          if (cse.trigger === "p4" && M.p4(sql)) fire();
          if (cse.trigger === "p3" && M.p3(sql)) fire();
          if (cse.trigger === "p7" && M.p7(sql)) fire();
          if (cse.trigger === "p8" && M.p8(sql)) fire();
        },
      });
      const r2 = makeR2({ onPurge: () => (cse.trigger === "purge" ? void fire() : undefined) });
      const out = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id);
      expect(out.status, cse.name).toBe("pd_lease_lost");
      const preRpcSteal = cse.trigger === "p4" || cse.trigger === "p3";
      // pre-purge steals: detected by P3's exactly-1 → abort BEFORE the RPC, zero purge calls
      expect(r2.state.purges.length, cse.name).toBe(preRpcSteal ? 0 : 1);
      // no later destructive EFFECT: the terminal P8 never landed
      expect(d1.executed.filter((e) => M.p8(e.sql) && e.changes > 0), cse.name).toHaveLength(0);
      const s = scanRow(sqlite, id)!;
      expect(s.email, cse.name).toBe("u@x.com"); // scan PII retained in every steal case
      // own-fence-only release: the thief's lease is intact
      expect(s.op_lease_id, cse.name).toBe("thief");
      expect(d1.executed.filter((e) => M.p10(e.sql) && e.changes > 0), cse.name).toHaveLength(0);
    }
  });

  it("tG8: capture-email guard — tombstoned 409/byte-unchanged; free-lease captures; TOCTOU → pd_busy then retry succeeds; clamp invariant under five binds; injected throws → pd_internal (gate-on) vs legacy catch bytes (gate-off)", async () => {
    // (a) tombstoned, free lease → 409 tombstoned, byte-unchanged
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const id = uuid();
      seedScan(sqlite, { id, email: "orig@x.com", retention_locked_at: OLD, retention_job_id: "J" });
      const before = scanRow(sqlite, id)!;
      const res = await scannerWorker.fetch(captureReq(id, "new@x.com"), envOf(d1, { PRIVACY_INTEGRATION_MODE: "on" }), ctx);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toBe("tombstoned");
      expect(scanRow(sqlite, id)).toEqual(before);
    }
    // (b) non-tombstoned + free/expired lease → captures
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const id = uuid();
      seedScan(sqlite, { id, op_lease_id: "old", op_lease_expires_at: 1000 }); // expired lease (route path uses real Date.now)
      const res = await scannerWorker.fetch(captureReq(id, "new@x.com"), envOf(d1, { PRIVACY_INTEGRATION_MODE: "on" }), ctx);
      expect(res.status).toBe(200);
      const s = scanRow(sqlite, id)!;
      expect(s.email).toBe("new@x.com");
      expect(s.email_opted_in_rescan).toBe(1);
      // the guarded statement (raw positional bytes) is what executed
      expect(d1.executed.some((e) => e.sql === CAPTURE_SET_EMAIL_GUARDED_SQL)).toBe(true);
    }
    // (c) TOCTOU: live foreign lease at the UPDATE, released before the A4 read → pd_busy; retry succeeds
    {
      const sqlite = freshSqlite();
      const id = uuid();
      seedScan(sqlite, { id, op_lease_id: "other", op_lease_expires_at: FAR });
      let fired = false;
      const d1 = makeD1(sqlite, {
        before: (sql) => {
          if (!fired && M.a4(sql)) {
            fired = true;
            sqlite.prepare("UPDATE scans SET op_owner=NULL, op_lease_id=NULL, op_lease_expires_at=NULL WHERE id=?").run(id);
          }
        },
      });
      const env = envOf(d1, { PRIVACY_INTEGRATION_MODE: "on" });
      const res1 = await scannerWorker.fetch(captureReq(id, "new@x.com"), env, ctx);
      expect(res1.status).toBe(409);
      expect(((await res1.json()) as { error: string }).error).toBe("pd_busy");
      expect(scanRow(sqlite, id)!.email).toBeNull();
      const res2 = await scannerWorker.fetch(captureReq(id, "new@x.com"), env, ctx);
      expect(res2.status).toBe(200);
      expect(scanRow(sqlite, id)!.email).toBe("new@x.com");
    }
    // (d) unsubscribed-clamp invariant under the guarded statement (five binds)
    {
      const sqlite = freshSqlite();
      const idU = uuid();
      const idN = uuid();
      seedScan(sqlite, { id: idU, unsubscribed_at: OLD });
      seedScan(sqlite, { id: idN });
      const r1 = sqlite.prepare(CAPTURE_SET_EMAIL_GUARDED_SQL).run("a@b.com", 1, "tok", idU, NOW);
      expect(Number(r1.changes)).toBe(1);
      expect(scanRow(sqlite, idU)!.email).toBe("a@b.com"); // capture proceeds
      expect(scanRow(sqlite, idU)!.email_opted_in_rescan).toBe(0); // opt-in clamped
      const r2s = sqlite.prepare(CAPTURE_SET_EMAIL_GUARDED_SQL).run("a@b.com", 1, "tok", idN, NOW);
      expect(Number(r2s.changes)).toBe(1);
      expect(scanRow(sqlite, idN)!.email_opted_in_rescan).toBe(1); // honored when not unsubscribed
    }
    // (e) injected D1 throws: gate-on → pd_internal, identifier-free; gate-off → legacy catch bytes
    {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // gate-on, throw on the guarded UPDATE
      {
        const sqlite = freshSqlite();
        const id = uuid();
        seedScan(sqlite, { id });
        const d1 = makeD1(sqlite, {
          before: (sql) => {
            if (sql === CAPTURE_SET_EMAIL_GUARDED_SQL) throw new Error("d1 boom");
          },
        });
        const res = await scannerWorker.fetch(captureReq(id, "a@b.com"), envOf(d1, { PRIVACY_INTEGRATION_MODE: "on" }), ctx);
        expect(res.status).toBe(500);
        expect(((await res.json()) as { error: string }).error).toBe("pd_internal");
        const lines = errSpy.mock.calls.map((c) => c.join(" "));
        expect(lines.some((l) => l === "[capture-email] pd_internal")).toBe(true);
        expect(lines.some((l) => l.includes(id))).toBe(false);
      }
      errSpy.mockClear();
      // gate-on, throw on the A4 read (guarded 0-rows first: tombstoned row)
      {
        const sqlite = freshSqlite();
        const id = uuid();
        seedScan(sqlite, { id, retention_locked_at: OLD });
        const d1 = makeD1(sqlite, {
          before: (sql) => {
            if (M.a4(sql)) throw new Error("d1 boom");
          },
        });
        const res = await scannerWorker.fetch(captureReq(id, "a@b.com"), envOf(d1, { PRIVACY_INTEGRATION_MODE: "on" }), ctx);
        expect(res.status).toBe(500);
        expect(((await res.json()) as { error: string }).error).toBe("pd_internal");
        expect(errSpy.mock.calls.map((c) => c.join(" ")).some((l) => l.includes(id))).toBe(false);
      }
      errSpy.mockClear();
      // gate-off, throw on the legacy statement → the legacy catch bytes (raw scan_id log, "db error")
      {
        const sqlite = freshSqlite();
        const id = uuid();
        seedScan(sqlite, { id });
        const d1 = makeD1(sqlite, {
          before: (sql) => {
            if (sql === CAPTURE_SET_EMAIL_SQL) throw new Error("d1 boom");
          },
        });
        const res = await scannerWorker.fetch(captureReq(id, "a@b.com"), envOf(d1), ctx);
        expect(res.status).toBe(500);
        expect(((await res.json()) as { error: string }).error).toBe("db error");
        const lines = errSpy.mock.calls.map((c) => c.join(" "));
        expect(lines.some((l) => l.includes(`scan_id=${id}`))).toBe(true); // legacy bytes preserved
      }
    }
  });
});

describe("Chunk G tG9–tG17 — replay endpoint, interplay, audits, windows, matrix", () => {
  it("tG9: named proof G-1 — replay endpoint: trust-domain actor canonicalized-as-stored; 401/404/400/429 legs all zero statements; non-dead-letter replays false", async () => {
    // happy: authenticated + gate-on + dead-letter row; padded plain-ASCII actor/reason
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const id = uuid();
      insertRJob(sqlite, { scan_id: id, job_id: "J", status: "dead_letter", attempts: 5, alert_state: "alerted", dead_lettered_at: OLD, next_attempt_at: FAR });
      const res = await scannerWorker.fetch(
        replayReq({ scan_id: id, actor: "  ops-bruno  ", reason: "  manual replay after drift revert  " }, "admin-key"),
        envOf(d1, { PRIVACY_INTEGRATION_MODE: "on" }),
        ctx
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, replayed: true });
      const audit = auditRows(sqlite, id);
      expect(audit).toHaveLength(1);
      expect(audit[0].actor).toBe("scanner-admin/ops-bruno"); // canonicalized as stored, not bytes-as-sent
      expect(audit[0].reason).toBe("manual replay after drift revert");
      expect(audit[0].job_id).toBe("J");
      const j = jobRow(sqlite, id)!;
      expect(j.status).toBe("pending");
      expect(j.attempts).toBe(0);
      expect(j.claim_id).toBeNull();
      expect(j.lease_expires_at).toBeNull();
      expect(j.alert_state).toBeNull();
    }
    // unauthenticated → 401, zero statements
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const res = await scannerWorker.fetch(replayReq({ scan_id: "x", actor: "a", reason: "r" }, "wrong"), envOf(d1, { PRIVACY_INTEGRATION_MODE: "on" }), ctx);
      expect(res.status).toBe(401);
      expect(d1.executed).toHaveLength(0);
    }
    // gate-off → 404, zero statements
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const res = await scannerWorker.fetch(replayReq({ scan_id: "x", actor: "a", reason: "r" }, "admin-key"), envOf(d1), ctx);
      expect(res.status).toBe(404);
      expect(d1.executed).toHaveLength(0);
    }
    // invalid bodies → 400, zero statements
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const env = envOf(d1, { PRIVACY_INTEGRATION_MODE: "on" });
      const bad = [
        { actor: "a", reason: "r" }, // missing scan_id
        { scan_id: "", actor: "a", reason: "r" },
        { scan_id: "x".repeat(129), actor: "a", reason: "r" },
        { scan_id: "x", actor: "   ", reason: "r" }, // whitespace-only actor
        { scan_id: "x", actor: "a".repeat(51), reason: "r" },
        { scan_id: "x", actor: "a", reason: 7 },
        { scan_id: "x", actor: "a", reason: "bad" + String.fromCharCode(1) + "reason" }, // control char → D15 revalidation, still zero statements
      ];
      for (const body of bad) {
        const res = await scannerWorker.fetch(replayReq(body, "admin-key"), env, ctx);
        expect(res.status).toBe(400);
      }
      const resJson = await scannerWorker.fetch(replayReq("{not json", "admin-key"), env, ctx);
      expect(resJson.status).toBe(400);
      expect(d1.executed).toHaveLength(0);
    }
    // non-dead-letter → replayed:false, zero audit rows
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const id = uuid();
      insertRJob(sqlite, { scan_id: id, job_id: "J", status: "pending" });
      const res = await scannerWorker.fetch(replayReq({ scan_id: id, actor: "ops", reason: "check" }, "admin-key"), envOf(d1, { PRIVACY_INTEGRATION_MODE: "on" }), ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, replayed: false });
      expect(auditRows(sqlite, id)).toHaveLength(0);
    }
    // rate limit → 429, zero statements
    {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const cache = { get: async () => String(REPLAY_PER_MIN), put: async () => {} };
      const res = await scannerWorker.fetch(
        replayReq({ scan_id: "x", actor: "a", reason: "r" }, "admin-key"),
        envOf(d1, { PRIVACY_INTEGRATION_MODE: "on", CACHE: cache }),
        ctx
      );
      expect(res.status).toBe(429);
      expect(d1.executed).toHaveLength(0);
    }
  });

  it("tG10: GD7 interplay — privacy-delete on a dead-lettered tombstoned scan (free lease) scrubs AND fires the audited replay (actor=privacy_delete; job → pending; alert_state cleared)", async () => {
    const sqlite = freshSqlite();
    const id = uuid();
    const cj = uuid();
    seedHappy(sqlite, id, cj);
    sqlite.prepare("UPDATE scans SET retention_locked_at=?, retention_job_id='J' WHERE id=?").run(OLD, id);
    insertRJob(sqlite, { scan_id: id, job_id: "J", status: "dead_letter", attempts: 5, alert_state: "alerted", dead_lettered_at: OLD, next_attempt_at: FAR });
    const d1 = makeD1(sqlite);
    const r2 = makeR2();
    const out = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id);
    expect(out.status).toBe("ok");
    expect(scanRow(sqlite, id)!.email).toBeNull();
    const audit = auditRows(sqlite, id);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe("privacy_delete");
    expect(audit[0].reason).toBe("privacy-delete completion");
    const j = jobRow(sqlite, id)!;
    expect(j.status).toBe("pending");
    expect(j.attempts).toBe(0);
    expect(j.alert_state).toBeNull(); // D16 re-alert-once contract unaffected
  });

  it("tG11: static audit over PRIVACY_SQL + the guarded capture statement — presence AND absence", () => {
    const P = { p1: PRIVACY_SQL.p1, p2: PRIVACY_SQL.p2, p3: PRIVACY_SQL.p3, p4: PRIVACY_SQL.p4, p6: PRIVACY_SQL.p6, p7: PRIVACY_SQL.p7, p8: PRIVACY_SQL.p8, p10: PRIVACY_SQL.p10 };
    // scan-plane EXISTS with live expiry in P4/P6/P7
    for (const k of ["p4", "p6", "p7"] as const) {
      expect(P[k]).toContain("EXISTS (SELECT 1 FROM scans WHERE id=:id AND op_lease_id=:cid AND op_fence=:fence");
      expect(P[k]).toContain("op_lease_expires_at > :live");
    }
    // in-statement authority in P8 (terminal-success-statement authority)
    expect(P.p8).toContain("WHERE id=:id AND op_lease_id=:cid AND op_fence=:fence AND op_lease_expires_at > :live");
    // required ABSENCES in every P-fragment: no job-plane reference, no retention identity terms
    for (const [k, sql] of Object.entries(P)) {
      expect(sql, k).not.toContain("retention_jobs");
      expect(sql, k).not.toContain("retention_locked_at");
      expect(sql, k).not.toContain("retention_job_id");
    }
    // P1 ends RETURNING op_fence
    expect(P.p1.trim().endsWith("RETURNING op_fence;")).toBe(true);
    // guarded capture statement: tombstone predicate + free/expired-lease predicate + the clamp CASE; absences
    expect(CAPTURE_SET_EMAIL_GUARDED_SQL).toContain("retention_locked_at IS NULL");
    expect(CAPTURE_SET_EMAIL_GUARDED_SQL).toContain("(op_lease_id IS NULL OR op_lease_expires_at < ?)");
    expect(CAPTURE_SET_EMAIL_GUARDED_SQL).toContain("CASE WHEN unsubscribed_at IS NULL THEN ? ELSE 0 END");
    expect(CAPTURE_SET_EMAIL_GUARDED_SQL).not.toContain("retention_job_id");
    expect(CAPTURE_SET_EMAIL_GUARDED_SQL).not.toContain("retention_jobs");
    // the guarded statement is the legacy statement + exactly the two predicates
    expect(CAPTURE_SET_EMAIL_GUARDED_SQL.startsWith(CAPTURE_SET_EMAIL_SQL.replace(/\n  WHERE id = \?$/, ""))).toBe(true);
    // a4Read bytes identical to the frozen retention machine's A4
    expect(PRIVACY_SQL.a4Read).toBe(RETENTION_SQL.a4Read);
  });

  it("tG12: cross-contamination — deleting scan A never touches scan B's rows, artifacts, or capture jobs", async () => {
    const sqlite = freshSqlite();
    const a = uuid();
    const b = uuid();
    const cjA = uuid();
    const cjB = uuid();
    seedHappy(sqlite, a, cjA);
    seedHappy(sqlite, b, cjB);
    insertRJob(sqlite, { scan_id: b, job_id: "JB", status: "pending" });
    const beforeScanB = scanRow(sqlite, b)!;
    const beforeCapB = capRow(sqlite, cjB)!;
    const beforeJobB = jobRow(sqlite, b)!;
    const d1 = makeD1(sqlite);
    const r2 = makeR2();
    const out = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), a);
    expect(out.status).toBe("ok");
    expect(scanRow(sqlite, b)).toEqual(beforeScanB);
    expect(capRow(sqlite, cjB)).toEqual(beforeCapB);
    expect(jobRow(sqlite, b)).toEqual(beforeJobB);
    expect(artCount(sqlite, b)).toBe(2);
    expect(r2.state.purges).toEqual([`score-reports/${a}/`]);
    expect(scanRow(sqlite, a)!.email).toBeNull();
    expect(artCount(sqlite, a)).toBe(0);
  });

  it("tG13: log hygiene — no created scan/job UUID in any NEW log line; fixed classes only", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ids: string[] = [];
    // happy path + GD7 replay
    {
      const sqlite = freshSqlite();
      const id = uuid();
      const cj = uuid();
      ids.push(id, cj);
      seedHappy(sqlite, id, cj);
      sqlite.prepare("UPDATE scans SET retention_locked_at=?, retention_job_id='J' WHERE id=?").run(OLD, id);
      insertRJob(sqlite, { scan_id: id, job_id: "J", status: "dead_letter", next_attempt_at: FAR });
      const d1 = makeD1(sqlite);
      const r2 = makeR2();
      await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id);
    }
    // pd_busy path
    {
      const sqlite = freshSqlite();
      const id = uuid();
      ids.push(id);
      seedScan(sqlite, { id, op_lease_id: "x", op_lease_expires_at: FAR });
      const d1 = makeD1(sqlite);
      const r2 = makeR2();
      await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id);
    }
    // purge-failure path
    {
      const sqlite = freshSqlite();
      const id = uuid();
      ids.push(id);
      seedScan(sqlite, { id, email: "u@x.com" });
      const d1 = makeD1(sqlite);
      const r2 = makeR2({ modes: ["transport"] });
      await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id);
    }
    // guard rejection through the route
    {
      const sqlite = freshSqlite();
      const id = uuid();
      ids.push(id);
      seedScan(sqlite, { id, retention_locked_at: OLD });
      const d1 = makeD1(sqlite);
      await scannerWorker.fetch(captureReq(id, "a@b.com"), envOf(d1, { PRIVACY_INTEGRATION_MODE: "on" }), ctx);
    }
    const all = [...logSpy.mock.calls, ...errSpy.mock.calls, ...warnSpy.mock.calls].map((c) => c.join(" "));
    for (const id of ids) {
      expect(all.some((l) => l.includes(id))).toBe(false);
    }
    const newLines = all.filter((l) => /^\[(privacy-delete|capture-email|delete-pii|retention-replay)\]/.test(l));
    expect(newLines.length).toBeGreaterThan(0);
    const allowed =
      /^\[privacy-delete\] (ok purged=\d+|pd_busy|pd_lease_lost|pd_purge_failed class=r2_[a-z_]+|pd_replay_failed|pd_release_failed)$|^\[capture-email\] (tombstoned|pd_busy|pd_internal)$|^\[delete-pii\] (pd_internal|pd_misconfigured)$|^\[retention-replay\] (retention_replay_integrity|pd_internal)$/;
    for (const l of newLines) {
      expect(l).toMatch(allowed);
    }
  });

  it("tG14: gate-on without MARKETING_R2/RECONCILE_R2_KEY — pd_misconfigured 500, zero statements, zero R2", async () => {
    const sqlite = freshSqlite();
    const id = uuid();
    seedScan(sqlite, { id, email: "u@x.com" });
    // direct: typed PdError before any statement
    {
      const d1 = makeD1(sqlite);
      await expect(runPrivacyDelete(envOf(d1), id)).rejects.toMatchObject({ cls: "pd_misconfigured" });
      expect(d1.executed).toHaveLength(0);
    }
    // through the route: 500 with its own class (never collapsed into pd_internal)
    {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const d1 = makeD1(sqlite);
      const res = await scannerWorker.fetch(deleteReq(id), envOf(d1, { PRIVACY_INTEGRATION_MODE: "on" }), ctx);
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error: string }).error).toBe("pd_misconfigured");
      expect(d1.executed).toHaveLength(0);
      expect(errSpy.mock.calls.map((c) => c.join(" "))).toContain("[delete-pii] pd_misconfigured");
    }
    expect(scanRow(sqlite, id)!.email).toBe("u@x.com");
  });

  it("tG15: capture-email/privacy-delete interleaving — dispatch inside the live lease (between P8 and P10) → 409 pd_busy, byte-unchanged; after release the same dispatch succeeds", async () => {
    const sqlite = freshSqlite();
    const id = uuid();
    const cj = uuid();
    seedHappy(sqlite, id, cj);
    let interposed: Response | null = null;
    let fired = false;
    const r2 = makeR2();
    const d1 = makeD1(sqlite, {
      before: async (sql) => {
        if (!fired && M.p10(sql)) {
          fired = true;
          interposed = await scannerWorker.fetch(captureReq(id, "late@x.com"), env, ctx);
        }
      },
    });
    const env = envOf(d1, { PRIVACY_INTEGRATION_MODE: "on", MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY });
    const res = await scannerWorker.fetch(deleteReq(id), env, ctx);
    expect(res.status).toBe(200);
    expect(interposed).not.toBeNull();
    expect(interposed!.status).toBe(409);
    expect(((await interposed!.json()) as { error: string }).error).toBe("pd_busy");
    // the v1 hole is closed: no fresh email landed mid-deletion
    const s = scanRow(sqlite, id)!;
    expect(s.email).toBeNull();
    // post-release residue (recorded, GD8): a NEW capture on the completed deletion is a new business event
    const after = await scannerWorker.fetch(captureReq(id, "late@x.com"), env, ctx);
    expect(after.status).toBe(200);
    expect(scanRow(sqlite, id)!.email).toBe("late@x.com");
  });

  it("tG16: window/deadline collapse — (a) request-deadline collapse aborts pd_busy BEFORE the RPC with no renewal; (b) low-headroom renewal fires and the bounded RPC proceeds", async () => {
    // (a) healthy lease, requestDeadline nearly exhausted → no P2, no RPC, pd_busy
    {
      const sqlite = freshSqlite();
      const id = uuid();
      const cj = uuid();
      seedHappy(sqlite, id, cj);
      const d1 = makeD1(sqlite);
      const r2 = makeR2();
      let t = NOW;
      const out = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id, {
        clock: () => (t += 7),
        requestBudgetMs: PD_TAIL_MARGIN_MS + MIN_RPC_WINDOW_MS - 1, // deadline term collapses below MIN
      });
      expect(out.status).toBe("pd_busy");
      expect(r2.state.purges).toHaveLength(0);
      expect(d1.executed.some((e) => M.p2(e.sql))).toBe(false); // no renewal fired — renewal cannot repair a request budget
      expect(d1.executed.some((e) => M.p8(e.sql))).toBe(false);
    }
    // (b) scanExpiry inside the renewal threshold with ample request budget → conditional P2 → RPC proceeds
    {
      const sqlite = freshSqlite();
      const id = uuid();
      const cj = uuid();
      seedHappy(sqlite, id, cj);
      let tNow = NOW;
      let jumped = false;
      const d1 = makeD1(sqlite, {
        before: (sql) => {
          if (!jumped && M.p3(sql)) {
            jumped = true;
            tNow = NOW + PD_LEASE_MS - (PD_PURGE_BUDGET_MS + LEASE_RENEW_MARGIN_MS) + 1000; // inside the threshold
          }
        },
      });
      const r2 = makeR2();
      const out = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id, {
        clock: () => tNow,
        requestBudgetMs: 3_600_000,
      });
      expect(out.status).toBe("ok");
      expect(r2.state.purges).toHaveLength(1);
      // conditional P2 (pre-purge) + unconditional P2 (post-purge) both fired
      expect(d1.executed.filter((e) => M.p2(e.sql))).toHaveLength(2);
    }
  });

  it("tG17: natural expiry + injected failures per the exception matrix — pd_lease_lost via P2 0-row; pd_internal per step (no P10 when fence-less); hook failure preserves 200; release failure preserves the prior outcome", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // (a) clock jumped past scanExpiry after P4 → P3 returns the expired deadline
    // (no expiry predicate), the headroom conditional fires, P2 0-rows → pd_lease_lost
    {
      const sqlite = freshSqlite();
      const id = uuid();
      const cj = uuid();
      seedHappy(sqlite, id, cj);
      let tNow = NOW;
      let jumped = false;
      const d1 = makeD1(sqlite, {
        before: (sql) => {
          if (!jumped && M.p3(sql)) {
            jumped = true;
            tNow = NOW + PD_LEASE_MS + 100_000; // past the acquired lease's expiry
          }
        },
      });
      const r2 = makeR2();
      const out = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id, { clock: () => tNow });
      expect(out.status).toBe("pd_lease_lost");
      expect(r2.state.purges).toHaveLength(0);
      const p2 = d1.executed.filter((e) => M.p2(e.sql));
      expect(p2).toHaveLength(1);
      expect(p2[0].changes).toBe(0); // the renewal 0-rowed on natural expiry
    }
    // (b) injected D1 throw at each of P1–P8 → 500 pd_internal via the route;
    // P10 attempted only where a fence was acquired
    {
      const legs: Array<[string, (q: string) => boolean]> = [
        ["p1", M.p1],
        ["p4", M.p4],
        ["p3", M.p3],
        ["p2", M.p2], // healthy run: the post-purge unconditional P2
        ["p6", M.p6],
        ["p7", M.p7],
        ["p8", M.p8],
      ];
      for (const [name, marker] of legs) {
        const sqlite = freshSqlite();
        const id = uuid();
        const cj = uuid();
        seedHappy(sqlite, id, cj);
        const d1 = makeD1(sqlite, {
          before: (sql) => {
            if (marker(sql)) throw new Error("d1 boom");
          },
        });
        const r2 = makeR2();
        const env = envOf(d1, { PRIVACY_INTEGRATION_MODE: "on", MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY });
        const res = await scannerWorker.fetch(deleteReq(id), env, ctx);
        expect(res.status, name).toBe(500);
        expect(((await res.json()) as { error: string }).error, name).toBe("pd_internal");
        const p10Ran = d1.executed.some((e) => M.p10(e.sql));
        if (name === "p1") {
          expect(p10Ran, name).toBe(false); // fence-less: nothing to release
        } else {
          expect(p10Ran, name).toBe(true);
        }
        expect(errSpy.mock.calls.map((c) => c.join(" ")).some((l) => l.includes(id)), name).toBe(false);
        // token retry completes after the fault clears
        const d1clean = makeD1(sqlite);
        const out = await runPrivacyDelete(envOf(d1clean, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), id);
        expect(out.status, name).toBe("ok");
        errSpy.mockClear();
      }
    }
    // (c) GD7-hook failure → pd_replay_failed logged, 200 preserved
    {
      const sqlite = freshSqlite();
      const id = uuid();
      const cj = uuid();
      seedHappy(sqlite, id, cj);
      const d1 = makeD1(sqlite, {
        before: (sql) => {
          if (M.gd7(sql)) throw new Error("d1 boom");
        },
      });
      const r2 = makeR2();
      const res = await scannerWorker.fetch(deleteReq(id), envOf(d1, { PRIVACY_INTEGRATION_MODE: "on", MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(errSpy.mock.calls.map((c) => c.join(" "))).toContain("[privacy-delete] pd_replay_failed");
      errSpy.mockClear();
    }
    // (d) P10 failure → pd_release_failed logged; prior outcome preserved on BOTH a success and an error run
    {
      const sqlite = freshSqlite();
      const id = uuid();
      const cj = uuid();
      seedHappy(sqlite, id, cj);
      const d1 = makeD1(sqlite, {
        before: (sql) => {
          if (M.p10(sql)) throw new Error("d1 boom");
        },
      });
      const r2 = makeR2();
      const res = await scannerWorker.fetch(deleteReq(id), envOf(d1, { PRIVACY_INTEGRATION_MODE: "on", MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), ctx);
      expect(res.status).toBe(200); // success preserved
      expect(errSpy.mock.calls.map((c) => c.join(" "))).toContain("[privacy-delete] pd_release_failed");
      errSpy.mockClear();
    }
    {
      const sqlite = freshSqlite();
      const id = uuid();
      const cj = uuid();
      seedHappy(sqlite, id, cj);
      const d1 = makeD1(sqlite, {
        before: (sql) => {
          if (M.p10(sql)) throw new Error("d1 boom");
        },
      });
      const r2 = makeR2({ modes: ["transport"] });
      const res = await scannerWorker.fetch(deleteReq(id), envOf(d1, { PRIVACY_INTEGRATION_MODE: "on", MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }), ctx);
      expect(res.status).toBe(502); // error outcome preserved (never masked by the release failure)
      expect(((await res.json()) as { error: string }).error).toBe("pd_purge_failed");
      expect(errSpy.mock.calls.map((c) => c.join(" "))).toContain("[privacy-delete] pd_release_failed");
    }
  });
});
