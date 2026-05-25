-- citation-tracking/migrations/0013_subscriptions_pending_cadence.sql
-- F4.1 (Variant B): option (iii) deferred downgrade storage at subscription tier.
-- Bruno lock #16: store pending_probe_cadence directly so period-end sweep in
-- citation-tracking reads cadence without cross-Worker env binding (sweep #32).

ALTER TABLE subscriptions ADD COLUMN pending_product_id TEXT;
ALTER TABLE subscriptions ADD COLUMN pending_probe_cadence TEXT
  CHECK(pending_probe_cadence IS NULL OR pending_probe_cadence IN ('daily', 'twice_weekly'));
ALTER TABLE subscriptions ADD COLUMN cadence_change_effective_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_subscriptions_cadence_change_effective_at
  ON subscriptions (cadence_change_effective_at)
  WHERE cadence_change_effective_at IS NOT NULL;
