// P0-C2 Chunk E1 — capture-consumer RPC state-machine integration tests.
// worker.fetch over the REAL migration chain + a stateful node:sqlite D1 adapter
// with pre-write race hooks (beforeRun / beforeBatch) so lease-replacement races
// hit the fenced mutation SQL, not just the pre-reads.
import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
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
type Hooks = { beforeRun?: (sql: string) => void; beforeBatch?: () => void; beforeStmt?: (sql: string) => void };
function makeD1(sqlite: DatabaseSync, batchLog: BatchCall[], hooks: Hooks = {}) {
  let firedBatch = false;
  const prepare = (sql: string) => {
    const stmt = {
      _sql: sql,
      _binds: [] as unknown[],
      bind(...a: unknown[]) { stmt._binds = a; return stmt; },
      async run() {
        hooks.beforeRun?.(sql);
        const i = sqlite.prepare(sql).run(...(stmt._binds as never[]));
        return { success: true, meta: { changes: Number(i.changes), last_row_id: Number(i.lastInsertRowid) }, results: [] };
      },
      async first<T = unknown>() { return (sqlite.prepare(sql).get(...(stmt._binds as never[])) ?? null) as T | null; },
      async all<T = unknown>() { return { success: true, results: sqlite.prepare(sql).all(...(stmt._binds as never[])) as T[], meta: { changes: 0 } }; },
    };
    return stmt;
  };
  const batch = async (stmts: ReturnType<typeof prepare>[]) => {
    if (hooks.beforeBatch && !firedBatch) { firedBatch = true; hooks.beforeBatch(); }
    sqlite.exec("BEGIN");
    try {
      const out = [];
      for (const st of stmts) {
        hooks.beforeStmt?.(st._sql);
        batchLog.push({ sql: st._sql, binds: st._binds });
        const i = sqlite.prepare(st._sql).run(...(st._binds as never[]));
        out.push({ success: true, meta: { changes: Number(i.changes) }, results: [] });
      }
      sqlite.exec("COMMIT");
      return out;
    } catch (e) { sqlite.exec("ROLLBACK"); throw e; }
  };
  return { prepare, batch };
}

const KEY = "consumer-key";
function makeEnv(sqlite: DatabaseSync, batchLog: BatchCall[] = [], hooks: Hooks = {}): Env {
  return { DB: makeD1(sqlite, batchLog, hooks), CAPTURE_CONSUMER_KEY: KEY } as unknown as Env;
}

const uuid = () => crypto.randomUUID();

