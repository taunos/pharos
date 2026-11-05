// Slice Q (Q4 + v1.1 A6 + fix round) — F2 Day-N audit run, moved from
// app/api/audit-fulfill/route.ts (handleF2DayNAudit) so the astrant-fulfill
// Queue consumer runs it. Must NOT import Next.
//
// Logic unchanged apart from:
//   - returns a typed result instead of a NextResponse;
//   - A6: the claim CAS clears day{N}_audit_failed_at atomically, so a
//     claimed row never carries a stale failed_at (citation-tracking's
//     stale-claim cleanup can then reset a crashed re-claim);
//   - the Day-N email carries Resend idempotencyKey f2-day{N}:{f2_session_id};
//   - fix round: day{N}_audit_email_sent_at (migration 0016) is written in its
//     own statement right after Resend confirms the send. Once the email is
//     sent, a later failure never clears fired_at nor sets failed_at: it alerts
//     F2_DAYN_SENT_UNRECORDED, leaves the row claimed and throws (queue retry).
//     The claim also takes a row whose email is sent but whose succeeded_at is
//     missing; such a re-run skips the scan + send and only writes succeeded_at.
//     citation-tracking's stale-claim cleanup never resets a sent day.
//
// Residual: if the email_sent_at write itself fails right after the send, the
// stale-claim cleanup resets fired_at and the next daily sweep re-sends; that
// re-send falls inside Resend's 24 h idempotency window for the same key.

import { runScan, type AuditEnv } from "./audit-pipeline";
import { sendF2DayNAuditEmail, F2_VERIFICATION_COPY_APPROVED } from "./f2-email";
import { generateAuditRecs } from "./f2-generators/audit-recs";
import { alertOperator } from "./operator-alerts";
import {
  loadRecheckReport,
  runRecheckVerification,
  type ImplVerifier,
  type RecheckReport,
} from "./impl-verification";
import { loadImplVerifier } from "./impl-verify-adapter";

// Verification report v1: Day-N due dates are anchored on applied_at (Day 0)
// by lib/impl-verification.ts; the claim below only ever sees 'active' rows,
// so a delivered-but-unapplied row ('awaiting_application') never fires.
// A row with applied_at set gets, at Day 30, the rescan PLUS the acceptance
// checks again, stored as the 'day30' verification record and compared to
// Day 0 (checks) and the baseline (score). While the verification email copy
// is unapproved, that first run stores the record, sets
// day30_verification_held_at, alerts the operator once and releases the claim;
// later claims are refused (no rescan) until the copy is approved, then the
// email is sent from the stored record. Verified rows never run Day 60/90.
// Legacy 'active' rows without applied_at keep the payment-anchored flow
// unchanged.
export interface ImplDayDeps {
  verifier?: ImplVerifier | null; // default: loadImplVerifier()
  fetchImpl?: typeof fetch;
  verificationCopyApproved?: boolean; // default: F2_VERIFICATION_COPY_APPROVED
}

export interface ImplDayRunEnv extends AuditEnv {
  INTERNAL_FULFILL_KEY: string;
  CITATION_DB: D1Database;
  RESEND_API_KEY: string;
}

export type ImplDayRunResult =
  | { kind: "done" }
  | { kind: "deduped" }
  // Error after the claim and BEFORE the email was sent: fired_at cleared +
  // failed_at set, so the next daily citation-tracking sweep re-sends it. The
  // queue does NOT also retry.
  | { kind: "failed_reset" }
  // Verified Day 30 with unapproved email copy: record stored, claim released,
  // operator alerted once; later sweeps are deduped until the copy is approved.
  | { kind: "held" };

interface F2ImplementationRow {
  session_id: string;
  customer_email: string;
  customer_domain: string;
  brand_name: string;
  customer_id: string;
  baseline_scan_id: string | null;
  payment_succeeded_at: number;
  status: string;
  email_sent_at: number | null;
  applied_at: number | null;
  patch_r2_key: string | null;
  baseline_scoring_version: string | null;
  day30_verification_held_at: number | null;
}

