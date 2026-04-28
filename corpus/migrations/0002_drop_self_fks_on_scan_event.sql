-- 0002 — drop self-FKs on scan_event(source_scan_id, parent_scan_id).
--
-- Discovered during Slice 2.0 dogfood verification: source_scan_id naturally
-- references the SCANNER's scan_id (pharos-scanner D1), not a scan_event row
-- in pharos_corpus. The corpus today has only one writer (audit-fulfill), so
-- there's no row to point at for free-Score precursors. Same applies to
-- parent_scan_id once AutoPilot ships — it'll write rescans, not the original
-- score-tier scan, until score-tier writes also flow through corpus.
--
-- Both columns stay as indexed TEXT. The relationship is documentary, not
-- enforced. CorpusClient's INSERT OR IGNORE was masking the constraint
-- violation silently, which is the kind of failure mode we'd never want in
-- production. Better to make the schema match what the writer can actually
-- guarantee.
--
-- Intra-batch FKs (scan_finding.scan_id, scan_recommendation.scan_id, etc.)
-- stay enforced — those are written together by the same writer and should
-- maintain referential integrity.

PRAGMA foreign_keys = OFF;

-- Recreate scan_event without the two self-FKs.
CREATE TABLE scan_event_new (
  scan_id          TEXT PRIMARY KEY,
  customer_id      TEXT,
  url              TEXT NOT NULL,
  tier             TEXT NOT NULL,
  source_scan_id   TEXT,                     -- documentary; not FK-enforced
  parent_scan_id   TEXT,                     -- documentary; not FK-enforced
  consent_basis    TEXT NOT NULL,
  status           TEXT NOT NULL,
  score_pre        INTEGER,
  score_post       INTEGER,
  engine_version   TEXT NOT NULL,
  schema_version   TEXT NOT NULL,
  metadata         TEXT,
  created_at       INTEGER NOT NULL
);

INSERT INTO scan_event_new SELECT * FROM scan_event;

DROP TABLE scan_event;
ALTER TABLE scan_event_new RENAME TO scan_event;

-- Recreate indexes (DROP TABLE drops them).
CREATE INDEX IF NOT EXISTS idx_scan_event_customer ON scan_event(customer_id);
CREATE INDEX IF NOT EXISTS idx_scan_event_url ON scan_event(url);
CREATE INDEX IF NOT EXISTS idx_scan_event_parent ON scan_event(parent_scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_event_source ON scan_event(source_scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_event_created ON scan_event(created_at);

PRAGMA foreign_keys = ON;