function seedScan(sqlite: DatabaseSync, o: {
  id: string; email?: string | null; op_lease_id?: string | null; op_lease_expires_at?: number | null;
  op_fence?: number; retention_locked_at?: number | null; pdf_r2_key?: string | null;
}): void {
  const cols = ["id", "url", "dimensions_scored", "dimensions_total", "results_json", "created_at"];
  const vals: unknown[] = [o.id, "https://x", 6, 6, JSON.stringify({ id: o.id, url: "https://x" }), 1];
  const push = (c: string, v: unknown) => { cols.push(c); vals.push(v); };
  if (o.email !== undefined) push("email", o.email);
  if (o.op_lease_id !== undefined) push("op_lease_id", o.op_lease_id);
  if (o.op_lease_expires_at !== undefined) push("op_lease_expires_at", o.op_lease_expires_at);
  if (o.op_fence !== undefined) push("op_fence", o.op_fence);
  if (o.retention_locked_at !== undefined) push("retention_locked_at", o.retention_locked_at);
  if (o.pdf_r2_key !== undefined) push("pdf_r2_key", o.pdf_r2_key);
  sqlite.prepare(`INSERT INTO scans (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...(vals as never[]));
}
function insertJob(sqlite: DatabaseSync, o: {
  job_id: string; scan_id: string; phase: string; queue_state?: string; email?: string | null;
  pdf_r2_key?: string | null; delivery_snapshot?: string | null; updated_at?: number; attempts?: number;
  claim_id?: string | null; claim_expires_at?: number | null; op_fence?: number | null; next_attempt_at?: number;
}): void {
  sqlite.prepare(
    `INSERT INTO capture_jobs (job_id, scan_id, phase, queue_state, email, pdf_r2_key, delivery_snapshot, claim_id, claim_expires_at, op_fence, attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(o.job_id, o.scan_id, o.phase, o.queue_state ?? "active", o.email ?? null, o.pdf_r2_key ?? null,
    o.delivery_snapshot ?? null, o.claim_id ?? null, o.claim_expires_at ?? null, o.op_fence ?? null, o.attempts ?? 0,
    o.next_attempt_at ?? 0, 100, o.updated_at ?? 100);
}
function insertArtifact(sqlite: DatabaseSync, o: { r2_key: string; scan_id: string; job_id: string; op_fence?: number; status: string }): void {
  sqlite.prepare("INSERT INTO r2_artifacts (r2_key, scan_id, capture_job_id, op_fence, created_at, status) VALUES (?,?,?,?,?,?)")
    .run(o.r2_key, o.scan_id, o.job_id, o.op_fence ?? 1, 1, o.status);
}
const job = (s: DatabaseSync, id: string) => s.prepare("SELECT * FROM capture_jobs WHERE job_id=?").get(id) as Record<string, unknown>;
const scanRow = (s: DatabaseSync, id: string) => s.prepare("SELECT * FROM scans WHERE id=?").get(id) as Record<string, unknown> | undefined;
const arts = (s: DatabaseSync, scanId: string) => s.prepare("SELECT * FROM r2_artifacts WHERE scan_id=? ORDER BY r2_key").all(scanId) as Record<string, unknown>[];

async function rpc(env: Env, path: string, body: unknown, opts: { key?: string | null } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = opts.key === undefined ? KEY : opts.key;
  if (key) headers["x-internal-capture-consumer-key"] = key;
  const res = await worker.fetch(
    new Request(`https://scanner.astrant.io/api/internal/capture/${path}`, { method: "POST", headers, body: JSON.stringify(body) }),
    env, {} as ExecutionContext,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function seedAndClaim(sqlite: DatabaseSync, env: Env, email = "alice@example.com") {
  const scanId = uuid(), jobId = uuid();
  seedScan(sqlite, { id: scanId, email });
  insertJob(sqlite, { job_id: jobId, scan_id: scanId, phase: "pending", email });
  const r = await rpc(env, "claim", { job_id: jobId });
  const j = r.json.job as Record<string, unknown>;
  return { scanId, jobId, claimId: j.claim_id as string, fence: j.op_fence as number, claim: r };
}
async function toUploaded(sqlite: DatabaseSync, env: Env) {
  const c = await seedAndClaim(sqlite, env);
  const key = (await rpc(env, "register-artifact", { job_id: c.jobId, claim_id: c.claimId })).json.r2_key as string;
  await rpc(env, "mark-uploaded", { job_id: c.jobId, claim_id: c.claimId, r2_key: key });
  return { ...c, key };
}
const validSnap = (o: Partial<Record<string, unknown>> = {}) => ({ from: "a@b", to: "c@d", subject: "s", text: "t", html: "<p>h</p>", headers: { X: "1" }, ...o });

describe("E1 golden path", () => {
  it("claim → register → upload → commit → freeze → complete", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const { scanId, jobId, claimId } = await seedAndClaim(sqlite, env);
    expect(job(sqlite, jobId).phase).toBe("rendering");
    expect(scanRow(sqlite, scanId)!.op_lease_id).toBe(claimId);
    const key = (await rpc(env, "register-artifact", { job_id: jobId, claim_id: claimId })).json.r2_key as string;
    expect((await rpc(env, "mark-uploaded", { job_id: jobId, claim_id: claimId, r2_key: key })).json.status).toBe("uploaded");
    expect((await rpc(env, "commit-pointer", { job_id: jobId, claim_id: claimId, r2_key: key })).json.status).toBe("committed");
    expect(scanRow(sqlite, scanId)!.pdf_r2_key).toBe(key);
    expect(arts(sqlite, scanId).filter((a) => a.status === "active")).toHaveLength(1);
    const snap = validSnap({ to: "alice@example.com" });
    expect((await rpc(env, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: snap })).json.status).toBe("frozen");
    const done = await rpc(env, "complete", { job_id: jobId, claim_id: claimId });
    expect(done.json.status).toBe("done");
    const j = job(sqlite, jobId);
    expect([j.phase, j.email, j.delivery_snapshot]).toEqual(["done", null, null]);
    expect(j.email_sent_at).not.toBeNull();
    expect(j.pdf_r2_key).toBe(key); // retained
    expect(scanRow(sqlite, scanId)!.op_lease_id).toBeNull(); // released
  });
});

describe("E1 claim scheduling + resume", () => {
  it("a not-yet-due job returns deferred WITHOUT acquiring a lease", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const sId = uuid(), jId = uuid();
    seedScan(sqlite, { id: sId, email: "a@b.com" });
    insertJob(sqlite, { job_id: jId, scan_id: sId, phase: "pending", email: "a@b.com", next_attempt_at: Date.now() + 3_600_000 });
    const r = await rpc(env, "claim", { job_id: jId });
    expect(r.json.status).toBe("deferred");
    expect(scanRow(sqlite, sId)!.op_lease_id).toBeNull();
    expect(scanRow(sqlite, sId)!.op_fence).toBe(0); // no lease acquired
  });

  it("a race to terminal after lease acquisition returns ack_no_work and does not strand the lease", async () => {
    const sqlite = freshSqlite();
    const sId = uuid(), jId = uuid();
    seedScan(sqlite, { id: sId, email: "a@b.com" });
    insertJob(sqlite, { job_id: jId, scan_id: sId, phase: "pending", email: "a@b.com" });
    // when the claim UPDATE runs, the job has just gone terminal → 0 rows.
    const env = makeEnv(sqlite, [], {
      beforeRun: (sql) => { if (sql.includes("SET claim_id=?")) sqlite.prepare("UPDATE capture_jobs SET phase='cancelled' WHERE job_id=?").run(jId); },
    });
    const r = await rpc(env, "claim", { job_id: jId });
    expect(r.json.status).toBe("ack_no_work");
    expect(scanRow(sqlite, sId)!.op_lease_id).toBeNull(); // released, not stranded
  });

  it("the claim projection carries everything needed to resume uploaded AND email_sending", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    // uploaded resume
    const s1 = uuid(), j1 = uuid();
    seedScan(sqlite, { id: s1, email: "a@b.com" });
    insertJob(sqlite, { job_id: j1, scan_id: s1, phase: "uploaded", email: "a@b.com", pdf_r2_key: "score-reports/" + s1 + "/hh/1.pdf" });
    const r1 = (await rpc(env, "claim", { job_id: j1 })).json.job as Record<string, unknown>;
    expect(r1.phase).toBe("uploaded");
    expect(r1.pdf_r2_key).toBe("score-reports/" + s1 + "/hh/1.pdf");
    expect(r1.email).toBe("a@b.com");
    expect(typeof r1.created_at).toBe("number");
    // email_sending resume with exact snapshot
    const s2 = uuid(), j2 = uuid(); const snapStr = JSON.stringify(validSnap());
    seedScan(sqlite, { id: s2, email: "a@b.com" });
    insertJob(sqlite, { job_id: j2, scan_id: s2, phase: "email_sending", email: "a@b.com", pdf_r2_key: "score-reports/" + s2 + "/hh/1.pdf", delivery_snapshot: snapStr, updated_at: 123 });
    const r2 = (await rpc(env, "claim", { job_id: j2 })).json.job as Record<string, unknown>;
    expect(r2.phase).toBe("email_sending");
    expect(r2.delivery_snapshot).toBe(snapStr);
    expect(r2.updated_at).toBe(123); // anchor preserved
  });

  it("inactive/terminal → ack_no_work; contention → deferred, no attempt burn", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const dl = uuid(), sdl = uuid();
    seedScan(sqlite, { id: sdl, email: "a@b.com" });
    insertJob(sqlite, { job_id: dl, scan_id: sdl, phase: "uploaded", queue_state: "dead_letter" });
    expect((await rpc(env, "claim", { job_id: dl })).json.status).toBe("ack_no_work");
    const sId = uuid(), jId = uuid(); const leaseExp = Date.now() + 600_000;
    seedScan(sqlite, { id: sId, email: "a@b.com", op_lease_id: "other", op_lease_expires_at: leaseExp });
    insertJob(sqlite, { job_id: jId, scan_id: sId, phase: "pending", email: "a@b.com", attempts: 2 });
    const r = await rpc(env, "claim", { job_id: jId });
    expect(r.json.status).toBe("deferred");
    expect(r.json.next_attempt_at as number).toBeGreaterThan(leaseExp);
    expect(job(sqlite, jId).attempts).toBe(2);
  });
});

