// P0-C2 Chunk F2 — retention-sweep state-machine proofs (Appendix Q tests 1–40)
// over the REAL migration chain (node:sqlite, 0001–0004) with an RPC-level
// MarketingR2Client mock. Production SQL only (RETENTION_SQL); helper-only
// assertions satisfy nothing. PASS is enumerated per test ID in the ship-report.
import { describe, it, expect, vi, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  runRetentionSweep,
  replayDeadLetter,
  parseRetentionMode,
  prepRetentionSql,
  RETENTION_SQL,
  HANDLER_WALL_BUDGET_MS,
  TICK_STOP_MARGIN_MS,
  MIN_JOB_HEADROOM_MS,
  RETENTION_MS,
} from "./retention-sweep";
import scannerWorker from "./index";
import type { Env } from "./types";

// ── Harness (F1 conventions: real migration chain, per-statement hooks) ──────
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
type Hooks = { before?: (sql: string, args: unknown[]) => void };
const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i;

function makeD1(sqlite: DatabaseSync, hooks: Hooks = {}) {
  const executed: Executed[] = [];
  const counters = { stmts: 0, writes: 0 };
  const record = (sql: string, changes: number) => {
    counters.stmts++;
    if (WRITE_RE.test(sql) && changes > 0) counters.writes++;
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
        hooks.before?.(sql, stmt._b);
        const i = sqlite.prepare(sql).run(...(stmt._b as never[]));
        const changes = Number(i.changes);
        record(sql, changes);
        return { success: true, meta: { changes }, results: [] };
      },
      async first<T = unknown>() {
        hooks.before?.(sql, stmt._b);
        const row = (sqlite.prepare(sql).get(...(stmt._b as never[])) ?? null) as T | null;
        record(sql, WRITE_RE.test(sql) && row !== null ? 1 : 0);
        return row;
      },
      async all<T = unknown>() {
        hooks.before?.(sql, stmt._b);
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
  return { prepare, batch, executed, counters };
}

type R2Mode = "ok" | "transport" | "rpc_failed" | "malformed" | "unconfirmed" | "abort";
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
        case "abort":
          return new Promise<Response>((_, reject) => {
            req.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
        default:
          return new Response(JSON.stringify({ ok: true, status: "purged", purged: 1 }), { status: 200 });
      }
    },
  };
  return { fetcher: fetcher as unknown as Fetcher, state };
}

const NOW = 1_800_000_000_000; // stable sweep timestamp (ms)
const THRESH = NOW - RETENTION_MS;
const OLD = THRESH - 60_000; // eligible (created_at < threshold)
const FAR = NOW + 3_600_000;
const KEY = "rk-secret";
const uuid = () => crypto.randomUUID();

