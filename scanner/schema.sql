CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  composite_score INTEGER,
  composite_grade TEXT,
  dimensions_scored INTEGER NOT NULL,
  dimensions_total INTEGER NOT NULL DEFAULT 6,
  results_json TEXT NOT NULL,
  email TEXT,
  user_ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scans_url ON scans(url);
CREATE INDEX IF NOT EXISTS idx_scans_email ON scans(email);
CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at);