describe("E1 register artifact", () => {
  it("idempotent same-claim replay (one artifact)", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const { scanId, jobId, claimId } = await seedAndClaim(sqlite, env);
    expect((await rpc(env, "register-artifact", { job_id: jobId, claim_id: claimId })).json.status).toBe("registered");
    expect((await rpc(env, "register-artifact", { job_id: jobId, claim_id: claimId })).json.status).toBe("already_registered");
    expect(arts(sqlite, scanId)).toHaveLength(1);
  });

  it("lost-fence race writes NEITHER the job key NOR an artifact", async () => {
    const sqlite = freshSqlite();
    const { scanId, jobId, claimId } = await (async () => {
      const c = await seedAndClaim(sqlite, makeEnv(sqlite)); return c;
    })();
    // re-run register with a hook that replaces the lease right before the batch.
    const env = makeEnv(sqlite, [], { beforeBatch: () => sqlite.prepare("UPDATE scans SET op_lease_id='thief', op_fence=op_fence+1 WHERE id=?").run(scanId) });
    const r = await rpc(env, "register-artifact", { job_id: jobId, claim_id: claimId });
    expect(r.status).toBe(422);
    expect(job(sqlite, jobId).pdf_r2_key).toBeNull(); // no key written
    expect(arts(sqlite, scanId)).toHaveLength(0); // no artifact written
  });

  it("a new fence after re-claim mints a new key; the old pending artifact remains", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const { scanId, jobId, claimId, fence } = await seedAndClaim(sqlite, env);
    const k1 = (await rpc(env, "register-artifact", { job_id: jobId, claim_id: claimId })).json.r2_key as string;
    await rpc(env, "defer", { job_id: jobId, claim_id: claimId, next_attempt_at: Date.now() + 3_600_000 });
    sqlite.prepare("UPDATE capture_jobs SET next_attempt_at=0 WHERE job_id=?").run(jobId); // scheduled time arrives
    const r2 = await rpc(env, "claim", { job_id: jobId });
    const claim2 = (r2.json.job as Record<string, unknown>).claim_id as string;
    expect((r2.json.job as Record<string, unknown>).op_fence as number).toBeGreaterThan(fence);
    const k2 = (await rpc(env, "register-artifact", { job_id: jobId, claim_id: claim2 })).json.r2_key as string;
    expect(k2).not.toBe(k1);
    expect(arts(sqlite, scanId).filter((a) => a.status === "pending")).toHaveLength(2);
  });
});

