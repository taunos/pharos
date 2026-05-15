-- 0005_subscriptions.sql — F3 AutoPilot fulfillment subscriptions table.
-- See pharos-f3-autopilot-fulfillment-spec.md v3.2 §11.1.
CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start INTEGER NOT NULL,
  current_period_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  expired_at INTEGER,
  welcome_email_sent_at INTEGER,
  last_webhook_event_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (customer_id);
