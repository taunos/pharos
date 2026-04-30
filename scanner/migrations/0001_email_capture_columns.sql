-- Slice 2b Phase 1 — email-capture state on the scans table.
--
-- Adds the columns the Score email-gated PDF flow needs. The `email` column
-- already exists from the original schema (used by the optional rescan-email
-- on the free scan form). All new columns are NULL/0-default so the table
-- remains backward-compatible with existing rows.
--
-- Note: the R2 key for generated PDFs is NOT stored on the row — it's
-- deterministically computable as:
--     score-reports/<scan_id>/<sha256(email)[:16]>.pdf
-- ...so we save a column and avoid drift between persisted key and actual
-- R2 contents. The scanner GET endpoint returns the boolean
--     pdf_ready := (pdf_generated_at IS NOT NULL)
-- to drive UI state on /score/[id], and never returns the email itself.
--
-- D1/SQLite supports ALTER TABLE ADD COLUMN one column at a time. Idempotency
-- is achieved by failing-fast on re-run (re-applying this migration will
-- error on the second column with "duplicate column name"). For dev
-- workflows that need re-runnable migrations, run via wrangler's migration
-- system; for one-shot apply, this file is fine.

ALTER TABLE scans ADD COLUMN email_opted_in_rescan INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scans ADD COLUMN unsubscribe_token TEXT;
ALTER TABLE scans ADD COLUMN unsubscribed_at INTEGER;
ALTER TABLE scans ADD COLUMN deletion_requested_at INTEGER;
ALTER TABLE scans ADD COLUMN pdf_template_version TEXT;
ALTER TABLE scans ADD COLUMN pdf_generated_at INTEGER;
ALTER TABLE scans ADD COLUMN pdf_deferred_until_tomorrow INTEGER NOT NULL DEFAULT 0;

-- Indexes for common lookups in Slice 2b paths.
CREATE INDEX IF NOT EXISTS idx_scans_unsubscribe_token ON scans(unsubscribe_token);
CREATE INDEX IF NOT EXISTS idx_scans_email_for_deletion ON scans(email);