describe("E1 lease-replacement blocks mutations (pre-write races)", () => {
  const thief = (sqlite: DatabaseSync, scanId: string) =>
    sqlite.prepare("UPDATE scans SET op_lease_id='thief', op_fence=op_fence+1, op_lease_expires_at=? WHERE id=?").run(Date.now() + 999_999, scanId);

  it("blocks mark-uploaded", async () => {
    const sqlite = freshSqlite();
    const s = uuid(), j = uuid();
    seedScan(sqlite, { id: s, email: "a@b.com" });
    insertJob(sqlite, { job_id: j, scan_id: s, phase: "pending", email: "a@b.com" });
    const env0 = makeEnv(sqlite);
    const cl = (await rpc(env0, "claim", { job_id: j })).json.job as Record<string, unknown>;
    const key = (await rpc(env0, "register-artifact", { job_id: j, claim_id: cl.claim_id as string })).json.r2_key as string;
    const env = makeEnv(sqlite, [], { beforeRun: (sql) => { if (sql.includes("SET phase='uploaded'")) thief(sqlite, s); } });
    const r = await rpc(env, "mark-uploaded", { job_id: j, claim_id: cl.claim_id as string, r2_key: key });
    expect(r.json.status).toBe("error");
    expect(job(sqlite, j).phase).toBe("rendering"); // no transition
    expect(scanRow(sqlite, s)!.op_lease_id).toBe("thief"); // other owner's lease intact
  });

  it("blocks freeze", async () => {
    const sqlite = freshSqlite();
    const { scanId, jobId, claimId, key } = await toUploaded(sqlite, makeEnv(sqlite));
    await rpc(makeEnv(sqlite), "commit-pointer", { job_id: jobId, claim_id: claimId, r2_key: key });
    const env = makeEnv(sqlite, [], { beforeRun: (sql) => { if (sql.includes("SET phase='email_sending'")) thief(sqlite, scanId); } });
    const r = await rpc(env, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: validSnap() });
    expect(r.json.status).toBe("error");
    expect(job(sqlite, jobId).phase).toBe("uploaded");
    expect(scanRow(sqlite, scanId)!.op_lease_id).toBe("thief");
  });

  it("blocks complete and cannot release another owner's lease", async () => {
    const sqlite = freshSqlite();
    const { scanId, jobId, claimId, key } = await toUploaded(sqlite, makeEnv(sqlite));
    const e = makeEnv(sqlite);
    await rpc(e, "commit-pointer", { job_id: jobId, claim_id: claimId, r2_key: key });
    await rpc(e, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: validSnap() });
    const env = makeEnv(sqlite, [], { beforeBatch: () => thief(sqlite, scanId) });
    const r = await rpc(env, "complete", { job_id: jobId, claim_id: claimId });
    expect(r.json.status).toBe("error");
    expect(job(sqlite, jobId).phase).toBe("email_sending"); // no transition
    expect(scanRow(sqlite, scanId)!.op_lease_id).toBe("thief"); // not released
  });

  it("blocks defer and cannot release another owner's lease", async () => {
    const sqlite = freshSqlite();
    const { scanId, jobId, claimId } = await seedAndClaim(sqlite, makeEnv(sqlite));
    const env = makeEnv(sqlite, [], { beforeBatch: () => thief(sqlite, scanId) });
    const r = await rpc(env, "defer", { job_id: jobId, claim_id: claimId, next_attempt_at: Date.now() + 3_600_000 });
    expect(r.json.status).toBe("error");
    expect(job(sqlite, jobId).claim_id).toBe(claimId); // claim not cleared
    expect(scanRow(sqlite, scanId)!.op_lease_id).toBe("thief");
  });
});

