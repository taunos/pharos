// P0-C2 capture cutover — scanner-side proofs (tC1s, CD6-1..5, CC-2(a,b,c),
// CC-3(a), tC13) over the REAL migration chain (node:sqlite, schema.sql +
// 0001–0004), real worker.fetch dispatches / real exported functions, and an
// RPC-level MarketingR2Client mock (F1/F2/G harness). Helper-only assertions
// satisfy nothing. PASS is enumerated per test ID in the ship-report.
import { describe, it, expect, vi, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "./index";
import type { Env } from "./types";
import { runCaptureOutbox } from "./capture-outbox";
import { runPrivacyDelete } from "./privacy-delete";
import { CONSUMER_LEASE_MS } from "./capture-consumer-rpc";

// ── Harness ───────────────────────────────────────────────────────────────────
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
const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i;

// D1-shaped adapter over node:sqlite recording EVERY executed statement (the
// harness statement counter tC1s / CD6 assert on).
function makeD1(sqlite: DatabaseSync) {
  const executed: Executed[] = [];
  const record = (sql: string, changes: number) => {
    executed.push({ sql, changes });
  };
  const prepare = (sql: string) => {
    const stmt = {
      _sql: sql,
      _b: [] as unknown[],
      bind(...a: unknown[]) {
        stmt._b = a;
        return stmt;
      },
      async run() {
        const i = sqlite.prepare(sql).run(...(stmt._b as never[]));
        const changes = Number(i.changes);
        record(sql, changes);
        return { success: true, meta: { changes, last_row_id: Number(i.lastInsertRowid) }, results: [] };
      },
      async first<T = unknown>() {
        const row = (sqlite.prepare(sql).get(...(stmt._b as never[])) ?? null) as T | null;
        record(sql, WRITE_RE.test(sql) && row !== null ? 1 : 0);
        return row;
      },
      async all<T = unknown>() {
        const rows = sqlite.prepare(sql).all(...(stmt._b as never[])) as T[];
        record(sql, 0);
        return { success: true, results: rows, meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  const batch = async (stmts: ReturnType<typeof prepare>[]) => {
    sqlite.exec("BEGIN");
    const out: Array<{ success: boolean; meta: { changes: number }; results: never[] }> = [];
    try {
      for (const st of stmts) {
        const i = sqlite.prepare(st._sql).run(...(st._b as never[]));
        const changes = Number(i.changes);
        record(st._sql, changes);
        out.push({ success: true, meta: { changes }, results: [] });
      }
      sqlite.exec("COMMIT");
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
    return out;
  };
  return { prepare, batch, executed };
}
type D1 = ReturnType<typeof makeD1>;

// RPC-level MarketingR2Client mock (purge-prefix only; every call recorded).
function makeR2() {
  const state = { purges: [] as string[] };
  const fetcher = {
    fetch: async (req: Request) => {
      const op = new URL(req.url).pathname.split("/").pop();
      if (op !== "purge-prefix") return new Response("{}", { status: 404 });
      const body = (await req.json()) as { prefix: string };
      state.purges.push(body.prefix);
      return new Response(JSON.stringify({ ok: true, status: "purged", purged: 2 }), { status: 200 });
    },
  };
  return { fetcher: fetcher as unknown as Fetcher, state };
}

const NOW = 1_800_000_000_000; // stable base timestamp (ms)
const OLD = NOW - 120 * 24 * 3_600_000;
const FAR = NOW + 3_600_000;
const ADMIN = "admin-key";
const CKEY = "consumer-key";
const RKEY = "rk-secret";
const uuid = () => crypto.randomUUID();
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

function seedScan(
  s: DatabaseSync,
  o: {
    id: string;
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
  const vals: unknown[] = [o.id, "https://x", 6, 6, JSON.stringify({ id: o.id, url: "https://x" }), OLD, 0, "free"];
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
function insertJob(
  s: DatabaseSync,
  o: { job_id: string; scan_id: string; phase: string; email?: string | null; claim_id?: string | null; claim_expires_at?: number | null; op_fence?: number | null }
) {
  s.prepare(
    `INSERT INTO capture_jobs (job_id, scan_id, phase, queue_state, email, pdf_r2_key, delivery_snapshot, claim_id, claim_expires_at, op_fence, attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, NULL, NULL, ?, ?, ?, 0, 0, ?, ?)`
  ).run(o.job_id, o.scan_id, o.phase, o.email ?? null, o.claim_id ?? null, o.claim_expires_at ?? null, o.op_fence ?? null, OLD, OLD);
}
const scanRow = (s: DatabaseSync, id: string) => s.prepare("SELECT * FROM scans WHERE id=?").get(id) as Record<string, unknown> | undefined;
const jobRow = (s: DatabaseSync, jid: string) => s.prepare("SELECT * FROM capture_jobs WHERE job_id=?").get(jid) as Record<string, unknown> | undefined;
const artRows = (s: DatabaseSync, id: string) => s.prepare("SELECT * FROM r2_artifacts WHERE scan_id=?").all(id) as Record<string, unknown>[];

function envOf(d1: D1, extra: Record<string, unknown> = {}): Env {
  return {
    DB: d1 as unknown,
    INTERNAL_SCANNER_ADMIN_KEY: ADMIN,
    CAPTURE_CONSUMER_KEY: CKEY,
    CACHE: { get: async () => null, put: async () => {} },
    ...extra,
  } as unknown as Env;
}
const ON = { CAPTURE_PIPELINE_MODE: "on" };

const pdfKeyReq = (id: string, key?: string | null, ip?: string) =>
  new Request(`https://scanner.astrant.io/api/internal/scan/${id}/pdf-key`, {
    method: "GET",
    headers: { ...(key ? { "x-internal-scanner-admin-key": key } : {}), ...(ip ? { "CF-Connecting-IP": ip } : {}) },
  });

async function rpc(env: Env, path: string, body: unknown) {
  const res = await worker.fetch(
    new Request(`https://scanner.astrant.io/api/internal/capture/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-capture-consumer-key": CKEY },
      body: JSON.stringify(body),
    }),
    env,
    ctx
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── tC1s — gate-off invariant ─────────────────────────────────────────────────
describe("tC1s — gate off: pdf-key endpoint is absent (404) with ZERO statements", () => {
  const variants: Array<[string, string | undefined]> = [
    ["absent", undefined],
    ['"ON"', "ON"],
    ['"on " (trailing space)', "on "],
    ['"bogus"', "bogus"],
  ];
  for (const [label, mode] of variants) {
    it(`tC1s: gate ${label} → 404, zero statements executed (authenticated request)`, async () => {
      const sqlite = freshSqlite();
      const d1 = makeD1(sqlite);
      const id = uuid();
      seedScan(sqlite, { id, pdf_r2_key: `score-reports/${id}/0123456789abcdef/1.pdf` });
      const env = envOf(d1, mode === undefined ? {} : { CAPTURE_PIPELINE_MODE: mode });
      const res = await worker.fetch(pdfKeyReq(id, ADMIN), env, ctx);
      expect(res.status).toBe(404);
      expect(d1.executed).toHaveLength(0);
    });
  }
});

// ── CD6 — GET /api/internal/scan/:id/pdf-key (gate ON) ────────────────────────
describe("CD6 — GET /api/internal/scan/:id/pdf-key (gate ON; dispatch gate → auth → rate limit → SELECT)", () => {
  it("CD6-1: missing key → 401; wrong key → 401; zero statements", async () => {
    const sqlite = freshSqlite();
    const d1 = makeD1(sqlite);
    const id = uuid();
    seedScan(sqlite, { id, pdf_r2_key: `score-reports/${id}/0123456789abcdef/1.pdf` });
    const env = envOf(d1, ON);
    const r1 = await worker.fetch(pdfKeyReq(id), env, ctx);
    expect(r1.status).toBe(401);
    const r2 = await worker.fetch(pdfKeyReq(id, "wrong-key"), env, ctx);
    expect(r2.status).toBe(401);
    expect(d1.executed).toHaveLength(0);
  });

  it("CD6-2: rate-limit exceeded (per-scan 1/s stamp already present) → 429, zero statements; total 60/min bucket → 429", async () => {
    const sqlite = freshSqlite();
    const d1 = makeD1(sqlite);
    const id = uuid();
    seedScan(sqlite, { id, pdf_r2_key: null });
    const nowSec = String(Math.floor(Date.now() / 1000));
    const touched: string[] = [];
    // per-scan stamp "now" → per-scan limiter trips
    const perScan = { get: async (k: string) => (touched.push(k), k.startsWith("int:pdfkey:") && k.endsWith(":sec") ? nowSec : null), put: async () => {} };
    const r1 = await worker.fetch(pdfKeyReq(id, ADMIN, "9.9.9.9"), envOf(d1, { ...ON, CACHE: perScan }), ctx);
    expect(r1.status).toBe(429);
    expect(d1.executed).toHaveLength(0);
    expect(touched.every((k) => k.startsWith("int:pdfkey:"))).toBe(true); // own key prefix, never int:email:
    // total bucket at the ceiling → per-minute limiter trips
    const perTotal = { get: async (k: string) => (k.startsWith("int:pdfkey:total:min:") ? "60" : null), put: async () => {} };
    const r2 = await worker.fetch(pdfKeyReq(id, ADMIN, "9.9.9.9"), envOf(d1, { ...ON, CACHE: perTotal }), ctx);
    expect(r2.status).toBe(429);
    expect(d1.executed).toHaveLength(0);
  });

  it("CD6-3: success returns the stored pdf_r2_key via exactly one plain SELECT", async () => {
    const sqlite = freshSqlite();
    const d1 = makeD1(sqlite);
    const id = uuid();
    const key = `score-reports/${id}/0123456789abcdef/3.pdf`;
    seedScan(sqlite, { id, pdf_r2_key: key });
    const res = await worker.fetch(pdfKeyReq(id, ADMIN), envOf(d1, ON), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pdf_r2_key: key });
    expect(d1.executed).toHaveLength(1);
    expect(d1.executed[0].sql).toBe("SELECT pdf_r2_key FROM scans WHERE id = ?");
  });

  it("CD6-4: NULL pointer → { ok: true, pdf_r2_key: null } (the ONLY legacy-fallback signal)", async () => {
    const sqlite = freshSqlite();
    const d1 = makeD1(sqlite);
    const id = uuid();
    seedScan(sqlite, { id, pdf_r2_key: null });
    const res = await worker.fetch(pdfKeyReq(id, ADMIN), envOf(d1, ON), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pdf_r2_key: null });
  });

  it("CD6-5: unknown scan → 404 { ok: false, error: 'not found' }", async () => {
    const sqlite = freshSqlite();
    const d1 = makeD1(sqlite);
    const res = await worker.fetch(pdfKeyReq(uuid(), ADMIN), envOf(d1, ON), ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not found" });
  });
});

// ── CC-2 / CC-3 — resurrection-race + lease-exclusion proofs ──────────────────
describe("CC-2 — purged / tombstoned scans are refused by the consumer RPC (E1)", () => {
  it("CC-2(a) ACTIVATION-BLOCKING: REAL outbox producer (persist + job) → REAL runPrivacyDelete to completion → E1 claim with the pre-purge job id returns ack_no_work; D1 byte-unchanged by the claim; zero R2-facing outputs", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const sqlite = freshSqlite();
    const d1 = makeD1(sqlite);
    const id = uuid();
    seedScan(sqlite, { id });
    const sent: { job_id: string }[] = [];
    const env = envOf(d1, { CAPTURE_QUEUE: { send: async (m: { job_id: string }) => void sent.push(m) } });

    // 1. The live-path producer this slice cuts over to.
    const out = await runCaptureOutbox(env, id, { email: "alice@example.com", opted_in: 1, unsubscribe_token: "tok" }, NOW);
    expect(out.status).toBe("deferred");
    const jobId = (out as { job_id: string }).job_id;
    expect(sent).toEqual([{ job_id: jobId }]);
    expect(scanRow(sqlite, id)!.email).toBe("alice@example.com");

    // 2. The coordinated privacy delete runs to completion (P4 cancels the job).
    const r2 = makeR2();
    let t = NOW;
    const pd = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: RKEY }), id, { clock: () => (t += 7) });
    expect(pd.status).toBe("ok");
    expect(scanRow(sqlite, id)!.email).toBeNull();
    expect(jobRow(sqlite, jobId)!.phase).toBe("cancelled");
    const purgesAfterDelete = r2.state.purges.length;
    expect(purgesAfterDelete).toBeGreaterThan(0);

    // 3. A Queue message carrying the pre-purge job id arrives late: refused.
    const scanBefore = scanRow(sqlite, id);
    const jobBefore = jobRow(sqlite, jobId);
    const stmtsBefore = d1.executed.length;
    const claim = await rpc(env, "claim", { job_id: jobId });
    expect(claim.status).toBe(200);
    expect(claim.json.status).toBe("ack_no_work");
    expect(scanRow(sqlite, id)).toEqual(scanBefore);
    expect(jobRow(sqlite, jobId)).toEqual(jobBefore);
    expect(d1.executed.slice(stmtsBefore).filter((e) => WRITE_RE.test(e.sql) && e.changes > 0)).toHaveLength(0);
    expect(r2.state.purges.length).toBe(purgesAfterDelete); // the claim produced zero R2-facing outputs
    expect(artRows(sqlite, id)).toHaveLength(0);
  });

  it("CC-2(b): tombstone seeding (retention_locked_at + LIVE retention lease, t34-style) → claim → ack_no_work; scan row byte-unchanged", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const sqlite = freshSqlite();
    const d1 = makeD1(sqlite);
    const id = uuid();
    const jobId = uuid();
    seedScan(sqlite, { id, email: "orig@x.com", retention_locked_at: OLD, retention_job_id: "J", op_lease_id: "retention-cid", op_lease_expires_at: FAR });
    insertJob(sqlite, { job_id: jobId, scan_id: id, phase: "pending", email: "orig@x.com" });
    const before = scanRow(sqlite, id);
    const claim = await rpc(envOf(d1), "claim", { job_id: jobId });
    expect(claim.status).toBe(200);
    expect(claim.json.status).toBe("ack_no_work");
    expect(scanRow(sqlite, id)).toEqual(before);
    expect(jobRow(sqlite, jobId)!.claim_id).toBeNull();
  });

  it("CC-2(c): stale-claim register-artifact and commit-pointer against a purged scan AND a tombstoned scan → error / zero rows, never success", async () => {
    let now = NOW;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    // (i) purged world: claim first, let the capture lease expire, purge, then replay the stale claim.
    const sqlite = freshSqlite();
    const d1 = makeD1(sqlite);
    const id = uuid();
    const jobId = uuid();
    seedScan(sqlite, { id, email: "alice@example.com" });
    insertJob(sqlite, { job_id: jobId, scan_id: id, phase: "pending", email: "alice@example.com" });
    const env = envOf(d1);
    const claimed = await rpc(env, "claim", { job_id: jobId });
    expect(claimed.json.status).toBe("claimed");
    const claimId = (claimed.json.job as { claim_id: string }).claim_id;
    now = NOW + CONSUMER_LEASE_MS + 1_000; // capture lease expired → P1 can acquire
    const r2 = makeR2();
    let t = now;
    const pd = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: RKEY }), id, { clock: () => (t += 7) });
    expect(pd.status).toBe("ok");
    expect(jobRow(sqlite, jobId)!.phase).toBe("cancelled");
    const reg = await rpc(env, "register-artifact", { job_id: jobId, claim_id: claimId });
    expect(reg.json.ok).toBe(false);
    expect(reg.json.status).toBe("error");
    const commit = await rpc(env, "commit-pointer", { job_id: jobId, claim_id: claimId, r2_key: `score-reports/${id}/0123456789abcdef/1.pdf` });
    expect(commit.json.ok).toBe(false);
    expect(commit.json.status).toBe("error");
    expect(scanRow(sqlite, id)!.pdf_r2_key).toBeNull();
    expect(artRows(sqlite, id)).toHaveLength(0);

    // (ii) tombstoned world: a job carrying a stale claim under a tombstone + live retention lease.
    const id2 = uuid();
    const job2 = uuid();
    const stale = uuid();
    seedScan(sqlite, { id: id2, email: "orig@x.com", retention_locked_at: OLD, retention_job_id: "J2", op_lease_id: "retention-cid", op_lease_expires_at: now + 3_600_000, op_fence: 7 });
    insertJob(sqlite, { job_id: job2, scan_id: id2, phase: "rendering", email: "orig@x.com", claim_id: stale, claim_expires_at: now + 600_000, op_fence: 7 });
    const before2 = scanRow(sqlite, id2);
    const reg2 = await rpc(env, "register-artifact", { job_id: job2, claim_id: stale });
    expect(reg2.json.ok).toBe(false);
    expect(reg2.json.status).toBe("error");
    const commit2 = await rpc(env, "commit-pointer", { job_id: job2, claim_id: stale, r2_key: `score-reports/${id2}/0123456789abcdef/7.pdf` });
    expect(commit2.json.ok).toBe(false);
    expect(commit2.json.status).toBe("error");
    expect(scanRow(sqlite, id2)).toEqual(before2);
    expect(artRows(sqlite, id2)).toHaveLength(0);
  });
});

describe("CC-3 — lease exclusion between the capture consumer and privacy delete", () => {
  it("CC-3(a) ACTIVATION-BLOCKING: claim + register-artifact under a LIVE capture lease, then concurrent runPrivacyDelete → pd_busy with ZERO purge RPC calls; PII + registered artifact intact", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const sqlite = freshSqlite();
    const d1 = makeD1(sqlite);
    const id = uuid();
    const jobId = uuid();
    seedScan(sqlite, { id, email: "alice@example.com" });
    insertJob(sqlite, { job_id: jobId, scan_id: id, phase: "pending", email: "alice@example.com" });
    const env = envOf(d1);
    const claimed = await rpc(env, "claim", { job_id: jobId });
    expect(claimed.json.status).toBe("claimed");
    const claimId = (claimed.json.job as { claim_id: string }).claim_id;
    const reg = await rpc(env, "register-artifact", { job_id: jobId, claim_id: claimId });
    expect(reg.json.status).toBe("registered");
    const before = scanRow(sqlite, id);
    const r2 = makeR2();
    let t = NOW;
    const pd = await runPrivacyDelete(envOf(d1, { MARKETING_R2: r2.fetcher, RECONCILE_R2_KEY: RKEY }), id, { clock: () => (t += 7) });
    expect(pd.status).toBe("pd_busy");
    expect(r2.state.purges).toHaveLength(0);
    expect(scanRow(sqlite, id)).toEqual(before); // lease, fence, email all intact
    expect(artRows(sqlite, id)).toHaveLength(1);
    expect(jobRow(sqlite, jobId)!.phase).toBe("rendering");
  });

  it("tC13 (CC-3(b)): QUEUE_WALL_MAX_MS + CC3_TERMINATION_MARGIN_MS <= CONSUMER_LEASE_MS against the IMPORTED constant", () => {
    // Doc provenance (Step 0.5(1), fetched 2026-08-25):
    // https://developers.cloudflare.com/queues/platform/limits/ —
    // "Each consumer invocation has a maximum wall time of 15 minutes."
    const QUEUE_WALL_MAX_MS = 900_000;
    const CC3_TERMINATION_MARGIN_MS = 60_000;
    expect(QUEUE_WALL_MAX_MS + CC3_TERMINATION_MARGIN_MS).toBeLessThanOrEqual(CONSUMER_LEASE_MS);
    expect(CONSUMER_LEASE_MS).toBe(1_200_000);
  });
});
