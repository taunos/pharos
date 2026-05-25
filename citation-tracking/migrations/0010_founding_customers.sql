-- citation-tracking/migrations/0010_founding_customers.sql
-- F-Fnd: Founding Customer pricing fulfillment
-- Idempotent CREATE IF NOT EXISTS + guarded singleton seed.

CREATE TABLE IF NOT EXISTS founding_cohort_meta (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  reserved_count INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 30,
  updated_at INTEGER NOT NULL
);

INSERT INTO founding_cohort_meta (id, reserved_count, cap, updated_at)
SELECT 1, 0, 30, strftime('%s', 'now')
WHERE NOT EXISTS (SELECT 1 FROM founding_cohort_meta WHERE id = 1);

CREATE TABLE IF NOT EXISTS founding_customers (
  customer_id TEXT PRIMARY KEY
    CHECK(customer_id NOT IN ('astrant', 'ASTRANT')),
  founding_order_seq INTEGER UNIQUE,
  founding_status TEXT NOT NULL CHECK(founding_status IN ('active', 'cancelled')),
  founding_assigned_at INTEGER NOT NULL,
  founding_cancelled_at INTEGER,
  founding_tier_locks TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_founding_customers_status
  ON founding_customers (founding_status);

CREATE TRIGGER IF NOT EXISTS trg_founding_customers_enforce_cap
BEFORE INSERT ON founding_customers
WHEN (SELECT reserved_count FROM founding_cohort_meta WHERE id = 1)
     >= (SELECT cap FROM founding_cohort_meta WHERE id = 1)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER IF NOT EXISTS trg_founding_customers_assign_seq
AFTER INSERT ON founding_customers
BEGIN
  UPDATE founding_cohort_meta
  SET reserved_count = reserved_count + 1,
      updated_at = strftime('%s', 'now')
  WHERE id = 1;

  UPDATE founding_customers
  SET founding_order_seq = (SELECT reserved_count FROM founding_cohort_meta WHERE id = 1)
  WHERE customer_id = NEW.customer_id;
END;
