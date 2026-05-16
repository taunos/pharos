-- 0006_audit_fired_at.sql — F3.1 D9 CAS gate.
-- Nullable INTEGER UNIX seconds. NULL = audit not yet fired; non-NULL = audit fired (timestamp captured).
-- No backfill (pre-F3.1 subscriptions had no audit-fire concept).
ALTER TABLE subscriptions ADD COLUMN audit_fired_at INTEGER;