describe("E1 pointer commit + safe compensation", () => {
  it("runs the three-statement batch in exact order", async () => {
    const sqlite = freshSqlite(); const batchLog: BatchCall[] = []; const env = makeEnv(sqlite, batchLog);
    const { jobId, claimId, key } = await toUploaded(sqlite, env);
    batchLog.length = 0;
    await rpc(env, "commit-pointer", { job_id: jobId, claim_id: claimId, r2_key: key });
    const b = batchLog.filter((x) => x.sql.includes("pdf_r2_key") || x.sql.includes("r2_artifacts"));
    expect(b[0].sql).toContain("UPDATE scans SET pdf_r2_key");
    expect(b[1].sql).toContain("status='superseded'");
    expect(b[2].sql).toContain("status='active'");
  });

  it("crash-after-commit replay normalizes (already_committed); ≤1 active", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const { scanId, jobId, claimId, key } = await toUploaded(sqlite, env);
    expect((await rpc(env, "commit-pointer", { job_id: jobId, claim_id: claimId, r2_key: key })).json.status).toBe("committed");
    sqlite.prepare("UPDATE scans SET op_lease_expires_at=1 WHERE id=?").run(scanId);
    expect((await rpc(env, "commit-pointer", { job_id: jobId, claim_id: claimId, r2_key: key })).json.status).toBe("already_committed");
    expect(arts(sqlite, scanId).filter((a) => a.status === "active")).toHaveLength(1);
  });

  it("expired lease on an existing uploaded job → preserved_for_retry (NOT compensation); a later claim commits it", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const { scanId, jobId, claimId, key } = await toUploaded(sqlite, env);
    sqlite.prepare("UPDATE scans SET op_lease_expires_at=1 WHERE id=?").run(scanId);
    const r = await rpc(env, "commit-pointer", { job_id: jobId, claim_id: claimId, r2_key: key });
    expect(r.json.status).toBe("preserved_for_retry");
    // later claim resumes uploaded (phase floor) and commits the SAME key
    const rc = (await rpc(env, "claim", { job_id: jobId })).json.job as Record<string, unknown>;
    expect(rc.phase).toBe("uploaded");
    const commit = await rpc(env, "commit-pointer", { job_id: jobId, claim_id: rc.claim_id as string, r2_key: key });
    expect(commit.json.status).toBe("committed");
    expect(scanRow(sqlite, scanId)!.pdf_r2_key).toBe(key);
  });

  it("missing-scan orphan → safe compensation_required, then confirm purges", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const { scanId, jobId, claimId, key } = await toUploaded(sqlite, env);
    sqlite.prepare("DELETE FROM scans WHERE id=?").run(scanId);
    const r = await rpc(env, "commit-pointer", { job_id: jobId, claim_id: claimId, r2_key: key });
    expect(r.json.status).toBe("compensation_required");
    const conf = await rpc(env, "confirm-compensation", { job_id: jobId, r2_key: key });
    expect(conf.json.status).toBe("confirmed");
    expect(arts(sqlite, scanId).find((a) => a.r2_key === key)!.status).toBe("purged");
  });

  it("confirm-compensation refuses a now-referenced key", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const sId = uuid(), jId = uuid();
    const key = "score-reports/" + sId + "/hh/1.pdf";
    seedScan(sqlite, { id: sId, email: "a@b.com", pdf_r2_key: key });
    insertJob(sqlite, { job_id: jId, scan_id: sId, phase: "uploaded", email: "a@b.com", pdf_r2_key: key });
    insertArtifact(sqlite, { r2_key: key, scan_id: sId, job_id: jId, status: "pending" });
    const r = await rpc(env, "confirm-compensation", { job_id: jId, r2_key: key });
    expect(r.json.status).toBe("refused");
    expect(arts(sqlite, sId).find((a) => a.r2_key === key)!.status).toBe("pending"); // not purged
  });
});

