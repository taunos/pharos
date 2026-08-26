// P0-C2 Chunk E1 — scanner-owned capture-consumer RPC / state machine.
//
// The marketing Queue consumer (Chunk E2) drives the deferred-PDF lifecycle
// through these authenticated internal endpoints (future Service Binding).
// Scanner owns ALL D1 state, the per-scan lease, the artifact registry, and the
// fenced transitions; it NEVER touches R2, Browser Rendering, Resend, or
// marketing secrets. EVERY mutation carries its fence + live-matching-lease
// predicate IN the SQL (not merely a pre-read); zero affected rows is failure,
// never synthetic success. Logs carry a fixed class only.

import { Hono } from "hono";
import type { Env } from "./types";
import { constantTimeEqual } from "./auth";
import { emailR2KeyHash } from "./capture-outbox";

export const CONSUMER_LEASE_MS = 20 * 60 * 1000; // > 15 min wall bound + margin
const LEASE_CONTENTION_MARGIN_MS = 5_000;
const MAX_DEFER_MS = 24 * 60 * 60 * 1000;
const MAX_SNAPSHOT_BYTES = 256 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

const keyForScan = (scanId: string, emailHash: string, fence: number) => `score-reports/${scanId}/${emailHash}/${fence}.pdf`;
const keyPrefixValid = (key: string, scanId: string) =>
  typeof key === "string" && key.startsWith(`score-reports/${scanId}/`) && key.endsWith(".pdf");

// Exactly the six Resend fields; string values; headers = flat string→string map.
export function validSnapshotShape(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const allowed = ["from", "to", "subject", "text", "html", "headers"];
  const keys = Object.keys(o);
  if (keys.length !== allowed.length || !allowed.every((k) => k in o)) return false;
  for (const k of ["from", "to", "subject", "text", "html"]) if (typeof o[k] !== "string") return false;
  const h = o.headers;
  if (typeof h !== "object" || h === null || Array.isArray(h)) return false;
  for (const val of Object.values(h as Record<string, unknown>)) if (typeof val !== "string") return false;
  return true;
}

type JobRow = {
  job_id: string; scan_id: string; email: string | null; phase: string; queue_state: string;
  claim_id: string | null; claim_expires_at: number | null; op_fence: number | null;
  pdf_r2_key: string | null; delivery_snapshot: string | null;
  created_at: number; updated_at: number; next_attempt_at: number; email_sent_at: number | null;
};
type ScanLeaseRow = {
  id: string; email: string | null; op_lease_id: string | null; op_lease_expires_at: number | null;
  op_fence: number; retention_locked_at: number | null;
};

const loadJob = (env: Env, jobId: string) =>
  env.DB
    .prepare(
      `SELECT job_id, scan_id, email, phase, queue_state, claim_id, claim_expires_at, op_fence,
              pdf_r2_key, delivery_snapshot, created_at, updated_at, next_attempt_at, email_sent_at
         FROM capture_jobs WHERE job_id=?`
    )
    .bind(jobId)
    .first<JobRow>();

const loadScanLease = (env: Env, scanId: string) =>
  env.DB
    .prepare(`SELECT id, email, op_lease_id, op_lease_expires_at, op_fence, retention_locked_at FROM scans WHERE id=?`)
    .bind(scanId)
    .first<ScanLeaseRow>();

function leaseLive(scan: ScanLeaseRow | null, job: JobRow, now: number): boolean {
  return (
    !!scan &&
    scan.retention_locked_at === null &&
    scan.op_lease_id !== null &&
    scan.op_lease_id === job.claim_id &&
    scan.op_fence === job.op_fence &&
    (scan.op_lease_expires_at ?? 0) >= now
  );
}

// Live-matching-lease EXISTS fragment (binds: scanId, claimId, fence, now).
const LEASE_SQL = `EXISTS (SELECT 1 FROM scans WHERE id=? AND op_lease_id=? AND op_fence=? AND op_lease_expires_at>=? AND retention_locked_at IS NULL)`;

