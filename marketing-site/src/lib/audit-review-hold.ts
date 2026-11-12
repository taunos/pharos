// Audit review hold (2026-11-12, reopening plan step 2).
//
// The first N paid standalone Audit orders that reach fulfillment are
// generated as normal, then held: no buyer email, no report on the results
// page, no PDF/JSON download, until a reviewer releases them
// (/api/internal/audit-review). N = AUDIT_REVIEW_HOLD_COUNT (wrangler var).
//
// FAIL-CLOSED:
//   - an absent or malformed AUDIT_REVIEW_HOLD_COUNT holds the default 10;
//     only a plain non-negative integer string changes it ("0" = no hold).
//   - every D1 error throws. Fulfillment then retries (queue) instead of
//     delivering; the read-side gates (status / PDF / JSON) withhold.
//
// State lives in CITATION_DB.audit_review_holds (migration 0019). The count is
// decided in D1, in one INSERT OR IGNORE ... SELECT, so concurrent orders
// cannot both take the last slot and a retry reuses the first decision.
//
// Delivery paths gated (every one runs through this module):
//   1. buyer email, fresh run           audit-fulfill-run.ts deliverBuyerEmail
//   2. buyer email, resume after ready  (queue retry/duplicate, DLQ never emails,
//                                       /api/audit-fulfill operator replay)
//   3. results page report + links      /api/audit-status/[sessionId]
//   4. PDF download                     /audit-results/[sessionId]/pdf
//   5. JSON download (on-page report)   /audit-results/[sessionId]/json
// ap- (AutoPilot) and impl-day sessions are not standalone Audit orders and
// are not held (their checkouts have their own gates).

export const DEFAULT_AUDIT_REVIEW_HOLD_COUNT = 10;
// A generation lease older than this is abandoned: it is longer than any
// writer can live (Queue consumer invocations stop at 15 min wall time;
// /api/audit-fulfill has maxDuration 300 s), so its holder is dead and can no
// longer write after the lease is retaken.
export const REVIEW_GEN_LEASE_MS = 30 * 60 * 1000;

export type ReviewHoldRow = {
  session_id: string;
  held: 0 | 1;
  decided_at: number;
  released_at: number | null;
  gen_claimed_at: number | null;
  generated_at: number | null;
  send_claimed_at: number | null;
  delivered_at: number | null;
};

export function parseReviewHoldCount(raw: string | undefined): number {
  if (typeof raw === "string" && /^\d{1,6}$/.test(raw)) return Number(raw);
  return DEFAULT_AUDIT_REVIEW_HOLD_COUNT;
}

// True while the report must not reach the buyer.
export function isWithheld(row: ReviewHoldRow | null): boolean {
  return row !== null && row.held === 1 && row.released_at === null;
}

export async function readReviewHold(
  db: D1Database,
  sessionId: string,
): Promise<ReviewHoldRow | null> {
  return await db
    .prepare(`SELECT * FROM audit_review_holds WHERE session_id = ?`)
    .bind(sessionId)
    .first<ReviewHoldRow>();
}

