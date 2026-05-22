-- Migration 0009: probe_jobs worklist for B1.3 v1.1 cron-fix.
-- Replaces direct cron-probing with enqueue-then-drain worklist architecture.
-- Schema rationale: see pharos-b1-3-v1-1-cron-fix-spec.md §2.1 (4-class staircase).

CREATE TABLE probe_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_date TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  probe_run_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'done', 'failed')),
  enqueued_at INTEGER NOT NULL,
  claimed_at INTEGER,
  completed_at INTEGER,
  alert_claim_id TEXT,
  alert_fired_at INTEGER,
  rows_written INTEGER,
  failed_reason TEXT,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  probe_subject TEXT NOT NULL,
  target_category TEXT NOT NULL,
  CHECK (
    customer_id = 'astrant'
    OR customer_id GLOB 'sub_?*'
  )
);

CREATE UNIQUE INDEX idx_probe_jobs_unique ON probe_jobs (job_date, customer_id);
CREATE INDEX idx_probe_jobs_pending ON probe_jobs (status, job_date, customer_id) WHERE status='pending';
CREATE INDEX idx_probe_jobs_processing_claimed ON probe_jobs (status, claimed_at) WHERE status='processing';
CREATE INDEX idx_probe_jobs_failed_unclaimed ON probe_jobs (status, alert_claim_id) WHERE status='failed' AND alert_claim_id IS NULL;