describe("E1 snapshot contract", () => {
  async function ready(sqlite: DatabaseSync, env: Env) {
    const c = await toUploaded(sqlite, env);
    await rpc(env, "commit-pointer", { job_id: c.jobId, claim_id: c.claimId, r2_key: c.key });
    return c;
  }
  it("stores exact bytes; replay verbatim, no overwrite / re-anchor", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const { jobId, claimId } = await ready(sqlite, env);
    const A = validSnap({ subject: "AAA" }); const B = validSnap({ subject: "BBB" });
    expect((await rpc(env, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: A })).json.status).toBe("frozen");
    const anchor = job(sqlite, jobId).updated_at; const stored = job(sqlite, jobId).delivery_snapshot;
    const f2 = await rpc(env, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: B });
    expect(f2.json.status).toBe("already_frozen");
    expect(JSON.parse(f2.json.snapshot as string)).toEqual(A);
    expect(job(sqlite, jobId).delivery_snapshot).toBe(stored);
    expect(job(sqlite, jobId).updated_at).toBe(anchor);
  });

  it("rejects extra fields, non-string headers, and UTF-8 byte overflow", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const { jobId, claimId } = await ready(sqlite, env);
    const extra = { ...validSnap(), extra: "x" };
    expect((await rpc(env, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: extra })).status).toBe(400);
    const badHeaders = validSnap({ headers: { X: 5 } });
    expect((await rpc(env, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: badHeaders })).status).toBe(400);
    const nestedHeaders = validSnap({ headers: { X: { nested: "y" } } });
    expect((await rpc(env, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: nestedHeaders })).status).toBe(400);
    // "€" = 3 UTF-8 bytes, 1 char: 90000 chars ≈ 270KB bytes > 256KB, char-count < 256KB.
    const overflow = validSnap({ html: "€".repeat(90_000) });
    expect((await rpc(env, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: overflow })).status).toBe(400);
  });

  it("rejects a wrong claim and an expired lease at freeze time", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const { scanId, jobId, claimId } = await ready(sqlite, env);
    expect((await rpc(env, "freeze-snapshot", { job_id: jobId, claim_id: uuid(), snapshot: validSnap() })).status).toBe(422);
    sqlite.prepare("UPDATE scans SET op_lease_expires_at=1 WHERE id=?").run(scanId);
    expect((await rpc(env, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: validSnap() })).json.status).toBe("error");
  });
});

describe("E1 defer", () => {
  it("preserves phase + anchor, clears claim, releases lease, no attempt increment", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const { scanId, jobId, claimId } = await seedAndClaim(sqlite, env);
    const before = job(sqlite, jobId);
    const r = await rpc(env, "defer", { job_id: jobId, claim_id: claimId, next_attempt_at: Date.now() + 3_600_000 });
    expect(r.json.status).toBe("deferred");
    const after = job(sqlite, jobId);
    expect([after.phase, after.updated_at, after.claim_id, after.attempts, after.queue_state])
      .toEqual(["rendering", before.updated_at, null, before.attempts, "active"]);
    expect(scanRow(sqlite, scanId)!.op_lease_id).toBeNull();
  });
  it("rejects an out-of-bounds next_attempt_at", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const { jobId, claimId } = await seedAndClaim(sqlite, env);
    expect((await rpc(env, "defer", { job_id: jobId, claim_id: claimId, next_attempt_at: -1 })).status).toBe(422);
  });
});

describe("E1 security + validation", () => {
  it("unauthorized → 401, zero mutation", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const sId = uuid(), jId = uuid();
    seedScan(sqlite, { id: sId, email: "a@b.com" });
    insertJob(sqlite, { job_id: jId, scan_id: sId, phase: "pending", email: "a@b.com" });
    expect((await rpc(env, "claim", { job_id: jId }, { key: null })).status).toBe(401);
    expect((await rpc(env, "claim", { job_id: jId }, { key: "wrong" })).status).toBe(401);
    expect(scanRow(sqlite, sId)!.op_lease_id).toBeNull();
  });
  it("malformed ids / payload → 400", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    expect((await rpc(env, "claim", { job_id: "nope" })).status).toBe(400);
    const { jobId, claimId } = await seedAndClaim(sqlite, env);
    expect((await rpc(env, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: { from: "a" } })).status).toBe(400);
  });
  it("failure logs carry a fixed class only — no identifiers", async () => {
    const throwingDb = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("boom victim@example.com"); }, run: async () => ({}), all: async () => ({ results: [] }) }) }), batch: async () => { throw new Error("x"); } };
    const env = { DB: throwingDb, CAPTURE_CONSUMER_KEY: KEY } as unknown as Env;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const jobId = uuid();
    expect((await rpc(env, "claim", { job_id: jobId })).status).toBe(500);
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("class=db_error");
    expect(logged).not.toContain(jobId);
    expect(logged).not.toContain("victim@example.com");
    spy.mockRestore();
  });
});

