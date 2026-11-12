// Audit review hold — reviewer operations behind /api/internal/audit-review:
// list held reports, fetch one (report JSON + Dim 6 cells/evidence, or the
// PDF), and release one through the normal buyer-email code.
// See lib/audit-review-hold.ts for the hold itself.

import {
  deliverBuyerEmail,
  readAuditSession,
  type AuditRunEnv,
  type BuyerEmailOutcome,
} from "./audit-fulfill-run";
import {
  adoptGeneratedReport,
  listReviewHolds,
  markReviewReleased,
  reconcileReviewSend,
  readReviewHold,
  reviewEvidenceKey,
  type ReviewHoldRow,
} from "./audit-review-hold";
import type { SessionRecord } from "./audit-types";
import { writeAuditSession } from "./audit-fulfill-run";
import { AUDIT_READY_EMAIL_COPY, type AuditReadyEmailCopy } from "./score-email";

// Session fields the reviewer needs; the buyer email is left out.
function sessionSummary(record: SessionRecord | null) {
  if (!record) return null;
  return {
    status: record.status,
    url: record.url,
    created_at: record.created_at,
    paid_at: record.paid_at ?? null,
    completed_at: record.completed_at ?? null,
    composite_score: record.composite_score ?? null,
    grade: record.grade ?? null,
    email_sent_at: record.email_sent_at ?? null,
  };
}

async function r2Json(bucket: R2Bucket, key: string): Promise<unknown | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text());
  } catch {
    return null;
  }
}

export async function listHeldAudits(env: AuditRunEnv) {
  const rows = await listReviewHolds(env.CITATION_DB);
  return await Promise.all(
    rows.map(async (hold) => ({
      hold,
      session: sessionSummary(await readAuditSession(env, hold.session_id)),
    })),
  );
}

export async function getHeldAuditForReview(env: AuditRunEnv, sessionId: string) {
  const hold = await readReviewHold(env.CITATION_DB, sessionId);
  if (!hold || hold.held !== 1) return null;
  const audit = await r2Json(env.AUDITS, `audits/${sessionId}.json`);
  const dims = (audit as { scan?: { dimensions?: Array<{ dimension_id?: number }> } } | null)?.scan
    ?.dimensions;
  return {
    hold,
    session: sessionSummary(await readAuditSession(env, sessionId)),
    audit,
    dim6_dimension: Array.isArray(dims) ? (dims.find((d) => d?.dimension_id === 6) ?? null) : null,
    dim6_evidence: await r2Json(env.AUDITS, reviewEvidenceKey(sessionId)),
  };
}

export async function getHeldAuditPdf(env: AuditRunEnv, sessionId: string): Promise<R2ObjectBody | null> {
  const hold = await readReviewHold(env.CITATION_DB, sessionId);
  if (!hold || hold.held !== 1) return null;
  return await env.AUDITS.get(`audits/${sessionId}.pdf`);
}

export type ReleaseResult =
  | { kind: "not_held" }
  | { kind: "not_ready"; status: string }
  | { kind: "released"; hold: ReviewHoldRow; email: BuyerEmailOutcome };

// Idempotent: a second release keeps the first released_at, and the buyer
// email is sent at most once (deliverBuyerEmail's D1 send claim). A failed
// send throws AuditReadyEmailError with the release already recorded; calling
// release again retries the email.
export async function releaseHeldAudit(
  env: AuditRunEnv,
  sessionId: string,
  origin: string,
  copy: AuditReadyEmailCopy | null = AUDIT_READY_EMAIL_COPY,
): Promise<ReleaseResult> {
  const existing = await readReviewHold(env.CITATION_DB, sessionId);
  if (!existing || existing.held !== 1) return { kind: "not_held" };
  const record = await readAuditSession(env, sessionId);
  // Only a generated report can be released.
  if (!record || record.status !== "ready") {
    return { kind: "not_ready", status: record?.status ?? "not_found" };
  }
  if (existing.generated_at === null) {
    await adoptGeneratedReport(env.CITATION_DB, sessionId, record.completed_at ?? Date.now());
  }
  const hold = await markReviewReleased(env.CITATION_DB, sessionId);
  if (!hold) return { kind: "not_held" };
  if (hold.released_at === null) return { kind: "not_ready", status: "generation_in_progress" };
  console.log(`AUDIT_REVIEW_RELEASED session_id=${sessionId} released_at=${hold.released_at}`);
  const email = await deliverBuyerEmail(env, record, origin, copy);
  return { kind: "released", hold, email };
}

// Resolve a send whose outcome was unknown (alert AUDIT_REVIEW_SEND_OUTCOME_UNKNOWN
// or AUDIT_REVIEW_DELIVERED_MARK_FAILED), after checking the Resend dashboard.
export async function reconcileHeldAuditSend(
  env: AuditRunEnv,
  sessionId: string,
  outcome: "delivered" | "not_sent",
): Promise<{ kind: "reconciled" } | { kind: "nothing_to_reconcile" }> {
  const changed = await reconcileReviewSend(env.CITATION_DB, sessionId, outcome);
  if (!changed) return { kind: "nothing_to_reconcile" };
  if (outcome === "delivered") {
    const record = await readAuditSession(env, sessionId);
    if (record && !record.email_sent_at) {
      await writeAuditSession(env, { ...record, email_sent_at: Date.now() });
    }
  }
  console.log(`AUDIT_REVIEW_SEND_RECONCILED session_id=${sessionId} outcome=${outcome}`);
  return { kind: "reconciled" };
}