// Idempotent: the first call for a session decides held = 1 while fewer than
// `limit` sessions are held, else 0; later calls return that same row.
export async function decideReviewHold(
  db: D1Database,
  sessionId: string,
  limit: number,
  now: number = Date.now(),
): Promise<ReviewHoldRow> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO audit_review_holds (session_id, held, decided_at)
       SELECT ?, CASE WHEN (SELECT COUNT(*) FROM audit_review_holds WHERE held = 1) < ? THEN 1 ELSE 0 END, ?`,
    )
    .bind(sessionId, limit, now)
    .run();
  const row = await readReviewHold(db, sessionId);
  if (!row) throw new Error("AUDIT_REVIEW_HOLD_DECISION_MISSING");
  return row;
}

// Reviewer release (only of a generated report). Returns null if the row is
// not a held row; an already released row stays at its first released_at.
export async function markReviewReleased(
  db: D1Database,
  sessionId: string,
  now: number = Date.now(),
): Promise<ReviewHoldRow | null> {
  await db
    .prepare(
      `UPDATE audit_review_holds SET released_at = ?
       WHERE session_id = ? AND held = 1 AND released_at IS NULL AND generated_at IS NOT NULL`,
    )
    .bind(now, sessionId)
    .run();
  const row = await readReviewHold(db, sessionId);
  return row && row.held === 1 ? row : null;
}

// Lease on storing a held report's artifacts. Only one run may write them,
// and never after the report was generated: what the reviewer reads (and
// releases) is what the buyer gets.
export async function claimReviewGeneration(
  db: D1Database,
  sessionId: string,
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE audit_review_holds SET gen_claimed_at = ?
       WHERE session_id = ? AND held = 1 AND released_at IS NULL AND generated_at IS NULL
         AND (gen_claimed_at IS NULL OR gen_claimed_at < ?)`,
    )
    .bind(now, sessionId, now - REVIEW_GEN_LEASE_MS)
    .run();
  return res.meta.changes === 1;
}

// Terminal marker for generation: own lease, not yet generated.
export async function markReviewGenerated(
  db: D1Database,
  sessionId: string,
  claimedAt: number,
  now: number = Date.now(),
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE audit_review_holds SET generated_at = ?
       WHERE session_id = ? AND held = 1 AND generated_at IS NULL AND gen_claimed_at = ?`,
    )
    .bind(now, sessionId, claimedAt)
    .run();
  return res.meta.changes === 1;
}

export async function dropReviewGenerationClaim(
  db: D1Database,
  sessionId: string,
  claimedAt: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE audit_review_holds SET gen_claimed_at = NULL
       WHERE session_id = ? AND gen_claimed_at = ? AND generated_at IS NULL`,
    )
    .bind(sessionId, claimedAt)
    .run();
}

// A held row whose KV session is ready but generated_at was never written:
// a session that went ready before this code ran, or a run that died between
// the KV ready write and its generated marker. Called only once the KV
// session is ready; never while a generation lease is live (its holder may
// still be writing).
export async function adoptGeneratedReport(
  db: D1Database,
  sessionId: string,
  generatedAt: number,
  now: number = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE audit_review_holds SET generated_at = ?
       WHERE session_id = ? AND held = 1 AND generated_at IS NULL
         AND (gen_claimed_at IS NULL OR gen_claimed_at < ?)`,
    )
    .bind(generatedAt, sessionId, now - REVIEW_GEN_LEASE_MS)
    .run();
}

// CAS claim on the post-release buyer email. Exactly one caller wins. The
// claim never expires on its own: only a send CONFIRMED not sent gives it
// back, so a send whose outcome is unknown (transport exception, crash, or the
// delivered marker not written) is never repeated automatically. Resend's idempotency key only lasts 24 h.
export async function claimReviewSend(
  db: D1Database,
  sessionId: string,
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE audit_review_holds SET send_claimed_at = ?
       WHERE session_id = ? AND held = 1 AND released_at IS NOT NULL AND generated_at IS NOT NULL
         AND delivered_at IS NULL AND send_claimed_at IS NULL`,
    )
    .bind(now, sessionId)
    .run();
  return res.meta.changes === 1;
}

// Terminal marker: carries the full authority (own claim, released, not yet
// delivered) in its own WHERE clause.
export async function markReviewDelivered(
  db: D1Database,
  sessionId: string,
  claimedAt: number,
  now: number = Date.now(),
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE audit_review_holds SET delivered_at = ?
       WHERE session_id = ? AND held = 1 AND released_at IS NOT NULL
         AND delivered_at IS NULL AND send_claimed_at = ?`,
    )
    .bind(now, sessionId, claimedAt)
    .run();
  return res.meta.changes === 1;
}

// Give the claim back after a failed send so the next release/retry can send.
export async function dropReviewSendClaim(
  db: D1Database,
  sessionId: string,
  claimedAt: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE audit_review_holds SET send_claimed_at = NULL
       WHERE session_id = ? AND send_claimed_at = ? AND delivered_at IS NULL`,
    )
    .bind(sessionId, claimedAt)
    .run();
}

