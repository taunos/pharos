CREATE TABLE digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  generated_at INTEGER NOT NULL,
  markdown TEXT NOT NULL,
  digest_version TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_digests_period ON digests (period_start, period_end);
