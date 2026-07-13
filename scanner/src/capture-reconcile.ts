// P0-C2 Chunk F1 — scanner-owned R2 artifact reconciliation.
//
// Because Queue-bounded capture makes an expired lease PROVE the writer ended,
// reconciliation can safely garbage-collect the registry. It operates on
// r2_artifacts (scanner-owned D1), deletes physical objects via the marketing R2
// Service Binding, and marks rows `purged` ONLY after a confirmed R2 delete
// (delete-first, mark-second ⇒ idempotent + crash-safe).
//
// LEASE-TIME SAFETY: candidate AGE uses the stable sweep timestamp (`opts.now`),
// but every lease acquisition / renewal / pre-delete authorization uses a live
// injectable clock (default Date.now()). Before each external delete the lease is
// renewed if low and the RPC is bounded below the remaining lease window, so an
// external delete can never still be running when another owner acquires the
// scan lease. The authoritative pointer comes from the acquisition RETURNING.
// Logs are counts-only.

import type { Env } from "./types";
import { MarketingR2Client } from "./marketing-r2-client";

const CONSUMER_LEASE_MS = 20 * 60 * 1000; // must match the consumer's lease bound (candidate age)
const RECONCILE_LEASE_MS = 5 * 60 * 1000;
const R2_DELETE_BUDGET_MS = 10_000; // max wall-time budgeted per external R2 delete
const MIN_RPC_WINDOW_MS = 1_000; // below this remaining window, renew (or fail) before the RPC
const LEASE_RENEW_MARGIN_MS = 5_000; // renew when remaining < budget + margin
const MAX_TIMESTAMP_MS = 4_102_444_800_000; // ~year 2100
const DEFAULT_SCAN_LIMIT = 100;
const MAX_SCAN_LIMIT = 10_000;
// One Service Binding invocation per external delete. Cloudflare caps a request
// chain at 32 invocations, so the whole-pass delete budget stays well below 32
// (leaving headroom for the chain). Excess artifacts remain eligible next pass.
const DEFAULT_DELETE_BUDGET = 25;
const MAX_DELETE_BUDGET = 25;

// Fenced-authorization fragment for a delete/purge of `:key` at the CURRENT clock:
// live reconcile lease, not tombstoned, and `:key` is NOT the current pointer.
// Binds: scanId, leaseId, fence, clockNow, key.
const AUTH_SQL = `EXISTS (SELECT 1 FROM scans s WHERE s.id=? AND s.op_lease_id=? AND s.op_fence=? AND s.op_lease_expires_at>=? AND s.retention_locked_at IS NULL AND (s.pdf_r2_key IS NULL OR s.pdf_r2_key<>?))`;
// Fenced lease-live fragment for normalization. Binds: scanId, leaseId, fence, clockNow.
const LEASE_SQL = `EXISTS (SELECT 1 FROM scans WHERE id=? AND op_lease_id=? AND op_fence=? AND op_lease_expires_at>=? AND retention_locked_at IS NULL)`;

function boundedInt(v: number, name: string, max: number): number {
  if (!Number.isInteger(v) || v <= 0 || v > max) throw new Error(`reconcile_bad_${name}`);
  return v;
}

export type ReconcileResult = { scans: number; purged: number; activated: number; skipped: number };

// `opts.now` = stable sweep timestamp (candidate age). `opts.clock` = live clock
// for lease timing (default Date.now()). `opts.deleteBudget` = whole-pass cap on
// EXTERNAL DELETE operations only (normalization is bounded by `limit`/scanLimit).
export async function runReconcile(
  env: Env,
  opts: { now: number; limit?: number; deleteBudget?: number; clock?: () => number },
): Promise<ReconcileResult> {
  if (!env.MARKETING_R2 || !env.RECONCILE_R2_KEY) throw new Error("reconcile misconfigured");
  const sweepNow = opts.now;
  if (!Number.isInteger(sweepNow) || sweepNow <= 0 || sweepNow > MAX_TIMESTAMP_MS) throw new Error("reconcile_bad_now");
  const scanLimit = boundedInt(opts.limit ?? DEFAULT_SCAN_LIMIT, "limit", MAX_SCAN_LIMIT);
  const deleteBudget = boundedInt(opts.deleteBudget ?? DEFAULT_DELETE_BUDGET, "budget", MAX_DELETE_BUDGET);
  const clock = opts.clock ?? (() => Date.now());
  const db = env.DB;
  const staleThreshold = sweepNow - CONSUMER_LEASE_MS;
  const r2 = new MarketingR2Client(env.MARKETING_R2, env.RECONCILE_R2_KEY);

  const rows = await db
    .prepare(
      `SELECT DISTINCT a.scan_id AS scan_id FROM r2_artifacts a
        WHERE a.status='superseded'
           OR (a.status='pending' AND a.created_at < ?)
           OR NOT EXISTS (SELECT 1 FROM scans s WHERE s.id = a.scan_id)
        ORDER BY a.scan_id
        LIMIT ?`
    )
    .bind(staleThreshold, scanLimit)
    .all<{ scan_id: string }>();

  let purged = 0;
  let activated = 0;
  let scans = 0;
  let skipped = 0;
  let remaining = deleteBudget; // whole-pass EXTERNAL-DELETE budget
  for (const { scan_id } of rows.results ?? []) {
    if (remaining <= 0) break;
    const r = await reconcileScan(db, r2, scan_id, sweepNow, staleThreshold, remaining, clock);
    purged += r.purged;
    activated += r.activated;
    scans++;
    if (r.skipped) skipped++;
    remaining -= r.ops;
  }
  console.log(`[capture-reconcile] scans=${scans} purged=${purged} activated=${activated} skipped=${skipped}`);
  return { scans, purged, activated, skipped };
}