function seedScan(
  s: DatabaseSync,
  o: {
    id: string;
    tier?: string | null;
    opted?: number;
    created_at?: number;
    email?: string | null;
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
  claim: (q: string) => q.includes("SET status='claimed'"),
  tomb: (q: string) => q.includes("op_owner='retention'"),
  s1: (q: string) => q.includes("UPDATE retention_jobs SET lease_expires_at"),
  s2: (q: string) => q.includes("UPDATE scans SET op_lease_expires_at"),
  s3: (q: string) => q.includes("AS job_expiry"),
  s4: (q: string) => q.includes("SET phase='cancelled'") && q.includes("op_lease_id"),
  s5: (q: string) => q.includes("SET status='r2_purged'"),
  s6: (q: string) => q.includes("DELETE FROM r2_artifacts") && q.includes("op_lease_id"),
  s7: (q: string) => q.includes("SET email=NULL, pdf_r2_key=NULL") && q.includes("op_lease_id"),
  s9: (q: string) => q.includes("SET status='done'"),
  s10: (q: string) => q.includes("SET op_owner=NULL"),
  s11: (q: string) => q.includes("DELETE FROM r2_artifacts") && !q.includes("op_lease_id"),
  s12a: (q: string) => q.includes("SET phase='cancelled'") && !q.includes("op_lease_id"),
  s12b: (q: string) => q.includes("SET email=NULL, pdf_r2_key=NULL") && !q.includes("op_lease_id"),
  hd: (q: string) => q.trimStart().startsWith("DELETE FROM scans"),
  watchdog: (q: string) => q.includes("capture_jobs") && q.includes("enqueued_at IS NULL"),
};
const DESTRUCTIVE = [M.s4, M.s6, M.s7, M.s11, M.s12a, M.s12b, M.hd] as const;

type World = {
  sqlite: DatabaseSync;
  d1: ReturnType<typeof makeD1>;
  r2: ReturnType<typeof makeR2>;
  env: Env;
  clockRef: { v: number };
  run: (over?: Record<string, unknown>) => Promise<Awaited<ReturnType<typeof runRetentionSweep>>>;
};
function world(
  opts: {
    mode?: string;
    r2?: ReturnType<typeof makeR2>;
    hooks?: Hooks;
    noR2Binding?: boolean;
    queue?: { send: (m: unknown) => Promise<void> };
  } = {}
): World {
  const sqlite = freshSqlite();
  const r2 = opts.r2 ?? makeR2();
  const d1 = makeD1(sqlite, opts.hooks ?? {});
  const clockRef = { v: NOW };
  const env = {
    DB: d1 as unknown as Env["DB"],
    RETENTION_SWEEP_MODE: opts.mode ?? "enforce",
    ...(opts.noR2Binding ? {} : { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY }),
    ...(opts.queue ? { CAPTURE_QUEUE: opts.queue } : {}),
  } as unknown as Env;
  const run = (over: Record<string, unknown> = {}) =>
    runRetentionSweep(env, {
      now: NOW,
      deadlineMs: clockRef.v + HANDLER_WALL_BUDGET_MS,
      clock: () => clockRef.v,
      jitter: (min: number) => min,
      ...over,
    });
  return { sqlite, d1, r2, env, clockRef, run };
}
// hook helper: fire action the occurrence-th time marker matches (1-based)
function onStmt(marker: (q: string) => boolean, occurrence: number, action: () => void): Hooks {
  let seen = 0;
  return {
    before: (sql) => {
      if (marker(sql)) {
        seen++;
        if (seen === occurrence) action();
      }
    },
  };
}
function seedHappy(sqlite: DatabaseSync, id: string, jid: string) {
  seedScan(sqlite, { id, email: "user@example.com", pdf_r2_key: `score-reports/${id}/abcd/1.pdf` });
  insertRJob(sqlite, { scan_id: id, job_id: jid });
  insertArtifact(sqlite, { r2_key: `score-reports/${id}/abcd/1.pdf`, scan_id: id, status: "active" });
  insertCapture(sqlite, {
    job_id: `cap-${id}`,
    scan_id: id,
    phase: "uploaded",
    email: "user@example.com",
    pdf_r2_key: `score-reports/${id}/abcd/1.pdf`,
    delivery_snapshot: '{"t":1}',
  });
}
const stealJob = (s: DatabaseSync, id: string) =>
  s.prepare("UPDATE retention_jobs SET claim_id='thief', lease_expires_at=? WHERE scan_id=?").run(FAR, id);
const stealScan = (s: DatabaseSync, id: string) =>
  s.prepare("UPDATE scans SET op_lease_id='thief', op_fence=op_fence+1, op_lease_expires_at=? WHERE id=?").run(FAR, id);
const releaseClaim = (s: DatabaseSync, id: string) =>
  s.prepare("UPDATE retention_jobs SET claim_id=NULL, lease_expires_at=NULL, status='pending', next_attempt_at=0 WHERE scan_id=?").run(id);

afterEach(() => {
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
describe("F2 t1–t3 — mode gate + enforce quarantine gate", () => {
  it("t1: unknown/absent/case-variant → off; off returns before the config guard (zero reads beyond env)", async () => {
    for (const v of [undefined, "", "OFF", "Enforce", "DRY_RUN", " dry_run", "enforce ", "on", 0, null]) {
      expect(parseRetentionMode(v)).toBe("off");
    }
    expect(parseRetentionMode("dry_run")).toBe("dry_run");
    expect(parseRetentionMode("enforce")).toBe("enforce");
    // off: no DB, no R2 binding, no throw — returns before validation/config guard
    const noDbEnv = { RETENTION_SWEEP_MODE: "nope" } as unknown as Env;
    const r = await runRetentionSweep(noDbEnv, { now: NOW });
    expect(r.mode).toBe("off");
    // off with a DB attached: zero statements, zero writes, R2 untouched
    const w = world({ mode: "off" });
    seedHappy(w.sqlite, uuid(), uuid());
    await w.run();
    expect(w.d1.counters.stmts).toBe(0);
    expect(w.d1.counters.writes).toBe(0);
    expect(w.r2.state.purges).toHaveLength(0);
  });

  it("t2: dry_run — zero mutations, correct counts, gate reported, NO R2 binding required", async () => {
    const w = world({ mode: "dry_run", noR2Binding: true });
    const a = uuid(),
      b = uuid(),
      c = uuid(),
      d = uuid();
    seedScan(w.sqlite, { id: a }); // eligible, no job → would-enqueue
    seedScan(w.sqlite, { id: b }); // eligible, no job → would-enqueue
    seedScan(w.sqlite, { id: c }); // eligible, pending job → claimable
    insertRJob(w.sqlite, { scan_id: c, job_id: uuid(), status: "pending" });
    seedScan(w.sqlite, { id: d }); // eligible, cancelled job → revive candidate
    insertRJob(w.sqlite, { scan_id: d, job_id: uuid(), status: "cancelled" });
    seedScan(w.sqlite, { id: uuid(), tier: "paid" }); // ineligible
    seedScan(w.sqlite, { id: uuid(), tier: null }); // NULL-tier, old, opted 0 → gate=1
    const r = await w.run();
    expect(r.mode).toBe("dry_run");
    expect(r.gateCount).toBe(1);
    expect(r.dryRun!.cohortEligible).toBe(4);
    expect(r.dryRun!.wouldEnqueue).toBe(2);
    expect(r.dryRun!.reviveCandidates).toBe(1);
    expect(r.dryRun!.claimable).toBe(1);
    expect(r.dryRun!.perStatus).toEqual({ pending: 1, cancelled: 1 });
    expect(r.dryRun!.sample.length).toBe(4);
    expect(w.d1.counters.writes).toBe(0);
    expect(w.r2.state.purges).toHaveLength(0);
  });

  it("t3: enforce gate — NULL-tier row present → tick aborts before any mutation, zero mutations", async () => {
    const w = world();
    seedScan(w.sqlite, { id: uuid() }); // eligible free scan present — must NOT be enqueued
    seedScan(w.sqlite, { id: uuid(), tier: null }); // eligible NULL-tier → gate fails
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    const r = await w.run();
    expect(r.gateFailed).toBe(true);
    expect(r.gateCount).toBe(1);
    expect(w.d1.counters.writes).toBe(0);
    expect((w.sqlite.prepare("SELECT COUNT(*) AS n FROM retention_jobs").get() as { n: number }).n).toBe(0);
    expect(logs.some((l) => l.includes("class=retention_gate_failed count=1"))).toBe(true);
  });
});

describe("F2 t4–t8 — happy path, boundary, eligibility", () => {
  it("t4: happy path — enqueue→claim→tombstone(+fence)→authorization→cancel→purge→r2_purged→scrub→hard-delete→done(+done_at)→release", async () => {
    const w = world();
    const id = uuid();
    seedScan(w.sqlite, { id, email: "user@example.com" });
    insertArtifact(w.sqlite, { r2_key: `score-reports/${id}/abcd/1.pdf`, scan_id: id, status: "active" });
    insertCapture(w.sqlite, {
      job_id: `cap-${id}`,
      scan_id: id,
      phase: "uploaded",
      email: "user@example.com",
      pdf_r2_key: `score-reports/${id}/abcd/1.pdf`,
      delivery_snapshot: "{}",
    });
    const r = await w.run();
    expect(r.enqueued).toBe(1);
    expect(r.processed).toBe(1);
    expect(r.done).toBe(1);
    expect(w.r2.state.purges).toEqual([`score-reports/${id}/`]);
    expect(scanRow(w.sqlite, id)).toBeUndefined(); // hard-deleted
    const j = jobRow(w.sqlite, id)!;
    expect(j.status).toBe("done");
    expect(j.done_at).not.toBeNull();
    expect(artCount(w.sqlite, id)).toBe(0); // registry DELETEd, not marked
    const cap = capRow(w.sqlite, `cap-${id}`)!;
    expect(cap.phase).toBe("cancelled");
    expect(cap.email).toBeNull();
    expect(cap.pdf_r2_key).toBeNull();
    expect(cap.delivery_snapshot).toBeNull();
  });

  it("t5: exact 90-day boundary in ms — threshold−1 eligible; threshold and threshold+1 not", async () => {
    const w = world();
    const el = uuid(),
      at = uuid(),
      plus = uuid();
    seedScan(w.sqlite, { id: el, created_at: THRESH - 1 });
    seedScan(w.sqlite, { id: at, created_at: THRESH });
    seedScan(w.sqlite, { id: plus, created_at: THRESH + 1 });
    const r = await w.run();
    expect(r.enqueued).toBe(1);
    expect(scanRow(w.sqlite, el)).toBeUndefined();
    expect(scanRow(w.sqlite, at)).toBeDefined();
    expect(scanRow(w.sqlite, plus)).toBeDefined();
    expect(jobRow(w.sqlite, at)).toBeUndefined();
    expect(jobRow(w.sqlite, plus)).toBeUndefined();
  });

  it("t6: ineligible rows never touched — paid, opted-in, young, NULL-tier (quarantine)", async () => {
    // (a) with a NULL-tier eligible row the gate aborts and NOTHING is touched
    const w1 = world();
    seedScan(w1.sqlite, { id: uuid(), tier: null });
    seedScan(w1.sqlite, { id: uuid() });
    await w1.run();
    expect(w1.d1.counters.writes).toBe(0);
    // (b) paid / opted-in / young never enqueued nor touched while an eligible row is swept
    const w = world();
    const paid = uuid(),
      opted = uuid(),
      young = uuid(),
      el = uuid();
    seedScan(w.sqlite, { id: paid, tier: "paid", email: "p@x.com" });
    seedScan(w.sqlite, { id: opted, opted: 1, email: "o@x.com" });
    seedScan(w.sqlite, { id: young, created_at: NOW - 1000, email: "y@x.com" });
    seedScan(w.sqlite, { id: el });
    const r = await w.run();
    expect(r.enqueued).toBe(1);
    for (const id of [paid, opted, young]) {
      expect(jobRow(w.sqlite, id)).toBeUndefined();
      const row = scanRow(w.sqlite, id)!;
      expect(row.retention_locked_at).toBeNull();
      expect(row.email).not.toBeNull();
    }
    expect(scanRow(w.sqlite, el)).toBeUndefined();
  });

  it("t7: enqueue idempotent (conflict no-op); a conflict-discarded job_id never appears anywhere else", async () => {
    // direct frozen-statement conflict proof
    const sqlite = freshSqlite();
    const id = uuid();
    const existing = uuid();
    seedScan(sqlite, { id });
    insertRJob(sqlite, { scan_id: id, job_id: existing });
    const p = prepRetentionSql(RETENTION_SQL.enqueue);
    const discarded = uuid();
    const vals: Record<string, unknown> = { newJobId: discarded, now: NOW, id, threshold: THRESH };
    const info = sqlite.prepare(p.text).run(...(p.order.map((n) => vals[n]) as never[]));
    expect(Number(info.changes)).toBe(0); // ON CONFLICT DO NOTHING
    const all = sqlite.prepare("SELECT job_id FROM retention_jobs").all() as { job_id: string }[];
    expect(all).toEqual([{ job_id: existing }]); // discarded id appears nowhere
    // orchestration level: an existing job self-excludes from the enqueue scan
    const w = world();
    const id2 = uuid();
    seedScan(w.sqlite, { id: id2, op_lease_id: "foreign", op_lease_expires_at: FAR });
    insertRJob(w.sqlite, { scan_id: id2, job_id: existing });
    const r = await w.run();
    expect(r.enqueued).toBe(0);
    expect(jobRow(w.sqlite, id2)!.job_id).toBe(existing);
  });

  it("t8: eligibility change post-enqueue → cancelled (cancelled_at stamped); re-eligibility → frozen revive; cancelled_at untouched", async () => {
    const w = world();
    const id = uuid();
    const jid = uuid();
    seedScan(w.sqlite, { id });
    insertRJob(w.sqlite, { scan_id: id, job_id: jid });
    w.sqlite.prepare("UPDATE scans SET email_opted_in_rescan=1 WHERE id=?").run(id); // pre-tombstone drift
    await w.run();
    let j = jobRow(w.sqlite, id)!;
    expect(j.status).toBe("cancelled");
    const stampedAt = j.cancelled_at;
    expect(stampedAt).not.toBeNull();
    expect(scanRow(w.sqlite, id)!.retention_locked_at).toBeNull(); // never tombstoned
    // re-eligibility → revive (attempts reset, claim nulled, stable job_id, cancelled_at untouched)
    w.sqlite.prepare("UPDATE scans SET email_opted_in_rescan=0 WHERE id=?").run(id);
    w.clockRef.v = NOW + 200_000;
    const r2 = await w.run({ now: NOW + 200_000 });
    expect(r2.revived).toBe(1);
    j = jobRow(w.sqlite, id)!;
    expect(j.status).toBe("done"); // revived then completed in the same tick
    expect(j.job_id).toBe(jid);
    expect(j.cancelled_at).toBe(stampedAt); // frozen revive does not clear it (D17 note)
    expect(scanRow(w.sqlite, id)).toBeUndefined();
  });
});

describe("F2 t9–t12 — contention, idempotence, reclaim, crash injection", () => {
  it("t9: tombstone 0-row + live foreign op-lease → contention, NO attempt++, jittered next_attempt_at", async () => {
    const w = world();
    const id = uuid();
    seedScan(w.sqlite, { id, op_lease_id: "foreign", op_lease_expires_at: FAR });
    insertRJob(w.sqlite, { scan_id: id, job_id: uuid() });
    const r = await w.run();
    expect(r.contended).toBe(1);
    const j = jobRow(w.sqlite, id)!;
    expect(j.status).toBe("pending");
    expect(j.attempts).toBe(0); // no attempt++
    expect(j.next_attempt_at as number).toBeGreaterThanOrEqual(NOW + 60_000);
    expect(j.next_attempt_at as number).toBeLessThanOrEqual(NOW + 120_000);
  });

  it("t10: tombstone idempotence on reclaim — COALESCE preserves retention_locked_at/retention_job_id; op_fence increments", async () => {
    const id = uuid();
    const jid = uuid();
    const sqlite = freshSqlite();
    seedHappy(sqlite, id, jid);
    const crashRun = async (at: number) => {
      let dead = false;
      const trigger = onStmt(M.s1, 1, () => {
        dead = true;
        throw new Error("crash");
      });
      const d1 = makeD1(sqlite, {
        before: (q, a) => {
          if (dead) throw new Error("db_crashed");
          trigger.before!(q, a);
        },
      });
      const env = { DB: d1 as unknown as Env["DB"], RETENTION_SWEEP_MODE: "enforce", MARKETING_R2: makeR2().fetcher, RECONCILE_R2_KEY: KEY } as unknown as Env;
      await expect(
        runRetentionSweep(env, { now: at, deadlineMs: at + HANDLER_WALL_BUDGET_MS, clock: () => at, jitter: (m) => m })
      ).rejects.toThrow();
    };
    await crashRun(NOW);
    const after1 = scanRow(sqlite, id)!;
    const locked1 = after1.retention_locked_at as number;
    const fence1 = after1.op_fence as number;
    expect(locked1).not.toBeNull();
    expect(after1.retention_job_id).toBe(jid);
    await crashRun(NOW + 400_000); // reclaim past lease expiry, crash after the re-tombstone
    const after2 = scanRow(sqlite, id)!;
    expect(after2.retention_locked_at).toBe(locked1); // COALESCE preserved
    expect(after2.retention_job_id).toBe(jid);
    expect(after2.op_fence as number).toBeGreaterThan(fence1); // fence increments
  });

  it("t11: reclaim from expired claimed AND from r2_purged → full re-run; r2_purged reclaim RE-PURGES before delete", async () => {
    for (const status of ["claimed", "r2_purged"] as const) {
      const w = world();
      const id = uuid();
      const jid = uuid();
      seedScan(w.sqlite, {
        id,
        op_lease_id: "dead",
        op_lease_expires_at: NOW - 1000,
        retention_locked_at: OLD,
        retention_job_id: jid,
        email: "u@x.com",
      });
      insertRJob(w.sqlite, { scan_id: id, job_id: jid, status, claim_id: "dead", lease_expires_at: NOW - 1000 });
      insertArtifact(w.sqlite, { r2_key: `score-reports/${id}/abcd/1.pdf`, scan_id: id });
      const r = await w.run();
      expect(r.done, status).toBe(1);
      expect(w.r2.state.purges, status).toEqual([`score-reports/${id}/`]); // ALWAYS re-purges
      expect(scanRow(w.sqlite, id), status).toBeUndefined();
      expect(jobRow(w.sqlite, id)!.status, status).toBe("done");
    }
  });

  it("t12: crash injection after each side effect → reclaim completes; end state identical", async () => {
    const points: Array<[string, (q: string) => boolean, number]> = [
      ["after-tombstone", M.s1, 1],
      ["after-cancel", M.s3, 1],
      ["after-purge", M.s5, 1],
      ["after-r2_purged", M.s1, 2],
      ["after-scrub", M.s1, 3],
      ["after-delete", M.s9, 1],
    ];
    for (const [label, marker, occ] of points) {
      const sqlite = freshSqlite();
      const id = uuid();
      const jid = uuid();
      seedHappy(sqlite, id, jid);
      let dead = false;
      const trigger = onStmt(marker, occ, () => {
        dead = true;
        throw new Error("crash");
      });
      const d1 = makeD1(sqlite, {
        before: (q, a) => {
          if (dead) throw new Error("db_crashed");
          trigger.before!(q, a);
        },
      });
      const r2 = makeR2();
      const env = { DB: d1 as unknown as Env["DB"], RETENTION_SWEEP_MODE: "enforce", MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY } as unknown as Env;
      await expect(
        runRetentionSweep(env, { now: NOW, deadlineMs: NOW + HANDLER_WALL_BUDGET_MS, clock: () => NOW, jitter: (m) => m })
      ).rejects.toThrow();
      // reclaim run past lease expiry with a healthy handle
      const T2 = NOW + 400_000;
      const d1b = makeD1(sqlite);
      const envb = { DB: d1b as unknown as Env["DB"], RETENTION_SWEEP_MODE: "enforce", MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY } as unknown as Env;
      const r = await runRetentionSweep(envb, { now: T2, deadlineMs: T2 + HANDLER_WALL_BUDGET_MS, clock: () => T2, jitter: (m) => m });
      expect(r.done, label).toBe(1);
      expect(scanRow(sqlite, id), label).toBeUndefined();
      const j = jobRow(sqlite, id)!;
      expect(j.status, label).toBe("done");
      expect(artCount(sqlite, id), label).toBe(0);
      const cap = capRow(sqlite, `cap-${id}`)!;
      expect(cap.email, label).toBeNull();
      expect(cap.pdf_r2_key, label).toBeNull();
      expect(cap.delivery_snapshot, label).toBeNull();
      expect(cap.phase, label).toBe("cancelled");
    }
  });
});

describe("F2 t13–t16 — failure classes, dead-letter, replay", () => {
  it("t13: RPC failure classes → failure SQL, attempts++, backoff (range); attempt :N → dead_letter + dead_lettered_at", async () => {
    const classMap: Array<[R2Mode, string]> = [
      ["transport", "r2_transport"],
      ["rpc_failed", "r2_rpc_failed"],
      ["malformed", "r2_malformed"],
      ["unconfirmed", "r2_purge_unconfirmed"],
    ];
    for (const [mode, cls] of classMap) {
      const w = world({ r2: makeR2({ modes: [mode] }) });
      const id = uuid();
      seedHappy(w.sqlite, id, uuid());
      const r = await w.run();
      expect(r.failed, cls).toBe(1);
      const j = jobRow(w.sqlite, id)!;
      expect(j.status, cls).toBe("pending");
      expect(j.attempts, cls).toBe(1);
      expect(j.last_error_class, cls).toBe(cls);
      // backoff base 5 min × 2^0 = 300k, ±20% → [240k, 360k]
      expect(j.next_attempt_at as number, cls).toBeGreaterThanOrEqual(NOW + 240_000);
      expect(j.next_attempt_at as number, cls).toBeLessThanOrEqual(NOW + 360_000);
    }
    // drive one job to :N = 5 → dead_letter
    const w = world({ r2: makeR2({ modes: ["transport", "transport", "transport", "transport", "transport"] }) });
    const id = uuid();
    seedHappy(w.sqlite, id, uuid());
    let t = NOW;
    for (let i = 0; i < 5; i++) {
      w.clockRef.v = t;
      await w.run({ now: t });
      t += 8 * 3_600_000; // past any backoff (max 6 h + 20 %)
    }
    const j = jobRow(w.sqlite, id)!;
    expect(j.status).toBe("dead_letter");
    expect(j.attempts).toBe(5);
    expect(j.dead_lettered_at).not.toBeNull();
  });

  it("t14: r2_purged never set on unconfirmed purge (client throw propagates before D1 advances)", async () => {
    const w = world({ r2: makeR2({ modes: ["unconfirmed"] }) });
    const id = uuid();
    seedHappy(w.sqlite, id, uuid());
    await w.run();
    const j = jobRow(w.sqlite, id)!;
    expect(j.status).not.toBe("r2_purged");
    expect(artCount(w.sqlite, id)).toBe(1); // no scrub happened either
    expect(scanRow(w.sqlite, id)).toBeDefined();
  });

  it("t15: dead-letter excluded from the claim query; counted; alert deduped via the D16 CAS", async () => {
    const w = world();
    const dl = uuid();
    seedScan(w.sqlite, { id: dl, retention_locked_at: OLD, retention_job_id: "J" });
    insertRJob(w.sqlite, { scan_id: dl, job_id: "J", status: "dead_letter", next_attempt_at: 0, attempts: 5 });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    await w.run();
    const j = jobRow(w.sqlite, dl)!;
    expect(j.status).toBe("dead_letter"); // never claimed/processed
    expect(j.claim_id).toBeNull();
    expect(j.alert_state).toBe("alerted"); // observing pass CAS
    expect(logs.filter((l) => l.startsWith("class=retention_dead_letter"))).toHaveLength(1);
    // second pass is a no-op
    logs.length = 0;
    await w.run();
    expect(logs.filter((l) => l.startsWith("class=retention_dead_letter"))).toHaveLength(0);
  });

  it("t16: replayDeadLetter — conditional-audit atomic batch (D15)", async () => {
    const w = world();
    const id = uuid();
    insertRJob(w.sqlite, { scan_id: id, job_id: "J1", status: "dead_letter", attempts: 5, alert_state: "alerted" });
    // success: 1 audit + 1 replay, alert_state cleared by the frozen SQL
    const ok = await replayDeadLetter(w.env.DB, id, "bruno", "ops remediation", NOW);
    expect(ok).toEqual({ replayed: true });
    const audits = auditRows(w.sqlite, id);
    expect(audits).toHaveLength(1);
    expect(audits[0].job_id).toBe("J1");
    expect(audits[0].actor).toBe("bruno");
    expect(audits[0].replayed_at).toBe(NOW);
    const j = jobRow(w.sqlite, id)!;
    expect(j.status).toBe("pending");
    expect(j.attempts).toBe(0);
    expect(j.alert_state).toBeNull();
    // non-dead-letter → 0/0, no audit row
    const r2 = await replayDeadLetter(w.env.DB, id, "bruno", "again", NOW);
    expect(r2).toEqual({ replayed: false });
    expect(auditRows(w.sqlite, id)).toHaveLength(1);
    // missing row → 0/0
    const r3 = await replayDeadLetter(w.env.DB, "no-such-scan", "bruno", "x", NOW);
    expect(r3).toEqual({ replayed: false });
    // validation rejects BEFORE any statement
    const d1v = makeD1(w.sqlite);
    for (const [a, rr] of [
      ["", "reason"],
      ["a".repeat(65), "r"],
      ["ok", ""],
      ["ok", "r".repeat(257)],
      ["badactor", "r"],
    ] as const) {
      await expect(replayDeadLetter(d1v as unknown as Env["DB"], id, a, rr, NOW)).rejects.toThrow("retention_replay_invalid");
    }
    expect(d1v.counters.stmts).toBe(0);
    // injected audit-INSERT failure → batch rolls back; row stays dead_letter; zero audit rows
    const id2 = uuid();
    insertRJob(w.sqlite, { scan_id: id2, job_id: "J2", status: "dead_letter" });
    const failing = makeD1(w.sqlite, {
      before: (q) => {
        if (q.includes("INSERT INTO retention_replay_audit")) throw new Error("boom");
      },
    });
    await expect(replayDeadLetter(failing as unknown as Env["DB"], id2, "bruno", "x", NOW)).rejects.toThrow("boom");
    expect(jobRow(w.sqlite, id2)!.status).toBe("dead_letter");
    expect(auditRows(w.sqlite, id2)).toHaveLength(0);
    // integrity assert: status flipped between the two batch statements → mismatch → throws
    const id3 = uuid();
    insertRJob(w.sqlite, { scan_id: id3, job_id: "J3", status: "dead_letter" });
    const racing = makeD1(w.sqlite, {
      before: (q) => {
        if (q.includes("SET status='pending'") && q.includes("alert_state=NULL")) {
          w.sqlite.prepare("UPDATE retention_jobs SET status='pending' WHERE scan_id=?").run(id3);
        }
      },
    });
    await expect(replayDeadLetter(racing as unknown as Env["DB"], id3, "bruno", "x", NOW)).rejects.toThrow("retention_replay_integrity");
  });
});

describe("F2 t17–t24 — missing scan, capture semantics, budgets, hygiene", () => {
  it("t17: missing scan → full D6; capture-job identifiers scrubbed; no op-lease ever taken", async () => {
    const w = world();
    const id = uuid();
    insertRJob(w.sqlite, { scan_id: id, job_id: "J" });
    insertArtifact(w.sqlite, { r2_key: `score-reports/${id}/abcd/1.pdf`, scan_id: id, status: "active" });
    insertArtifact(w.sqlite, { r2_key: `score-reports/${id}/abcd/2.pdf`, scan_id: id, status: "purged" });
    insertCapture(w.sqlite, { job_id: "c-live", scan_id: id, phase: "uploaded", email: "u@x.com", pdf_r2_key: "k", delivery_snapshot: "{}" });
    insertCapture(w.sqlite, { job_id: "c-done", scan_id: id, phase: "done", email: "u@x.com", pdf_r2_key: "k2", delivery_snapshot: "{}" });
    const r = await w.run();
    expect(r.done).toBe(1);
    expect(w.r2.state.purges).toEqual([`score-reports/${id}/`]);
    expect(artCount(w.sqlite, id)).toBe(0);
    const live = capRow(w.sqlite, "c-live")!;
    expect(live.phase).toBe("cancelled");
    expect(live.email).toBeNull();
    expect(live.pdf_r2_key).toBeNull();
    expect(live.delivery_snapshot).toBeNull();
    const done = capRow(w.sqlite, "c-done")!;
    expect(done.phase).toBe("done"); // terminal phase preserved
    expect(done.email).toBeNull(); // identifiers must not survive a missing-scan purge
    expect(done.pdf_r2_key).toBeNull();
    const j = jobRow(w.sqlite, id)!;
    expect(j.status).toBe("done");
    expect(j.done_at).not.toBeNull();
    // no op-lease ever taken: the tombstone attempt 0-rowed (scan missing) and
    // no UPDATE scans statement ever took effect
    expect(w.d1.executed.filter((e) => e.sql.includes("UPDATE scans") && e.changes > 0)).toHaveLength(0);
  });

  it("t18: capture cancel — only non-terminal phases transition; anchor rule; pdf_r2_key survives until scrub", async () => {
    const T_ANCHOR = OLD + 5;
    // idx_one_active_capture allows at most ONE non-terminal job per scan, so
    // each non-terminal phase gets its own world: one in-flight job + terminal rows.
    for (const phase of ["pending", "rendering", "uploaded", "email_sending"] as const) {
      const holder: { sqlite?: DatabaseSync; checked?: boolean } = {};
      const hooks = onStmt(M.s6, 1, () => {
        // between cancel and scrub: email already null, pdf_r2_key still present
        const row = capRow(holder.sqlite!, "c-live")!;
        expect(row.email, phase).toBeNull();
        expect(row.pdf_r2_key, phase).toBe("k-live");
        holder.checked = true;
      });
      const w = world({ hooks });
      holder.sqlite = w.sqlite;
      const id = uuid();
      seedScan(w.sqlite, { id });
      insertRJob(w.sqlite, { scan_id: id, job_id: uuid() });
      insertCapture(w.sqlite, { job_id: "c-live", scan_id: id, phase, email: "u@x.com", pdf_r2_key: "k-live", delivery_snapshot: "{}", updated_at: T_ANCHOR });
      insertCapture(w.sqlite, { job_id: "c-done", scan_id: id, phase: "done", email: "d@x.com", pdf_r2_key: "k-done", delivery_snapshot: "{}", updated_at: T_ANCHOR });
      insertCapture(w.sqlite, { job_id: "c-canc", scan_id: id, phase: "cancelled", email: "c@x.com", pdf_r2_key: "k-canc", delivery_snapshot: "{}", updated_at: T_ANCHOR });
      await w.run();
      expect(holder.checked, phase).toBe(true);
      const live = capRow(w.sqlite, "c-live")!;
      expect(live.phase, phase).toBe("cancelled"); // non-terminal → transition
      expect(live.updated_at as number, phase).toBeGreaterThan(T_ANCHOR); // transition stamps (email_sending anchor rule: only a genuine transition may stamp)
      expect(live.email, phase).toBeNull();
      expect(live.pdf_r2_key, phase).toBeNull(); // nulled by the scrub, not the cancel
      for (const jid of ["c-done", "c-canc"]) {
        const row = capRow(w.sqlite, jid)!;
        expect(row.phase, `${phase}/${jid}`).toBe(jid === "c-done" ? "done" : "cancelled"); // terminal untouched
        expect(row.updated_at, `${phase}/${jid}`).toBe(T_ANCHOR); // preservation never stamps
      }
    }
  });

  it("t19: lease loss between purge and r2_purged mark → retention_lease_lost → contention, no attempt++", async () => {
    const holder: { sqlite?: DatabaseSync; id?: string } = {};
    const hooks = onStmt(M.s5, 1, () => stealJob(holder.sqlite!, holder.id!));
    const w = world({ hooks });
    holder.sqlite = w.sqlite;
    const id = uuid();
    holder.id = id;
    seedHappy(w.sqlite, id, uuid());
    const r = await w.run();
    expect(r.contended).toBe(1);
    const j = jobRow(w.sqlite, id)!;
    expect(j.attempts).toBe(0); // contention, not failure
    expect(j.status).not.toBe("done");
    expect(scanRow(w.sqlite, id)).toBeDefined(); // no destructive progress after the loss
  });

  it("t20: safe-window recompute — low headroom → fresh S1+S2; renewal 0-row → fail closed BEFORE the RPC; timeout obeys D8", async () => {
    // (a) low lease headroom → dual renewal re-runs, purge proceeds; the R2-budget term is NOT margin-cut (per-term margins)
    const timeouts: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(((ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    }) as typeof AbortSignal.timeout);
    {
      const holder: { sqlite?: DatabaseSync } = {};
      const hooks = onStmt(M.s3, 1, () => {
        holder.sqlite!.prepare("UPDATE retention_jobs SET lease_expires_at=? WHERE claim_id IS NOT NULL").run(NOW + 20_000);
        holder.sqlite!.prepare("UPDATE scans SET op_lease_expires_at=? WHERE op_lease_id IS NOT NULL").run(NOW + 20_000);
      });
      const w = world({ hooks });
      holder.sqlite = w.sqlite;
      const id = uuid();
      seedHappy(w.sqlite, id, uuid());
      const r = await w.run();
      expect(r.done).toBe(1);
      const s1Count = w.d1.executed.filter((e) => M.s1(e.sql)).length;
      expect(s1Count).toBeGreaterThanOrEqual(4); // step-3 + low-headroom renewal + steps 8/10
      expect(timeouts[0]).toBe(20_000); // R2_PURGE_BUDGET_MS as the binding term, un-cut
    }
    // (b) renewal 0-row on the scan plane during the low-headroom recompute → contention BEFORE the RPC
    {
      const holder: { sqlite?: DatabaseSync; id?: string } = {};
      const hooks = onStmt(M.s3, 1, () => {
        holder.sqlite!.prepare("UPDATE retention_jobs SET lease_expires_at=? WHERE scan_id=?").run(NOW + 20_000, holder.id);
        stealScan(holder.sqlite!, holder.id!);
      });
      const w = world({ hooks });
      holder.sqlite = w.sqlite;
      const id = uuid();
      holder.id = id;
      seedHappy(w.sqlite, id, uuid());
      const r = await w.run();
      expect(r.contended).toBe(1);
      expect(w.r2.state.purges).toHaveLength(0); // fail closed BEFORE the RPC
    }
  });

  it("t21: RPC-budget exhaustion mid-worklist → clean stop; leftovers claimable next tick", async () => {
    const w = world();
    const a = uuid(),
      b = uuid();
    seedHappy(w.sqlite, a, uuid());
    seedHappy(w.sqlite, b, uuid());
    const r = await w.run({ purgeBudget: 1 });
    expect(r.processed).toBe(1);
    const statuses = (w.sqlite.prepare("SELECT status FROM retention_jobs ORDER BY status").all() as { status: string }[]).map((x) => x.status);
    expect(statuses.sort()).toEqual(["done", "pending"]);
    // leftover claimable next tick
    const r2 = await w.run({ purgeBudget: 1 });
    expect(r2.processed).toBe(1);
    expect((w.sqlite.prepare("SELECT COUNT(*) AS n FROM retention_jobs WHERE status='done'").get() as { n: number }).n).toBe(2);
  });

  it("t22: hard-delete keyed on stable job_id — a different job_id → 0 rows (no cross-job deletion)", () => {
    const sqlite = freshSqlite();
    const id = uuid();
    seedScan(sqlite, { id, op_lease_id: "C", op_lease_expires_at: FAR, op_fence: 5, retention_locked_at: OLD, retention_job_id: "J1" });
    const p = prepRetentionSql(RETENTION_SQL.hardDelete);
    const vals: Record<string, unknown> = { id, job_id: "J2", cid: "C", fence: 5, threshold: THRESH };
    const info = sqlite.prepare(p.text).run(...(p.order.map((n) => vals[n]) as never[]));
    expect(Number(info.changes)).toBe(0);
    expect(scanRow(sqlite, id)).toBeDefined();
  });

  it("t23: cross-contamination — sweeping scan A never touches scan B's rows", async () => {
    const w = world();
    const a = uuid(),
      b = uuid();
    seedHappy(w.sqlite, a, uuid());
    // B: full rows, ineligible (young)
    seedScan(w.sqlite, { id: b, created_at: NOW - 1000, email: "b@x.com", pdf_r2_key: `score-reports/${b}/ffff/1.pdf` });
    insertArtifact(w.sqlite, { r2_key: `score-reports/${b}/ffff/1.pdf`, scan_id: b, status: "active" });
    insertCapture(w.sqlite, { job_id: `cap-${b}`, scan_id: b, phase: "uploaded", email: "b@x.com", pdf_r2_key: `score-reports/${b}/ffff/1.pdf`, delivery_snapshot: '{"b":1}' });
    const snapScan = JSON.stringify(scanRow(w.sqlite, b));
    const snapCap = JSON.stringify(capRow(w.sqlite, `cap-${b}`));
    const r = await w.run();
    expect(r.done).toBe(1);
    expect(scanRow(w.sqlite, a)).toBeUndefined();
    expect(JSON.stringify(scanRow(w.sqlite, b))).toBe(snapScan);
    expect(JSON.stringify(capRow(w.sqlite, `cap-${b}`))).toBe(snapCap);
    expect(artCount(w.sqlite, b)).toBe(1);
    expect(jobRow(w.sqlite, b)).toBeUndefined();
  });

  it("t24: log hygiene — no scan UUID, job UUID, or salt in any emitted line (happy + dead-letter + replay)", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
    // happy path
    const w = world();
    seedHappy(w.sqlite, uuid(), uuid());
    await w.run();
    // dead-letter + alert (observing pass) + replay
    const w2 = world();
    const dl = uuid();
    seedScan(w2.sqlite, { id: dl, retention_locked_at: OLD, retention_job_id: "J" });
    insertRJob(w2.sqlite, { scan_id: dl, job_id: uuid(), status: "dead_letter", attempts: 5 });
    await w2.run();
    await replayDeadLetter(w2.env.DB, dl, "bruno", "why", NOW);
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) expect(line, line).not.toMatch(UUID_RE);
  });
});

describe("F2 t25–t32 — authority-loss matrix, indeterminate purge, budgets", () => {
  it("t25: claim/fence loss before EVERY D1 transition (both planes; incl. missing-scan revalidations) → routed per D3; no destructive effect after loss; no synthetic success", async () => {
    // main-path points. HD gets scan-plane only: the frozen hard-delete carries
    // NO job-plane predicate by design (fence monotonicity — a job-claim loss
    // alone does not block it; t38b proves that branch safe). S9 gets job-plane
    // only: the scan is already hard-deleted at S9 (legitimately), so the
    // "survives" assertion doesn't apply; scan-plane loss there is exercised
    // via the missing-scan recreate variants below.
    const mainPoints: Array<[string, (q: string) => boolean, Array<"job" | "scan">, boolean]> = [
      ["S4", M.s4, ["job", "scan"], true],
      ["S5", M.s5, ["job", "scan"], true],
      ["S6", M.s6, ["job", "scan"], true],
      ["S7", M.s7, ["job", "scan"], true],
      ["HD", M.hd, ["scan"], true],
      ["S9", M.s9, ["job"], false],
    ];
    for (const [label, marker, planes, scanSurvives] of mainPoints) {
      for (const plane of planes) {
        const holder: { sqlite?: DatabaseSync; id?: string; stealIndex: number; d1?: ReturnType<typeof makeD1> } = { stealIndex: -1 };
        const hooks = onStmt(marker, 1, () => {
          if (plane === "job") stealJob(holder.sqlite!, holder.id!);
          else stealScan(holder.sqlite!, holder.id!);
          holder.stealIndex = holder.d1!.executed.length;
        });
        const w = world({ hooks });
        holder.sqlite = w.sqlite;
        holder.d1 = w.d1;
        const id = uuid();
        holder.id = id;
        seedHappy(w.sqlite, id, uuid());
        await w.run();
        const tag = `${label}/${plane}`;
        expect(holder.stealIndex, tag).toBeGreaterThanOrEqual(0);
        // no synthetic success
        expect(jobRow(w.sqlite, id)!.status, tag).not.toBe("done");
        if (scanSurvives) expect(scanRow(w.sqlite, id), tag).toBeDefined();
        // no destructive statement with effect after the loss
        const post = w.d1.executed.slice(holder.stealIndex);
        for (const e of post) {
          if (DESTRUCTIVE.some((m) => m(e.sql))) expect(e.changes, `${tag}: ${e.sql.slice(0, 60)}`).toBe(0);
          if (M.s9(e.sql)) expect(e.changes, tag).toBe(0);
          if (plane === "job" && M.s5(e.sql)) expect(e.changes, tag).toBe(0);
        }
      }
    }
    // missing-scan points: job-claim steal at S11/S12a/S12b/S9; scan-recreate before S11 and before S9
    const msPoints: Array<[string, (q: string) => boolean, "steal" | "recreate"]> = [
      ["S11/steal", M.s11, "steal"],
      ["S12a/steal", M.s12a, "steal"],
      ["S12b/steal", M.s12b, "steal"],
      ["S9/steal", M.s9, "steal"],
      ["S11/recreate", M.s11, "recreate"],
      ["S9/recreate", M.s9, "recreate"],
    ];
    for (const [tag, marker, kind] of msPoints) {
      const holder: { sqlite?: DatabaseSync; id?: string } = {};
      const hooks = onStmt(marker, 1, () => {
        if (kind === "steal") stealJob(holder.sqlite!, holder.id!);
        else seedScan(holder.sqlite!, { id: holder.id!, created_at: NOW - 1000 }); // reappeared scan
      });
      const w = world({ hooks });
      holder.sqlite = w.sqlite;
      const id = uuid();
      holder.id = id;
      insertRJob(w.sqlite, { scan_id: id, job_id: "J" });
      insertArtifact(w.sqlite, { r2_key: `score-reports/${id}/abcd/1.pdf`, scan_id: id });
      insertCapture(w.sqlite, { job_id: `cap-${id}`, scan_id: id, phase: "uploaded", email: "u@x.com" });
      await w.run();
      expect(jobRow(w.sqlite, id)!.status, tag).not.toBe("done"); // done unreachable
    }
  });

  it("t26: indeterminate purge (timeout after R2 delete, before response) → failure → reclaim → MANDATORY re-purge before scrub/delete", async () => {
    // fast wall-clock: the client's AbortSignal fires after 10 ms real time
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((() => realTimeout(10)) as typeof AbortSignal.timeout);
    const w = world({ r2: makeR2({ modes: ["abort", "ok"] }) });
    const id = uuid();
    seedHappy(w.sqlite, id, uuid());
    const r1 = await w.run();
    expect(r1.failed).toBe(1);
    expect(jobRow(w.sqlite, id)!.last_error_class).toBe("r2_transport"); // abort ⇒ fail closed
    expect(artCount(w.sqlite, id)).toBe(1); // nothing scrubbed on the indeterminate attempt
    expect(scanRow(w.sqlite, id)).toBeDefined();
    // reclaim: re-purge happens (2nd RPC) before any scrub/delete
    const T2 = NOW + 400_000;
    w.clockRef.v = T2;
    const r2 = await w.run({ now: T2 });
    expect(r2.done).toBe(1);
    expect(w.r2.state.purges).toHaveLength(2);
    expect(scanRow(w.sqlite, id)).toBeUndefined();
  });

  it("t27: hard-delete zero through orchestration — (a) fence stolen → contention; (b) cohort drift → invariant :N=1 + one alert; (c) retention_job_id mismatch → invariant; never cancelled/done", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    const cases: Array<[string, (s: DatabaseSync, id: string) => void, "contention" | "invariant"]> = [
      ["fence-stolen", (s, id) => void stealScan(s, id), "contention"],
      ["cohort-drift", (s, id) => void s.prepare("UPDATE scans SET email_opted_in_rescan=1 WHERE id=?").run(id), "invariant"],
      ["jobid-desync", (s, id) => void s.prepare("UPDATE scans SET retention_job_id='other' WHERE id=?").run(id), "invariant"],
    ];
    for (const [tag, mutate, expected] of cases) {
      logs.length = 0;
      const holder: { sqlite?: DatabaseSync; id?: string } = {};
      const hooks = onStmt(M.hd, 1, () => mutate(holder.sqlite!, holder.id!));
      const w = world({ hooks });
      holder.sqlite = w.sqlite;
      const id = uuid();
      holder.id = id;
      seedHappy(w.sqlite, id, uuid());
      await w.run();
      const j = jobRow(w.sqlite, id)!;
      expect(j.status, tag).not.toBe("done");
      expect(j.status, tag).not.toBe("cancelled");
      if (expected === "invariant") {
        expect(j.status, tag).toBe("dead_letter"); // :N=1 → immediate
        expect(j.last_error_class, tag).toBe("retention_invariant_violation");
        expect(logs.filter((l) => l.startsWith("class=retention_dead_letter")), tag).toHaveLength(1);
      } else {
        expect(j.attempts, tag).toBe(0);
      }
    }
  });

  it("t28: poison job dead-letters after :N; a later healthy job processes; alert exactly-once; repeated alert pass no-op", async () => {
    const w = world({ r2: makeR2({ modes: ["transport", "transport", "transport", "transport", "transport", "ok"] }) });
    const poison = uuid();
    seedHappy(w.sqlite, poison, uuid());
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    let t = NOW;
    for (let i = 0; i < 5; i++) {
      w.clockRef.v = t;
      await w.run({ now: t });
      t += 8 * 3_600_000;
    }
    expect(jobRow(w.sqlite, poison)!.status).toBe("dead_letter");
    expect(logs.filter((l) => l.startsWith("class=retention_dead_letter"))).toHaveLength(1);
    // healthy successor processes while the poison row stays dead-lettered
    const healthy = uuid();
    seedScan(w.sqlite, { id: healthy, created_at: OLD - 5 });
    w.clockRef.v = t;
    const r = await w.run({ now: t });
    expect(r.done).toBe(1);
    expect(jobRow(w.sqlite, healthy)!.status).toBe("done");
    expect(jobRow(w.sqlite, poison)!.status).toBe("dead_letter");
    // repeated alert pass is a no-op
    expect(logs.filter((l) => l.startsWith("class=retention_dead_letter"))).toHaveLength(1);
  });

  it("t29: fence RETURNING proof (A1) — production tombstone returns exactly one fence; THAT value binds the real hard-delete", () => {
    const sqlite = freshSqlite();
    const id = uuid();
    seedScan(sqlite, { id });
    const tomb = prepRetentionSql(RETENTION_SQL.tombstone);
    const tv: Record<string, unknown> = { cid: "C", now: NOW, RET_LEASE_MS: 300000, job_id: "J", id, threshold: THRESH };
    const rows = sqlite.prepare(tomb.text).all(...(tomb.order.map((n) => tv[n]) as never[])) as { op_fence: number }[];
    expect(rows).toHaveLength(1); // exactly one returned fence
    const fence = rows[0].op_fence;
    expect(fence).toBe(1);
    const hd = prepRetentionSql(RETENTION_SQL.hardDelete);
    const hv: Record<string, unknown> = { id, job_id: "J", cid: "C", fence, threshold: THRESH };
    const info = sqlite.prepare(hd.text).run(...(hd.order.map((n) => hv[n]) as never[]));
    expect(Number(info.changes)).toBe(1); // that returned value deletes exactly one row
    expect(scanRow(sqlite, id)).toBeUndefined();
  });

  it("t30: replacement owner during outstanding purge RPC — post-RPC transitions 0-row → contention; successor unaffected; release never touches the newer lease", async () => {
    const holder: { sqlite?: DatabaseSync; id?: string } = {};
    const r2 = makeR2({
      onPurge: () => {
        // successor claims + re-tombstones while the RPC is outstanding
        holder.sqlite!.prepare("UPDATE retention_jobs SET claim_id='succ', lease_expires_at=? WHERE scan_id=?").run(FAR, holder.id);
        holder.sqlite!.prepare("UPDATE scans SET op_lease_id='succ', op_fence=op_fence+1, op_lease_expires_at=? WHERE id=?").run(FAR, holder.id);
      },
    });
    const w = world({ r2 });
    holder.sqlite = w.sqlite;
    const id = uuid();
    holder.id = id;
    seedHappy(w.sqlite, id, uuid());
    await w.run();
    const j = jobRow(w.sqlite, id)!;
    expect(j.claim_id).toBe("succ"); // contention statement 0-rowed (claim stolen) → successor untouched
    expect(j.status).not.toBe("done");
    const s = scanRow(w.sqlite, id)!;
    expect(s.op_lease_id).toBe("succ"); // S10 release (our old fence) never touched the newer lease
    expect(s.op_lease_expires_at).toBe(FAR);
  });

  it("t31: wall-budget exhaustion mid-worklist → stop-before-claim; durable leftovers; no partial destructive step", async () => {
    const holder: { w?: World } = {};
    // after job 1 fully completes (its op-lease release), exhaust the shared deadline
    const hooks = onStmt(M.s10, 1, () => {
      holder.w!.clockRef.v = NOW + HANDLER_WALL_BUDGET_MS;
    });
    const w = world({ hooks });
    holder.w = w;
    const a = uuid(),
      b = uuid();
    seedHappy(w.sqlite, a, uuid());
    seedHappy(w.sqlite, b, uuid());
    const r = await w.run();
    expect(r.processed).toBe(1); // second claim never attempted (stop-before-claim)
    expect(r.done).toBe(1);
    const statuses = (w.sqlite.prepare("SELECT status FROM retention_jobs ORDER BY status").all() as { status: string }[]).map((x) => x.status);
    expect(statuses.sort()).toEqual(["done", "pending"]);
    // the leftover scan is untouched (no partial destructive step)
    const leftover = [a, b].map((x) => scanRow(w.sqlite, x)).filter(Boolean);
    expect(leftover).toHaveLength(1);
    expect((leftover[0] as Record<string, unknown>).retention_locked_at).toBeNull();
  });

  it("t32: missing-scan claim expiry mid-path → S1 0-rows → abort before purge / before scrub; reclaim re-runs D6", async () => {
    // (a) claim stolen before the FIRST S1 → abort before purge
    {
      const holder: { sqlite?: DatabaseSync; id?: string } = {};
      const hooks = onStmt(M.s1, 1, () => stealJob(holder.sqlite!, holder.id!));
      const w = world({ hooks });
      holder.sqlite = w.sqlite;
      const id = uuid();
      holder.id = id;
      insertRJob(w.sqlite, { scan_id: id, job_id: "J" });
      insertArtifact(w.sqlite, { r2_key: `score-reports/${id}/abcd/1.pdf`, scan_id: id });
      await w.run();
      expect(w.r2.state.purges).toHaveLength(0); // abort BEFORE purge
      expect(artCount(w.sqlite, id)).toBe(1);
    }
    // (b) claim stolen before the SECOND S1 (post-purge) → abort before scrub; reclaim completes
    {
      const holder: { sqlite?: DatabaseSync; id?: string } = {};
      const hooks = onStmt(M.s1, 2, () => stealJob(holder.sqlite!, holder.id!));
      const w = world({ hooks });
      holder.sqlite = w.sqlite;
      const id = uuid();
      holder.id = id;
      insertRJob(w.sqlite, { scan_id: id, job_id: "J" });
      insertArtifact(w.sqlite, { r2_key: `score-reports/${id}/abcd/1.pdf`, scan_id: id });
      await w.run();
      expect(w.r2.state.purges).toHaveLength(1); // purge ran
      expect(artCount(w.sqlite, id)).toBe(1); // scrub did NOT
      expect(jobRow(w.sqlite, id)!.status).not.toBe("done");
      // reclaim (thief surrenders) → D6 re-runs from the top and completes
      releaseClaim(w.sqlite, id);
      const r = await w.run();
      expect(r.done).toBe(1);
      expect(artCount(w.sqlite, id)).toBe(0);
      expect(jobRow(w.sqlite, id)!.status).toBe("done");
    }
  });
});

