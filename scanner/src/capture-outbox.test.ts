// P0-C2 Chunk C — capture-outbox producer + watchdog integration tests.
//
// Uses a stateful node:sqlite D1 adapter over the REAL migration chain, so the
// fenced writes, DB.batch() atomicity, partial unique indexes, and zero-row
// semantics all behave like production. The adapter records batch order/binds.
import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  runCaptureOutbox,
  runCaptureWatchdog,
  emailR2KeyHash,
  type CaptureOutboxInput,
} from "./capture-outbox";
import worker from "./index";
import type { Env } from "./types";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

function freshSqlite(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(read("../schema.sql"));
  db.exec(read("../migrations/0001_email_capture_columns.sql"));
  db.exec(read("../migrations/0002_tier_column.sql"));
  db.exec(read("../migrations/0003_p0c2_capture_retention.sql"));
  return db;
}

type BatchCall = { sql: string; binds: unknown[] };

// Minimal D1-shaped adapter over node:sqlite. `onBeforeBatch` fires once, right
// before the first batch executes — used to inject the race that makes the
// conditional INSERT hit an unexpected unique conflict.
function makeD1(
  sqlite: DatabaseSync,
  batchLog: BatchCall[],
  hooks: { onBeforeBatch?: () => void } = {},
) {
  let firedBatchHook = false;
  const prepare = (sql: string) => {
    const stmt = {
      _sql: sql,
      _binds: [] as unknown[],
      bind(...args: unknown[]) {
        stmt._binds = args;
        return stmt;
      },
      async run() {
        const info = sqlite.prepare(sql).run(...(stmt._binds as never[]));
        return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }, results: [] };
      },
      async first<T = unknown>() {
        const row = sqlite.prepare(sql).get(...(stmt._binds as never[]));
        return (row ?? null) as T | null;
      },
      async all<T = unknown>() {
        const rows = sqlite.prepare(sql).all(...(stmt._binds as never[]));
        return { success: true, results: rows as T[], meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  const batch = async (stmts: ReturnType<typeof prepare>[]) => {
    if (hooks.onBeforeBatch && !firedBatchHook) {
      firedBatchHook = true;
      hooks.onBeforeBatch();
    }
    sqlite.exec("BEGIN");
    try {
      const out = [];
      for (const st of stmts) {
        batchLog.push({ sql: st._sql, binds: st._binds });
        const info = sqlite.prepare(st._sql).run(...(st._binds as never[]));
        out.push({ success: true, meta: { changes: Number(info.changes) }, results: [] });
      }
      sqlite.exec("COMMIT");
      return out;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  };
  return { prepare, batch };
}

function makeQueue() {
  const sent: { job_id: string }[] = [];
  return {
    ok: { send: async (m: { job_id: string }) => void sent.push(m) },
    failing: { send: async () => { throw new Error("queue down"); } },
    sent,
  };
}

function makeEnv(
  sqlite: DatabaseSync,
  batchLog: BatchCall[],
  o: { queue?: { send: (m: { job_id: string }) => Promise<void> }; adminKey?: string; hooks?: { onBeforeBatch?: () => void } } = {},
): Env {
  return {
    DB: makeD1(sqlite, batchLog, o.hooks ?? {}),
    CAPTURE_QUEUE: o.queue,
    INTERNAL_SCANNER_ADMIN_KEY: o.adminKey ?? "admin-key",
  } as unknown as Env;
}

// Seed a scans row with only the relevant columns (defaults fill the rest).
function seedScan(
  sqlite: DatabaseSync,
  o: {
    id: string;
    email?: string | null;
    unsubscribed_at?: number | null;
    opted?: number;
    pdf_r2_key?: string | null;
    retention_locked_at?: number | null;
    op_lease_id?: string | null;
    op_lease_expires_at?: number | null;
    op_fence?: number;
  },
): void {
  const cols = ["id", "url", "dimensions_scored", "dimensions_total", "results_json", "created_at"];
  const vals: unknown[] = [o.id, "https://x", 6, 6, "{}", 1];
  const push = (c: string, v: unknown) => { cols.push(c); vals.push(v); };
  if (o.email !== undefined) push("email", o.email);
  if (o.unsubscribed_at !== undefined) push("unsubscribed_at", o.unsubscribed_at);
  if (o.opted !== undefined) push("email_opted_in_rescan", o.opted);
  if (o.pdf_r2_key !== undefined) push("pdf_r2_key", o.pdf_r2_key);
  if (o.retention_locked_at !== undefined) push("retention_locked_at", o.retention_locked_at);
  if (o.op_lease_id !== undefined) push("op_lease_id", o.op_lease_id);
  if (o.op_lease_expires_at !== undefined) push("op_lease_expires_at", o.op_lease_expires_at);
  if (o.op_fence !== undefined) push("op_fence", o.op_fence);
  sqlite.prepare(`INSERT INTO scans (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...(vals as never[]));
}

function insertJob(
  sqlite: DatabaseSync,
  o: {
    job_id: string; scan_id: string; phase: string; queue_state?: string; email?: string | null;
    enqueued_at?: number | null; claim_id?: string | null; claim_expires_at?: number | null;
    next_attempt_at?: number; updated_at?: number; pdf_r2_key?: string | null;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO capture_jobs (job_id, scan_id, phase, queue_state, email, pdf_r2_key, enqueued_at, claim_id, claim_expires_at, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      o.job_id, o.scan_id, o.phase, o.queue_state ?? "active", o.email ?? null, o.pdf_r2_key ?? null,
      o.enqueued_at ?? null, o.claim_id ?? null, o.claim_expires_at ?? null, o.next_attempt_at ?? 0, 1, o.updated_at ?? 1,
    );
}

const scanRow = (sqlite: DatabaseSync, id: string) =>
  sqlite.prepare("SELECT email, email_opted_in_rescan AS opt, unsubscribe_token AS tok, op_lease_id FROM scans WHERE id=?").get(id) as
    | { email: string | null; opt: number; tok: string | null; op_lease_id: string | null }
    | undefined;
const jobsFor = (sqlite: DatabaseSync, scanId: string) =>
  sqlite.prepare("SELECT * FROM capture_jobs WHERE scan_id=?").all(scanId) as Record<string, unknown>[];
const jobById = (sqlite: DatabaseSync, jobId: string) =>
  sqlite.prepare("SELECT * FROM capture_jobs WHERE job_id=?").get(jobId) as Record<string, unknown> | undefined;

const NOW = 1_000_000;
const input = (email: string, opted: 0 | 1 = 1): CaptureOutboxInput => ({ email, opted_in: opted, unsubscribe_token: "tok-1" });

// ── endpoint-level (through the default export's fetch) ──────────────────────

describe("POST /api/scan/:id/capture-outbox (through worker.fetch)", () => {
  const call = (env: Env, id: string, body: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request(`https://scanner.astrant.io/api/scan/${id}/capture-outbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      env,
      {} as ExecutionContext,
    );

  const goodBody = { email: "Alice@Example.com", email_opted_in_rescan: 1, unsubscribe_token: "tok-1" };

  it("unauthorized (missing/incorrect key) → 401, zero D1 and Queue mutation", async () => {
    const sqlite = freshSqlite();
    seedScan(sqlite, { id: "s1" });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok, adminKey: "admin-key" });

    const noKey = await call(env, "s1", goodBody);
    expect(noKey.status).toBe(401);
    const badKey = await call(env, "s1", goodBody, { "x-internal-scanner-admin-key": "wrong" });
    expect(badKey.status).toBe(401);

    expect(jobsFor(sqlite, "s1")).toHaveLength(0);
    expect(scanRow(sqlite, "s1")!.email).toBeNull();
    expect(q.sent).toHaveLength(0);
  });

  it("invalid body → 400, zero mutation", async () => {
    const sqlite = freshSqlite();
    seedScan(sqlite, { id: "s1" });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });
    const res = await call(env, "s1", { email: "a@b.com" }, { "x-internal-scanner-admin-key": "admin-key" });
    expect(res.status).toBe(400);
    expect(jobsFor(sqlite, "s1")).toHaveLength(0);
    expect(q.sent).toHaveLength(0);
  });

  it("fresh request → one pending job, atomic scan-field update, lease released, queues that exact id", async () => {
    const sqlite = freshSqlite();
    seedScan(sqlite, { id: "s1" });
    const q = makeQueue();
    const batchLog: BatchCall[] = [];
    const env = makeEnv(sqlite, batchLog, { queue: q.ok });

    const res = await call(env, "s1", goodBody, { "x-internal-scanner-admin-key": "admin-key" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { job_id: string; reused: boolean; enqueued: boolean };

    const jobs = jobsFor(sqlite, "s1");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].phase).toBe("pending");
    expect(jobs[0].queue_state).toBe("active");
    expect(jobs[0].email).toBe("alice@example.com"); // normalized
    expect(jobs[0].job_id).toBe(json.job_id);

    // atomic scan-field update
    const s = scanRow(sqlite, "s1")!;
    expect(s.email).toBe("alice@example.com");
    expect(s.opt).toBe(1);
    expect(s.tok).toBe("tok-1");
    expect(s.op_lease_id).toBeNull(); // lease released

    // batch order: fenced scan-update THEN conditional insert
    expect(batchLog).toHaveLength(2);
    expect(batchLog[0].sql).toContain("UPDATE scans");
    expect(batchLog[1].sql).toContain("INSERT INTO capture_jobs");
    expect(batchLog[1].binds[0]).toBe(json.job_id);
    expect(batchLog[1].binds[3]).toBe("pending");

    // queued exactly that id; enqueued_at stamped
    expect(q.sent).toEqual([{ job_id: json.job_id }]);
    expect(jobById(sqlite, json.job_id)!.enqueued_at).not.toBeNull();
    expect(json.reused).toBe(false);
    expect(json.enqueued).toBe(true);
  });

  it("unsubscribed scan clamps opt-in to zero", async () => {
    const sqlite = freshSqlite();
    seedScan(sqlite, { id: "s1", unsubscribed_at: 500 });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });
    await call(env, "s1", { ...goodBody, email_opted_in_rescan: 1 }, { "x-internal-scanner-admin-key": "admin-key" });
    expect(scanRow(sqlite, "s1")!.opt).toBe(0);
  });

  it("same-email repeat reuses + queues the existing id; no second job", async () => {
    const sqlite = freshSqlite();
    seedScan(sqlite, { id: "s1" });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok, adminKey: "admin-key" });

    const r1 = (await (await call(env, "s1", goodBody, { "x-internal-scanner-admin-key": "admin-key" })).json()) as { job_id: string };
    const r2 = (await (await call(env, "s1", goodBody, { "x-internal-scanner-admin-key": "admin-key" })).json()) as { job_id: string; reused: boolean };

    expect(r2.job_id).toBe(r1.job_id);
    expect(r2.reused).toBe(true);
    expect(jobsFor(sqlite, "s1")).toHaveLength(1);
    expect(q.sent).toEqual([{ job_id: r1.job_id }, { job_id: r1.job_id }]);
  });

  it("different-email repeat mutates no capture fields and sends no Queue message", async () => {
    const sqlite = freshSqlite();
    seedScan(sqlite, { id: "s1" });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok, adminKey: "admin-key" });

    await call(env, "s1", goodBody, { "x-internal-scanner-admin-key": "admin-key" }); // email A
    const before = scanRow(sqlite, "s1")!;
    const sentBefore = q.sent.length;

    const res = await call(env, "s1", { ...goodBody, email: "bob@example.com" }, { "x-internal-scanner-admin-key": "admin-key" });
    expect(res.status).toBe(409);

    const after = scanRow(sqlite, "s1")!;
    expect(after.email).toBe(before.email); // still A
    expect(jobsFor(sqlite, "s1")).toHaveLength(1);
    expect(q.sent.length).toBe(sentBefore); // no new message
  });
});

