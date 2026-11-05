-- citation-tracking/migrations/0018_impl_verification.sql
-- Implementation verification report v1 (DECISION 2026-11-05, TODO.md):
-- Day 0 = verified application, not payment.
--
-- implementation_sessions:
--   baseline_scoring_version  scoring_version of the pre-delivery baseline scan
--                             (the scan itself stays at R2 f2-baseline-scans/<baseline_scan_id>.json)
--   applied_at                Day 0: when the application was verified. The Day-30
--                             due date and bundle_expires_at are anchored on it.
--   applied_by                who marked it applied: 'operator', or 'operator+forced'
--                             when Day 0 was anchored without a working artifact
--   day30_verification_held_at  the Day-30 recheck ran and was stored, but its
--                             email copy is not approved yet: later sweeps skip the
--                             rescan; once approved the email is sent from the record
-- Verified rows (applied_at set) get Day 30 only: day60/day90 due dates stay NULL.
-- mark-applied also accepts 'active_email_pending' (patch re-sent by hand).
-- New status value (TEXT, no CHECK): 'awaiting_application' — patch delivered,
-- application not yet verified. Written by marketing-site lib/impl-fulfill-run.ts
-- Step 11 instead of 'active'; flipped to 'active' by lib/impl-verification.ts.
--
-- implementation_verifications: one row per (session_id, checkpoint), checkpoint
-- 'day0' | 'day30'. Written with INSERT OR REPLACE on the primary key (idempotent
-- re-runs overwrite, never duplicate). checks_json = ArtifactCheck[] from the
-- acceptance checker.
--
-- Additive; NULL for every existing row. Existing 'active' rows keep their
-- payment-anchored due dates (legacy path).
-- Apply this single file BEFORE deploying marketing-site or citation-tracking
-- (this DB's migrations table is out of sync; do NOT run `npm run migrate`):
--   npx wrangler d1 execute pharos-citation-tracking --remote --file migrations/0018_impl_verification.sql

ALTER TABLE implementation_sessions ADD COLUMN baseline_scoring_version TEXT;
ALTER TABLE implementation_sessions ADD COLUMN applied_at INTEGER;
ALTER TABLE implementation_sessions ADD COLUMN applied_by TEXT;
ALTER TABLE implementation_sessions ADD COLUMN day30_verification_held_at INTEGER;

CREATE TABLE IF NOT EXISTS implementation_verifications (
  session_id TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  composite_score REAL,
  scoring_version TEXT,
  scan_r2_key TEXT,
  verified_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, checkpoint)
);
