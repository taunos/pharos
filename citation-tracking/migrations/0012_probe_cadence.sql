-- citation-tracking/migrations/0012_probe_cadence.sql
-- F4.1: Pro tier cadence differentiation + Standard fixed-day scheduling.

ALTER TABLE customer_probe_targets ADD COLUMN probe_cadence TEXT NOT NULL
  DEFAULT 'twice_weekly'
  CHECK(probe_cadence IN ('daily', 'twice_weekly'));

ALTER TABLE customer_probe_targets ADD COLUMN next_probe_at INTEGER;

ALTER TABLE customer_probe_targets ADD COLUMN last_probed_at INTEGER;

UPDATE customer_probe_targets SET next_probe_at = strftime('%s','now')
  WHERE next_probe_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_probe_targets_next_probe_at
  ON customer_probe_targets (next_probe_at);
