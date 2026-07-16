// P0-C2 Chunk F2 — 90-day retention-sweep state machine (DISABLED build).
//
// Executes the frozen design-v2.9 §4 SQL verbatim (sole augmentation: A1 —
// `RETURNING op_fence` on the tombstone CAS) plus the spec-authored S1–S12b
// fragments. Mode gate RETENTION_SWEEP_MODE = off | dry_run | enforce is
// fail-closed (absent/unknown → off) and parsed exactly once, here, before
// any config or DB access. No cron trigger exists in this chunk — the code
// path is unreachable in production until activation (D18 gate: G scrub
// wiring + capture cutover + t34 inversion + OQ-1 adjudication).
//
// AUTHORITY MODEL (Appendix T): two planes — the retention_jobs claim
// (claim_id/lease_expires_at) and the per-scan op-lease (op_lease_id/op_fence),
// both held under the same :cid. The tombstone CAS is the scan-plane
// acquisition (exempt from renewal — nothing exists to renew before it); every
// later destructive step runs inside a live identity-checked renewal window
// (S1 job-plane, S2 scan-plane, both carrying the stable-identity terms), with
// both-plane EXISTS predicates embedded in multi-row statements as
// defense-in-depth. Authority is NEVER inferred from affected-row counts on
// multi-row statements; terminal `done` (S9) carries its full authority
// in-statement. The frozen hard-delete's staleness protection is fence
// monotonicity, not a live-expiry predicate.
//
// CLOCK BINDING (D3/D4): eligibility, :threshold, the worklist
// next_attempt_at filter, and backoff/timestamp bases bind the stable
// per-tick `sweepNow`; the claim statement's :now, the tombstone CAS's :now,
// renewals, disambiguation reads, authorization, safe-window recompute, and
// the shared handler deadline bind the live injectable clock() (":live").
//
// LOGGING (D14): counts, fixed error classes, and per-tick salted scan-ID
// hashes only. No raw scan UUID, job UUID, email, key, prefix, or salt in any
// log line. The resolved mode is logged — never the raw env value.
//
// The RETENTION_SQL strings below are byte-copied from deploy-prompt
// Appendices F/S/D (which the Step-0 fidelity audit byte-checked against the
// frozen spec). Bind names are the design's illustrative convention; prep()
// strips whole-line comments and converts each named parameter to a numbered
// positional (?N, first-occurrence order) for D1's positional .bind().

import type { Env } from "./types";
import { MarketingR2Client } from "./marketing-r2-client";

// Locked constants (grep-verified in Phase 4).
export const HANDLER_WALL_BUDGET_MS = 720000; // 12 min inside the 15-min cron wall (D12)
export const TICK_STOP_MARGIN_MS = 60000; // tail reserve: summary logging + platform variance
export const MIN_JOB_HEADROOM_MS = 30000; // stop-before-claim threshold
export const RETENTION_MS = 7776000000; // 90 * 24 * 60 * 60 * 1000 — scans.created_at is ms (V5)
const RET_LEASE_MS = 300000; // 5 min, renewable — both authority planes
const R2_PURGE_BUDGET_MS = 20000; // prefix purge lists+deletes server-side (> single-delete's 10 s)
const MIN_RPC_WINDOW_MS = 1000; // below this, contention-abort BEFORE the RPC
const LEASE_RENEW_MARGIN_MS = 5000; // per-term margin in the D8 formula
const FAILURE_N_DEFAULT = 5; // frozen Failure :N — real errors
const FAILURE_N_INVARIANT = 1; // A3 — retention_invariant_violation dead-letters immediately
const BACKOFF_BASE_MS = 300000; // 5 min × 2^attempts …
const BACKOFF_CAP_MS = 21600000; // … capped at 6 h, ± 20 %
const MAX_TIMESTAMP_MS = 4102444800000; // ~year 2100 (F1 convention)
const DEFAULT_ENQUEUE_LIMIT = 200;
const MAX_ENQUEUE_LIMIT = 10000;
const DEFAULT_CLAIM_LIMIT = 20;
const MAX_CLAIM_LIMIT = 1000;
const DEFAULT_RPC_BUDGET = 20; // each processed job = 1 purgePrefix Service-Binding invocation
const MAX_RPC_BUDGET = 25; // ≤ Cloudflare's 32-invocation chain, with headroom
const DEFAULT_ALERT_LIMIT = 50;
const MAX_ALERT_LIMIT = 1000;