async function releaseLease(env: Env, scanId: string, leaseId: string, fence: number): Promise<void> {
  await env.DB
    .prepare(`UPDATE scans SET op_owner=NULL, op_lease_id=NULL, op_lease_expires_at=NULL WHERE id=? AND op_lease_id=? AND op_fence=?`)
    .bind(scanId, leaseId, fence)
    .run();
}

// ── 1. Claim ────────────────────────────────────────────────────────────────
export async function claimJob(env: Env, jobId: string, now: number) {
  const job = await loadJob(env, jobId);
  if (!job || job.queue_state !== "active" || job.phase === "done" || job.phase === "cancelled") {
    return { status: "ack_no_work" as const };
  }
  // Honor scheduling: a not-yet-due job is deferred WITHOUT acquiring a lease
  // (else a duplicate Queue message bypasses backpressure immediately).
  if ((job.next_attempt_at ?? 0) > now) return { status: "deferred" as const, next_attempt_at: job.next_attempt_at };

  const leaseId = crypto.randomUUID();
  const leaseExp = now + CONSUMER_LEASE_MS;
  const acquired = await env.DB
    .prepare(
      `UPDATE scans SET op_owner='capture', op_lease_id=?, op_lease_expires_at=?, op_fence=op_fence+1
        WHERE id=? AND retention_locked_at IS NULL AND (op_lease_id IS NULL OR op_lease_expires_at < ?)
        RETURNING op_fence`
    )
    .bind(leaseId, leaseExp, job.scan_id, now)
    .first<{ op_fence: number }>();

  if (!acquired) {
    const scan = await loadScanLease(env, job.scan_id);
    if (!scan || scan.retention_locked_at !== null) return { status: "ack_no_work" as const };
    // Contention: schedule repair past the live lease, but NEVER shorten an
    // existing later backoff (e.g. a daily-cap deferral) — MAX(existing, this).
    const contentionTime = (scan.op_lease_expires_at ?? now) + LEASE_CONTENTION_MARGIN_MS;
    await env.DB
      .prepare(`UPDATE capture_jobs SET next_attempt_at=MAX(next_attempt_at, ?) WHERE job_id=? AND queue_state='active' AND phase NOT IN ('done','cancelled')`)
      .bind(contentionTime, jobId)
      .run();
    const after = await env.DB.prepare(`SELECT next_attempt_at AS n FROM capture_jobs WHERE job_id=?`).bind(jobId).first<{ n: number }>();
    return { status: "deferred" as const, next_attempt_at: after?.n ?? contentionTime };
  }
  const fence = acquired.op_fence;

  // Claim the job — scheduling gate `next_attempt_at<=now` is IN the SQL (not only
  // the pre-read), floor pending→rendering, preserve email_sending anchor. Zero
  // rows ⇒ raced to terminal OR a fresh deferral landed → release THIS lease and
  // return the newly-persisted deferral (or ack).
  const claimRes = await env.DB
    .prepare(
      `UPDATE capture_jobs
          SET claim_id=?, claim_expires_at=?, op_fence=?,
              phase = CASE WHEN phase='pending' THEN 'rendering' ELSE phase END,
              updated_at = CASE WHEN phase='email_sending' THEN updated_at ELSE ? END
        WHERE job_id=? AND queue_state='active' AND phase NOT IN ('done','cancelled') AND next_attempt_at <= ?`
    )
    .bind(leaseId, leaseExp, fence, now, jobId, now)
    .run();
  if ((claimRes.meta?.changes ?? 0) === 0) {
    await releaseLease(env, job.scan_id, leaseId, fence);
    const cur = await loadJob(env, jobId);
    if (cur && (cur.next_attempt_at ?? 0) > now) return { status: "deferred" as const, next_attempt_at: cur.next_attempt_at };
    return { status: "ack_no_work" as const };
  }

  const claimed = (await loadJob(env, jobId))!;
  const s = await env.DB.prepare(`SELECT results_json, pdf_r2_key FROM scans WHERE id=?`).bind(job.scan_id).first<{ results_json: string; pdf_r2_key: string | null }>();

  // Complete resume projection — everything E2 needs to resume rendering,
  // uploaded (incl. send-only), OR email_sending directly. Never logged.
  return {
    status: "claimed" as const,
    job: {
      job_id: jobId, phase: claimed.phase, op_fence: fence, claim_id: leaseId, claim_expires_at: leaseExp,
      email: claimed.email, pdf_r2_key: claimed.pdf_r2_key, delivery_snapshot: claimed.delivery_snapshot,
      created_at: claimed.created_at, updated_at: claimed.updated_at,
    },
    scan: { id: job.scan_id, results_json: s?.results_json ?? null, pdf_r2_key: s?.pdf_r2_key ?? null },
  };
}

