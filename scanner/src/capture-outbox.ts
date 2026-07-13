// P0-C2 Chunk C — scanner-owned capture-outbox PRODUCER + WATCHDOG.
//
// Scanner owns D1, the per-scan operation lease, the durable outbox state, Queue
// production, and the repair watchdog. It does NOT render PDFs, write R2, mint
// delivery snapshots, or send email — those are marketing-owned (Chunk E).
//
// This module is additive: the existing live /api/scan/:id/capture-email route
// (marketing's synchronous path) is untouched. The new authenticated endpoint
// POST /api/scan/:id/capture-outbox is for the future coordinated cutover and is
// dormant until a Queue + cron are wired (NOT in this chunk).

import { Hono } from "hono";
import type { Env } from "./types";
import { normalizeEmail } from "./email-normalize";
import { requireScannerAdminAuth } from "./auth";

const REQ_LEASE_MS = 30_000; // producer holds the lease only across a few D1 ops
const RESEND_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // Resend idempotency-key retention
const WATCHDOG_BATCH_LIMIT = 100; // bounded per pass

// ── SQL (fenced; lease predicate P inlined) ──────────────────────────────────

// Acquire the capture lease: rejects a tombstoned scan and a live lease; bumps
// the monotonic fence and RETURNS it. Binds: leaseId, leaseExp, scanId, now.
const ACQUIRE_LEASE_SQL = `UPDATE scans
    SET op_owner='capture', op_lease_id=?, op_lease_expires_at=?, op_fence=op_fence+1
  WHERE id=? AND retention_locked_at IS NULL AND (op_lease_id IS NULL OR op_lease_expires_at < ?)
  RETURNING op_fence`;

// Fenced scan-field update — normalized email + CLAMPED opt-in + token together.
// Binds: email, opted_in, unsubscribe_token, scanId, leaseId, fence, now.
const FENCED_SCAN_UPDATE_SQL = `UPDATE scans
    SET email = ?,
        email_opted_in_rescan = CASE WHEN unsubscribed_at IS NULL THEN ? ELSE 0 END,
        unsubscribe_token = ?
  WHERE id=? AND op_lease_id=? AND op_fence=? AND op_lease_expires_at>=? AND retention_locked_at IS NULL`;

// Plain conditional outbox insert (NO ON CONFLICT — an unexpected unique
// conflict must roll the batch back). WHERE EXISTS(fence) makes a lost fence
// insert zero rows. Binds: job, scanId, email, phase, pdfKey, now, now, scanId,
// leaseId, fence, now.
const COND_INSERT_SQL = `INSERT INTO capture_jobs (job_id, scan_id, email, phase, pdf_r2_key, created_at, updated_at)
  SELECT ?, ?, ?, ?, ?, ?, ?
  WHERE EXISTS (SELECT 1 FROM scans WHERE id=? AND op_lease_id=? AND op_fence=? AND op_lease_expires_at>=? AND retention_locked_at IS NULL)`;

// Release only the MATCHING lease/fence. Binds: scanId, leaseId, fence.
const RELEASE_LEASE_SQL = `UPDATE scans
    SET op_owner=NULL, op_lease_id=NULL, op_lease_expires_at=NULL
  WHERE id=? AND op_lease_id=? AND op_fence=?`;

// ── types ─────────────────────────────────────────────────────────────────

export type CaptureOutboxInput = {
  email: string; // caller-normalized
  opted_in: 0 | 1;
  unsubscribe_token: string;
};

export type CaptureOutboxResult =
  | { status: "deferred"; job_id: string; reused: boolean; sendOnly: boolean; enqueued: boolean }
  | { status: "conflict"; reason: "different_email_in_flight" }
  | { status: "unavailable"; reason: "tombstoned_or_contended" | "fence_lost" | "insert_conflict" }
  | { status: "not_found" };

// sha256(normalizedEmail)[:16] hex — mirrors marketing's R2 key scheme (locked
// decision 8) so the producer can tell whether the committed pointer belongs to
// THIS email (send-only reuse) vs a different email (fresh render).
export async function emailR2KeyHash(email: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeEmail(email)));
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex.slice(0, 16);
}