describe("F2 t33–t35 — boundary silence, legacy canary, handler deadline", () => {
  it("t33: off/dry_run external-boundary silence — D1 writes, R2, Queue, alert all 0; handler runs the watchdog independently of retention mode", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    const queueSends: unknown[] = [];
    const queue = { send: async (m: unknown) => void queueSends.push(m) };
    for (const mode of ["off", "dry_run"] as const) {
      const w = world({ mode, noR2Binding: mode === "dry_run", queue });
      seedHappy(w.sqlite, uuid(), uuid());
      insertRJob(w.sqlite, { scan_id: uuid(), job_id: uuid(), status: "dead_letter" });
      await w.run();
      expect(w.d1.counters.writes, mode).toBe(0);
      expect(w.r2.state.purges, mode).toHaveLength(0);
      expect(queueSends, mode).toHaveLength(0);
      expect(logs.filter((l) => l.startsWith("class=retention_dead_letter")), mode).toHaveLength(0);
      if (mode === "off") expect(w.d1.counters.stmts).toBe(0);
      // note: the scanner sweep has no email surface; D1/R2/Queue/alert are the observable boundaries
    }
    // handler-level companion: the watchdog runs independently of retention mode (off)
    const sqlite = freshSqlite();
    const d1 = makeD1(sqlite);
    const env = { DB: d1 as unknown as Env["DB"] } as unknown as Env; // RETENTION_SWEEP_MODE absent → off
    await scannerWorker.scheduled({} as ScheduledEvent, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    expect(d1.executed.length).toBeGreaterThan(0); // watchdog ran
    expect(d1.executed.some((e) => e.sql.includes("retention_jobs"))).toBe(false); // retention touched nothing
  });

  it("t34: ACTIVATION-BLOCKING legacy-surface canary — capture-email AND delete-PII route dispatch mutates a TOMBSTONED scan at current ship-state (documents the hole)", async () => {
    const sqlite = freshSqlite();
    const d1 = makeD1(sqlite);
    const id = uuid();
    seedScan(sqlite, {
      id,
      email: "orig@x.com",
      retention_locked_at: OLD,
      retention_job_id: "J",
      op_lease_id: "retention-cid",
      op_lease_expires_at: FAR,
    });
    const env = { DB: d1 as unknown as Env["DB"], INTERNAL_SCANNER_ADMIN_KEY: "admin-key" } as unknown as Env;
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    // legacy capture-email: mutates email + opt-in with NO tombstone/lease awareness
    const res1 = await scannerWorker.fetch(
      new Request(`https://scanner.astrant.io/api/scan/${id}/capture-email`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-scanner-admin-key": "admin-key" },
        body: JSON.stringify({ email: "attacker@x.com", unsubscribe_token: "tok", email_opted_in_rescan: 1 }),
      }),
      env,
      ctx
    );
    expect(res1.status).toBe(200);
    let row = scanRow(sqlite, id)!;
    expect(row.email).toBe("attacker@x.com"); // ← the hole: cohort field mutated post-tombstone
    expect(row.email_opted_in_rescan).toBe(1);
    // legacy delete-pii: likewise tombstone-blind
    const res2 = await scannerWorker.fetch(
      new Request(`https://scanner.astrant.io/api/scan/${id}/delete-pii`, {
        method: "POST",
        headers: { "x-internal-scanner-admin-key": "admin-key" },
      }),
      env,
      ctx
    );
    expect(res2.status).toBe(200);
    row = scanRow(sqlite, id)!;
    expect(row.email).toBeNull(); // mutated again — no tombstone/lease/fence check
    // INVERSION CONTRACT (D18/G-2 — must flip BEFORE any activation): (i) retained+guarded →
    // the same authenticated dispatches are REJECTED and D1 state is byte-unchanged; or
    // (ii) retired → the routes are absent and a repo-wide grep proves no remaining caller
    // of the legacy SQL shape. An ad-hoc direct SQL update is NOT the activation proof.
  });

  it("t35: handler-level shared deadline — watchdog consumes injected time → retention shrinks/skips; TICK_STOP_MARGIN observable", async () => {
    const sqlite = freshSqlite();
    const id = uuid();
    seedHappy(sqlite, id, uuid());
    let tNow = NOW;
    vi.spyOn(Date, "now").mockImplementation(() => tNow);
    let advanced = false;
    const d1 = makeD1(sqlite, {
      before: (q) => {
        if (!advanced && q.includes("capture_jobs")) {
          advanced = true;
          // the watchdog consumes almost the whole budget: remaining < STOP_MARGIN + HEADROOM
          tNow = NOW + HANDLER_WALL_BUDGET_MS - TICK_STOP_MARGIN_MS - MIN_JOB_HEADROOM_MS + 1;
        }
      },
    });
    const r2 = makeR2();
    const env = { DB: d1 as unknown as Env["DB"], RETENTION_SWEEP_MODE: "enforce", MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: KEY } as unknown as Env;
    await scannerWorker.scheduled({} as ScheduledEvent, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    expect(advanced).toBe(true); // watchdog ran and consumed the injected time
    // retention enqueued (cheap) but claimed nothing: stop-before-claim tripped on the shared deadline
    const j = jobRow(sqlite, id);
    if (j) {
      expect(j.status).toBe("pending");
      expect(j.claim_id).toBeNull();
    }
    expect(scanRow(sqlite, id)!.retention_locked_at).toBeNull(); // no destructive step
    expect(r2.state.purges).toHaveLength(0);
    expect(Date.now() - NOW).toBeLessThan(HANDLER_WALL_BUDGET_MS); // total inside the budget
  });
});