describe("E1 final corrections", () => {
  it("contention never shortens a daily-cap deferral; no lease is acquired", async () => {
    const sqlite = freshSqlite();
    const sId = uuid(), jId = uuid();
    const daily = Date.now() + 20 * 3_600_000; // far-future daily-cap deferral
    const otherLeaseExp = Date.now() + 600_000; // other lease expires sooner
    seedScan(sqlite, { id: sId, email: "a@b.com", op_lease_id: "other", op_lease_expires_at: otherLeaseExp });
    insertJob(sqlite, { job_id: jId, scan_id: sId, phase: "pending", email: "a@b.com", next_attempt_at: 0 });
    // A concurrent daily-cap deferral lands right before the MAX contention update.
    const env = makeEnv(sqlite, [], {
      beforeRun: (sql) => { if (sql.includes("MAX(next_attempt_at")) sqlite.prepare("UPDATE capture_jobs SET next_attempt_at=? WHERE job_id=?").run(daily, jId); },
    });
    const r = await rpc(env, "claim", { job_id: jId });
    expect(r.json.status).toBe("deferred");
    expect(r.json.next_attempt_at).toBe(daily); // daily survived, not shortened to contention time
    expect(scanRow(sqlite, sId)!.op_lease_id).toBe("other"); // no lease acquired
  });

  it("a lost scheduling race on the claim UPDATE releases the lease and returns the persisted deferral", async () => {
    const sqlite = freshSqlite();
    const sId = uuid(), jId = uuid();
    const daily = Date.now() + 20 * 3_600_000;
    seedScan(sqlite, { id: sId, email: "a@b.com" });
    insertJob(sqlite, { job_id: jId, scan_id: sId, phase: "pending", email: "a@b.com", next_attempt_at: 0 });
    // job becomes deferred right when the claim UPDATE runs → 0 rows.
    const env = makeEnv(sqlite, [], {
      beforeRun: (sql) => { if (sql.includes("SET claim_id=?")) sqlite.prepare("UPDATE capture_jobs SET next_attempt_at=? WHERE job_id=?").run(daily, jId); },
    });
    const r = await rpc(env, "claim", { job_id: jId });
    expect(r.json.status).toBe("deferred");
    expect(r.json.next_attempt_at).toBe(daily);
    expect(scanRow(sqlite, sId)!.op_lease_id).toBeNull(); // acquired lease released
  });

  it("send-only uploaded job: claim (no rewind, resume pointer) → already-committed → freeze succeeds", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    // Job A: full flow → committed pointer + active artifact owned by A, then done.
    const A = await toUploaded(sqlite, env);
    await rpc(env, "commit-pointer", { job_id: A.jobId, claim_id: A.claimId, r2_key: A.key });
    await rpc(env, "freeze-snapshot", { job_id: A.jobId, claim_id: A.claimId, snapshot: validSnap() });
    await rpc(env, "complete", { job_id: A.jobId, claim_id: A.claimId }); // lease released, A done

    // Send-only job B on the same scan, pointing at A's committed key (no register/render).
    const bJob = uuid();
    insertJob(sqlite, { job_id: bJob, scan_id: A.scanId, phase: "uploaded", email: "alice@example.com", pdf_r2_key: A.key });
    const claimResp = await rpc(env, "claim", { job_id: bJob });
    const cb = claimResp.json.job as Record<string, unknown>;
    expect(cb.phase).toBe("uploaded"); // no rewind
    expect(cb.pdf_r2_key).toBe(A.key);
    expect((claimResp.json.scan as Record<string, unknown>).pdf_r2_key).toBe(A.key); // resume pointer present

    const commit = await rpc(env, "commit-pointer", { job_id: bJob, claim_id: cb.claim_id as string, r2_key: A.key });
    expect(commit.json.status).toBe("already_committed"); // prior job's active artifact accepted
    const froze = await rpc(env, "freeze-snapshot", { job_id: bJob, claim_id: cb.claim_id as string, snapshot: validSnap() });
    expect(froze.json.status).toBe("frozen");
  });

  it("confirm-compensation refuses an EXISTING scan with a different pointer", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const sId = uuid(), jId = uuid();
    const key = "score-reports/" + sId + "/hh/1.pdf";
    seedScan(sqlite, { id: sId, email: "a@b.com", pdf_r2_key: "score-reports/" + sId + "/other/9.pdf" });
    insertJob(sqlite, { job_id: jId, scan_id: sId, phase: "uploaded", email: "a@b.com", pdf_r2_key: key });
    insertArtifact(sqlite, { r2_key: key, scan_id: sId, job_id: jId, status: "pending" });
    const r = await rpc(env, "confirm-compensation", { job_id: jId, r2_key: key });
    expect(r.json.status).toBe("refused");
    expect(arts(sqlite, sId).find((a) => a.r2_key === key)!.status).toBe("pending"); // not purged
  });

  it("complete: a zero-row lease release does NOT report done", async () => {
    const sqlite = freshSqlite();
    const { scanId, jobId, claimId, key } = await toUploaded(sqlite, makeEnv(sqlite));
    const e = makeEnv(sqlite);
    await rpc(e, "commit-pointer", { job_id: jobId, claim_id: claimId, r2_key: key });
    await rpc(e, "freeze-snapshot", { job_id: jobId, claim_id: claimId, snapshot: validSnap() });
    const env = makeEnv(sqlite, [], { beforeStmt: (sql) => { if (sql.includes("op_owner=NULL")) sqlite.prepare("UPDATE scans SET op_lease_id='x' WHERE id=?").run(scanId); } });
    const r = await rpc(env, "complete", { job_id: jobId, claim_id: claimId });
    expect(r.json.status).toBe("error");
    expect(r.json.status).not.toBe("done");
  });

  it("defer: a zero-row lease release does NOT report deferred", async () => {
    const sqlite = freshSqlite();
    const { scanId, jobId, claimId } = await seedAndClaim(sqlite, makeEnv(sqlite));
    const env = makeEnv(sqlite, [], { beforeStmt: (sql) => { if (sql.includes("op_owner=NULL")) sqlite.prepare("UPDATE scans SET op_lease_id='x' WHERE id=?").run(scanId); } });
    const r = await rpc(env, "defer", { job_id: jobId, claim_id: claimId, next_attempt_at: Date.now() + 3_600_000 });
    expect(r.json.status).toBe("error");
    expect(r.json.status).not.toBe("deferred");
  });
});