// ── producer (v2.9 §2a) ──────────────────────────────────────────────────────

export async function runCaptureOutbox(
  env: Env,
  scanId: string,
  input: CaptureOutboxInput,
  now: number
): Promise<CaptureOutboxResult> {
  const db = env.DB;
  const leaseId = crypto.randomUUID();
  const leaseExp = now + REQ_LEASE_MS;

  // 2. Acquire the lease (retention_locked_at IS NULL; expired-or-empty; fence++).
  const acquired = await db
    .prepare(ACQUIRE_LEASE_SQL)
    .bind(leaseId, leaseExp, scanId, now)
    .first<{ op_fence: number }>();
  if (!acquired) {
    const exists = await db
      .prepare("SELECT id FROM scans WHERE id=?")
      .bind(scanId)
      .first<{ id: string }>();
    if (!exists) return { status: "not_found" };
    return { status: "unavailable", reason: "tombstoned_or_contended" };
  }
  const fence = acquired.op_fence;

  // 3. Resolve under the lease.
  const inflight = await db
    .prepare("SELECT job_id, email FROM capture_jobs WHERE scan_id=? AND phase NOT IN ('done','cancelled')")
    .bind(scanId)
    .first<{ job_id: string; email: string | null }>();

  let resolvedJobId: string;
  let skipInsert = false;
  let insertPhase: "pending" | "uploaded" = "pending";
  let insertPdfKey: string | null = null;
  let sendOnly = false;

  if (inflight) {
    if ((inflight.email ?? null) !== input.email) {
      // Different-email unfinished job: release, mutate nothing, stable conflict.
      await releaseLease(env, scanId, leaseId, fence);
      return { status: "conflict", reason: "different_email_in_flight" };
    }
    // Same-email unfinished job: reuse + enqueue its existing id (never a fresh one).
    resolvedJobId = inflight.job_id;
    skipInsert = true;
  } else {
    // No in-flight job → send-only reuse if a matching-email committed pointer
    // is backed by its active artifact; otherwise a fresh render job.
    const ptr = await db
      .prepare(
        `SELECT s.pdf_r2_key AS ptr,
                (SELECT 1 FROM r2_artifacts a WHERE a.scan_id=s.id AND a.status='active' AND a.r2_key=s.pdf_r2_key) AS active_ptr
           FROM scans s WHERE s.id=?`
      )
      .bind(scanId)
      .first<{ ptr: string | null; active_ptr: number | null }>();
    const hash = await emailR2KeyHash(input.email);
    const prefix = `score-reports/${scanId}/${hash}/`;
    if (ptr?.ptr && ptr.active_ptr === 1 && ptr.ptr.startsWith(prefix)) {
      resolvedJobId = crypto.randomUUID();
      insertPhase = "uploaded";
      insertPdfKey = ptr.ptr;
      sendOnly = true;
    } else {
      resolvedJobId = crypto.randomUUID();
      insertPhase = "pending";
      insertPdfKey = null;
    }
  }

  // 4. ONE DB.batch(): fenced scan-field update + (unless reusing) conditional insert.
  const stmts = [
    db
      .prepare(FENCED_SCAN_UPDATE_SQL)
      .bind(input.email, input.opted_in, input.unsubscribe_token, scanId, leaseId, fence, now),
  ];
  if (!skipInsert) {
    stmts.push(
      db
        .prepare(COND_INSERT_SQL)
        .bind(resolvedJobId, scanId, input.email, insertPhase, insertPdfKey, now, now, scanId, leaseId, fence, now)
    );
  }

  let results: D1Result[];
  try {
    results = await db.batch(stmts);
  } catch {
    // Unexpected unique conflict (or other SQL error) → batch rolled back, no
    // scan-field change persisted, nothing to enqueue.
    await releaseLease(env, scanId, leaseId, fence);
    return { status: "unavailable", reason: "insert_conflict" };
  }

  // Zero affected rows = fence lost (NOT success).
  const scanChanges = results[0]?.meta?.changes ?? 0;
  const insertChanges = skipInsert ? 1 : results[1]?.meta?.changes ?? 0;
  if (scanChanges === 0 || insertChanges === 0) {
    await releaseLease(env, scanId, leaseId, fence);
    return { status: "unavailable", reason: "fence_lost" };
  }

  // 5. Release only the matching lease/fence.
  await releaseLease(env, scanId, leaseId, fence);

  // 6/7/8. Enqueue exactly { job_id }; set enqueued_at only after a confirmed
  // send. A send failure (or an absent binding) leaves the durable job with
  // enqueued_at NULL for the watchdog to repair — never delete, never fake it.
  let enqueued = false;
  if (env.CAPTURE_QUEUE) {
    try {
      await env.CAPTURE_QUEUE.send({ job_id: resolvedJobId });
      enqueued = true;
    } catch {
      enqueued = false;
    }
  }
  if (enqueued) {
    await db
      .prepare("UPDATE capture_jobs SET enqueued_at=? WHERE job_id=? AND enqueued_at IS NULL")
      .bind(now, resolvedJobId)
      .run();
  }

  // 9. Deferred result. No PDF/R2/snapshot/email here.
  return { status: "deferred", job_id: resolvedJobId, reused: skipInsert, sendOnly, enqueued };
}