// ── 2. Register render artifact ───────────────────────────────────────────────
export async function registerArtifact(env: Env, jobId: string, claimId: string, now: number) {
  const job = await loadJob(env, jobId);
  if (!job) return { status: "error" as const, reason: "not_found" };
  if (job.claim_id !== claimId) return { status: "error" as const, reason: "claim" };
  if (job.phase !== "rendering") return { status: "error" as const, reason: "phase" };
  const scan = await loadScanLease(env, job.scan_id);
  if (!leaseLive(scan, job, now)) return { status: "error" as const, reason: "lease_lost" };
  // Derive the key from the IMMUTABLE job email, not mutable scans.email.
  if (!job.email) return { status: "error" as const, reason: "no_email" };
  const hash = await emailR2KeyHash(job.email);
  const key = keyForScan(job.scan_id, hash, job.op_fence!);
  if (!keyPrefixValid(key, job.scan_id)) return { status: "error" as const, reason: "key_invalid" };

  // Idempotent replay: ONLY the current job-owned artifact in a usable (not
  // purged) state counts.
  if (job.pdf_r2_key === key) {
    const art = await env.DB
      .prepare(`SELECT status FROM r2_artifacts WHERE r2_key=? AND capture_job_id=? AND status IN ('pending','active')`)
      .bind(key, jobId)
      .first<{ status: string }>();
    if (art) return { status: "already_registered" as const, r2_key: key };
  }

  // Both statements fenced on the live lease + current claim/fence. The INSERT is
  // conditional (SELECT…WHERE EXISTS), gated on statement 1 having set pdf_r2_key.
  try {
    const res = await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE capture_jobs SET pdf_r2_key=?
            WHERE job_id=? AND claim_id=? AND phase='rendering' AND op_fence=? AND queue_state='active' AND ${LEASE_SQL}`
        )
        .bind(key, jobId, claimId, job.op_fence, job.scan_id, claimId, job.op_fence, now),
      env.DB
        .prepare(
          `INSERT INTO r2_artifacts (r2_key, scan_id, capture_job_id, op_fence, created_at, status)
           SELECT ?, ?, ?, ?, ?, 'pending'
           WHERE ${LEASE_SQL}
             AND EXISTS (SELECT 1 FROM capture_jobs WHERE job_id=? AND claim_id=? AND op_fence=? AND phase='rendering' AND pdf_r2_key=?)`
        )
        .bind(key, job.scan_id, jobId, job.op_fence, now, job.scan_id, claimId, job.op_fence, now, jobId, claimId, job.op_fence, key),
    ]);
    if ((res[0]?.meta?.changes ?? 0) !== 1 || (res[1]?.meta?.changes ?? 0) !== 1) {
      return { status: "error" as const, reason: "fence_lost" };
    }
  } catch {
    return { status: "error" as const, reason: "artifact_conflict" };
  }
  return { status: "registered" as const, r2_key: key };
}

// ── 3. Mark uploaded ──────────────────────────────────────────────────────────
export async function markUploaded(env: Env, jobId: string, claimId: string, key: string, now: number) {
  const job = await loadJob(env, jobId);
  if (!job) return { status: "error" as const, reason: "not_found" };
  const scan = await loadScanLease(env, job.scan_id);
  // Idempotent replay REQUIRES the current claim + live lease.
  if (job.phase === "uploaded" && job.pdf_r2_key === key && job.claim_id === claimId && leaseLive(scan, job, now)) {
    return { status: "already_uploaded" as const };
  }
  if (job.claim_id !== claimId) return { status: "error" as const, reason: "claim" };
  if (job.phase !== "rendering") return { status: "error" as const, reason: "phase" };
  if (job.pdf_r2_key !== key) return { status: "error" as const, reason: "key_mismatch" };
  if (!leaseLive(scan, job, now)) return { status: "error" as const, reason: "lease_lost" };
  const art = await env.DB
    .prepare(`SELECT status FROM r2_artifacts WHERE r2_key=? AND capture_job_id=? AND status='pending'`)
    .bind(key, jobId)
    .first<{ status: string }>();
  if (!art) return { status: "error" as const, reason: "artifact_missing" };

  const res = await env.DB
    .prepare(
      `UPDATE capture_jobs SET phase='uploaded'
        WHERE job_id=? AND claim_id=? AND phase='rendering' AND op_fence=? AND pdf_r2_key=? AND queue_state='active' AND ${LEASE_SQL}`
    )
    .bind(jobId, claimId, job.op_fence, key, job.scan_id, claimId, job.op_fence, now)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return { status: "error" as const, reason: "lease_lost" };
  return { status: "uploaded" as const };
}

// ── 4. Pointer commit (v2.9 three-statement batch, exact order) ────────────────
export async function commitPointer(env: Env, jobId: string, claimId: string, key: string, now: number) {
  const job = await loadJob(env, jobId);
  if (!job) return { status: "error" as const, reason: "not_found" };
  if (job.queue_state !== "active" || job.phase !== "uploaded") return { status: "error" as const, reason: "phase" };
  if (job.claim_id !== claimId) return { status: "error" as const, reason: "claim" };
  if (job.pdf_r2_key !== key) return { status: "error" as const, reason: "key_mismatch" };
  if (!keyPrefixValid(key, job.scan_id)) return { status: "error" as const, reason: "key_invalid" };

  // Send-only / already-committed fast path: the scan pointer already equals the
  // key. A send-only job references a PRIOR job's active artifact, so accept it
  // when backed by the scan's active artifact regardless of its capture_job_id;
  // normalize the registry if needed. Only a NEW CAS requires a current-job artifact.
  const ptr0 = await env.DB.prepare(`SELECT pdf_r2_key AS k FROM scans WHERE id=?`).bind(job.scan_id).first<{ k: string | null }>();
  if (ptr0?.k === key) {
    const activeArt = await env.DB
      .prepare(`SELECT 1 AS r FROM r2_artifacts WHERE r2_key=? AND scan_id=? AND status='active'`)
      .bind(key, job.scan_id)
      .first<{ r: number }>();
    if (!activeArt) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE r2_artifacts SET status='superseded' WHERE scan_id=? AND status='active' AND r2_key<>? AND EXISTS (SELECT 1 FROM scans WHERE id=? AND pdf_r2_key=?)`).bind(job.scan_id, key, job.scan_id, key),
        env.DB.prepare(`UPDATE r2_artifacts SET status='active' WHERE r2_key=? AND EXISTS (SELECT 1 FROM scans WHERE id=? AND pdf_r2_key=?)`).bind(key, job.scan_id, key),
      ]);
    }
    return { status: "already_committed" as const };
  }

  const ownArt = await env.DB
    .prepare(`SELECT status FROM r2_artifacts WHERE r2_key=? AND scan_id=? AND capture_job_id=? AND status IN ('pending','active')`)
    .bind(key, job.scan_id, jobId)
    .first<{ status: string }>();
  if (!ownArt) return { status: "error" as const, reason: "artifact_missing" };

  const res = await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE scans SET pdf_r2_key=?, pdf_generated_at=?
          WHERE id=? AND op_lease_id=? AND op_fence=? AND op_lease_expires_at>=? AND retention_locked_at IS NULL
            AND EXISTS (SELECT 1 FROM r2_artifacts WHERE r2_key=? AND scan_id=? AND capture_job_id=? AND status IN ('pending','active'))`
      )
      .bind(key, now, job.scan_id, claimId, job.op_fence, now, key, job.scan_id, jobId),
    env.DB
      .prepare(`UPDATE r2_artifacts SET status='superseded' WHERE scan_id=? AND status='active' AND r2_key<>? AND EXISTS (SELECT 1 FROM scans WHERE id=? AND pdf_r2_key=?)`)
      .bind(job.scan_id, key, job.scan_id, key),
    env.DB
      .prepare(`UPDATE r2_artifacts SET status='active' WHERE r2_key=? AND EXISTS (SELECT 1 FROM scans WHERE id=? AND pdf_r2_key=?)`)
      .bind(key, job.scan_id, key),
  ]);

  if ((res[0]?.meta?.changes ?? 0) > 0) return { status: "committed" as const };

  // Zero-row CAS: a mere expired lease is NOT compensation. Inspect atomically.
  const scan = await loadScanLease(env, job.scan_id);
  if (!scan) {
    // Missing scan ⇒ no future capture can ever commit this key ⇒ safe to delete.
    return { status: "compensation_required" as const, r2_key: key };
  }
  const ptr = await env.DB.prepare(`SELECT pdf_r2_key AS k FROM scans WHERE id=?`).bind(job.scan_id).first<{ k: string | null }>();
  if (ptr?.k === key) return { status: "already_committed" as const };
  // Scan exists and this uploaded job still OWNS the key → a later claim resumes
  // uploaded and commits the SAME object. Never delete underneath it.
  return { status: "preserved_for_retry" as const };
}

// Separate confirmation — mark purged ONLY after marketing confirms the R2
// delete AND deletion is still provably safe (key unreferenced by any scan).
export async function confirmCompensation(env: Env, jobId: string, key: string) {
  // Enforce the SAME safe condition that authorizes compensation: under the
  // current contract compensation_required is emitted only for a MISSING scan.
  const job = await loadJob(env, jobId);
  if (!job) return { status: "refused" as const, reason: "no_job" };
  if (!keyPrefixValid(key, job.scan_id)) return { status: "refused" as const, reason: "key_invalid" };
  // Scan must still be missing (an existing scan — even with a different pointer — is refused).
  const scan = await loadScanLease(env, job.scan_id);
  if (scan) return { status: "refused" as const, reason: "scan_exists" };
  // No scan anywhere points to the key (defensive; a purged scan can't, but check).
  const referenced = await env.DB.prepare(`SELECT 1 AS r FROM scans WHERE pdf_r2_key=? LIMIT 1`).bind(key).first<{ r: number }>();
  if (referenced) return { status: "refused" as const, reason: "referenced" };
  const res = await env.DB
    .prepare(`UPDATE r2_artifacts SET status='purged' WHERE r2_key=? AND capture_job_id=? AND status IN ('pending','superseded')`)
    .bind(key, jobId)
    .run();
  // Exactly one owned artifact row must change.
  if ((res.meta?.changes ?? 0) !== 1) return { status: "refused" as const, reason: "no_compensable_artifact" };
  return { status: "confirmed" as const };
}

// ── 5. Freeze email snapshot ──────────────────────────────────────────────────
export async function freezeSnapshot(env: Env, jobId: string, claimId: string, snapshotJson: string, now: number) {
  const job = await loadJob(env, jobId);
  if (!job) return { status: "error" as const, reason: "not_found" };
  const scan = await loadScanLease(env, job.scan_id);
  // Replay: return the stored snapshot verbatim ONLY under the current claim,
  // active queue state, and live lease; otherwise force a re-claim.
  if (job.phase === "email_sending" && job.delivery_snapshot !== null) {
    if (job.claim_id === claimId && job.queue_state === "active" && leaseLive(scan, job, now)) {
      // Carry the immutable anchor so the consumer's 24h check uses the stored value.
      return { status: "already_frozen" as const, snapshot: job.delivery_snapshot, updated_at: job.updated_at };
    }
    return { status: "error" as const, reason: "claim_or_lease" };
  }
  if (job.claim_id !== claimId) return { status: "error" as const, reason: "claim" };
  if (job.phase !== "uploaded") return { status: "error" as const, reason: "phase" };
  if (!leaseLive(scan, job, now)) return { status: "error" as const, reason: "lease_lost" };
  if (!job.pdf_r2_key) return { status: "error" as const, reason: "no_key" };
  const ptr = await env.DB.prepare(`SELECT pdf_r2_key AS k FROM scans WHERE id=?`).bind(job.scan_id).first<{ k: string | null }>();
  if (ptr?.k !== job.pdf_r2_key) return { status: "error" as const, reason: "pointer_uncommitted" };

  const res = await env.DB
    .prepare(
      `UPDATE capture_jobs SET phase='email_sending', delivery_snapshot=?, updated_at=?
        WHERE job_id=? AND claim_id=? AND phase='uploaded' AND op_fence=? AND queue_state='active' AND delivery_snapshot IS NULL AND ${LEASE_SQL}`
    )
    .bind(snapshotJson, now, jobId, claimId, job.op_fence, job.scan_id, claimId, job.op_fence, now)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return { status: "error" as const, reason: "cas_failed" };
  return { status: "frozen" as const, updated_at: now };
}

// ── email_ambiguous disposition (claim/lease-gated) ───────────────────────────
// 24h-window failsafe: flips ONLY queue_state → email_ambiguous, preserves
// phase='email_sending' + the anchor (updated_at), clears claim, releases the
// matching lease. Consumer acks after this confirms.
export async function markEmailAmbiguous(env: Env, jobId: string, claimId: string, now: number) {
  const job = await loadJob(env, jobId);
  if (!job) return { status: "error" as const, reason: "not_found" };
  if (job.claim_id !== claimId) return { status: "error" as const, reason: "claim" };
  if (job.phase !== "email_sending") return { status: "error" as const, reason: "phase" };
  const scan = await loadScanLease(env, job.scan_id);
  if (!leaseLive(scan, job, now)) return { status: "error" as const, reason: "lease_lost" };
  const res = await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE capture_jobs SET queue_state='email_ambiguous', claim_id=NULL, claim_expires_at=NULL
          WHERE job_id=? AND claim_id=? AND phase='email_sending' AND queue_state='active' AND op_fence=? AND ${LEASE_SQL}`
      )
      .bind(jobId, claimId, job.op_fence, job.scan_id, claimId, job.op_fence, now),
    env.DB
      .prepare(`UPDATE scans SET op_owner=NULL, op_lease_id=NULL, op_lease_expires_at=NULL WHERE id=? AND op_lease_id=? AND op_fence=?`)
      .bind(job.scan_id, claimId, job.op_fence),
  ]);
  if ((res[0]?.meta?.changes ?? 0) !== 1 || (res[1]?.meta?.changes ?? 0) !== 1) return { status: "error" as const, reason: "fence_lost" };
  return { status: "ambiguous" as const };
}

