// P0-C2 Chunk B — schema invariants for the capture-outbox / versioned-artifact
// / retention foundation (migration 0003), verified against a REAL SQLite engine
// (node:sqlite, Node 24) using the base schema + the full migration chain. Proves
// the DB-enforced invariants the v2.9 design leans on (CHECK domains, defaults,
// partial unique indexes, NOT NULL, and SQLite's zero-row-success semantics that
// the fenced conditional writes depend on). Migration is UNAPPLIED — this only
// exercises it in-memory.
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(read("../schema.sql"));
  db.exec(read("../migrations/0001_email_capture_columns.sql"));
  db.exec(read("../migrations/0002_tier_column.sql"));
  db.exec(read("../migrations/0003_p0c2_capture_retention.sql"));
  return db;
}

// ── minimal inserters (only the NOT-NULL / relevant columns) ──────────────────
function insertScan(
  db: DatabaseSync,
  o: {
    id: string;
    op_owner?: string | null;
    op_lease_id?: string | null;
    op_lease_expires_at?: number | null;
    op_fence?: number;
    retention_locked_at?: number | null;
  },
): void {
  // Build a column list so DEFAULTs apply when a field is omitted.
  const cols = ["id", "url", "dimensions_scored", "dimensions_total", "results_json", "created_at"];
  const vals: unknown[] = [o.id, "https://x", 6, 6, "{}", 1];
  const push = (c: string, v: unknown) => {
    cols.push(c);
    vals.push(v);
  };
  if (o.op_owner !== undefined) push("op_owner", o.op_owner);
  if (o.op_lease_id !== undefined) push("op_lease_id", o.op_lease_id);
  if (o.op_lease_expires_at !== undefined) push("op_lease_expires_at", o.op_lease_expires_at);
  if (o.op_fence !== undefined) push("op_fence", o.op_fence);
  if (o.retention_locked_at !== undefined) push("retention_locked_at", o.retention_locked_at);
  const ph = cols.map(() => "?").join(", ");
  db.prepare(`INSERT INTO scans (${cols.join(", ")}) VALUES (${ph})`).run(...(vals as never[]));
}