async function releaseLease(env: Env, scanId: string, leaseId: string, fence: number): Promise<void> {
  await env.DB.prepare(RELEASE_LEASE_SQL).bind(scanId, leaseId, fence).run();
}

// ── watchdog ────────────────────────────────────────────────────────────────

export type WatchdogResult = { scanned: number; reenqueued: number; send_failed: number; ambiguous: number };

// Scanner-owned repair sweep. Injectable `now` for tests. Processes only
// queue_state='active'; never rewinds phase; logs counts only.
export async function runCaptureWatchdog(
  env: Env,
  opts: { now: number; limit?: number }
): Promise<WatchdogResult> {
  const db = env.DB;
  const now = opts.now;
  const limit = opts.limit ?? WATCHDOG_BATCH_LIMIT;
  const windowStart = now - RESEND_DEDUP_WINDOW_MS;

  // (a) BOUNDED ambiguity transition: email_sending past Resend's 24h window →
  // email_ambiguous (preserve phase, do NOT enqueue). `updated_at` is the
  // IMMUTABLE phase-entry ANCHOR while phase='email_sending' (set once on
  // uploaded→email_sending in Chunk E); this disposition preserves phase and
  // does NOT advance the anchor. Ordered + LIMITed so the whole pass mutates at
  // most `limit` rows TOTAL (ambiguity + re-enqueue), not per-branch.
  const ambCandidates = await db
    .prepare(
      `SELECT job_id FROM capture_jobs
        WHERE queue_state='active' AND phase='email_sending' AND updated_at <= ?
        ORDER BY updated_at, job_id
        LIMIT ?`
    )
    .bind(windowStart, limit)
    .all<{ job_id: string }>();
  const ambRows = ambCandidates.results ?? [];
  for (const { job_id } of ambRows) {
    await db
      .prepare(
        `UPDATE capture_jobs SET queue_state='email_ambiguous'
          WHERE job_id=? AND queue_state='active' AND phase='email_sending'`
      )
      .bind(job_id)
      .run();
  }
  const ambiguous = ambRows.length;

  // (b) re-enqueue candidates, bounded by the REMAINING budget (total ≤ limit).
  // Outer guard excludes terminal done|cancelled from EVERY disjunct:
  //   - claim-free unsent pending|uploaded (enqueued_at IS NULL, claim_id IS NULL)
  //     — includes a send-only 'uploaded' job whose INITIAL send failed;
  //   - expired claim on rendering|uploaded|email_sending (phase preserved;
  //     surviving email_sending are within-window post step (a));
  //   - due backpressure (next_attempt_at > 0 AND <= now).
  const remaining = Math.max(0, limit - ambiguous);
  const rows =
    remaining === 0
      ? []
      : (
          await db
            .prepare(
              `SELECT job_id FROM capture_jobs
                WHERE phase NOT IN ('done','cancelled')
                  AND queue_state='active'
                  AND (
                    (phase IN ('pending','uploaded') AND enqueued_at IS NULL AND claim_id IS NULL)
                    OR (phase IN ('rendering','uploaded','email_sending') AND claim_expires_at IS NOT NULL AND claim_expires_at < ?)
                    OR (next_attempt_at > 0 AND next_attempt_at <= ?)
                  )
                ORDER BY updated_at, job_id
                LIMIT ?`
            )
            .bind(now, now, remaining)
            .all<{ job_id: string }>()
        ).results ?? [];
  let reenqueued = 0;
  let sendFailed = 0;

  for (const { job_id } of rows) {
    if (!env.CAPTURE_QUEUE) {
      sendFailed++; // no producer binding → leave repairable for a later pass
      continue;
    }
    try {
      await env.CAPTURE_QUEUE.send({ job_id });
    } catch {
      sendFailed++; // leave the row eligible; do not stamp enqueued_at
      continue;
    }
    // Confirmed send: stamp enqueued_at, clear the due retry marker + claim
    // ownership, RETAIN phase AND updated_at. Re-enqueue is not a phase
    // transition, so it must never advance the email_sending 24h anchor.
    await db
      .prepare(
        `UPDATE capture_jobs
            SET enqueued_at=?, next_attempt_at=0, claim_id=NULL, claim_expires_at=NULL
          WHERE job_id=? AND queue_state='active'`
      )
      .bind(now, job_id)
      .run();
    reenqueued++;
  }

  // Counts only — never email, tokens, payloads, or raw scan ids.
  console.log(
    `[capture-watchdog] scanned=${rows.length} reenqueued=${reenqueued} send_failed=${sendFailed} ambiguous=${ambiguous}`
  );
  return { scanned: rows.length, reenqueued, send_failed: sendFailed, ambiguous };
}

