CREATE TABLE retention_replay_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL, job_id TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 64),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 256),
  replayed_at INTEGER NOT NULL                 -- ms
);
CREATE INDEX idx_replay_audit_scan ON retention_replay_audit (scan_id, replayed_at);
ALTER TABLE retention_jobs ADD COLUMN done_at INTEGER;        -- ms; stamped by S9 (D17)
ALTER TABLE retention_jobs ADD COLUMN cancelled_at INTEGER;   -- ms; stamped by S8 (D17)