// Fenced renew (always). Returns the new expiry; throws (fail closed) if the
// lease was lost/stolen (0 rows).
async function renewLease(db: Env["DB"], scanId: string, leaseId: string, fence: number, clock: () => number): Promise<number> {
  const nowMs = clock();
  const renewed = await db
    .prepare(
      `UPDATE scans SET op_lease_expires_at=?
        WHERE id=? AND op_lease_id=? AND op_fence=? AND op_lease_expires_at>=? AND retention_locked_at IS NULL
        RETURNING op_lease_expires_at`
    )
    .bind(nowMs + RECONCILE_LEASE_MS, scanId, leaseId, fence, nowMs)
    .first<{ op_lease_expires_at: number }>();
  if (!renewed) throw new Error("reconcile_lease_lost"); // expired or acquired by a newer owner
  return renewed.op_lease_expires_at;
}

// Renew only if headroom is low; returns the (possibly updated) expiry.
async function ensureLeaseHeadroom(db: Env["DB"], scanId: string, leaseId: string, fence: number, leaseExpiry: number, clock: () => number): Promise<number> {
  if (leaseExpiry - clock() >= R2_DELETE_BUDGET_MS + LEASE_RENEW_MARGIN_MS) return leaseExpiry;
  return renewLease(db, scanId, leaseId, fence, clock);
}

// Fenced pre-delete authorization at the CURRENT clock.
function authorizeDelete(db: Env["DB"], r2Key: string, scanId: string, leaseId: string, fence: number, clockNow: number) {
  return db
    .prepare(`SELECT 1 AS r FROM r2_artifacts a WHERE a.r2_key=? AND a.scan_id=? AND a.status IN ('pending','superseded') AND ${AUTH_SQL}`)
    .bind(r2Key, scanId, scanId, leaseId, fence, clockNow, r2Key)
    .first<{ r: number }>();
}

