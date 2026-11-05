-- citation-tracking/migrations/0017_outreach_do_not_contact.sql
-- E5 (code-quality audit 2026-11-05): addresses that asked /score/delete-me to remove
-- their data. The outreach Worker (pharos-outreach, binding OPTOUT_LISTS_DB) reads
-- this table, and email_suppressions, before any draft and never writes to it.
-- Kept apart from email_suppressions so a data-deletion request doesn't also
-- suppress a later customer's transactional email (welcome / account links).
-- email_hash = SHA-256 hex of the lower-cased, trimmed address, the same as
-- email_suppressions (marketing-site/src/lib/email-suppressions.ts hashEmailSha256).
-- No plaintext address is stored.
--
-- Apply this single file (this DB's migrations table is out of sync; do NOT run
-- `npm run migrate`):
--   npx wrangler d1 execute pharos-citation-tracking --remote --file migrations/0017_outreach_do_not_contact.sql

CREATE TABLE IF NOT EXISTS outreach_do_not_contact (
  email_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL
);