// Operator reconciliation of a retained send claim (outcome unknown), after
// checking Resend: "delivered" records the email as sent; "not_sent" gives the
// claim back so the next release sends. Only acts on a claimed, undelivered,
// released row.
export async function reconcileReviewSend(
  db: D1Database,
  sessionId: string,
  outcome: "delivered" | "not_sent",
  now: number = Date.now(),
): Promise<boolean> {
  const res =
    outcome === "delivered"
      ? await db
          .prepare(
            `UPDATE audit_review_holds SET delivered_at = ?
             WHERE session_id = ? AND held = 1 AND released_at IS NOT NULL
               AND send_claimed_at IS NOT NULL AND delivered_at IS NULL`,
          )
          .bind(now, sessionId)
          .run()
      : await db
          .prepare(
            `UPDATE audit_review_holds SET send_claimed_at = NULL
             WHERE session_id = ? AND held = 1 AND send_claimed_at IS NOT NULL AND delivered_at IS NULL`,
          )
          .bind(sessionId)
          .run();
  return res.meta.changes === 1;
}

export async function listReviewHolds(db: D1Database): Promise<ReviewHoldRow[]> {
  const res = await db
    .prepare(`SELECT * FROM audit_review_holds WHERE held = 1 ORDER BY decided_at`)
    .all<ReviewHoldRow>();
  return res.results ?? [];
}

// R2 key of the full Dim 6 evidence (cells incl. accuracy-check fields) kept
// for held sessions so the reviewer can check every Citation Visibility cell.
// Not served by any public route (those serve only audits/<id>.pdf|.json).
export function reviewEvidenceKey(sessionId: string): string {
  return `audits/${sessionId}.dim6-review.json`;
}

// Customer-facing text, approved by Bruno 2026-11-12
// (_tmp/report-truthfulness/copy-for-approval-review-hold-2026-11-12.md).
// A: results page while the report is held.
export const AUDIT_REVIEW_HOLD_STATUS_TITLE = "Your audit is being checked";
export const AUDIT_REVIEW_HOLD_STATUS_MESSAGE =
  "Your audit is ready. We check each early report by hand before we send it, usually within 1 business day. We'll email you the PDF when it's done. Questions? Write to contact@astrant.io.";
// B: results page intro while a held order is still running.
export const AUDIT_REVIEW_HOLD_RUNNING_INTRO =
  "Hold tight — we're scanning your site, generating remediation guidance for each gap, and rendering your PDF. This takes a few minutes. We check early reports by hand before sending them, so the email may come later.";
// C: /audit page, shown only while new orders are still held
// (isReviewHoldAcceptingOrders); the page falls back to its usual text after.
export const AUDIT_REVIEW_HOLD_PAGE_BADGE = "$79 · checked by hand, usually within 1 business day";
export const AUDIT_REVIEW_HOLD_PAGE_FAQ_TAIL =
  "The analysis is automated. While we open the Audit to our first customers, we check each report by hand before it is sent, usually within 1 business day.";
export const AUDIT_REVIEW_HOLD_PAGE_CTA_LINE =
  "Each early report is checked by hand before delivery, usually within 1 business day.";
// D: extra line in the "Your Astrant Audit is ready" email for released reports.
export const AUDIT_REVIEW_RELEASED_EMAIL_LINE = "We checked this report by hand before sending it.";

// /audit page: true while a new order would still be held (fewer than
// `limit` orders held so far), so the page's hold lines show only then.
// Fail-closed toward telling the buyer: a D1 error reports the hold active.
export async function isReviewHoldAcceptingOrders(
  db: D1Database | undefined,
  limit: number,
): Promise<boolean> {
  if (limit <= 0) return false;
  try {
    if (!db) return true;
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM audit_review_holds WHERE held = 1`)
      .first<{ n: number }>();
    return (row?.n ?? 0) < limit;
  } catch {
    return true;
  }
}
