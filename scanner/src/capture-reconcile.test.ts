// P0-C2 Chunk F1 — reconciliation state-machine proofs over the real migration
// chain (node:sqlite) with a mock marketing-R2 Service Binding.
import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { runReconcile } from "./capture-reconcile";
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
function makeD1(sqlite: DatabaseSync, hooks: { beforeRun?: (sql: string) => void } = {}) {
  const prepare = (sql: string) => {
    const stmt = {
      _b: [] as unknown[],
      bind(...a: unknown[]) { stmt._b = a; return stmt; },
      async run() { hooks.beforeRun?.(sql); const i = sqlite.prepare(sql).run(...(stmt._b as never[])); return { success: true, meta: { changes: Number(i.changes) }, results: [] }; },
      async first<T = unknown>() { hooks.beforeRun?.(sql); return (sqlite.prepare(sql).get(...(stmt._b as never[])) ?? null) as T | null; },
      async all<T = unknown>() { hooks.beforeRun?.(sql); return { success: true, results: sqlite.prepare(sql).all(...(stmt._b as never[])) as T[] }; },
    };
    return stmt;
  };
  return { prepare };
}

const KEY = "rk-secret";
function makeR2(opts: { failDelete?: boolean; abortDelete?: boolean } = {}) {
  const deleted: string[] = [];
  const fetcher = {
    fetch: async (req: Request) => {
      const op = new URL(req.url).pathname.split("/").pop();
      const body = (await req.json()) as { key?: string; prefix?: string };
      if (op === "delete") {
        // Wait for request.signal to abort (the client's timeout), then reject.
        if (opts.abortDelete) return new Promise<Response>((_, reject) => { req.signal?.addEventListener("abort", () => reject(new Error("aborted"))); });
        if (opts.failDelete) return new Response(JSON.stringify({ ok: false, status: "error" }), { status: 500 });
        deleted.push(body.key as string);
        return new Response(JSON.stringify({ ok: true, status: "deleted" }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    },
  } as unknown as Fetcher;
  return { fetcher, deleted };
}
function makeEnv(sqlite: DatabaseSync, r2: Fetcher, hooks: { beforeRun?: (sql: string) => void } = {}): Env {
  return { DB: makeD1(sqlite, hooks), MARKETING_R2: r2, RECONCILE_R2_KEY: KEY } as unknown as Env;
}

const uuid = () => crypto.randomUUID();
function seedScan(sqlite: DatabaseSync, o: { id: string; pdf_r2_key?: string | null; op_lease_id?: string | null; op_lease_expires_at?: number | null }) {
  const cols = ["id", "url", "dimensions_scored", "dimensions_total", "results_json", "created_at"];
  const vals: unknown[] = [o.id, "https://x", 6, 6, "{}", 1];
  const push = (c: string, v: unknown) => { cols.push(c); vals.push(v); };
  if (o.pdf_r2_key !== undefined) push("pdf_r2_key", o.pdf_r2_key);
  if (o.op_lease_id !== undefined) push("op_lease_id", o.op_lease_id);
  if (o.op_lease_expires_at !== undefined) push("op_lease_expires_at", o.op_lease_expires_at);
  sqlite.prepare(`INSERT INTO scans (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...(vals as never[]));
}
function insertArtifact(sqlite: DatabaseSync, o: { r2_key: string; scan_id: string; status: string; created_at?: number; job?: string }) {
  sqlite.prepare("INSERT INTO r2_artifacts (r2_key, scan_id, capture_job_id, op_fence, created_at, status) VALUES (?,?,?,?,?,?)")
    .run(o.r2_key, o.scan_id, o.job ?? "job-x", 1, o.created_at ?? 1, o.status);
}
const art = (s: DatabaseSync, key: string) => s.prepare("SELECT * FROM r2_artifacts WHERE r2_key=?").get(key) as Record<string, unknown> | undefined;
const activeCount = (s: DatabaseSync, scanId: string) => (s.prepare("SELECT COUNT(*) AS n FROM r2_artifacts WHERE scan_id=? AND status='active'").get(scanId) as { n: number }).n;
const scanRow = (s: DatabaseSync, id: string) => s.prepare("SELECT * FROM scans WHERE id=?").get(id) as Record<string, unknown>;

const NOW = 10_000_000_000;
const STALE = NOW - 21 * 60 * 1000; // older than the 20-min consumer lease bound
const key = (scan: string, n: number) => `score-reports/${scan}/0123456789abcdef/${n}.pdf`;
// Default: sweep timestamp AND lease clock both = NOW (so seeded lease expiries are meaningful).
const RUN = (env: Env, extra: { now?: number; limit?: number; deleteBudget?: number; clock?: () => number } = {}) =>
  runReconcile(env, { now: NOW, clock: () => NOW, ...extra });

describe("F1 reconciliation — existing scan", () => {
  it("stale A vs newer pointer B: A purged (R2 + D1), B preserved active", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2(); const env = makeEnv(sqlite, r2.fetcher);
    const s = uuid(); const kA = key(s, 1), kB = key(s, 2);
    seedScan(sqlite, { id: s, pdf_r2_key: kB });
    insertArtifact(sqlite, { r2_key: kB, scan_id: s, status: "active" });
    insertArtifact(sqlite, { r2_key: kA, scan_id: s, status: "superseded" });
    const r = await RUN(env);
    expect(r.purged).toBe(1);
    expect(r2.deleted).toEqual([kA]); // only A physically deleted
    expect(art(sqlite, kA)!.status).toBe("purged");
    expect(art(sqlite, kB)!.status).toBe("active"); // pointer preserved
    expect(scanRow(sqlite, s).op_lease_id).toBeNull(); // lease released
  });

  it("pointer-matching PENDING artifact becomes active; ≤1 active", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2(); const env = makeEnv(sqlite, r2.fetcher);
    const s = uuid(); const kP = key(s, 3), kR = key(s, 4);
    seedScan(sqlite, { id: s, pdf_r2_key: kP });
    insertArtifact(sqlite, { r2_key: kP, scan_id: s, status: "pending", created_at: STALE });
    insertArtifact(sqlite, { r2_key: kR, scan_id: s, status: "superseded" });
    await RUN(env);
    expect(art(sqlite, kP)!.status).toBe("active"); // activated
    expect(activeCount(sqlite, s)).toBe(1);
    expect(art(sqlite, kR)!.status).toBe("purged");
    expect(r2.deleted).toEqual([kR]); // pointer never deleted
  });

  it("fresh pending is untouched; a live-lease scan is skipped", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2(); const env = makeEnv(sqlite, r2.fetcher);
    // fresh pending (created NOW) alongside a superseded → superseded purged, fresh kept
    const s1 = uuid(); const kFresh = key(s1, 1), kSup = key(s1, 2);
    seedScan(sqlite, { id: s1, pdf_r2_key: null });
    insertArtifact(sqlite, { r2_key: kFresh, scan_id: s1, status: "pending", created_at: NOW });
    insertArtifact(sqlite, { r2_key: kSup, scan_id: s1, status: "superseded" });
    // live-lease scan → skip entirely
    const s2 = uuid(); const kL = key(s2, 1);
    seedScan(sqlite, { id: s2, pdf_r2_key: null, op_lease_id: "holder", op_lease_expires_at: NOW + 600_000 });
    insertArtifact(sqlite, { r2_key: kL, scan_id: s2, status: "superseded" });

    const r = await RUN(env);
    expect(art(sqlite, kFresh)!.status).toBe("pending"); // fresh untouched
    expect(art(sqlite, kSup)!.status).toBe("purged");
    expect(art(sqlite, kL)!.status).toBe("superseded"); // live-lease scan skipped
    expect(r.skipped).toBe(1);
    expect(r2.deleted).toContain(kSup);
    expect(r2.deleted).not.toContain(kL);
  });

  it("legacy null-pointer fallback preserved (only registry keys deleted)", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2(); const env = makeEnv(sqlite, r2.fetcher);
    const s = uuid(); const kSup = key(s, 9);
    const legacy = `score-reports/${s}/deadbeefdeadbeef.pdf`; // out-of-registry legacy object
    seedScan(sqlite, { id: s, pdf_r2_key: null });
    insertArtifact(sqlite, { r2_key: kSup, scan_id: s, status: "superseded" });
    await RUN(env);
    expect(r2.deleted).toEqual([kSup]); // legacy object never deleted
    expect(r2.deleted).not.toContain(legacy);
  });
});

describe("F1 reconciliation — missing scan + safety", () => {
  it("missing-scan objects purged without a lease attempt", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2(); const env = makeEnv(sqlite, r2.fetcher);
    const ghost = uuid(); const k1 = key(ghost, 1), k2 = key(ghost, 2);
    insertArtifact(sqlite, { r2_key: k1, scan_id: ghost, status: "active" });
    insertArtifact(sqlite, { r2_key: k2, scan_id: ghost, status: "superseded" });
    const r = await RUN(env);
    expect(r.purged).toBe(2);
    expect(art(sqlite, k1)!.status).toBe("purged");
    expect(art(sqlite, k2)!.status).toBe("purged");
    expect(r2.deleted.sort()).toEqual([k1, k2].sort());
  });

  it("R2 delete failure NEVER marks D1 purged", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2({ failDelete: true }); const env = makeEnv(sqlite, r2.fetcher);
    const s = uuid(); const kSup = key(s, 1);
    seedScan(sqlite, { id: s, pdf_r2_key: null });
    insertArtifact(sqlite, { r2_key: kSup, scan_id: s, status: "superseded" });
    await expect(RUN(env)).rejects.toBeTruthy();
    expect(art(sqlite, kSup)!.status).toBe("superseded"); // NOT purged
  });

  it("crash after R2 delete resumes idempotently on re-run", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2(); const env = makeEnv(sqlite, r2.fetcher);
    const s = uuid(); const kSup = key(s, 1);
    seedScan(sqlite, { id: s, pdf_r2_key: null });
    insertArtifact(sqlite, { r2_key: kSup, scan_id: s, status: "superseded" });
    await RUN(env);
    expect(art(sqlite, kSup)!.status).toBe("purged");
    // simulate a lost purge-mark (crash after R2 delete): reset to superseded, re-run
    sqlite.prepare("UPDATE r2_artifacts SET status='superseded' WHERE r2_key=?").run(kSup);
    await RUN(env, { now: NOW + 1000, clock: () => NOW + 1000 });
    expect(art(sqlite, kSup)!.status).toBe("purged"); // re-deleted (idempotent) + re-purged
    expect(r2.deleted.filter((k) => k === kSup)).toHaveLength(2);
  });

  it("bounded candidate processing (limit) + counts-only logs", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2(); const env = makeEnv(sqlite, r2.fetcher);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) { const s = uuid(); ids.push(s); seedScan(sqlite, { id: s, pdf_r2_key: null }); insertArtifact(sqlite, { r2_key: key(s, 1), scan_id: s, status: "superseded" }); }
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await RUN(env, { limit: 2 });
    expect(r.scans).toBe(2); // bounded
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("[capture-reconcile] scans=");
    for (const id of ids) expect(logged).not.toContain(id); // no scan ids
    expect(logged).not.toContain("score-reports/"); // no keys
    spy.mockRestore();
  });

  it("fails closed when the R2 binding/key is missing", async () => {
    const sqlite = freshSqlite();
    const env = { DB: makeD1(sqlite), MARKETING_R2: undefined, RECONCILE_R2_KEY: undefined } as unknown as Env;
    await expect(RUN(env)).rejects.toThrow("misconfigured");
  });
});

describe("F1 reconciliation — fencing races + bounds", () => {
  it("pointer replaced between existence read and lease acquisition: new pointer preserved", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2();
    const s = uuid(); const kA = key(s, 1), kB = key(s, 2), kC = key(s, 3);
    seedScan(sqlite, { id: s, pdf_r2_key: kA }); // initially points at A
    insertArtifact(sqlite, { r2_key: kA, scan_id: s, status: "active" });
    insertArtifact(sqlite, { r2_key: kC, scan_id: s, status: "superseded" });
    // A capture commits pointer B right before the reconcile lease acquire.
    let fired = false;
    const env = makeEnv(sqlite, r2.fetcher, {
      beforeRun: (sql) => {
        if (sql.includes("op_owner='reconcile'") && !fired) {
          fired = true;
          sqlite.prepare("UPDATE r2_artifacts SET status='superseded' WHERE r2_key=?").run(kA); // demote A first (≤1 active)
          sqlite.prepare("UPDATE scans SET pdf_r2_key=? WHERE id=?").run(kB, s);
          insertArtifact(sqlite, { r2_key: kB, scan_id: s, status: "active" });
        }
      },
    });
    await RUN(env);
    expect(art(sqlite, kB)!.status).toBe("active"); // new pointer preserved + active
    expect(r2.deleted).not.toContain(kB); // never deleted
    expect(r2.deleted.sort()).toEqual([kA, kC].sort()); // stale A + C purged
  });

  it("non-null pointer without a registry row: fail closed, touch nothing", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2(); const env = makeEnv(sqlite, r2.fetcher);
    const s = uuid(); const missingPtr = key(s, 7), kC = key(s, 8);
    seedScan(sqlite, { id: s, pdf_r2_key: missingPtr }); // pointer has NO registry row
    insertArtifact(sqlite, { r2_key: kC, scan_id: s, status: "superseded" });
    const r = await RUN(env);
    expect(r.skipped).toBe(1);
    expect(art(sqlite, kC)!.status).toBe("superseded"); // untouched
    expect(r2.deleted).toEqual([]); // nothing deleted
  });

  it("lease loss BEFORE the external delete: fail closed, no R2 delete", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2();
    const s = uuid(); const kSup = key(s, 1);
    seedScan(sqlite, { id: s, pdf_r2_key: null });
    insertArtifact(sqlite, { r2_key: kSup, scan_id: s, status: "superseded" });
    let fired = false;
    const env = makeEnv(sqlite, r2.fetcher, {
      beforeRun: (sql) => { if (sql.includes("FROM r2_artifacts a WHERE a.r2_key") && !fired) { fired = true; sqlite.prepare("UPDATE scans SET op_lease_id='gone' WHERE id=?").run(s); } },
    });
    await expect(RUN(env)).rejects.toBeTruthy();
    expect(r2.deleted).toEqual([]); // never deleted
    expect(art(sqlite, kSup)!.status).toBe("superseded"); // not purged
  });

  it("lease loss BEFORE the purge-mark (after R2 delete): throw, D1 not purged", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2();
    const s = uuid(); const kSup = key(s, 1);
    seedScan(sqlite, { id: s, pdf_r2_key: null });
    insertArtifact(sqlite, { r2_key: kSup, scan_id: s, status: "superseded" });
    let fired = false;
    const env = makeEnv(sqlite, r2.fetcher, {
      beforeRun: (sql) => { if (sql.includes("SET status='purged'") && !fired) { fired = true; sqlite.prepare("UPDATE scans SET op_lease_id='gone' WHERE id=?").run(s); } },
    });
    await expect(RUN(env)).rejects.toBeTruthy();
    expect(r2.deleted).toEqual([kSup]); // R2 delete happened
    expect(art(sqlite, kSup)!.status).toBe("superseded"); // purge-mark did NOT apply
  });

  it("one scan with many artifacts is bounded by the whole-pass artifact budget", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2(); const env = makeEnv(sqlite, r2.fetcher);
    const s = uuid();
    seedScan(sqlite, { id: s, pdf_r2_key: null });
    for (let i = 1; i <= 5; i++) insertArtifact(sqlite, { r2_key: key(s, i), scan_id: s, status: "superseded" });
    const r = await RUN(env, { deleteBudget: 2 });
    expect(r.purged).toBe(2); // budget-bounded
    expect(r2.deleted).toHaveLength(2);
  });

  it("rejects invalid limits/budgets (negative, zero, oversized) — never unbounded", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2(); const env = makeEnv(sqlite, r2.fetcher);
    await expect(runReconcile(env, { now: NOW, limit: -1 })).rejects.toThrow(/bad_limit/);
    await expect(runReconcile(env, { now: NOW, limit: 0 })).rejects.toThrow(/bad_limit/);
    await expect(runReconcile(env, { now: NOW, limit: 10_000_001 })).rejects.toThrow(/bad_limit/);
    await expect(runReconcile(env, { now: NOW, deleteBudget: -1 })).rejects.toThrow(/bad_budget/);
    await expect(runReconcile(env, { now: 1.5 })).rejects.toThrow(/bad_now/);
    await expect(runReconcile(env, { now: -1 })).rejects.toThrow(/bad_now/); // negative
    await expect(runReconcile(env, { now: 0 })).rejects.toThrow(/bad_now/); // zero
    await expect(runReconcile(env, { now: 5_000_000_000_000 })).rejects.toThrow(/bad_now/); // out of range (>~2100)
    await expect(runReconcile(env, { now: NOW, deleteBudget: 30 })).rejects.toThrow(/bad_budget/); // > 25 (Service Binding limit)
  });
});

describe("F1 reconciliation — operational bounds (Service Binding invocation limit)", () => {
  const BASE = 1_700_000_000_000;

  it("a scan with many artifacts performs ≤ the platform-safe budget; the rest remain eligible", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2(); const env = makeEnv(sqlite, r2.fetcher);
    const s = uuid();
    seedScan(sqlite, { id: s, pdf_r2_key: null });
    for (let i = 1; i <= 30; i++) insertArtifact(sqlite, { r2_key: key(s, i), scan_id: s, status: "superseded" });
    const r = await RUN(env); // default budget 25
    expect(r.purged).toBe(25); // ≤ 25 external deletes (< 32 chain limit)
    expect(r2.deleted).toHaveLength(25);
    const remaining = sqlite.prepare("SELECT COUNT(*) AS n FROM r2_artifacts WHERE scan_id=? AND status='superseded'").get(s) as { n: number };
    expect(remaining.n).toBe(5); // still eligible for a subsequent pass
  });

  it("substantial time elapses during the auth query: renew/re-auth or ZERO deletes", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2();
    const s = uuid(); const kSup = key(s, 1);
    seedScan(sqlite, { id: s, pdf_r2_key: null });
    insertArtifact(sqlite, { r2_key: kSup, scan_id: s, status: "superseded" });
    const nowRef = { v: BASE };
    let advanced = false;
    const env = makeEnv(sqlite, r2.fetcher, {
      // jump past the lease window while the delete-auth query runs → recompute
      // finds no safe window → renewal fails → zero deletes.
      beforeRun: (sql) => { if (sql.includes("a.status IN ('pending','superseded') AND EXISTS") && !advanced) { advanced = true; nowRef.v = BASE + 10 * 60 * 1000; } },
    });
    await expect(runReconcile(env, { now: NOW, clock: () => nowRef.v })).rejects.toThrow(/lease_lost/);
    expect(r2.deleted).toEqual([]); // zero deletes
    expect(art(sqlite, kSup)!.status).toBe("superseded");
  });

  it("R2 timeout (signal aborts): client throws, D1 stays superseded, lease released, no later artifact", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2({ abortDelete: true });
    const s = uuid(); const k1 = key(s, 1), k2 = key(s, 2);
    seedScan(sqlite, { id: s, pdf_r2_key: null });
    insertArtifact(sqlite, { r2_key: k1, scan_id: s, status: "superseded" });
    insertArtifact(sqlite, { r2_key: k2, scan_id: s, status: "superseded" });
    // Shrink the safe window to ~MIN_RPC_WINDOW so the delete timeout is ~1s.
    const nowRef = { v: BASE };
    let advanced = false;
    const env = makeEnv(sqlite, r2.fetcher, {
      beforeRun: (sql) => { if (sql.includes("a.status IN ('pending','superseded') AND EXISTS") && !advanced) { advanced = true; nowRef.v = BASE + 5 * 60 * 1000 - 6_000; } },
    });
    await expect(runReconcile(env, { now: NOW, clock: () => nowRef.v })).rejects.toBeTruthy();
    expect(r2.deleted).toEqual([]); // the aborted delete was never confirmed
    expect(art(sqlite, k1)!.status).toBe("superseded"); // not purged
    expect(art(sqlite, k2)!.status).toBe("superseded"); // later artifact never attempted
    expect(scanRow(sqlite, s).op_lease_id).toBeNull(); // lease released in finally
  }, 10_000);
});

describe("F1 reconciliation — lease-time safety (live clock)", () => {
  const BASE = 1_700_000_000_000; // a realistic ms timestamp (within range)

  it("lease expires mid-pass: the next artifact is not deleted unless renewed", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2();
    const s = uuid(); const k1 = key(s, 1), k2 = key(s, 2);
    seedScan(sqlite, { id: s, pdf_r2_key: null });
    insertArtifact(sqlite, { r2_key: k1, scan_id: s, status: "superseded" });
    insertArtifact(sqlite, { r2_key: k2, scan_id: s, status: "superseded" });
    // Advance the clock past the lease window right AFTER artifact 1's purge.
    const nowRef = { v: BASE };
    let purges = 0;
    const env = makeEnv(sqlite, r2.fetcher, {
      beforeRun: (sql) => { if (sql.includes("SET status='purged'")) { purges++; if (purges === 1) nowRef.v = BASE + 10 * 60 * 1000; } },
    });
    await expect(runReconcile(env, { now: NOW, clock: () => nowRef.v })).rejects.toThrow(/lease_lost/);
    expect(r2.deleted).toEqual([k1]); // only artifact 1 deleted; artifact 2 blocked by failed renewal
    expect(art(sqlite, k1)!.status).toBe("purged");
    expect(art(sqlite, k2)!.status).toBe("superseded"); // not deleted
  });

  it("replacement owner: after the lease is stolen, the stale reconciler neither deletes nor releases the newer lease", async () => {
    const sqlite = freshSqlite(); const r2 = makeR2();
    const s = uuid(); const kSup = key(s, 1);
    seedScan(sqlite, { id: s, pdf_r2_key: null });
    insertArtifact(sqlite, { r2_key: kSup, scan_id: s, status: "superseded" });
    // A newer owner steals the scan lease right before the reconciler's delete-auth check.
    let stolen = false;
    const env = makeEnv(sqlite, r2.fetcher, {
      beforeRun: (sql) => {
        if (sql.includes("a.status IN ('pending','superseded') AND EXISTS") && !stolen) {
          stolen = true;
          sqlite.prepare("UPDATE scans SET op_lease_id='newowner', op_fence=op_fence+1, op_lease_expires_at=? WHERE id=?").run(BASE + 999_999, s);
        }
      },
    });
    await expect(runReconcile(env, { now: NOW, clock: () => BASE })).rejects.toBeTruthy();
    expect(r2.deleted).toEqual([]); // nothing deleted
    const sc = scanRow(sqlite, s);
    expect(sc.op_lease_id).toBe("newowner"); // newer owner's lease NOT released
    expect(art(sqlite, kSup)!.status).toBe("superseded"); // not purged
  });
});