export async function runImplDayAudit(
  env: ImplDayRunEnv,
  implAudit: { day_n: 30 | 60 | 90; f2_session_id: string },
  deps: ImplDayDeps = {},
): Promise<ImplDayRunResult> {
  const { day_n, f2_session_id } = implAudit;
  const firedAtCol = `day${day_n}_audit_fired_at`;
  const succeededAtCol = `day${day_n}_audit_succeeded_at`;
  const failedAtCol = `day${day_n}_audit_failed_at`;
  const emailSentAtCol = `day${day_n}_audit_email_sent_at`;
  const now = Math.floor(Date.now() / 1000);
  const copyApproved = deps.verificationCopyApproved ?? F2_VERIFICATION_COPY_APPROVED;
  // Verified rows (applied_at set): Day 60/90 never run; Day 30 is skipped
  // (no rescan) while a stored recheck is held for unapproved copy.
  const verifiedGuard =
    day_n === 30
      ? copyApproved
        ? ""
        : "AND (applied_at IS NULL OR day30_verification_held_at IS NULL)"
      : "AND applied_at IS NULL";

  // CAS UPDATE to claim race-free. Column name is built from validated day_n
  // (30/60/90 only per regex) — no injection risk. A6: clears failed_at.
  // Fix round: also claims a sent-but-unrecorded day (only succeeded_at left).
  const casResult = await env.CITATION_DB.prepare(
    `UPDATE implementation_sessions
     SET ${firedAtCol} = ?, ${failedAtCol} = NULL, updated_at = ?
     WHERE session_id = ? AND status = 'active'
       AND (${firedAtCol} IS NULL
            OR (${emailSentAtCol} IS NOT NULL AND ${succeededAtCol} IS NULL))
       ${verifiedGuard}`,
  )
    .bind(now, now, f2_session_id)
    .run();

  if (casResult.meta.changes !== 1) {
    // Already fired, or session not in active state — idempotent no-op
    return { kind: "deduped" };
  }

  let emailSent = false;
  try {
    const f2 = await env.CITATION_DB.prepare(
      `SELECT session_id, customer_email, customer_domain, brand_name,
              customer_id, baseline_scan_id, payment_succeeded_at, status,
              ${emailSentAtCol} AS email_sent_at,
              applied_at, patch_r2_key, baseline_scoring_version, day30_verification_held_at
       FROM implementation_sessions WHERE session_id = ?`,
    )
      .bind(f2_session_id)
      .first<F2ImplementationRow>();

    if (!f2) {
      throw new Error(`F2_SESSION_NOT_FOUND f2_session_id=${f2_session_id}`);
    }

    if (f2.email_sent_at != null) {
      emailSent = true;
      console.log(`F2_AUDIT_DAYN_RESUME_AFTER_SEND session_id=${f2_session_id} day_n=${day_n}`);
    } else {
      if ((await scanAndSend(env, f2, day_n, f2_session_id, deps, copyApproved)) === "held") {
        // holdForCopy already released the claim (same batch as the marker).
        console.log(`F2_AUDIT_DAYN_HELD session_id=${f2_session_id} day_n=${day_n} reason=verification_copy_pending`);
        return { kind: "held" };
      }
      emailSent = true;
      // Delivered marker, in its own statement, right after the confirmed send.
      const sentTime = Math.floor(Date.now() / 1000);
      await env.CITATION_DB.prepare(
        `UPDATE implementation_sessions SET ${emailSentAtCol} = ?, updated_at = ?
         WHERE session_id = ?`,
      )
        .bind(sentTime, sentTime, f2_session_id)
        .run();
    }

    // Mark succeeded
    const succeedTime = Math.floor(Date.now() / 1000);
    await env.CITATION_DB.prepare(
      `UPDATE implementation_sessions
       SET ${succeededAtCol} = ?, updated_at = ?
       WHERE session_id = ?`,
    )
      .bind(succeedTime, succeedTime, f2_session_id)
      .run();

    console.log(`F2_AUDIT_DAYN_COMPLETED session_id=${f2_session_id} day_n=${day_n}`);
    return { kind: "done" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (emailSent) {
      // The customer has the email: never clear fired_at / set failed_at (that
      // would re-send it). Leave the row claimed and let the queue retry.
      console.error(`F2_DAYN_SENT_UNRECORDED session_id=${f2_session_id} day_n=${day_n} err=${msg}`);
      await alertOperator(env, "F2_DAYN_SENT_UNRECORDED", f2_session_id, `day_n=${day_n}`);
      throw err;
    }
    console.error(`F2_AUDIT_DAYN_FAILED session_id=${f2_session_id} day_n=${day_n} err=${msg}`);
    // Mark failed + clear fired_at so next sweep can retry
    const failTime = Math.floor(Date.now() / 1000);
    await env.CITATION_DB.prepare(
      `UPDATE implementation_sessions
       SET ${firedAtCol} = NULL, ${failedAtCol} = ?, failed_reason = ?, updated_at = ?
       WHERE session_id = ?`,
    )
      .bind(failTime, msg.slice(0, 500), failTime, f2_session_id)
      .run()
      .catch(() => {});
    return { kind: "failed_reset" };
  }
}

// Baseline read + Day-N re-scan + audit-recs + email. Throws on any failure,
// including a failed send.
async function scanAndSend(
  env: ImplDayRunEnv,
  f2: F2ImplementationRow,
  day_n: 30 | 60 | 90,
  f2_session_id: string,
  deps: ImplDayDeps,
  copyApproved: boolean,
): Promise<"sent" | "held"> {
  // Read baseline scan
  let baselineScore = 0;
  let baselineScoringVersion = f2.baseline_scoring_version;
  if (f2.baseline_scan_id) {
    const baselineObj = await env.AUDITS.get(`f2-baseline-scans/${f2.baseline_scan_id}.json`);
    if (baselineObj) {
      const baseline = JSON.parse(await baselineObj.text()) as {
        composite?: { score?: number };
        scoring_version?: string;
      };
      baselineScore = baseline.composite?.score ?? 0;
      baselineScoringVersion ??= baseline.scoring_version ?? null;
    }
  }

  const verified = day_n === 30 && f2.applied_at != null;
  let verification: RecheckReport | undefined;
  let currentScore: number;

  if (verified && f2.day30_verification_held_at != null) {
    // Held recheck, copy now approved (the claim guard ensures it): send from
    // the stored record. No rescan, no checks.
    verification = await loadRecheckReport(env, f2_session_id, {
      score: baselineScore,
      scoringVersion: baselineScoringVersion,
    });
    currentScore = verification.currentScore;
  } else {
    // Re-scan customer domain at Day-N
    const currentScan = await runScan(f2.customer_domain, env.INTERNAL_FULFILL_KEY, env.SCANNER_SVC);
    currentScore = currentScan.composite.score;

    // Verification report v1: Day-30 recheck of a verified (applied) session.
    if (verified) {
      const scanR2Key = `f2-recheck-scans/${f2_session_id}-day30.json`;
      await env.AUDITS.put(scanR2Key, JSON.stringify(currentScan));
      verification = await runRecheckVerification(
        env,
        {
          session_id: f2_session_id,
          customer_domain: f2.customer_domain,
          patch_r2_key: f2.patch_r2_key,
          checkpoint: "day30",
          baselineScore,
          baselineScoringVersion,
          currentScore,
          currentScoringVersion: currentScan.scoring_version ?? null,
          scanR2Key,
        },
        {
          verifier: deps.verifier !== undefined ? deps.verifier : loadImplVerifier(),
          fetchImpl: deps.fetchImpl,
        },
      );
      if (!copyApproved) {
        // Stored once; no customer email until the copy is approved.
        await holdForCopy(env, f2_session_id);
        return "held";
      }
    }
  }

  // v1.0: no cite-share numbers yet (v1.1+ wires the citation-tracking
  // aggregator), so none are passed and no citation delta is shown.

  // Generate audit-recs prose (deterministic-fallback path at v1.0)
  const recs = await generateAuditRecs(env, {
    brand_name: f2.brand_name,
    domain: f2.customer_domain,
    day_n,
    baseline_scan_summary: `composite=${baselineScore}`,
    current_scan_summary: `composite=${currentScore}`,
  });

  // Day-90 includes Standard CTA (D8 spec)
  const autoPilotCheckoutUrl =
    day_n === 90 ? "https://astrant.io/subscriptions" : undefined;

  // Send Day-N audit email (text-only at v1.0; PDF rendering deferred to v1.1+)
  const emailResult = await sendF2DayNAuditEmail(env, {
    toEmail: f2.customer_email,
    brandName: f2.brand_name,
    dayN: day_n,
    sessionId: f2_session_id,
    recs,
    baselineScore,
    currentScore,
    autoPilotCheckoutUrl,
    verification,
  }, { verificationCopyApproved: copyApproved });

  if (!emailResult.ok) {
    throw new Error(`F2_AUDIT_EMAIL_SEND_FAILED day_n=${day_n} err=${emailResult.error}`);
  }
  return "sent";
}

// Marks the stored Day-30 recheck as held for unapproved copy and releases the
// Day-30 claim (no failed_at) in ONE batch: a held marker never lands without
// the release, so the row cannot be stranded claimed-and-held. Once the copy is
// approved the next sweep claims again and sends from the stored record.
// Only the call that sets the marker alerts, so the operator gets ONE alert.
async function holdForCopy(env: ImplDayRunEnv, f2_session_id: string): Promise<void> {
  const t = Math.floor(Date.now() / 1000);
  const [res] = await env.CITATION_DB.batch([
    env.CITATION_DB.prepare(
      `UPDATE implementation_sessions SET day30_verification_held_at = ?, updated_at = ?
       WHERE session_id = ? AND day30_verification_held_at IS NULL`,
    ).bind(t, t, f2_session_id),
    env.CITATION_DB.prepare(
      `UPDATE implementation_sessions SET day30_audit_fired_at = NULL, updated_at = ?
       WHERE session_id = ?`,
    ).bind(t, f2_session_id),
  ]);
  if (res.meta.changes === 1) {
    await alertOperator(
      env,
      "F2_VERIFICATION_COPY_PENDING",
      f2_session_id,
      "Day-30 recheck stored; email held until F2_VERIFICATION_COPY_APPROVED is set",
    );
  }
}