// Byte-binding SQL — copied mechanically from deploy-prompt v5 Appendices F/S/D
// (fidelity-audited against frozen spec v3.3 at Step 0.13). Comment lines are
// part of the audited bytes; prep() strips them before execution. t37 audits
// these strings verbatim, including required ABSENCES.
export const RETENTION_SQL = {
  enqueue: `INSERT INTO retention_jobs (scan_id, job_id, status, enqueued_at, next_attempt_at)
SELECT s.id, :newJobId, 'pending', :now, 0 FROM scans s
WHERE s.id=:id AND s.tier='free' AND s.email_opted_in_rescan=0 AND s.created_at < :threshold
ON CONFLICT(scan_id) DO NOTHING;                       -- 1 new; 0 present/ineligible`,
  revive: `INSERT INTO retention_jobs (scan_id, job_id, status, enqueued_at, next_attempt_at)
VALUES (:id, :newJobId, 'pending', :now, 0)
ON CONFLICT(scan_id) DO UPDATE SET status='pending', claim_id=NULL, lease_expires_at=NULL,
  attempts=0, next_attempt_at=0, last_error_class=NULL
WHERE retention_jobs.status='cancelled'
  AND EXISTS (SELECT 1 FROM scans s WHERE s.id=:id AND s.tier='free'
              AND s.email_opted_in_rescan=0 AND s.created_at < :threshold);`,
  claim: `UPDATE retention_jobs SET status='claimed', claim_id=:cid, lease_expires_at=:now+:RET_LEASE_MS
WHERE scan_id=:id AND next_attempt_at<=:now
  AND (status='pending' OR (status IN ('claimed','r2_purged') AND lease_expires_at < :now));`,
  tombstone: `UPDATE scans SET op_owner='retention', op_lease_id=:cid, op_lease_expires_at=:now+:RET_LEASE_MS, op_fence=op_fence+1,
  retention_locked_at=COALESCE(retention_locked_at,:now), retention_job_id=COALESCE(retention_job_id,:job_id)
WHERE id=:id AND (op_lease_id IS NULL OR op_lease_expires_at < :now)
  AND tier='free' AND email_opted_in_rescan=0 AND created_at < :threshold
RETURNING op_fence;`,
  hardDelete: `DELETE FROM scans WHERE id=:id AND retention_job_id=:job_id AND op_lease_id=:cid AND op_fence=:fence
  AND tier='free' AND email_opted_in_rescan=0 AND created_at < :threshold;     -- 1 = deleted`,
  failure: `UPDATE retention_jobs SET status=CASE WHEN attempts+1>=:N THEN 'dead_letter' ELSE 'pending' END,
  attempts=attempts+1, next_attempt_at=:now+:backoff_jitter, last_error_class=:cls,
  dead_lettered_at=CASE WHEN attempts+1>=:N THEN :now ELSE dead_lettered_at END,
  claim_id=NULL, lease_expires_at=NULL
WHERE scan_id=:id AND claim_id=:cid;`,
  contention: `UPDATE retention_jobs SET status='pending', next_attempt_at=:now+:jitter, claim_id=NULL, lease_expires_at=NULL
WHERE scan_id=:id AND claim_id=:cid;`,
  replay: `UPDATE retention_jobs SET status='pending', attempts=0, next_attempt_at=:now, claim_id=NULL,
  lease_expires_at=NULL, alert_state=NULL
WHERE scan_id=:id AND status='dead_letter';            -- + write a replay-audit record (who/when/why)`,
  gate: `SELECT COUNT(*) FROM scans WHERE (tier IS NULL OR tier NOT IN ('free','paid')) AND email_opted_in_rescan=0 AND created_at < :threshold`,
  s1: `-- S1 job-claim renewal, identity-checked (binds: :live, :RET_LEASE_MS, :id, :cid, :job_id)
--    exactly 1 row; 0 → A4 routing (contention or invariant)
UPDATE retention_jobs SET lease_expires_at = :live + :RET_LEASE_MS
WHERE scan_id = :id AND claim_id = :cid AND lease_expires_at > :live AND job_id = :job_id;`,
  s2: `-- S2 scan op-lease renewal, identity-checked (binds: :live, :RET_LEASE_MS, :id, :cid, :fence, :job_id)
--    exactly 1 row; 0 → A4 routing (contention or invariant)
UPDATE scans SET op_lease_expires_at = :live + :RET_LEASE_MS
WHERE id = :id AND op_lease_id = :cid AND op_fence = :fence AND op_lease_expires_at > :live
  AND retention_locked_at IS NOT NULL AND retention_job_id = :job_id;`,
  s3: `-- S3 pre-purge authorization read (binds: :id, :cid, :fence, :job_id) — exactly 1 row; expiries feed D8
SELECT rj.lease_expires_at AS job_expiry, s.op_lease_expires_at AS scan_expiry
FROM retention_jobs rj JOIN scans s ON s.id = rj.scan_id
WHERE rj.scan_id = :id AND rj.claim_id = :cid AND rj.job_id = :job_id
  AND s.op_lease_id = :cid AND s.op_fence = :fence
  AND s.retention_locked_at IS NOT NULL AND s.retention_job_id = :job_id;`,
  s4: `-- S4 capture cancel (binds: :live, :id, :cid, :fence, :job_id) — 0..N; transition stamps updated_at (D11)
UPDATE capture_jobs SET phase='cancelled', email=NULL, delivery_snapshot=NULL, updated_at=:live
WHERE scan_id = :id AND phase NOT IN ('done','cancelled')
  AND EXISTS (SELECT 1 FROM scans WHERE id=:id AND op_lease_id=:cid AND op_fence=:fence
              AND op_lease_expires_at > :live AND retention_locked_at IS NOT NULL AND retention_job_id=:job_id)
  AND EXISTS (SELECT 1 FROM retention_jobs WHERE scan_id=:id AND claim_id=:cid
              AND lease_expires_at > :live AND job_id=:job_id);`,
  s5: `-- S5 mark r2_purged (binds: :live, :id, :cid) — exactly 1 or contention; A5 predicate
UPDATE retention_jobs SET status='r2_purged'
WHERE scan_id = :id AND claim_id = :cid AND lease_expires_at > :live;`,
  s6: `-- S6 registry DELETE (binds: :id, :cid, :fence, :live, :job_id) — 0..N
DELETE FROM r2_artifacts WHERE scan_id = :id
  AND EXISTS (SELECT 1 FROM scans WHERE id=:id AND op_lease_id=:cid AND op_fence=:fence
              AND op_lease_expires_at > :live AND retention_locked_at IS NOT NULL AND retention_job_id=:job_id)
  AND EXISTS (SELECT 1 FROM retention_jobs WHERE scan_id=:id AND claim_id=:cid
              AND lease_expires_at > :live AND job_id=:job_id);`,
  s7: `-- S7 capture scrub (binds: :id, :cid, :fence, :live, :job_id) — 0..N; NO updated_at stamp
UPDATE capture_jobs SET email=NULL, pdf_r2_key=NULL, delivery_snapshot=NULL
WHERE scan_id = :id
  AND EXISTS (SELECT 1 FROM scans WHERE id=:id AND op_lease_id=:cid AND op_fence=:fence
              AND op_lease_expires_at > :live AND retention_locked_at IS NOT NULL AND retention_job_id=:job_id)
  AND EXISTS (SELECT 1 FROM retention_jobs WHERE scan_id=:id AND claim_id=:cid
              AND lease_expires_at > :live AND job_id=:job_id);`,
  s8: `-- S8 cancelled, pre-tombstone eligibility-false (binds: :live, :id, :cid) — exactly 1 or safe no-op; stamps cancelled_at
UPDATE retention_jobs SET status='cancelled', claim_id=NULL, lease_expires_at=NULL, cancelled_at=:live
WHERE scan_id = :id AND claim_id = :cid;`,
  s9: `-- S9 done — FINAL-AUTHORITY completion, both paths (binds: :live, :id, :cid)
--    exactly 1 row; 0 → contention/recovery, NEVER synthetic success
--    ordinary path: hard-delete already removed the scan, so NOT EXISTS holds;
--    missing-scan path: scan absent throughout; a reappeared scan or lost/expired claim 0-rows this statement.
UPDATE retention_jobs SET status='done', claim_id=NULL, lease_expires_at=NULL, done_at=:live
WHERE scan_id = :id AND claim_id = :cid AND lease_expires_at > :live
  AND NOT EXISTS (SELECT 1 FROM scans WHERE id = :id);`,
  s10: `-- S10 op-lease release, finally (binds: :id, :cid, :fence) — 0..1; never a newer owner's lease
UPDATE scans SET op_owner=NULL, op_lease_id=NULL, op_lease_expires_at=NULL
WHERE id = :id AND op_lease_id = :cid AND op_fence = :fence;`,
  s11: `-- S11 missing-scan registry DELETE (binds: :id, :cid, :live, :job_id) — 0..N
DELETE FROM r2_artifacts WHERE scan_id = :id
  AND EXISTS (SELECT 1 FROM retention_jobs WHERE scan_id=:id AND claim_id=:cid
              AND lease_expires_at > :live AND job_id=:job_id)
  AND NOT EXISTS (SELECT 1 FROM scans WHERE id=:id);`,
  s12a: `-- S12a missing-scan capture cancel (binds: :live, :id, :cid, :job_id) — 0..N; transition stamps updated_at
UPDATE capture_jobs SET phase='cancelled', email=NULL, delivery_snapshot=NULL, updated_at=:live
WHERE scan_id = :id AND phase NOT IN ('done','cancelled')
  AND EXISTS (SELECT 1 FROM retention_jobs WHERE scan_id=:id AND claim_id=:cid
              AND lease_expires_at > :live AND job_id=:job_id)
  AND NOT EXISTS (SELECT 1 FROM scans WHERE id=:id);`,
  s12b: `-- S12b missing-scan capture scrub (binds: :id, :cid, :live, :job_id) — 0..N; NO updated_at stamp
UPDATE capture_jobs SET email=NULL, pdf_r2_key=NULL, delivery_snapshot=NULL
WHERE scan_id = :id
  AND EXISTS (SELECT 1 FROM retention_jobs WHERE scan_id=:id AND claim_id=:cid
              AND lease_expires_at > :live AND job_id=:job_id)
  AND NOT EXISTS (SELECT 1 FROM scans WHERE id=:id);`,
  a4Read: `SELECT id, op_lease_id, op_fence, op_lease_expires_at, tier, email_opted_in_rescan, created_at,
       retention_locked_at, retention_job_id
FROM scans WHERE id = :id;`,
  d15Audit: `-- Statement 1 (MUST precede the UPDATE — it reads status before the flip):
INSERT INTO retention_replay_audit (scan_id, job_id, actor, reason, replayed_at)
SELECT rj.scan_id, rj.job_id, :actor, :reason, :now
FROM retention_jobs rj WHERE rj.scan_id = :id AND rj.status = 'dead_letter';
-- Statement 2: the frozen dead-letter → pending replay UPDATE (§3, verbatim).`,
  d16Observe: `SELECT scan_id, last_error_class, attempts FROM retention_jobs
WHERE status='dead_letter' AND alert_state IS NULL LIMIT :alertLimit;   -- boundedInt, default 50`,
  d16Cas: `UPDATE retention_jobs SET alert_state='alerted'
WHERE scan_id=:id AND status='dead_letter' AND alert_state IS NULL;`,
} as const;

