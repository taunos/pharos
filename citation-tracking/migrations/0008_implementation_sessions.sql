-- 0008_implementation_sessions.sql — F2 D9 + D19 + D20 state schema.
-- 31 columns + 4 indexes. Per spec v6.1 §23.3.
-- D20 customer_id model: Dodo customer_id (NOT derived prefix); matches subscriptions.customer_id +
-- customer_probe_targets.customer_id for cross-tier JOIN.
-- 3 audit-day timestamp triples (fired_at / succeeded_at / failed_at × 30/60/90) for D19 retriability
-- per CLI v4 MED-1 (stale-claim cleanup pattern in citation-tracking cron sweep).

CREATE TABLE implementation_sessions (
  session_id TEXT PRIMARY KEY,                -- format: 'impl-' || dodo_payment_id
  dodo_payment_id TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_domain TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  category TEXT NOT NULL,
  competitors TEXT,                            -- JSON-encoded array (D17 field #4 optional)
  customer_id TEXT NOT NULL,                   -- Dodo customer_id (D20)
  baseline_scan_id TEXT,
  patch_r2_key TEXT,
  status TEXT NOT NULL,                        -- 'queued'|'processing'|'active'|'failed'|'failed_ceiling'|'active_email_pending'
  payment_succeeded_at INTEGER NOT NULL,
  processing_started_at INTEGER,
  patch_delivered_at INTEGER,
  day30_audit_due_at INTEGER,
  day60_audit_due_at INTEGER,
  day90_audit_due_at INTEGER,
  day30_audit_fired_at INTEGER,
  day60_audit_fired_at INTEGER,
  day90_audit_fired_at INTEGER,
  day30_audit_succeeded_at INTEGER,           -- v5 MED-1 retriability
  day60_audit_succeeded_at INTEGER,
  day90_audit_succeeded_at INTEGER,
  day30_audit_failed_at INTEGER,
  day60_audit_failed_at INTEGER,
  day90_audit_failed_at INTEGER,
  bundle_expires_at INTEGER NOT NULL,         -- payment_succeeded_at + 91*86400 (D7)
  bundle_expired_at INTEGER,                  -- timestamp when Day-91 sweep fired (Codex HIGH-2 lock)
  failed_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_impl_sessions_dodo_payment ON implementation_sessions (dodo_payment_id);
CREATE INDEX idx_impl_sessions_status ON implementation_sessions (status);
CREATE INDEX idx_impl_sessions_audit_due ON implementation_sessions (status, day30_audit_due_at, day60_audit_due_at, day90_audit_due_at);
CREATE INDEX idx_impl_sessions_bundle_expires ON implementation_sessions (status, bundle_expires_at);
