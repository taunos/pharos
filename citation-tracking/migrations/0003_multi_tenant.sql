-- (1) probe_runs: add customer_id (NULL for Astrant; non-NULL for customers)
ALTER TABLE probe_runs ADD COLUMN customer_id TEXT;
CREATE INDEX idx_probe_runs_customer_id ON probe_runs (customer_id);

-- (2) digests: parallel multi-tenancy extension
ALTER TABLE digests ADD COLUMN customer_id TEXT;
DROP INDEX idx_digests_period;
CREATE UNIQUE INDEX idx_digests_period_customer
  ON digests (period_start, period_end, COALESCE(customer_id, CHAR(0) || 'ASTRANT' || CHAR(0)));
CREATE INDEX idx_digests_customer_id ON digests (customer_id);

-- (3) New table customer_probe_targets:
CREATE TABLE customer_probe_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  category TEXT NOT NULL,
  competitors TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_customer_probe_targets_status ON customer_probe_targets (status);