// ── DLQ disposition (authenticated; no claim required) ────────────────────────
// Sets queue_state='dead_letter' for an active nonterminal job, PRESERVING phase
// and the email_sending anchor (updated_at untouched), clears claim state, and
// releases any matching capture lease. Idempotent no-op if already terminal/disposed.
export async function markDeadLetter(env: Env, jobId: string) {
  const job = await loadJob(env, jobId);
  if (!job) return { status: "ack_no_work" as const };
  if (job.queue_state !== "active" || job.phase === "done" || job.phase === "cancelled") return { status: "noop" as const };
  const res = await env.DB
    .prepare(
      `UPDATE capture_jobs SET queue_state='dead_letter', claim_id=NULL, claim_expires_at=NULL
        WHERE job_id=? AND queue_state='active' AND phase NOT IN ('done','cancelled')`
    )
    .bind(jobId)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return { status: "noop" as const };
  // Release the capture lease only if this job's claim still holds it.
  if (job.claim_id && job.op_fence !== null) await releaseLease(env, job.scan_id, job.claim_id, job.op_fence);
  return { status: "dead_lettered" as const };
}

// ── 6. Complete delivery ──────────────────────────────────────────────────────
export async function completeDelivery(env: Env, jobId: string, claimId: string, now: number) {
  const job = await loadJob(env, jobId);
  if (!job) return { status: "error" as const, reason: "not_found" };
  if (job.phase === "done") return { status: "already_done" as const };
  if (job.claim_id !== claimId) return { status: "error" as const, reason: "claim" };
  if (job.phase !== "email_sending") return { status: "error" as const, reason: "phase" };
  const scan = await loadScanLease(env, job.scan_id);
  if (!leaseLive(scan, job, now)) return { status: "error" as const, reason: "lease_lost" };

  const res = await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE capture_jobs
            SET phase='done', email_sent_at=?, updated_at=?, email=NULL, delivery_snapshot=NULL, claim_id=NULL, claim_expires_at=NULL
          WHERE job_id=? AND claim_id=? AND phase='email_sending' AND op_fence=? AND queue_state='active' AND ${LEASE_SQL}`
      )
      .bind(now, now, jobId, claimId, job.op_fence, job.scan_id, claimId, job.op_fence, now),
    env.DB
      .prepare(`UPDATE scans SET op_owner=NULL, op_lease_id=NULL, op_lease_expires_at=NULL WHERE id=? AND op_lease_id=? AND op_fence=?`)
      .bind(job.scan_id, claimId, job.op_fence),
  ]);
  // Both sides must land: the transition AND the matching lease release.
  if ((res[0]?.meta?.changes ?? 0) !== 1 || (res[1]?.meta?.changes ?? 0) !== 1) return { status: "error" as const, reason: "fence_lost" };
  return { status: "done" as const };
}

// ── 7. Expected deferral / release ────────────────────────────────────────────
export async function deferRelease(env: Env, jobId: string, claimId: string, nextAttemptAt: number, now: number) {
  if (!isInt(nextAttemptAt) || nextAttemptAt < now || nextAttemptAt > now + MAX_DEFER_MS) {
    return { status: "error" as const, reason: "bad_next_attempt" };
  }
  const job = await loadJob(env, jobId);
  if (!job) return { status: "error" as const, reason: "not_found" };
  if (job.claim_id !== claimId) return { status: "error" as const, reason: "claim" };
  const scan = await loadScanLease(env, job.scan_id);
  if (!leaseLive(scan, job, now)) return { status: "error" as const, reason: "lease_lost" };

  // Preserve phase + updated_at (anchor); clear claim; release ONLY the matching
  // lease — all in one batch, both fenced on the live lease.
  const res = await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE capture_jobs SET next_attempt_at=?, claim_id=NULL, claim_expires_at=NULL
          WHERE job_id=? AND claim_id=? AND op_fence=? AND queue_state='active' AND phase NOT IN ('done','cancelled') AND ${LEASE_SQL}`
      )
      .bind(nextAttemptAt, jobId, claimId, job.op_fence, job.scan_id, claimId, job.op_fence, now),
    env.DB
      .prepare(`UPDATE scans SET op_owner=NULL, op_lease_id=NULL, op_lease_expires_at=NULL WHERE id=? AND op_lease_id=? AND op_fence=?`)
      .bind(job.scan_id, claimId, job.op_fence),
  ]);
  // Both sides must land: the deferral AND the matching lease release.
  if ((res[0]?.meta?.changes ?? 0) !== 1 || (res[1]?.meta?.changes ?? 0) !== 1) return { status: "error" as const, reason: "claim" };
  return { status: "deferred" as const, next_attempt_at: nextAttemptAt };
}