async function reconcileScan(
  db: Env["DB"],
  r2: MarketingR2Client,
  scanId: string,
  sweepNow: number,
  staleThreshold: number,
  budget: number,
  clock: () => number,
): Promise<{ purged: number; activated: number; skipped: boolean; ops: number }> {
  const exists = await db.prepare(`SELECT 1 AS r FROM scans WHERE id=?`).bind(scanId).first<{ r: number }>();

  // ── Missing scan: no lease; delete every registered object idempotently, each
  // revalidated as still-missing immediately before the (bounded) external delete.
  if (!exists) {
    let purged = 0;
    let ops = 0;
    const arts = await db
      .prepare(`SELECT r2_key FROM r2_artifacts WHERE scan_id=? AND status IN ('pending','active','superseded') LIMIT ?`)
      .bind(scanId, budget)
      .all<{ r2_key: string }>();
    for (const { r2_key } of arts.results ?? []) {
      const auth = await db
        .prepare(`SELECT 1 AS r FROM r2_artifacts WHERE r2_key=? AND scan_id=? AND status IN ('pending','active','superseded') AND NOT EXISTS (SELECT 1 FROM scans WHERE id=?)`)
        .bind(r2_key, scanId, scanId)
        .first<{ r: number }>();
      if (!auth) continue; // scan reappeared / already purged → fail closed (skip this key)
      await r2.deleteArtifact(r2_key, R2_DELETE_BUDGET_MS);
      const upd = await db
        .prepare(`UPDATE r2_artifacts SET status='purged' WHERE r2_key=? AND scan_id=? AND status IN ('pending','active','superseded') AND NOT EXISTS (SELECT 1 FROM scans WHERE id=?)`)
        .bind(r2_key, scanId, scanId)
        .run();
      if ((upd.meta?.changes ?? 0) !== 1) throw new Error("reconcile_purge_lost");
      purged++;
      ops++;
    }
    return { purged, activated: 0, skipped: false, ops };
  }

  // ── Existing scan: acquire a fenced reconcile lease at the CURRENT clock,
  // taking the authoritative pointer + expiry from RETURNING. Live lease ⇒ skip.
  const acquireNow = clock();
  const leaseId = crypto.randomUUID();
  const acquired = await db
    .prepare(
      `UPDATE scans SET op_owner='reconcile', op_lease_id=?, op_lease_expires_at=?, op_fence=op_fence+1
        WHERE id=? AND retention_locked_at IS NULL AND (op_lease_id IS NULL OR op_lease_expires_at < ?)
        RETURNING op_fence, pdf_r2_key, op_lease_expires_at`
    )
    .bind(leaseId, acquireNow + RECONCILE_LEASE_MS, scanId, acquireNow)
    .first<{ op_fence: number; pdf_r2_key: string | null; op_lease_expires_at: number }>();
  if (!acquired) return { purged: 0, activated: 0, skipped: true, ops: 0 };
  const fence = acquired.op_fence;
  const pointer = acquired.pdf_r2_key;
  let leaseExpiry = acquired.op_lease_expires_at;
  let activated = 0;

  try {
    // Normalization — the pointer-registry proof is gated on the CURRENT live
    // lease AND the current scans.pdf_r2_key; activation must affect exactly one
    // row (a zero-row activation from lease/fence/pointer replacement fails closed).
    if (pointer !== null) {
      const proof = await db
        .prepare(
          `SELECT 1 AS r FROM r2_artifacts a WHERE a.r2_key=? AND a.scan_id=? AND a.status IN ('pending','active')
             AND EXISTS (SELECT 1 FROM scans s WHERE s.id=? AND s.op_lease_id=? AND s.op_fence=? AND s.op_lease_expires_at>=? AND s.retention_locked_at IS NULL AND s.pdf_r2_key=?)`
        )
        .bind(pointer, scanId, scanId, leaseId, fence, clock(), pointer)
        .first<{ r: number }>();
      if (!proof) return { purged: 0, activated: 0, skipped: true, ops: 0 };
      await db
        .prepare(`UPDATE r2_artifacts SET status='superseded' WHERE scan_id=? AND status='active' AND r2_key<>? AND ${LEASE_SQL}`)
        .bind(scanId, pointer, scanId, leaseId, fence, clock())
        .run();
      const act = await db
        .prepare(`UPDATE r2_artifacts SET status='active' WHERE r2_key=? AND scan_id=? AND status IN ('pending','active') AND ${LEASE_SQL}`)
        .bind(pointer, scanId, scanId, leaseId, fence, clock())
        .run();
      if ((act.meta?.changes ?? 0) !== 1) throw new Error("reconcile_normalize_failed"); // fence/pointer replaced → fail closed
      activated = 1;
    }

    // Delete non-pointer stale/superseded artifacts (budget-bounded on external
    // deletes). Before each delete: renew the lease if low, re-authorize at the
    // current clock, then bound the RPC below the remaining lease window.
    let purged = 0;
    let ops = 0;
    const toDelete = await db
      .prepare(
        `SELECT r2_key FROM r2_artifacts WHERE scan_id=? AND (? IS NULL OR r2_key<>?)
           AND (status='superseded' OR (status='pending' AND created_at < ?)) LIMIT ?`
      )
      .bind(scanId, pointer, pointer, staleThreshold, budget)
      .all<{ r2_key: string }>();
    for (const { r2_key } of toDelete.results ?? []) {
      leaseExpiry = await ensureLeaseHeadroom(db, scanId, leaseId, fence, leaseExpiry, clock);
      if (!(await authorizeDelete(db, r2_key, scanId, leaseId, fence, clock()))) throw new Error("reconcile_auth_lost");
      // Recompute the safe window with the LIVE clock (time may have elapsed
      // during the auth query). If it's below the minimum RPC window, renew +
      // re-authorize; if renewal fails, throw before calling R2. The timeout is
      // strictly positive and NEVER rounded above `leaseExpiry - clock - margin`.
      let safeWindow = leaseExpiry - clock() - LEASE_RENEW_MARGIN_MS;
      if (safeWindow < MIN_RPC_WINDOW_MS) {
        leaseExpiry = await renewLease(db, scanId, leaseId, fence, clock); // throws if lost
        if (!(await authorizeDelete(db, r2_key, scanId, leaseId, fence, clock()))) throw new Error("reconcile_auth_lost");
        safeWindow = leaseExpiry - clock() - LEASE_RENEW_MARGIN_MS;
        if (safeWindow < MIN_RPC_WINDOW_MS) throw new Error("reconcile_lease_lost"); // still no room → fail closed
      }
      const timeoutMs = Math.min(R2_DELETE_BUDGET_MS, safeWindow); // > 0, ≤ leaseExpiry - clock - margin
      await r2.deleteArtifact(r2_key, timeoutMs);
      const upd = await db
        .prepare(`UPDATE r2_artifacts SET status='purged' WHERE r2_key=? AND scan_id=? AND status IN ('pending','superseded') AND ${AUTH_SQL}`)
        .bind(r2_key, scanId, scanId, leaseId, fence, clock(), r2_key)
        .run();
      if ((upd.meta?.changes ?? 0) !== 1) throw new Error("reconcile_purge_lost");
      purged++;
      ops++;
    }
    return { purged, activated, skipped: false, ops };
  } finally {
    // Best-effort fenced release; never masks the original error. A newer owner's
    // lease (different id/fence) is never released. Crashes rely on lease expiry.
    try {
      await db
        .prepare(`UPDATE scans SET op_owner=NULL, op_lease_id=NULL, op_lease_expires_at=NULL WHERE id=? AND op_lease_id=? AND op_fence=?`)
        .bind(scanId, leaseId, fence)
        .run();
    } catch {
      /* swallow */
    }
  }
}