// ── endpoint ────────────────────────────────────────────────────────────────

export function mountCaptureOutbox(app: Hono<{ Bindings: Env }>): void {
  app.post("/api/scan/:id/capture-outbox", async (c) => {
    if (!requireScannerAdminAuth(c.env.INTERNAL_SCANNER_ADMIN_KEY, c.req.header("x-internal-scanner-admin-key"))) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    const scanId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }
    const b = body as Record<string, unknown>;
    // Presence + types.
    if (
      typeof b.email !== "string" ||
      typeof b.unsubscribe_token !== "string" ||
      (typeof b.email_opted_in_rescan !== "number" && typeof b.email_opted_in_rescan !== "boolean")
    ) {
      return c.json({ ok: false, error: "missing fields" }, 400);
    }
    // opt-in: ONLY boolean or numeric 0|1 (reject arbitrary numbers like 5 / 2.5).
    let opted_in: 0 | 1;
    if (typeof b.email_opted_in_rescan === "boolean") {
      opted_in = b.email_opted_in_rescan ? 1 : 0;
    } else if (b.email_opted_in_rescan === 0 || b.email_opted_in_rescan === 1) {
      opted_in = b.email_opted_in_rescan;
    } else {
      return c.json({ ok: false, error: "invalid opt-in" }, 400);
    }
    // token: non-empty after trim.
    if (b.unsubscribe_token.trim().length === 0) {
      return c.json({ ok: false, error: "invalid token" }, 400);
    }
    // email: valid syntax after normalization.
    const email = normalizeEmail(b.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ ok: false, error: "invalid email" }, 400);
    }
    const input: CaptureOutboxInput = { email, opted_in, unsubscribe_token: b.unsubscribe_token };

    let result: CaptureOutboxResult;
    try {
      result = await runCaptureOutbox(c.env, scanId, input, Date.now());
    } catch {
      // Counts/class only — never scan id, email, token, job id, payload, or
      // raw exception text (may embed identifiers).
      console.error("[capture-outbox] producer error class=db_error");
      return c.json({ ok: false, error: "db error" }, 500);
    }

    switch (result.status) {
      case "deferred":
        return c.json({ ok: true, status: "deferred", job_id: result.job_id, reused: result.reused, enqueued: result.enqueued });
      case "conflict":
        return c.json({ ok: false, status: "conflict", error: "another capture is in flight for this scan" }, 409);
      case "not_found":
        return c.json({ ok: false, error: "scan not found" }, 404);
      case "unavailable":
        return c.json({ ok: false, status: "unavailable", error: "capture temporarily unavailable" }, 503);
    }
  });
}
