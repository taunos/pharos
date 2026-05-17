-- 0007_cancel_pending_at.sql — F3.2.1 cancel-pending UX state persistence.
-- Per pharos-f3-2-1-cancel-pending-at-spec.md v2 D1.
-- Nullable INTEGER UNIX seconds. NULL = not pending; non-NULL = pending since timestamp.
-- No backfill (pre-F3.2.1 customers have no cancel-pending state since the gap is the bug we're fixing).
ALTER TABLE subscriptions ADD COLUMN cancel_pending_at INTEGER;
