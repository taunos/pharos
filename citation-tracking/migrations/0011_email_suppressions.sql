-- citation-tracking/migrations/0011_email_suppressions.sql
-- F-Fnd OQ3 path (b): email-suppression registry for RFC 8058 List-Unsubscribe.

CREATE TABLE IF NOT EXISTS email_suppressions (
  email_hash TEXT PRIMARY KEY,
  suppressed_at INTEGER NOT NULL,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_suppressed_at
  ON email_suppressions (suppressed_at);
