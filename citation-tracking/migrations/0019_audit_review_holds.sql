-- citation-tracking/migrations/0019_audit_review_holds.sql
-- Audit review hold (2026-11-12, reopening plan step 2): the first N paid
-- standalone Audit orders after reopening (N = marketing-site var
-- AUDIT_REVIEW_HOLD_COUNT, default 10) are generated as normal but NOT
-- delivered until a reviewer releases them.
--
-- One row per paid standalone Audit session, written once by marketing-site
-- lib/audit-review-hold.ts decideReviewHold() with a single INSERT OR IGNORE
-- ... SELECT, so the held count is decided in D1 (never in memory) and a retry
-- reuses the first decision. Decided in the payment webhook (payment order);
-- fulfillment re-calls it as an idempotent fallback.
--
--   held             1 = held for review (the order was within the first N), 0 = not held
--   decided_at       when the decision was made (ms)
--   released_at      reviewer released it (ms); NULL while held. Delivery is
--                    blocked while held = 1 AND released_at IS NULL.
--   gen_claimed_at   lease on writing the held report's artifacts (ms); a
--                    lease older than 30 min (longer than any writer can run) is
--                    abandoned and can be retaken
--   generated_at     the held report was stored and the session went ready
--                    (ms). Once set, no later run may replace the reviewed
--                    artifacts (clear it by hand to regenerate before release).
--   send_claimed_at  CAS claim on the buyer email after release (ms). Never
--                    expires: a send that crashed or threw (outcome unknown) leaves it set, and
--                    the operator reconciles (check Resend, then clear it).
--   delivered_at     buyer email confirmed sent after release (ms)
--
-- Additive. Apply with `wrangler d1 execute pharos-citation-tracking --file`
-- (never `npm run migrate` in citation-tracking; its migrations are out of sync).
CREATE TABLE IF NOT EXISTS audit_review_holds (
  session_id      TEXT PRIMARY KEY,
  held            INTEGER NOT NULL CHECK (held IN (0, 1)),
  decided_at      INTEGER NOT NULL,
  released_at     INTEGER,
  gen_claimed_at  INTEGER,
  generated_at    INTEGER,
  send_claimed_at INTEGER,
  delivered_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_audit_review_holds_held ON audit_review_holds(held, decided_at);
