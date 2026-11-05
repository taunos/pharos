-- citation-tracking/migrations/0016_dayn_email_sent_at.sql
-- Slice Q fix round: per-day "Day-N audit email confirmed sent" marker.
-- Written by marketing-site lib/impl-day-audit-run.ts in its own statement right
-- after Resend confirms the send. A set marker means: never send that day again
-- (a re-run only writes succeeded_at) and the stale-claim cleanup never resets
-- that day's fired_at. Additive; NULL for every existing row.
-- Apply BEFORE deploying either marketing-site or citation-tracking (both read it).

ALTER TABLE implementation_sessions ADD COLUMN day30_audit_email_sent_at INTEGER;
ALTER TABLE implementation_sessions ADD COLUMN day60_audit_email_sent_at INTEGER;
ALTER TABLE implementation_sessions ADD COLUMN day90_audit_email_sent_at INTEGER;
