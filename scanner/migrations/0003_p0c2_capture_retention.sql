-- P0-C2 v2.9 §1 — capture-outbox + versioned-artifact + retention-sweep foundation.
--
-- ADDITIVE and UNAPPLIED (Chunk B): this file defines the schema only. No
-- Wrangler/D1 apply, no producer/consumer runtime, sweep stays off. `tier` is
-- ALREADY shipped (migration 0002) and is deliberately NOT touched here.
--
-- New scans columns are NULL / 0-default so existing rows stay valid. New tables
-- carry no FK cascade to scans (registry + job rows outlive scan deletion; the
-- retention tombstone keys on the stable retention_job_id). Times are ms.
-- One column per ALTER (SQLite requirement); fail-fast on re-run per the 0001/0002
-- convention.

-- ── scans: per-scan operation lease + versioned pointer + retention tombstone ──
ALTER TABLE scans ADD COLUMN op_owner TEXT
  CHECK (op_owner IN ('capture','optin','privacy_delete','retention','reconcile') OR op_owner IS NULL);
ALTER TABLE scans ADD COLUMN op_lease_id TEXT;
ALTER TABLE scans ADD COLUMN op_lease_expires_at INTEGER;         -- ms
ALTER TABLE scans ADD COLUMN op_fence INTEGER NOT NULL DEFAULT 0; -- monotonic per acquisition
ALTER TABLE scans ADD COLUMN pdf_r2_key TEXT;                     -- committed active object pointer
ALTER TABLE scans ADD COLUMN retention_locked_at INTEGER;         -- ms; PERMANENT tombstone
ALTER TABLE scans ADD COLUMN retention_job_id TEXT;               -- STABLE job id

-- ── r2_artifacts: versioned PDF registry (state machine) ──────────────────────
CREATE TABLE r2_artifacts (
  r2_key         TEXT PRIMARY KEY,        -- score-reports/<id>/<hash>/<fence>.pdf ; <hash> is EMAIL-DERIVED
  scan_id        TEXT NOT NULL,
  capture_job_id TEXT NOT NULL,           -- owning job; every registry row is a VERSIONED artifact (legacy fallbacks are out-of-registry)
  op_fence       INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,        -- ms
  status         TEXT NOT NULL CHECK (status IN ('pending','active','superseded','purged'))
);
CREATE INDEX idx_r2_artifacts_scan ON r2_artifacts (scan_id);
CREATE INDEX idx_r2_artifacts_gc   ON r2_artifacts (status, created_at);
-- At most ONE active artifact per scan (DB-enforced).
CREATE UNIQUE INDEX idx_one_active_artifact ON r2_artifacts (scan_id) WHERE status='active';

-- ── retention_jobs: 90-day sweep state machine ────────────────────────────────
CREATE TABLE retention_jobs (
  scan_id TEXT PRIMARY KEY, job_id TEXT NOT NULL,     -- job_id STABLE across reclaims
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','r2_purged','done','dead_letter','cancelled')),
  claim_id TEXT, lease_expires_at INTEGER,            -- claim_id per-attempt
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error_class TEXT, enqueued_at INTEGER NOT NULL, dead_lettered_at INTEGER, alert_state TEXT
);
CREATE INDEX idx_retention_claimable ON retention_jobs (status, next_attempt_at);

-- ── capture_jobs: durable deferred-PDF outbox ─────────────────────────────────
-- phase = WORK done (terminal only = done|cancelled); queue_state = QUEUE
-- disposition (consumers claim only 'active'); claim_id/claim_expires_at =
-- execution ownership. Three separate axes so a reclaim never rewinds work.
CREATE TABLE capture_jobs (
  job_id           TEXT PRIMARY KEY,       -- STABLE; the only value enqueued; also the Resend idempotency key
  scan_id          TEXT NOT NULL,
  email            TEXT,                    -- NULLABLE PII; scrubbed on done/cancelled/delete/retention/DLQ-SLO
  pdf_r2_key       TEXT,                    -- persisted VERSIONED target key so an 'uploaded' phase retry resumes
  phase            TEXT NOT NULL CHECK (phase IN ('pending','rendering','uploaded','email_sending','done','cancelled')),
  queue_state      TEXT NOT NULL DEFAULT 'active' CHECK (queue_state IN ('active','dead_letter','email_ambiguous')),
  claim_id         TEXT,
  claim_expires_at INTEGER,                 -- ms
  op_fence         INTEGER,                 -- artifact fence held while rendering/committing
  delivery_snapshot TEXT,                   -- JSON exact-payload; NULL until email_sending; NULLed on done/delete
  attempts         INTEGER NOT NULL DEFAULT 0,
  enqueued_at      INTEGER,                 -- ms; set only when the queue send is CONFIRMED (NULL ⇒ unsent → repair)
  email_sent_at    INTEGER,                 -- send-once marker
  created_at       INTEGER NOT NULL, updated_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error_class TEXT
);
-- At most ONE UNFINISHED job per scan (dead_letter/email_ambiguous keep a non-terminal PHASE ⇒ still blocked).
CREATE UNIQUE INDEX idx_one_active_capture ON capture_jobs (scan_id) WHERE phase NOT IN ('done','cancelled');
CREATE INDEX idx_capture_claimable ON capture_jobs (queue_state, next_attempt_at);  -- claim scan: queue_state='active'
CREATE INDEX idx_capture_watchdog  ON capture_jobs (phase, updated_at);             -- stale-claim watchdog + unsent repair
