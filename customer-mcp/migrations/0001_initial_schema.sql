CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  paid_tier TEXT NOT NULL CHECK (paid_tier IN ('implementation', 'autopilot', 'concierge')),
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'expired')),
  period_end INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  config_json TEXT NOT NULL
);
CREATE INDEX idx_customers_slug ON customers (slug);
CREATE INDEX idx_customers_customer_id ON customers (customer_id);
CREATE INDEX idx_customers_status_period_end ON customers (status, period_end);