describe("F2 t36–t40 — alarm preservation, static audit, races, desync", () => {
  it("t36: alarm not laundered — drift → invariant dead-letter → replay (without revert) → invariant AGAIN (never cancelled); re-alert exactly once; revert-then-replay exits", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    const holder: { sqlite?: DatabaseSync; id?: string } = {};
    const hooks = onStmt(M.hd, 1, () => holder.sqlite!.prepare("UPDATE scans SET email_opted_in_rescan=1 WHERE id=?").run(holder.id));
    const w = world({ hooks });
    holder.sqlite = w.sqlite;
    const id = uuid();
    holder.id = id;
    seedHappy(w.sqlite, id, uuid());
    await w.run();
    expect(jobRow(w.sqlite, id)!.status).toBe("dead_letter");
    expect(jobRow(w.sqlite, id)!.last_error_class).toBe("retention_invariant_violation");
    expect(logs.filter((l) => l.startsWith("class=retention_dead_letter"))).toHaveLength(1);
    // replay WITHOUT reverting the drift → tombstone 0-row (cohort false + locked NOT NULL) → invariant again, never cancelled
    await replayDeadLetter(w.env.DB, id, "bruno", "attempt", NOW);
    const T2 = NOW + 400_000;
    w.clockRef.v = T2;
    await w.run({ now: T2 });
    const j = jobRow(w.sqlite, id)!;
    expect(j.status).toBe("dead_letter");
    expect(j.last_error_class).toBe("retention_invariant_violation");
    expect(logs.filter((l) => l.startsWith("class=retention_dead_letter"))).toHaveLength(2); // re-alert exactly once (replay cleared alert_state)
    // sanctioned exit: revert-then-replay (D9 remediation contract)
    w.sqlite.prepare("UPDATE scans SET email_opted_in_rescan=0 WHERE id=?").run(id);
    await replayDeadLetter(w.env.DB, id, "bruno", "reverted drift", T2);
    const T3 = T2 + 400_000;
    w.clockRef.v = T3;
    const r = await w.run({ now: T3 });
    expect(r.done).toBe(1);
    expect(jobRow(w.sqlite, id)!.status).toBe("done");
    expect(scanRow(w.sqlite, id)).toBeUndefined();
  });

  it("t37: static predicate audit over RETENTION_SQL — presence AND absence per Appendix T", () => {
    const stripped = (s: string) =>
      s
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n");
    // stable-identity terms present in S1–S4/S6/S7/S11/S12
    for (const k of ["s1", "s2", "s3", "s4", "s6", "s7", "s11", "s12a", "s12b"] as const) {
      expect(RETENTION_SQL[k], k).toContain(":job_id");
    }
    for (const k of ["s2", "s3", "s4", "s6", "s7"] as const) {
      expect(RETENTION_SQL[k], k).toContain("retention_locked_at IS NOT NULL");
      expect(RETENTION_SQL[k], k).toContain("retention_job_id");
    }
    // S9: NOT EXISTS(scans) + live expiry
    expect(RETENTION_SQL.s9).toContain("NOT EXISTS (SELECT 1 FROM scans WHERE id = :id)");
    expect(RETENTION_SQL.s9).toContain("lease_expires_at > :live");
    // tombstone ends RETURNING op_fence (A1)
    expect(RETENTION_SQL.tombstone.trimEnd().endsWith("RETURNING op_fence;")).toBe(true);
    // hard-delete: NO retention_jobs reference, NO expiry column (fence monotonicity)
    const hd = stripped(RETENTION_SQL.hardDelete);
    expect(hd).not.toContain("retention_jobs");
    expect(hd).not.toContain("expires_at");
    expect(hd).toContain("retention_job_id=:job_id");
    expect(hd).toContain("op_lease_id=:cid AND op_fence=:fence");
    // S5 carries the A5 predicate
    expect(RETENTION_SQL.s5).toContain("lease_expires_at > :live");
    // frozen statements keep exactly their frozen predicates: no job-plane EXISTS added
    for (const k of ["enqueue", "revive", "claim", "tombstone", "hardDelete", "failure", "contention", "replay", "gate"] as const) {
      expect(stripped(RETENTION_SQL[k]), k).not.toContain("EXISTS (SELECT 1 FROM retention_jobs");
    }
    // missing-scan fragments carry NOT EXISTS(scans)
    for (const k of ["s11", "s12a", "s12b"] as const) {
      expect(RETENTION_SQL[k], k).toContain("NOT EXISTS (SELECT 1 FROM scans WHERE id=:id)");
    }
  });

  it("t38a: claim-to-tombstone race — stale claimant may tombstone, is stopped at S1, releases its own fence; successor completes; zero destructive steps by the stale claimant", async () => {
    const holder: { sqlite?: DatabaseSync; id?: string } = {};
    // steal the job claim AFTER our claim but BEFORE the tombstone executes
    const hooks = onStmt(M.tomb, 1, () => stealJob(holder.sqlite!, holder.id!));
    const w = world({ hooks });
    holder.sqlite = w.sqlite;
    const id = uuid();
    holder.id = id;
    seedHappy(w.sqlite, id, uuid());
    await w.run();
    const s = scanRow(w.sqlite, id)!;
    expect(s.retention_locked_at).not.toBeNull(); // the stale CAS DID tombstone (documented, not a bug)
    expect(s.op_lease_id).toBeNull(); // `finally` released its own fence
    for (const e of w.d1.executed) {
      if (DESTRUCTIVE.some((m) => m(e.sql))) expect(e.changes).toBe(0); // zero destructive steps
    }
    expect(w.r2.state.purges).toHaveLength(0);
    // successor completes once the thief's claim is surrendered
    releaseClaim(w.sqlite, id);
    const r = await w.run();
    expect(r.done).toBe(1);
    expect(scanRow(w.sqlite, id)).toBeUndefined();
  });

  it("t38b: renewal-to-hard-delete fence monotonicity — with a successor → 0-row → contention; without → delete completes safely", async () => {
    // (a) successor advanced the fence while our lease lapsed → stale delete 0-rows → contention
    {
      const holder: { sqlite?: DatabaseSync; id?: string; w?: World } = {};
      const hooks = onStmt(M.hd, 1, () => {
        holder.w!.clockRef.v = NOW + 400_000; // clock past expiry after the renewal
        stealScan(holder.sqlite!, holder.id!); // successor re-tombstoned (fence advanced)
      });
      const w = world({ hooks });
      holder.sqlite = w.sqlite;
      holder.w = w;
      const id = uuid();
      holder.id = id;
      seedHappy(w.sqlite, id, uuid());
      const r = await w.run();
      expect(r.contended).toBe(1);
      expect(scanRow(w.sqlite, id)).toBeDefined(); // stale delete did nothing
    }
    // (b) no successor: lease lapsed but fence still matches → delete completes safely
    //     (no one to contend with); S9 0-rows on the lapsed lease → contention, and the
    //     next claimant lands in D6 recovery and marks done — never synthetic success
    {
      const holder: { w?: World } = {};
      const hooks = onStmt(M.hd, 1, () => {
        holder.w!.clockRef.v = NOW + 400_000; // expiry passes; nobody reclaims
      });
      const w = world({ hooks });
      holder.w = w;
      const id = uuid();
      seedHappy(w.sqlite, id, uuid());
      const r = await w.run();
      expect(scanRow(w.sqlite, id)).toBeUndefined(); // delete completed safely
      expect(r.done).toBe(0); // S9 0-rowed → contention, not synthetic success
      const T2 = NOW + 800_000;
      w.clockRef.v = T2;
      const r2 = await w.run({ now: T2 });
      expect(r2.done).toBe(1); // D6 recovery
      expect(jobRow(w.sqlite, id)!.status).toBe("done");
    }
  });

  it("t39: missing-scan completion authority — scan reappears before S9 → S9 0-rows, done unreachable; next claimant completes; ordinary-path S9 succeeds (t4)", async () => {
    const holder: { sqlite?: DatabaseSync; id?: string; fired?: boolean } = {};
    const hooks = onStmt(M.s9, 1, () => {
      holder.fired = true;
      seedScan(holder.sqlite!, { id: holder.id!, created_at: NOW - 1000 }); // scan reappears
    });
    const w = world({ hooks });
    holder.sqlite = w.sqlite;
    const id = uuid();
    holder.id = id;
    insertRJob(w.sqlite, { scan_id: id, job_id: "J" });
    insertArtifact(w.sqlite, { r2_key: `score-reports/${id}/abcd/1.pdf`, scan_id: id });
    await w.run();
    expect(holder.fired).toBe(true);
    expect(jobRow(w.sqlite, id)!.status).not.toBe("done"); // S9 0-rowed → contention/recovery
    // remove the reappeared row; the next claimant re-runs purge + scrub to completion
    w.sqlite.prepare("DELETE FROM scans WHERE id=?").run(id);
    const T2 = NOW + 400_000;
    w.clockRef.v = T2;
    const r = await w.run({ now: T2 });
    expect(r.done).toBe(1);
    expect(jobRow(w.sqlite, id)!.status).toBe("done");
  });

  it("t40: pre-destruction desync detection — retention_job_id ≠ job_id → invariant dead-letter + one alert with ZERO destructive effects", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    const w = world();
    const id = uuid();
    // tombstoned scan whose stable identity does NOT match the job row
    seedScan(w.sqlite, {
      id,
      email: "u@x.com",
      retention_locked_at: OLD,
      retention_job_id: "SOMEONE-ELSE",
      pdf_r2_key: `score-reports/${id}/abcd/1.pdf`,
    });
    insertRJob(w.sqlite, { scan_id: id, job_id: "J" });
    insertArtifact(w.sqlite, { r2_key: `score-reports/${id}/abcd/1.pdf`, scan_id: id });
    insertCapture(w.sqlite, { job_id: `cap-${id}`, scan_id: id, phase: "uploaded", email: "u@x.com", pdf_r2_key: "k", delivery_snapshot: "{}" });
    await w.run();
    const j = jobRow(w.sqlite, id)!;
    expect(j.status).toBe("dead_letter"); // :N=1 → immediate
    expect(j.last_error_class).toBe("retention_invariant_violation");
    expect(logs.filter((l) => l.startsWith("class=retention_dead_letter"))).toHaveLength(1);
    // zero capture mutations, zero R2 calls, zero registry deletions, zero identifier scrubs
    expect(w.r2.state.purges).toHaveLength(0);
    expect(artCount(w.sqlite, id)).toBe(1);
    const cap = capRow(w.sqlite, `cap-${id}`)!;
    expect(cap.phase).toBe("uploaded");
    expect(cap.email).toBe("u@x.com");
    expect(cap.pdf_r2_key).toBe("k");
    expect(scanRow(w.sqlite, id)).toBeDefined();
  });
});