// ── producer branch logic (direct) ───────────────────────────────────────────

describe("runCaptureOutbox — pointer + lease branches", () => {
  it("matching active pointer → uploaded send-only job", async () => {
    const sqlite = freshSqlite();
    const hash = await emailR2KeyHash("alice@example.com");
    const ptr = `score-reports/s1/${hash}/1.pdf`;
    seedScan(sqlite, { id: "s1", pdf_r2_key: ptr });
    sqlite.prepare(
      "INSERT INTO r2_artifacts (r2_key, scan_id, capture_job_id, op_fence, created_at, status) VALUES (?, 's1', 'j-old', 1, 1, 'active')",
    ).run(ptr);
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });

    const res = await runCaptureOutbox(env, "s1", input("alice@example.com"), NOW);
    expect(res.status).toBe("deferred");
    const jobs = jobsFor(sqlite, "s1");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].phase).toBe("uploaded");
    expect(jobs[0].pdf_r2_key).toBe(ptr);
  });

  it("non-active pointer → fresh pending job", async () => {
    const sqlite = freshSqlite();
    const hash = await emailR2KeyHash("alice@example.com");
    const ptr = `score-reports/s1/${hash}/1.pdf`;
    seedScan(sqlite, { id: "s1", pdf_r2_key: ptr });
    // artifact exists but is superseded, not active
    sqlite.prepare(
      "INSERT INTO r2_artifacts (r2_key, scan_id, capture_job_id, op_fence, created_at, status) VALUES (?, 's1', 'j-old', 1, 1, 'superseded')",
    ).run(ptr);
    const env = makeEnv(sqlite, [], { queue: makeQueue().ok });
    const res = await runCaptureOutbox(env, "s1", input("alice@example.com"), NOW);
    expect(res.status).toBe("deferred");
    expect(jobsFor(sqlite, "s1")[0].phase).toBe("pending");
  });

  it("tombstoned scan cannot create or enqueue a job", async () => {
    const sqlite = freshSqlite();
    seedScan(sqlite, { id: "s1", retention_locked_at: 999 });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });
    const res = await runCaptureOutbox(env, "s1", input("alice@example.com"), NOW);
    expect(res.status).toBe("unavailable");
    expect(jobsFor(sqlite, "s1")).toHaveLength(0);
    expect(q.sent).toHaveLength(0);
  });

  it("live-lease scan cannot create or enqueue a job", async () => {
    const sqlite = freshSqlite();
    seedScan(sqlite, { id: "s1", op_lease_id: "other", op_lease_expires_at: NOW + 10_000 });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });
    const res = await runCaptureOutbox(env, "s1", input("alice@example.com"), NOW);
    expect(res.status).toBe("unavailable");
    expect(jobsFor(sqlite, "s1")).toHaveLength(0);
    expect(q.sent).toHaveLength(0);
  });

  it("missing scan → not_found", async () => {
    const sqlite = freshSqlite();
    const env = makeEnv(sqlite, [], { queue: makeQueue().ok });
    const res = await runCaptureOutbox(env, "nope", input("a@b.com"), NOW);
    expect(res.status).toBe("not_found");
  });

  it("unexpected unique conflict rolls back scan-field changes and queues nothing", async () => {
    const sqlite = freshSqlite();
    seedScan(sqlite, { id: "s1", email: "old@example.com" });
    const q = makeQueue();
    // Race: a conflicting unfinished job appears AFTER the in-flight pre-check
    // but BEFORE the batch commits → the plain conditional INSERT violates
    // idx_one_active_capture → batch throws → ROLLBACK.
    const env = makeEnv(sqlite, [], {
      queue: q.ok,
      hooks: { onBeforeBatch: () => insertJob(sqlite, { job_id: "racer", scan_id: "s1", phase: "pending", email: "alice@example.com" }) },
    });

    const res = await runCaptureOutbox(env, "s1", input("alice@example.com"), NOW);
    expect(res.status).toBe("unavailable"); // insert_conflict
    // scan-field update rolled back
    expect(scanRow(sqlite, "s1")!.email).toBe("old@example.com");
    // only the injected racer exists; no second job
    const jobs = jobsFor(sqlite, "s1");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].job_id).toBe("racer");
    expect(q.sent).toHaveLength(0);
  });

  it("Queue-send failure leaves a committed job with enqueued_at NULL (repairable)", async () => {
    const sqlite = freshSqlite();
    seedScan(sqlite, { id: "s1" });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.failing });
    const res = await runCaptureOutbox(env, "s1", input("alice@example.com"), NOW);
    expect(res.status).toBe("deferred");
    if (res.status !== "deferred") return;
    expect(res.enqueued).toBe(false);
    const job = jobById(sqlite, res.job_id)!;
    expect(job.enqueued_at).toBeNull(); // durable + repairable
    expect(job.phase).toBe("pending");
  });
});