// ── Orchestration SQL (spec §4.1 tick flow; not frozen content) ──────────────
const ORCH = {
  // enqueue scan: eligible scans with no job row (keyset, self-excluding)
  enqueueScan: `SELECT s.id AS id FROM scans s LEFT JOIN retention_jobs rj ON rj.scan_id = s.id
    WHERE rj.scan_id IS NULL AND s.tier='free' AND s.email_opted_in_rescan=0 AND s.created_at < ?1
    ORDER BY s.created_at, s.id LIMIT ?2`,
  // revive scan: cancelled job rows joined to currently-eligible scans, bounded
  reviveScan: `SELECT rj.scan_id AS id FROM retention_jobs rj JOIN scans s ON s.id = rj.scan_id
    WHERE rj.status='cancelled' AND s.tier='free' AND s.email_opted_in_rescan=0 AND s.created_at < ?1
    ORDER BY rj.scan_id LIMIT ?2`,
  // worklist (spec-quoted): next_attempt_at gates on sweepNow; lease expiry on the live clock
  worklist: `SELECT scan_id FROM retention_jobs WHERE next_attempt_at<=?1 AND (status='pending' OR (status IN ('claimed','r2_purged') AND lease_expires_at < ?2)) ORDER BY next_attempt_at, scan_id LIMIT ?3`,
  jobRead: `SELECT job_id, attempts FROM retention_jobs WHERE scan_id = ?1 AND claim_id = ?2`,
  scanExists: `SELECT 1 AS r FROM scans WHERE id = ?1`,
  attemptsRead: `SELECT attempts FROM retention_jobs WHERE scan_id = ?1 AND claim_id = ?2`,
  statusRead: `SELECT status, last_error_class, attempts FROM retention_jobs WHERE scan_id = ?1`,
  deadLetterTotal: `SELECT COUNT(*) AS n FROM retention_jobs WHERE status='dead_letter'`,
} as const;