function insertArtifact(
  db: DatabaseSync,
  o: { r2_key: string; scan_id: string; capture_job_id?: string | null; op_fence?: number; status: string },
): void {
  db.prepare(
    `INSERT INTO r2_artifacts (r2_key, scan_id, capture_job_id, op_fence, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(o.r2_key, o.scan_id, o.capture_job_id ?? "job-x", o.op_fence ?? 1, 100, o.status);
}

function insertRetentionJob(
  db: DatabaseSync,
  o: { scan_id: string; job_id?: string; status: string },
): void {
  db.prepare(
    `INSERT INTO retention_jobs (scan_id, job_id, status, enqueued_at) VALUES (?, ?, ?, ?)`,
  ).run(o.scan_id, o.job_id ?? "rjob", o.status, 100);
}

function insertCaptureJob(
  db: DatabaseSync,
  o: { job_id: string; scan_id: string; phase: string; queue_state?: string },
): void {
  const cols = ["job_id", "scan_id", "phase", "created_at", "updated_at"];
  const vals: unknown[] = [o.job_id, o.scan_id, o.phase, 100, 100];
  if (o.queue_state !== undefined) {
    cols.push("queue_state");
    vals.push(o.queue_state);
  }
  const ph = cols.map(() => "?").join(", ");
  db.prepare(`INSERT INTO capture_jobs (${cols.join(", ")}) VALUES (${ph})`).run(...(vals as never[]));
}

describe("P0-C2 Chunk B — migration 0003 applies + tables exist", () => {
  it("the full base+0001+0002+0003 chain applies to a fresh database", () => {
    const db = freshDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["scans", "r2_artifacts", "retention_jobs", "capture_jobs"]));
  });
});

describe("CHECK domains — reject invalid, accept documented values", () => {
  it("scans.op_owner: accepts the 5 owners + NULL, rejects others", () => {
    const db = freshDb();
    for (const [i, v] of ["capture", "optin", "privacy_delete", "retention", "reconcile"].entries()) {
      expect(() => insertScan(db, { id: `o${i}`, op_owner: v })).not.toThrow();
    }
    expect(() => insertScan(db, { id: "onull", op_owner: null })).not.toThrow();
    expect(() => insertScan(db, { id: "obad", op_owner: "bogus" })).toThrow();
  });

  it("r2_artifacts.status: accepts pending/active/superseded/purged, rejects others", () => {
    const db = freshDb();
    for (const [i, v] of ["pending", "active", "superseded", "purged"].entries()) {
      // distinct scan per active row so the partial unique index doesn't interfere
      expect(() => insertArtifact(db, { r2_key: `k${i}`, scan_id: `s${i}`, status: v })).not.toThrow();
    }
    expect(() => insertArtifact(db, { r2_key: "kbad", scan_id: "sbad", status: "bogus" })).toThrow();
  });

  it("retention_jobs.status: accepts the 6 documented states, rejects others", () => {
    const db = freshDb();
    for (const [i, v] of ["pending", "claimed", "r2_purged", "done", "dead_letter", "cancelled"].entries()) {
      expect(() => insertRetentionJob(db, { scan_id: `rs${i}`, status: v })).not.toThrow();
    }
    expect(() => insertRetentionJob(db, { scan_id: "rsbad", status: "bogus" })).toThrow();
  });

  it("capture_jobs.phase: accepts the 6 WORK phases, rejects dead_letter/email_ambiguous/bogus (those are queue_state)", () => {
    const db = freshDb();
    for (const [i, v] of ["pending", "rendering", "uploaded", "email_sending", "done", "cancelled"].entries()) {
      expect(() => insertCaptureJob(db, { job_id: `p${i}`, scan_id: `ps${i}`, phase: v })).not.toThrow();
    }
    expect(() => insertCaptureJob(db, { job_id: "pdl", scan_id: "psdl", phase: "dead_letter" })).toThrow();
    expect(() => insertCaptureJob(db, { job_id: "pea", scan_id: "psea", phase: "email_ambiguous" })).toThrow();
    expect(() => insertCaptureJob(db, { job_id: "pb", scan_id: "psb", phase: "bogus" })).toThrow();
  });

  it("capture_jobs.queue_state: accepts active/dead_letter/email_ambiguous, rejects others", () => {
    const db = freshDb();
    for (const [i, v] of ["active", "dead_letter", "email_ambiguous"].entries()) {
      expect(() =>
        insertCaptureJob(db, { job_id: `q${i}`, scan_id: `qs${i}`, phase: "rendering", queue_state: v }),
      ).not.toThrow();
    }
    expect(() =>
      insertCaptureJob(db, { job_id: "qb", scan_id: "qsb", phase: "rendering", queue_state: "bogus" }),
    ).toThrow();
  });
});

describe("Defaults", () => {
  it("scans.op_fence defaults to 0", () => {
    const db = freshDb();
    insertScan(db, { id: "d" });
    const r = db.prepare("SELECT op_fence FROM scans WHERE id='d'").get() as { op_fence: number };
    expect(r.op_fence).toBe(0);
  });

  it("capture_jobs: queue_state='active', attempts=0, next_attempt_at=0 by default", () => {
    const db = freshDb();
    insertCaptureJob(db, { job_id: "j", scan_id: "js", phase: "pending" });
    const r = db
      .prepare("SELECT queue_state, attempts, next_attempt_at FROM capture_jobs WHERE job_id='j'")
      .get() as { queue_state: string; attempts: number; next_attempt_at: number };
    expect(r).toEqual({ queue_state: "active", attempts: 0, next_attempt_at: 0 });
  });

  it("retention_jobs: attempts=0, next_attempt_at=0 by default", () => {
    const db = freshDb();
    insertRetentionJob(db, { scan_id: "rd", status: "pending" });
    const r = db
      .prepare("SELECT attempts, next_attempt_at FROM retention_jobs WHERE scan_id='rd'")
      .get() as { attempts: number; next_attempt_at: number };
    expect(r).toEqual({ attempts: 0, next_attempt_at: 0 });
  });
});

describe("r2_artifacts.capture_job_id is NOT NULL", () => {
  it("rejects a NULL capture_job_id", () => {
    const db = freshDb();
    // Bind NULL directly (the helper's ?? default would mask it).
    expect(() =>
      db
        .prepare(
          `INSERT INTO r2_artifacts (r2_key, scan_id, capture_job_id, op_fence, created_at, status)
           VALUES ('kn', 'sn', ?, 1, 100, 'pending')`,
        )
        .run(null),
    ).toThrow();
  });
});

describe("idx_one_active_artifact — at most one active per scan", () => {
  it("permits many non-active artifacts but rejects a second active for the same scan", () => {
    const db = freshDb();
    insertArtifact(db, { r2_key: "a1", scan_id: "S", status: "pending" });
    insertArtifact(db, { r2_key: "a2", scan_id: "S", status: "superseded" });
    insertArtifact(db, { r2_key: "a3", scan_id: "S", status: "purged" });
    expect(() => insertArtifact(db, { r2_key: "a4", scan_id: "S", status: "active" })).not.toThrow();
    // second active on the SAME scan is rejected
    expect(() => insertArtifact(db, { r2_key: "a5", scan_id: "S", status: "active" })).toThrow();
    // a different scan may have its own active
    expect(() => insertArtifact(db, { r2_key: "b1", scan_id: "T", status: "active" })).not.toThrow();
  });
});

describe("idx_one_active_capture — one unfinished job per scan; excludes only done/cancelled", () => {
  it("blocks a second unfinished job even when the first is dead_letter (queue_state) at a non-terminal phase", () => {
    const db = freshDb();
    insertCaptureJob(db, { job_id: "j1", scan_id: "C", phase: "uploaded", queue_state: "dead_letter" });
    expect(() => insertCaptureJob(db, { job_id: "j2", scan_id: "C", phase: "pending" })).toThrow();
  });

  it("blocks a second unfinished job when the first is email_ambiguous", () => {
    const db = freshDb();
    insertCaptureJob(db, { job_id: "e1", scan_id: "D", phase: "email_sending", queue_state: "email_ambiguous" });
    expect(() => insertCaptureJob(db, { job_id: "e2", scan_id: "D", phase: "pending" })).toThrow();
  });

  it("permits a new unfinished job after the first terminates (done or cancelled)", () => {
    const db = freshDb();
    insertCaptureJob(db, { job_id: "d1", scan_id: "E", phase: "done" });
    expect(() => insertCaptureJob(db, { job_id: "d2", scan_id: "E", phase: "pending" })).not.toThrow();

    insertCaptureJob(db, { job_id: "c1", scan_id: "F", phase: "cancelled" });
    expect(() => insertCaptureJob(db, { job_id: "c2", scan_id: "F", phase: "pending" })).not.toThrow();
  });
});

describe("Named partial + supporting indexes exist with the intended columns/predicates", () => {
  const indexSql = (db: DatabaseSync, name: string): string => {
    const r = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as
      | { sql: string | null }
      | undefined;
    return r?.sql ?? "";
  };

  it("idx_one_active_artifact is a partial unique index on (scan_id) WHERE status='active'", () => {
    const db = freshDb();
    const sql = indexSql(db, "idx_one_active_artifact");
    expect(sql).toContain("UNIQUE");
    expect(sql).toContain("(scan_id)");
    expect(sql).toContain("WHERE status='active'");
  });

  it("idx_one_active_capture is a partial unique index excluding only done/cancelled", () => {
    const db = freshDb();
    const sql = indexSql(db, "idx_one_active_capture");
    expect(sql).toContain("UNIQUE");
    expect(sql).toContain("(scan_id)");
    expect(sql).toContain("WHERE phase NOT IN ('done','cancelled')");
  });

  it("supporting claimable/watchdog/GC indexes exist with intended columns", () => {
    const db = freshDb();
    expect(indexSql(db, "idx_capture_claimable")).toContain("(queue_state, next_attempt_at)");
    expect(indexSql(db, "idx_capture_watchdog")).toContain("(phase, updated_at)");
    expect(indexSql(db, "idx_retention_claimable")).toContain("(status, next_attempt_at)");
    expect(indexSql(db, "idx_r2_artifacts_scan")).toContain("(scan_id)");
    expect(indexSql(db, "idx_r2_artifacts_gc")).toContain("(status, created_at)");
  });
});

describe("Zero-row-success is NOT an exception (the hazard the fenced writes rely on)", () => {
  it("a zero-row fenced UPDATE inside a transaction does not abort later statements", () => {
    const db = freshDb();
    insertScan(db, { id: "Z", op_fence: 3 });
    db.exec("BEGIN");
    // wrong fence → zero rows, but NOT an error
    const upd = db.prepare("UPDATE scans SET op_owner='capture' WHERE id='Z' AND op_fence=?").run(999);
    expect(upd.changes).toBe(0);
    // a subsequent statement in the SAME transaction still commits
    const ins = db
      .prepare("INSERT INTO retention_jobs (scan_id, job_id, status, enqueued_at) VALUES ('Z','rj','pending',1)")
      .run();
    db.exec("COMMIT");
    expect(ins.changes).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM retention_jobs WHERE scan_id='Z'").get() as { n: number }).n,
    ).toBe(1);
  });

  it("the design's conditional INSERT ... SELECT ... WHERE EXISTS(fence) inserts zero jobs when the fence is absent, one when present", () => {
    const db = freshDb();
    insertScan(db, { id: "W", op_lease_id: "L", op_lease_expires_at: 10_000, op_fence: 5 });
    const now = 1;
    const condInsert =
      `INSERT INTO capture_jobs (job_id, scan_id, email, phase, pdf_r2_key, created_at, updated_at)
       SELECT ?, ?, ?, 'pending', NULL, ?, ?
       WHERE EXISTS (SELECT 1 FROM scans WHERE id=? AND op_lease_id=? AND op_fence=? AND op_lease_expires_at>=? AND retention_locked_at IS NULL)`;

    // WRONG fence (6 ≠ 5) → zero rows inserted, no throw
    const miss = db.prepare(condInsert).run("jmiss", "W", "e@x", now, now, "W", "L", 6, now);
    expect(miss.changes).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM capture_jobs WHERE scan_id='W'").get() as { n: number }).n).toBe(0);

    // CORRECT fence + matching lease → exactly one inserted
    const hit = db.prepare(condInsert).run("jhit", "W", "e@x", now, now, "W", "L", 5, now);
    expect(hit.changes).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM capture_jobs WHERE scan_id='W'").get() as { n: number }).n).toBe(1);
  });
});