// ── watchdog ─────────────────────────────────────────────────────────────────

describe("runCaptureWatchdog", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("re-enqueues unsent pending jobs (enqueued_at IS NULL)", async () => {
    const sqlite = freshSqlite();
    insertJob(sqlite, { job_id: "j1", scan_id: "s1", phase: "pending", enqueued_at: null });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });
    const r = await runCaptureWatchdog(env, { now: NOW });
    expect(r.reenqueued).toBe(1);
    expect(q.sent).toEqual([{ job_id: "j1" }]);
    expect(jobById(sqlite, "j1")!.enqueued_at).toBe(NOW);
  });

  it("recovers an expired claim WITHOUT rewinding phase", async () => {
    const sqlite = freshSqlite();
    insertJob(sqlite, { job_id: "j1", scan_id: "s1", phase: "uploaded", claim_id: "c1", claim_expires_at: NOW - 1000, updated_at: NOW - 100 });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });
    const r = await runCaptureWatchdog(env, { now: NOW });
    expect(r.reenqueued).toBe(1);
    const j = jobById(sqlite, "j1")!;
    expect(j.phase).toBe("uploaded"); // NOT rewound
    expect(j.claim_id).toBeNull();
    expect(j.claim_expires_at).toBeNull();
  });

  it("re-enqueues due-backpressure jobs (next_attempt_at>0 AND <=now) and clears the marker", async () => {
    const sqlite = freshSqlite();
    insertJob(sqlite, { job_id: "j1", scan_id: "s1", phase: "rendering", enqueued_at: NOW - 5000, next_attempt_at: NOW - 1 });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });
    const r = await runCaptureWatchdog(env, { now: NOW });
    expect(r.reenqueued).toBe(1);
    expect(jobById(sqlite, "j1")!.next_attempt_at).toBe(0);
  });

  it("does NOT re-enqueue a not-yet-due backpressure job", async () => {
    const sqlite = freshSqlite();
    insertJob(sqlite, { job_id: "j1", scan_id: "s1", phase: "rendering", enqueued_at: NOW - 5000, next_attempt_at: NOW + 10_000 });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });
    const r = await runCaptureWatchdog(env, { now: NOW });
    expect(r.reenqueued).toBe(0);
    expect(q.sent).toHaveLength(0);
  });

  it("email_sending beyond 24h → email_ambiguous, phase preserved, not enqueued", async () => {
    const sqlite = freshSqlite();
    insertJob(sqlite, { job_id: "j1", scan_id: "s1", phase: "email_sending", updated_at: NOW - DAY - 1, claim_expires_at: NOW - 1000 });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });
    const r = await runCaptureWatchdog(env, { now: NOW });
    expect(r.ambiguous).toBe(1);
    expect(r.reenqueued).toBe(0);
    const j = jobById(sqlite, "j1")!;
    expect(j.queue_state).toBe("email_ambiguous");
    expect(j.phase).toBe("email_sending");
    expect(q.sent).toHaveLength(0);
  });

  it("email_sending within 24h with an expired claim IS re-enqueued (phase preserved)", async () => {
    const sqlite = freshSqlite();
    insertJob(sqlite, { job_id: "j1", scan_id: "s1", phase: "email_sending", updated_at: NOW - 1000, claim_expires_at: NOW - 500 });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });
    const r = await runCaptureWatchdog(env, { now: NOW });
    expect(r.ambiguous).toBe(0);
    expect(r.reenqueued).toBe(1);
    expect(jobById(sqlite, "j1")!.phase).toBe("email_sending");
  });

  it("never processes dead_letter, existing email_ambiguous, done, or cancelled jobs", async () => {
    const sqlite = freshSqlite();
    insertJob(sqlite, { job_id: "dl", scan_id: "a", phase: "uploaded", queue_state: "dead_letter", claim_expires_at: NOW - 1 });
    insertJob(sqlite, { job_id: "ea", scan_id: "b", phase: "email_sending", queue_state: "email_ambiguous", updated_at: NOW - DAY - 1 });
    // done/cancelled with an OVERDUE next_attempt_at + unsent — must still be excluded.
    insertJob(sqlite, { job_id: "dn", scan_id: "c", phase: "done", next_attempt_at: NOW - 1, enqueued_at: null });
    insertJob(sqlite, { job_id: "cn", scan_id: "d", phase: "cancelled", next_attempt_at: NOW - 1, enqueued_at: null });
    insertJob(sqlite, { job_id: "ok", scan_id: "e", phase: "pending", enqueued_at: null }); // the only eligible one
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });
    const r = await runCaptureWatchdog(env, { now: NOW });
    expect(r.reenqueued).toBe(1);
    expect(r.ambiguous).toBe(0); // the email_ambiguous one is not re-ambiguated
    expect(q.sent).toEqual([{ job_id: "ok" }]);
  });

  it("a Queue-send failure leaves the row eligible for a later pass", async () => {
    const sqlite = freshSqlite();
    insertJob(sqlite, { job_id: "j1", scan_id: "s1", phase: "pending", enqueued_at: null });
    const q = makeQueue();
    const failEnv = makeEnv(sqlite, [], { queue: q.failing });
    const r1 = await runCaptureWatchdog(failEnv, { now: NOW });
    expect(r1.send_failed).toBe(1);
    expect(r1.reenqueued).toBe(0);
    expect(jobById(sqlite, "j1")!.enqueued_at).toBeNull(); // still unsent

    const okEnv = makeEnv(sqlite, [], { queue: q.ok });
    const r2 = await runCaptureWatchdog(okEnv, { now: NOW + 60_000 });
    expect(r2.reenqueued).toBe(1);
    expect(q.sent).toEqual([{ job_id: "j1" }]);
  });

  it("repairs a send-only 'uploaded' job whose INITIAL send failed (correction 1)", async () => {
    const sqlite = freshSqlite();
    const hash = await emailR2KeyHash("alice@example.com");
    const ptr = `score-reports/s1/${hash}/1.pdf`;
    seedScan(sqlite, { id: "s1", pdf_r2_key: ptr });
    sqlite.prepare(
      "INSERT INTO r2_artifacts (r2_key, scan_id, capture_job_id, op_fence, created_at, status) VALUES (?, 's1', 'j-old', 1, 1, 'active')",
    ).run(ptr);
    const q = makeQueue();

    // producer with a FAILING queue → send-only 'uploaded' job, enqueued_at NULL
    const res = await runCaptureOutbox(makeEnv(sqlite, [], { queue: q.failing }), "s1", input("alice@example.com"), NOW);
    expect(res.status).toBe("deferred");
    if (res.status !== "deferred") return;
    const jobId = res.job_id;
    expect(jobById(sqlite, jobId)!.phase).toBe("uploaded");
    expect(jobById(sqlite, jobId)!.enqueued_at).toBeNull();

    // watchdog with a working queue → repairs it (claim-free unsent uploaded)
    const r = await runCaptureWatchdog(makeEnv(sqlite, [], { queue: q.ok }), { now: NOW + 1000 });
    expect(r.reenqueued).toBe(1);
    expect(q.sent).toEqual([{ job_id: jobId }]);
    const j = jobById(sqlite, jobId)!;
    expect(j.enqueued_at).toBe(NOW + 1000);
    expect(j.phase).toBe("uploaded"); // preserved
  });

  it("bounds the WHOLE pass to `limit` across ambiguity + re-enqueue (correction 3)", async () => {
    const sqlite = freshSqlite();
    // 3 stale email_sending (ambiguity-eligible) + 4 unsent pending
    for (let i = 0; i < 3; i++)
      insertJob(sqlite, { job_id: `es${i}`, scan_id: `a${i}`, phase: "email_sending", updated_at: NOW - 25 * 60 * 60 * 1000 });
    for (let i = 0; i < 4; i++)
      insertJob(sqlite, { job_id: `p${i}`, scan_id: `b${i}`, phase: "pending", enqueued_at: null, updated_at: NOW - i });
    const q = makeQueue();
    const env = makeEnv(sqlite, [], { queue: q.ok });

    const r = await runCaptureWatchdog(env, { now: NOW, limit: 4 });
    // total mutations (ambiguated + reenqueued) must not exceed the limit
    expect(r.ambiguous + r.reenqueued).toBeLessThanOrEqual(4);
    expect(r.ambiguous).toBe(3); // all 3 stale (≤ limit)
    expect(r.reenqueued).toBe(1); // remaining budget = 1
    expect(q.sent).toHaveLength(1);
  });

  it("re-enqueue candidates are themselves bounded by limit", async () => {
    const sqlite = freshSqlite();
    for (let i = 0; i < 5; i++)
      insertJob(sqlite, { job_id: `p${i}`, scan_id: `b${i}`, phase: "pending", enqueued_at: null, updated_at: NOW - i });
    const q = makeQueue();
    const r = await runCaptureWatchdog(makeEnv(sqlite, [], { queue: q.ok }), { now: NOW, limit: 2 });
    expect(r.reenqueued).toBe(2);
    expect(q.sent).toHaveLength(2);
  });

  it("preserves the email_sending 24h anchor across a re-enqueue (correction 4, two-pass)", async () => {
    const sqlite = freshSqlite();
    const H = 60 * 60 * 1000;
    const T0 = 1_000_000_000_000;
    const anchor = T0 - 23 * H; // entered email_sending 23h ago
    insertJob(sqlite, {
      job_id: "j1", scan_id: "s1", phase: "email_sending",
      updated_at: anchor, claim_expires_at: T0 - 500, // expired claim
    });
    const q = makeQueue();

    // Pass 1 at hour 23: within window → re-enqueued, anchor UNCHANGED.
    const r1 = await runCaptureWatchdog(makeEnv(sqlite, [], { queue: q.ok }), { now: T0 });
    expect(r1.ambiguous).toBe(0);
    expect(r1.reenqueued).toBe(1);
    const j1 = jobById(sqlite, "j1")!;
    expect(j1.updated_at).toBe(anchor); // anchor NOT advanced
    expect(j1.phase).toBe("email_sending");

    // Pass 2 at hour 25 (relative to anchor): now past window → ambiguous, not re-enqueued.
    const r2 = await runCaptureWatchdog(makeEnv(sqlite, [], { queue: q.ok }), { now: T0 + 2 * H });
    expect(r2.ambiguous).toBe(1);
    expect(r2.reenqueued).toBe(0);
    const j2 = jobById(sqlite, "j1")!;
    expect(j2.queue_state).toBe("email_ambiguous");
    expect(j2.phase).toBe("email_sending");
  });
});