export type RetentionMode = "off" | "dry_run" | "enforce";

// D1: exact lowercase match only; every other value (absent, case-variant,
// whitespace, unknown) fails closed to 'off'.
export function parseRetentionMode(v: unknown): RetentionMode {
  return v === "dry_run" || v === "enforce" ? (v as RetentionMode) : "off";
}

export type SweepResult = {
  mode: RetentionMode;
  gateCount?: number;
  gateFailed?: boolean;
  enqueued: number;
  revived: number;
  processed: number;
  done: number;
  contended: number;
  failed: number;
  dryRun?: {
    cohortEligible: number;
    wouldEnqueue: number;
    reviveCandidates: number;
    claimable: number;
    perStatus: Record<string, number>;
    deadLetterTotal: number;
    alertPending: number;
    sample: string[];
  };
};

// ── Named-param → numbered-positional transform ──────────────────────────────
// RETENTION_SQL strings are stored byte-verbatim (audited by t37 / Phase 4);
// execution strips whole-line `--` comments, then converts each :name to ?N
// (N = first-occurrence index), so repeated names share one bind slot and the
// bind array follows each fragment's listed order.
type Prepared = { text: string; order: string[] };
const prepCache = new Map<string, Prepared>();
function prep(sql: string): Prepared {
  const hit = prepCache.get(sql);
  if (hit) return hit;
  const body = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  const order: string[] = [];
  const text = body.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    let i = order.indexOf(name);
    if (i < 0) {
      order.push(name);
      i = order.length - 1;
    }
    return "?" + (i + 1);
  });
  const p = { text, order };
  prepCache.set(sql, p);
  return p;
}
function bindOf(p: Prepared, params: Record<string, unknown>): unknown[] {
  return p.order.map((n) => {
    if (!(n in params)) throw new Error(`retention_bad_bind_${n}`);
    return params[n];
  });
}
// Exported for the test suite (t29 fence-flow proof executes the exact
// production statements through the same transform the sweep uses).
export function prepRetentionSql(sql: string): { text: string; order: string[] } {
  return prep(sql);
}

async function runNamed(db: Env["DB"], sql: string, params: Record<string, unknown>): Promise<number> {
  const p = prep(sql);
  const r = await db.prepare(p.text).bind(...bindOf(p, params)).run();
  return r.meta?.changes ?? 0;
}
async function firstNamed<T>(db: Env["DB"], sql: string, params: Record<string, unknown>): Promise<T | null> {
  const p = prep(sql);
  return (await db.prepare(p.text).bind(...bindOf(p, params)).first<T>()) ?? null;
}

function boundedInt(v: number, name: string, max: number): number {
  if (!Number.isInteger(v) || v <= 0 || v > max) throw new Error(`retention_bad_${name}`);
  return v;
}

// D9 routing signals. Contention never increments attempts; an invariant
// violation routes through the frozen Failure statement with :N = 1 (A3).
class ContentionSignal extends Error {
  constructor(cls: string) {
    super(cls);
  }
}
class InvariantSignal extends Error {
  constructor() {
    super("retention_invariant_violation");
  }
}

const R2_ERROR_CLASSES = new Set(["r2_transport", "r2_rpc_failed", "r2_malformed", "r2_purge_unconfirmed", "r2_delete_unconfirmed"]);
function classifyFailure(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return R2_ERROR_CLASSES.has(msg) ? msg : "unexpected";
}