describe("E2 disposition RPCs", () => {
  it("mark-ambiguous: flips ONLY queue_state, preserves phase + anchor, releases the lease", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const sId = uuid(), jId = uuid(); const anchor = 1_700_000_000_000;
    seedScan(sqlite, { id: sId, email: "a@b.com" });
    insertJob(sqlite, { job_id: jId, scan_id: sId, phase: "email_sending", email: "a@b.com", delivery_snapshot: "{}", updated_at: anchor });
    const cj = (await rpc(env, "claim", { job_id: jId })).json.job as Record<string, unknown>;
    expect(job(sqlite, jId).updated_at).toBe(anchor); // claim preserved the anchor
    const r = await rpc(env, "mark-ambiguous", { job_id: jId, claim_id: cj.claim_id as string });
    expect(r.json.status).toBe("ambiguous");
    const j = job(sqlite, jId);
    expect(j.queue_state).toBe("email_ambiguous");
    expect(j.phase).toBe("email_sending"); // preserved
    expect(j.updated_at).toBe(anchor); // anchor preserved
    expect(j.claim_id).toBeNull();
    expect(scanRow(sqlite, sId)!.op_lease_id).toBeNull(); // released
  });

  it("mark-dead-letter: sets dead_letter, preserves phase/anchor, clears claim, releases the lease", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const sId = uuid(), jId = uuid(); const anchor = 1_700_000_000_000;
    seedScan(sqlite, { id: sId, email: "a@b.com" });
    insertJob(sqlite, { job_id: jId, scan_id: sId, phase: "email_sending", email: "a@b.com", delivery_snapshot: "{}", updated_at: anchor });
    await rpc(env, "claim", { job_id: jId }); // acquire a held lease
    const r = await rpc(env, "mark-dead-letter", { job_id: jId });
    expect(r.json.status).toBe("dead_lettered");
    const j = job(sqlite, jId);
    expect(j.queue_state).toBe("dead_letter");
    expect(j.phase).toBe("email_sending"); // preserved
    expect(j.updated_at).toBe(anchor); // anchor preserved
    expect(j.claim_id).toBeNull();
    expect(scanRow(sqlite, sId)!.op_lease_id).toBeNull(); // released
  });

  it("mark-dead-letter is a no-op on a terminal job", async () => {
    const sqlite = freshSqlite(); const env = makeEnv(sqlite);
    const sId = uuid(), jId = uuid();
    seedScan(sqlite, { id: sId, email: "a@b.com" });
    insertJob(sqlite, { job_id: jId, scan_id: sId, phase: "done", email: "a@b.com" });
    const r = await rpc(env, "mark-dead-letter", { job_id: jId });
    expect(r.json.status).toBe("noop");
    expect(job(sqlite, jId).queue_state).toBe("active");
  });
});