// ── HTTP mount ────────────────────────────────────────────────────────────────
function authed(env: Env, provided: string | undefined): boolean {
  return !!env.CAPTURE_CONSUMER_KEY && !!provided && constantTimeEqual(provided, env.CAPTURE_CONSUMER_KEY);
}

export function mountCaptureConsumerRpc(app: Hono<{ Bindings: Env }>): void {
  const base = "/api/internal/capture";
  const guard = (c: { req: { header: (n: string) => string | undefined }; env: Env }) =>
    authed(c.env, c.req.header("x-internal-capture-consumer-key"));
  const readBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> => {
    try {
      const b = await c.req.json();
      return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const run = async (
    c: { req: { json: () => Promise<unknown>; header: (n: string) => string | undefined }; env: Env; json: (b: unknown, s?: number) => Response },
    validate: (b: Record<string, unknown>) => boolean,
    op: (b: Record<string, unknown>) => Promise<{ status: string } & Record<string, unknown>>,
  ): Promise<Response> => {
    if (!guard(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
    const b = await readBody(c);
    if (!b || !validate(b)) return c.json({ ok: false, error: "invalid input" }, 400);
    try {
      const r = await op(b);
      return c.json({ ok: r.status !== "error", ...r }, r.status === "error" ? 422 : 200);
    } catch {
      console.error("[capture-rpc] class=db_error");
      return c.json({ ok: false, error: "db error" }, 500);
    }
  };

  app.post(`${base}/claim`, (c) => run(c, (b) => isUuid(b.job_id), (b) => claimJob(c.env, b.job_id as string, Date.now())));
  app.post(`${base}/register-artifact`, (c) =>
    run(c, (b) => isUuid(b.job_id) && isUuid(b.claim_id), (b) => registerArtifact(c.env, b.job_id as string, b.claim_id as string, Date.now())),
  );
  app.post(`${base}/mark-uploaded`, (c) =>
    run(c, (b) => isUuid(b.job_id) && isUuid(b.claim_id) && typeof b.r2_key === "string", (b) => markUploaded(c.env, b.job_id as string, b.claim_id as string, b.r2_key as string, Date.now())),
  );
  app.post(`${base}/commit-pointer`, (c) =>
    run(c, (b) => isUuid(b.job_id) && isUuid(b.claim_id) && typeof b.r2_key === "string", (b) => commitPointer(c.env, b.job_id as string, b.claim_id as string, b.r2_key as string, Date.now())),
  );
  app.post(`${base}/confirm-compensation`, (c) =>
    run(c, (b) => isUuid(b.job_id) && typeof b.r2_key === "string", (b) => confirmCompensation(c.env, b.job_id as string, b.r2_key as string)),
  );
  app.post(`${base}/freeze-snapshot`, (c) =>
    run(
      c,
      (b) => isUuid(b.job_id) && isUuid(b.claim_id) && validSnapshotShape(b.snapshot) && utf8Bytes(JSON.stringify(b.snapshot)) <= MAX_SNAPSHOT_BYTES,
      (b) => freezeSnapshot(c.env, b.job_id as string, b.claim_id as string, JSON.stringify(b.snapshot), Date.now()),
    ),
  );
  app.post(`${base}/complete`, (c) => run(c, (b) => isUuid(b.job_id) && isUuid(b.claim_id), (b) => completeDelivery(c.env, b.job_id as string, b.claim_id as string, Date.now())));
  app.post(`${base}/defer`, (c) =>
    run(c, (b) => isUuid(b.job_id) && isUuid(b.claim_id) && isInt(b.next_attempt_at), (b) => deferRelease(c.env, b.job_id as string, b.claim_id as string, b.next_attempt_at as number, Date.now())),
  );
  app.post(`${base}/mark-ambiguous`, (c) =>
    run(c, (b) => isUuid(b.job_id) && isUuid(b.claim_id), (b) => markEmailAmbiguous(c.env, b.job_id as string, b.claim_id as string, Date.now())),
  );
  app.post(`${base}/mark-dead-letter`, (c) =>
    run(c, (b) => isUuid(b.job_id), (b) => markDeadLetter(c.env, b.job_id as string)),
  );
}