// D14: per-tick salted scan-ID hash (salt never logged; useless across ticks).
async function saltedHash(salt: string, id: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${id}`));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

type A4Row = {
  id: string;
  op_lease_id: string | null;
  op_fence: number;
  op_lease_expires_at: number | null;
  tier: string | null;
  email_opted_in_rescan: number;
  created_at: number;
  retention_locked_at: number | null;
  retention_job_id: string | null;
};

type Ctx = {
  db: Env["DB"];
  r2: MarketingR2Client | null;
  clock: () => number;
  jitter: (minMs: number, maxMs: number) => number;
  sweepNow: number;
  threshold: number;
  deadline: number;
  salt: string;
  counters: { done: number; contended: number; failed: number };
};

function cohortTrue(row: A4Row, threshold: number): boolean {
  return row.tier === "free" && row.email_opted_in_rescan === 0 && row.created_at < threshold;
}

async function a4Read(ctx: Ctx, id: string): Promise<A4Row | null> {
  return firstNamed<A4Row>(ctx.db, RETENTION_SQL.a4Read, { id });
}

// D3 renewal/authorization 0-row discrimination via the A4 read:
// scan missing → contention (reclaim lands in D6 recovery); foreign/expired
// lease or lost claim → contention (retention_lease_lost); our live lease but
// retention_job_id ≠ :job_id or retention_locked_at IS NULL → invariant.
async function discriminateAuthorityLoss(ctx: Ctx, id: string, cid: string, jobId: string): Promise<never> {
  const row = await a4Read(ctx, id);
  const live = ctx.clock();
  if (
    row &&
    row.op_lease_id === cid &&
    row.op_lease_expires_at !== null &&
    row.op_lease_expires_at > live &&
    (row.retention_job_id !== jobId || row.retention_locked_at === null)
  ) {
    throw new InvariantSignal();
  }
  throw new ContentionSignal("retention_lease_lost");
}

// Identity-checked dual renewal: S1 (job) then S2 (scan), each exactly-1-row
// at the live clock; any 0-row → A4 discrimination; no later destructive
// statement executes.
async function dualRenew(ctx: Ctx, id: string, cid: string, fence: number, jobId: string): Promise<void> {
  const s1 = await runNamed(ctx.db, RETENTION_SQL.s1, { live: ctx.clock(), RET_LEASE_MS, id, cid, job_id: jobId });
  if (s1 !== 1) await discriminateAuthorityLoss(ctx, id, cid, jobId);
  const s2 = await runNamed(ctx.db, RETENTION_SQL.s2, { live: ctx.clock(), RET_LEASE_MS, id, cid, fence, job_id: jobId });
  if (s2 !== 1) await discriminateAuthorityLoss(ctx, id, cid, jobId);
}

// D8 four-term purge timeout with per-term margins; the missing-scan path
// passes scanExpiry = null to omit only the scan term.
function purgeTimeout(ctx: Ctx, jobExpiry: number, scanExpiry: number | null): number {
  const live = ctx.clock();
  const terms = [
    R2_PURGE_BUDGET_MS,
    jobExpiry - live - LEASE_RENEW_MARGIN_MS,
    ctx.deadline - live - TICK_STOP_MARGIN_MS,
  ];
  if (scanExpiry !== null) terms.push(scanExpiry - live - LEASE_RENEW_MARGIN_MS);
  return Math.min(...terms);
}

// Missing-scan sequence (D6; also the hard-delete-0-row "no row" recovery,
// which re-proves the job claim identically on entry). Job-claim-only: no
// op-lease is ever taken; every D1 statement carries the job-plane EXISTS +
// NOT EXISTS(scans) predicates; completion authority is enforced inside S9
// itself (0 rows route to contention/recovery, never synthetic success).
async function missingScanSequence(ctx: Ctx, id: string, cid: string, jobId: string): Promise<void> {
  const renewJob = async (): Promise<number> => {
    const live = ctx.clock();
    const c = await runNamed(ctx.db, RETENTION_SQL.s1, { live, RET_LEASE_MS, id, cid, job_id: jobId });
    if (c !== 1) throw new ContentionSignal("retention_lease_lost");
    return live + RET_LEASE_MS;
  };
  const assertScanAbsent = async (): Promise<void> => {
    const present = await ctx.db.prepare(ORCH.scanExists).bind(id).first<{ r: number }>();
    if (present) throw new ContentionSignal("retention_contention");
  };

  const jobExpiry = await renewJob(); // D6 step 1 (the recovery entry re-proves the claim identically)
  await assertScanAbsent();

  if (!ctx.r2) throw new Error("retention misconfigured");
  const timeoutMs = purgeTimeout(ctx, jobExpiry, null);
  if (timeoutMs < MIN_RPC_WINDOW_MS) throw new ContentionSignal("retention_window_collapsed");
  await ctx.r2.purgePrefix(`score-reports/${id}/`, timeoutMs);

  await renewJob();
  await assertScanAbsent();

  await runNamed(ctx.db, RETENTION_SQL.s11, { id, cid, live: ctx.clock(), job_id: jobId }); // 0..N legitimate
  await runNamed(ctx.db, RETENTION_SQL.s12a, { live: ctx.clock(), id, cid, job_id: jobId }); // 0..N
  await runNamed(ctx.db, RETENTION_SQL.s12b, { id, cid, live: ctx.clock(), job_id: jobId }); // 0..N

  const done = await runNamed(ctx.db, RETENTION_SQL.s9, { live: ctx.clock(), id, cid });
  if (done !== 1) throw new ContentionSignal("retention_contention"); // never synthetic success
  ctx.counters.done++;
}

// Tombstone-0-row disambiguation (A4 read; D9 routing).
async function routeTombstoneZero(ctx: Ctx, id: string, cid: string, jobId: string): Promise<void> {
  const row = await a4Read(ctx, id);
  if (!row) {
    await missingScanSequence(ctx, id, cid, jobId);
    return;
  }
  const live = ctx.clock();
  const foreignLive = row.op_lease_id !== null && row.op_lease_id !== cid && row.op_lease_expires_at !== null && row.op_lease_expires_at > live;
  if (foreignLive) throw new ContentionSignal("retention_contention");
  if (!cohortTrue(row, ctx.threshold)) {
    if (row.retention_locked_at === null) {
      // pre-tombstone eligibility change → cancelled (S8 stamps cancelled_at)
      await runNamed(ctx.db, RETENTION_SQL.s8, { live, id, cid }); // 0-row = claim lost → safe no-op
      return;
    }
    throw new InvariantSignal(); // post-tombstone cohort drift
  }
  throw new ContentionSignal("retention_contention"); // cohort true + lease free/expired → read/CAS race
}

// Hard-delete-0-row three-way disambiguation (D9/A2).
async function routeHardDeleteZero(ctx: Ctx, id: string, cid: string, fence: number, jobId: string): Promise<void> {
  const row = await a4Read(ctx, id);
  if (!row) {
    // scan already gone → recovery: prefix purge + full scrub + S9 done
    await missingScanSequence(ctx, id, cid, jobId);
    return;
  }
  const live = ctx.clock();
  const ours = row.op_lease_id === cid && row.op_fence === fence && row.op_lease_expires_at !== null && row.op_lease_expires_at > live;
  if (!ours) throw new ContentionSignal("retention_lease_lost");
  if (!cohortTrue(row, ctx.threshold)) throw new InvariantSignal();
  if (row.retention_job_id !== jobId) throw new InvariantSignal();
  throw new InvariantSignal(); // all apparently held → defensive catch-all
}

// D16: alert CAS (single dedupe authority) + identifier-free fixed payload.
async function alertOne(ctx: Ctx, scanId: string): Promise<boolean> {
  const cas = await runNamed(ctx.db, RETENTION_SQL.d16Cas, { id: scanId });
  if (cas !== 1) return false;
  const row = await ctx.db.prepare(ORCH.statusRead).bind(scanId).first<{ status: string; last_error_class: string | null; attempts: number }>();
  const total = await ctx.db.prepare(ORCH.deadLetterTotal).first<{ n: number }>();
  console.log(
    `class=retention_dead_letter error_class=${row?.last_error_class ?? "unexpected"} attempts=${row?.attempts ?? 0} scan=${await saltedHash(ctx.salt, scanId)} dead_letter_total=${total?.n ?? 0}`
  );
  return true;
}

// D9 error routing: every catch runs exactly one frozen statement fenced on :cid.
async function routeError(ctx: Ctx, id: string, cid: string, e: unknown): Promise<void> {
  if (e instanceof ContentionSignal) {
    await runNamed(ctx.db, RETENTION_SQL.contention, { id, cid, now: ctx.sweepNow, jitter: ctx.jitter(60000, 120000) });
    ctx.counters.contended++;
    return;
  }
  const invariant = e instanceof InvariantSignal;
  const cls = invariant ? "retention_invariant_violation" : classifyFailure(e);
  const N = invariant ? FAILURE_N_INVARIANT : FAILURE_N_DEFAULT;
  const attemptsRow = await ctx.db.prepare(ORCH.attemptsRead).bind(id, cid).first<{ attempts: number }>();
  const attempts = attemptsRow?.attempts ?? 0;
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS);
  const spread = Math.round(base * 0.2);
  const backoff = base - spread + ctx.jitter(0, 2 * spread);
  await runNamed(ctx.db, RETENTION_SQL.failure, { N, now: ctx.sweepNow, backoff_jitter: backoff, cls, id, cid });
  ctx.counters.failed++;
  const status = await ctx.db.prepare(ORCH.statusRead).bind(id).first<{ status: string }>();
  if (status?.status === "dead_letter") await alertOne(ctx, id);
}

// Per-job processing: Appendix-T steps 2–13 (missing-scan branch per D6).
async function processJob(ctx: Ctx, id: string, cid: string): Promise<void> {
  const jobRow = await ctx.db.prepare(ORCH.jobRead).bind(id, cid).first<{ job_id: string }>();
  if (!jobRow) return; // claim vanished between claim and read → safe skip
  const jobId = jobRow.job_id;
  let fence: number | null = null;
  try {
    // Step 2 — tombstone CAS (frozen + A1): scan-plane acquisition.
    const t = await firstNamed<{ op_fence: number }>(ctx.db, RETENTION_SQL.tombstone, {
      cid,
      now: ctx.clock(),
      RET_LEASE_MS,
      job_id: jobId,
      id,
      threshold: ctx.threshold,
    });
    if (!t) {
      await routeTombstoneZero(ctx, id, cid, jobId);
      return;
    }
    fence = t.op_fence;

    // Step 3 — first post-tombstone authorization (identity-checked S1+S2):
    // a stale claimant or a desynced identity is stopped here, pre-destruction.
    await dualRenew(ctx, id, cid, fence, jobId);

    // Step 4 — capture cancel (S4; 0..N rows legitimate).
    await runNamed(ctx.db, RETENTION_SQL.s4, { live: ctx.clock(), id, cid, fence, job_id: jobId });

    // Step 5 — pre-purge authorization read; renew when headroom is low.
    if (!ctx.r2) throw new Error("retention misconfigured");
    let auth = await firstNamed<{ job_expiry: number; scan_expiry: number }>(ctx.db, RETENTION_SQL.s3, { id, cid, job_id: jobId, fence });
    if (!auth) await discriminateAuthorityLoss(ctx, id, cid, jobId);
    if (Math.min(auth!.job_expiry, auth!.scan_expiry) - ctx.clock() < R2_PURGE_BUDGET_MS + LEASE_RENEW_MARGIN_MS) {
      await dualRenew(ctx, id, cid, fence, jobId);
      auth = await firstNamed<{ job_expiry: number; scan_expiry: number }>(ctx.db, RETENTION_SQL.s3, { id, cid, job_id: jobId, fence });
      if (!auth) await discriminateAuthorityLoss(ctx, id, cid, jobId);
    }
    const timeoutMs = purgeTimeout(ctx, auth!.job_expiry, auth!.scan_expiry);
    if (timeoutMs < MIN_RPC_WINDOW_MS) throw new ContentionSignal("retention_window_collapsed");

    // Step 6 — R2 prefix purge (HTTP-200-confirmed only; any other outcome throws).
    await ctx.r2.purgePrefix(`score-reports/${id}/`, timeoutMs);

    // Step 7 — mark r2_purged (S5, A5 predicate; exactly 1 or contention).
    const marked = await runNamed(ctx.db, RETENTION_SQL.s5, { live: ctx.clock(), id, cid });
    if (marked !== 1) throw new ContentionSignal("retention_lease_lost");

    // Steps 8–9 — identity-checked dual renewal, then registry DELETE (S6) and
    // capture scrub (S7) inside the same window (deliberate; no updated_at stamp).
    await dualRenew(ctx, id, cid, fence, jobId);
    await runNamed(ctx.db, RETENTION_SQL.s6, { id, cid, fence, live: ctx.clock(), job_id: jobId });
    await runNamed(ctx.db, RETENTION_SQL.s7, { id, cid, fence, live: ctx.clock(), job_id: jobId });

    // Step 10 — identity-checked dual renewal, then the frozen hard-delete
    // (fence monotonicity is the staleness protection; binds the A1 fence).
    await dualRenew(ctx, id, cid, fence, jobId);
    const deleted = await runNamed(ctx.db, RETENTION_SQL.hardDelete, { id, job_id: jobId, cid, fence, threshold: ctx.threshold });
    if (deleted !== 1) {
      await routeHardDeleteZero(ctx, id, cid, fence, jobId);
      return;
    }

    // Step 11 — S9 done (final-authority; 0-row → contention, never synthetic success).
    const done = await runNamed(ctx.db, RETENTION_SQL.s9, { live: ctx.clock(), id, cid });
    if (done !== 1) throw new ContentionSignal("retention_contention");
    ctx.counters.done++;
  } catch (e) {
    await routeError(ctx, id, cid, e);
  } finally {
    // Step 13 — fenced op-lease release; never masks the original error; a
    // newer owner's lease (different id/fence) is never released.
    if (fence !== null) {
      try {
        await runNamed(ctx.db, RETENTION_SQL.s10, { id, cid, fence });
      } catch {
        /* swallow */
      }
    }
  }
}

// D15 — dead-letter → pending audited replay: conditional-audit atomic batch.
// The audit INSERT is gated on status='dead_letter' and MUST precede the
// frozen UPDATE (it reads the status the UPDATE flips); a 0-row UPDATE is a
// successful statement and does NOT roll back a D1 batch — which is exactly
// why the INSERT is conditional. Affected rows read via meta.changes
// (capture-outbox.ts precedent).
export async function replayDeadLetter(
  db: Env["DB"],
  scanId: string,
  actor: string,
  reason: string,
  now: number
): Promise<{ replayed: boolean }> {
  const a = typeof actor === "string" ? actor.trim() : "";
  const r = typeof reason === "string" ? reason.trim() : "";
  const ctl = /[\u0000-\u001F\u007F]/;
  if (a.length < 1 || a.length > 64 || r.length < 1 || r.length > 256 || ctl.test(a) || ctl.test(r)) {
    throw new Error("retention_replay_invalid");
  }
  const ins = prep(RETENTION_SQL.d15Audit);
  const upd = prep(RETENTION_SQL.replay);
  const results = await db.batch([
    db.prepare(ins.text).bind(...bindOf(ins, { actor: a, reason: r, now, id: scanId })),
    db.prepare(upd.text).bind(...bindOf(upd, { now, id: scanId })),
  ]);
  const insertChanges = results[0]?.meta?.changes ?? 0;
  const updateChanges = results[1]?.meta?.changes ?? 0;
  if (insertChanges !== updateChanges || ![0, 1].includes(insertChanges) || ![0, 1].includes(updateChanges)) {
    throw new Error("retention_replay_integrity");
  }
  return { replayed: updateChanges === 1 };
}

// ── The tick ─────────────────────────────────────────────────────────────────
export async function runRetentionSweep(
  env: Env,
  opts: {
    now: number;
    deadlineMs?: number;
    enqueueLimit?: number;
    claimLimit?: number;
    purgeBudget?: number;
    alertLimit?: number;
    clock?: () => number;
    jitter?: (minMs: number, maxMs: number) => number;
  }
): Promise<SweepResult> {
  // D1 ordering contract: (1) mode parse first; (2) off → immediate return
  // BEFORE the R2 config guard, zero reads beyond the env var.
  const mode = parseRetentionMode(env.RETENTION_SWEEP_MODE);
  if (mode === "off") {
    console.log(`[retention-sweep] mode=off`);
    return { mode, enqueued: 0, revived: 0, processed: 0, done: 0, contended: 0, failed: 0 };
  }

  // (3) validate sweepNow + bounds; resolve the shared deadline (D12).
  const sweepNow = opts.now;
  if (!Number.isInteger(sweepNow) || sweepNow <= 0 || sweepNow > MAX_TIMESTAMP_MS) throw new Error("retention_bad_now");
  const enqueueLimit = boundedInt(opts.enqueueLimit ?? DEFAULT_ENQUEUE_LIMIT, "enqueue_limit", MAX_ENQUEUE_LIMIT);
  const claimLimit = boundedInt(opts.claimLimit ?? DEFAULT_CLAIM_LIMIT, "claim_limit", MAX_CLAIM_LIMIT);
  const purgeBudget = boundedInt(opts.purgeBudget ?? DEFAULT_RPC_BUDGET, "purge_budget", MAX_RPC_BUDGET);
  const alertLimit = boundedInt(opts.alertLimit ?? DEFAULT_ALERT_LIMIT, "alert_limit", MAX_ALERT_LIMIT);
  const clock = opts.clock ?? (() => Date.now());
  const jitter =
    opts.jitter ?? ((minMs: number, maxMs: number) => minMs + Math.floor(Math.random() * (maxMs - minMs + 1)));
  const deadline = opts.deadlineMs ?? clock() + HANDLER_WALL_BUDGET_MS;
  if (!Number.isInteger(deadline) || deadline <= 0 || deadline > MAX_TIMESTAMP_MS) throw new Error("retention_bad_deadline");
  const threshold = sweepNow - RETENTION_MS;
  const db = env.DB;
  const salt = crypto.randomUUID(); // per-tick; never logged

  // (4) dry_run — read-only pipeline; NO R2 binding required; zero mutations.
  if (mode === "dry_run") {
    const gate = await firstNamed<{ "COUNT(*)": number }>(db, RETENTION_SQL.gate, { threshold });
    const gateCount = gate ? Object.values(gate)[0] as number : 0;
    const count = async (sql: string, binds: unknown[]): Promise<number> => {
      const row = await db.prepare(sql).bind(...binds).first<{ n: number }>();
      return row?.n ?? 0;
    };
    const cohortEligible = await count(`SELECT COUNT(*) AS n FROM scans WHERE tier='free' AND email_opted_in_rescan=0 AND created_at < ?1`, [threshold]);
    const wouldEnqueue = await count(
      `SELECT COUNT(*) AS n FROM scans s LEFT JOIN retention_jobs rj ON rj.scan_id = s.id WHERE rj.scan_id IS NULL AND s.tier='free' AND s.email_opted_in_rescan=0 AND s.created_at < ?1`,
      [threshold]
    );
    const reviveCandidates = await count(
      `SELECT COUNT(*) AS n FROM retention_jobs rj JOIN scans s ON s.id = rj.scan_id WHERE rj.status='cancelled' AND s.tier='free' AND s.email_opted_in_rescan=0 AND s.created_at < ?1`,
      [threshold]
    );
    const claimable = await count(
      `SELECT COUNT(*) AS n FROM retention_jobs WHERE next_attempt_at<=?1 AND (status='pending' OR (status IN ('claimed','r2_purged') AND lease_expires_at < ?2))`,
      [sweepNow, clock()]
    );
    const statusRows = await db.prepare(`SELECT status, COUNT(*) AS n FROM retention_jobs GROUP BY status`).all<{ status: string; n: number }>();
    const perStatus: Record<string, number> = {};
    for (const row of statusRows.results ?? []) perStatus[row.status] = row.n;
    const deadLetterTotal = perStatus["dead_letter"] ?? 0;
    const alertPending = await count(`SELECT COUNT(*) AS n FROM retention_jobs WHERE status='dead_letter' AND alert_state IS NULL`, []);
    const sampleRows = await db
      .prepare(`SELECT id FROM scans WHERE tier='free' AND email_opted_in_rescan=0 AND created_at < ?1 ORDER BY created_at, id LIMIT 10`)
      .bind(threshold)
      .all<{ id: string }>();
    const sample: string[] = [];
    for (const row of sampleRows.results ?? []) sample.push(await saltedHash(salt, row.id));
    console.log(
      `[retention-sweep] mode=dry_run gate=${gateCount} eligible=${cohortEligible} would_enqueue=${wouldEnqueue} revive_candidates=${reviveCandidates} claimable=${claimable} dead_letter_total=${deadLetterTotal} alert_pending=${alertPending}`
    );
    return {
      mode,
      gateCount,
      enqueued: 0,
      revived: 0,
      processed: 0,
      done: 0,
      contended: 0,
      failed: 0,
      dryRun: { cohortEligible, wouldEnqueue, reviveCandidates, claimable, perStatus, deadLetterTotal, alertPending, sample },
    };
  }

  // (5) enforce — R2 config guard, then the frozen quarantine gate BEFORE any mutation (D13).
  if (!env.MARKETING_R2 || !env.RECONCILE_R2_KEY) throw new Error("retention misconfigured");
  const r2 = new MarketingR2Client(env.MARKETING_R2, env.RECONCILE_R2_KEY);
  const gateRow = await firstNamed<Record<string, number>>(db, RETENTION_SQL.gate, { threshold });
  const gateCount = gateRow ? (Object.values(gateRow)[0] as number) : 0;
  if (gateCount !== 0) {
    console.log(`class=retention_gate_failed count=${gateCount}`);
    return { mode, gateCount, gateFailed: true, enqueued: 0, revived: 0, processed: 0, done: 0, contended: 0, failed: 0 };
  }

  const ctx: Ctx = { db, r2, clock, jitter, sweepNow, threshold, deadline, salt, counters: { done: 0, contended: 0, failed: 0 } };

  // Enqueue scan (frozen enqueue SQL per id; a conflict-discarded job_id is never reused).
  let enqueued = 0;
  const toEnqueue = await db.prepare(ORCH.enqueueScan).bind(threshold, enqueueLimit).all<{ id: string }>();
  for (const { id } of toEnqueue.results ?? []) {
    enqueued += await runNamed(db, RETENTION_SQL.enqueue, { newJobId: crypto.randomUUID(), now: sweepNow, id, threshold });
  }
  // Revive scan (frozen revive UPSERT; keeps the stable job_id).
  let revived = 0;
  const toRevive = await db.prepare(ORCH.reviveScan).bind(threshold, enqueueLimit).all<{ id: string }>();
  for (const { id } of toRevive.results ?? []) {
    revived += await runNamed(db, RETENTION_SQL.revive, { id, newJobId: crypto.randomUUID(), now: sweepNow, threshold });
  }

  // Worklist → per-row stop-before-claim (D12) → frozen claim → process.
  let processed = 0;
  let rpcBudget = purgeBudget;
  const work = await db.prepare(ORCH.worklist).bind(sweepNow, clock(), claimLimit).all<{ scan_id: string }>();
  for (const { scan_id } of work.results ?? []) {
    if (deadline - clock() - TICK_STOP_MARGIN_MS < MIN_JOB_HEADROOM_MS) break; // proactive stop-before-claim
    if (rpcBudget <= 0) break; // durable leftovers re-enter next tick
    const cid = crypto.randomUUID();
    const claimed = await runNamed(db, RETENTION_SQL.claim, { cid, now: clock(), RET_LEASE_MS, id: scan_id });
    if (claimed !== 1) continue; // not ours; skip
    rpcBudget--;
    processed++;
    await processJob(ctx, scan_id, cid);
  }

  // D16 bounded observing pass (dead-letter rows missed by transition-time alerts).
  const observe = await firstOrAllObserve(db, alertLimit);
  for (const row of observe) await alertOne(ctx, row.scan_id);

  console.log(
    `[retention-sweep] mode=enforce gate=0 enqueued=${enqueued} revived=${revived} processed=${processed} done=${ctx.counters.done} contended=${ctx.counters.contended} failed=${ctx.counters.failed}`
  );
  return {
    mode,
    gateCount,
    enqueued,
    revived,
    processed,
    done: ctx.counters.done,
    contended: ctx.counters.contended,
    failed: ctx.counters.failed,
  };
}

async function firstOrAllObserve(db: Env["DB"], alertLimit: number): Promise<{ scan_id: string }[]> {
  const p = prep(RETENTION_SQL.d16Observe);
  const rows = await db.prepare(p.text).bind(...bindOf(p, { alertLimit })).all<{ scan_id: string }>();
  return rows.results ?? [];
}