describe("endpoint validation (correction 5) — invalid input → 400, zero mutation", () => {
  const call = (env: Env, id: string, body: unknown) =>
    worker.fetch(
      new Request(`https://scanner.astrant.io/api/scan/${id}/capture-outbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-scanner-admin-key": "admin-key" },
        body: JSON.stringify(body),
      }),
      env,
      {} as ExecutionContext,
    );

  const cases: [string, Record<string, unknown>][] = [
    ["malformed email", { email: "not-an-email", email_opted_in_rescan: 1, unsubscribe_token: "t" }],
    ["empty email", { email: "", email_opted_in_rescan: 1, unsubscribe_token: "t" }],
    ["blank token", { email: "a@b.com", email_opted_in_rescan: 1, unsubscribe_token: "   " }],
    ["arbitrary numeric opt-in (5)", { email: "a@b.com", email_opted_in_rescan: 5, unsubscribe_token: "t" }],
    ["fractional opt-in (2.5)", { email: "a@b.com", email_opted_in_rescan: 2.5, unsubscribe_token: "t" }],
  ];

  for (const [name, body] of cases) {
    it(`${name} → 400 with no D1/Queue mutation`, async () => {
      const sqlite = freshSqlite();
      seedScan(sqlite, { id: "s1" });
      const q = makeQueue();
      const env = makeEnv(sqlite, [], { queue: q.ok });
      const res = await call(env, "s1", body);
      expect(res.status).toBe(400);
      expect(jobsFor(sqlite, "s1")).toHaveLength(0);
      expect(scanRow(sqlite, "s1")!.email).toBeNull();
      expect(q.sent).toHaveLength(0);
    });
  }
});

describe("log redaction (correction 6)", () => {
  it("producer error path logs a fixed class only — no scan id / email / token", async () => {
    const throwingDb = {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            throw new Error("boom victim@example.com secret-token-xyz secret-scan-id-123");
          },
          run: async () => ({ success: true, meta: { changes: 0 } }),
          all: async () => ({ results: [] }),
        }),
      }),
      batch: async () => {
        throw new Error("x");
      },
    };
    const env = { DB: throwingDb, INTERNAL_SCANNER_ADMIN_KEY: "admin-key" } as unknown as Env;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await worker.fetch(
      new Request("https://scanner.astrant.io/api/scan/secret-scan-id-123/capture-outbox", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-scanner-admin-key": "admin-key" },
        body: JSON.stringify({ email: "victim@example.com", email_opted_in_rescan: 1, unsubscribe_token: "secret-token-xyz" }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(500);

    const logged = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("class=db_error");
    expect(logged).not.toContain("secret-scan-id-123");
    expect(logged).not.toContain("victim@example.com");
    expect(logged).not.toContain("secret-token-xyz");
    errSpy.mockRestore();
  });
});
