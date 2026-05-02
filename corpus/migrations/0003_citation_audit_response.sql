-- 0003 — citation_audit_response table for Slice 3b Dim 6 (DIY Citation Audit).
-- Per pharos-corpus-layer-spec.md §3 + Slice 3b kickoff prompt.
-- CORPUS_SCHEMA_VERSION = "1.1.0" after this migration (see src/version.ts).
--
-- One row per (scan_id × query × model) trial. With 4 models × ~10 queries we
-- expect 30-40 rows per paid Dim 6 audit (some may be unmeasurable due to
-- network/safety/quota; the truncated flag captures responses that hit the
-- max_tokens cap but were otherwise clean).
--
-- DESIGN NOTES:
-- - scan_id is NOT a SQL FK. The corpus already documents that scan_event
--   cross-references the scanner's scan_id space (see migration 0002), and
--   citation_audit_response.scan_id may legitimately reference either the
--   audit-fulfill session_id (used as scan_event.scan_id) or the scanner's
--   scan_id directly. SQL FK would over-constrain. Indexed for query speed.
--
-- - unmeasurable: 1 means this cell could not be scored (network failure,
--   timeout, safety refusal, quota exhausted, post-fallback). The orchestrator
--   excludes unmeasurable cells from the score formula entirely. Distinct from
--   score=0 (a clean response that simply produced no citation).
--
-- - truncated: 1 means the response hit max_tokens but was otherwise valid.
--   The cell IS included in the score formula (with this flag for downstream
--   diagnostics) — truncation alone is not a measurability failure.
--
-- - engine_version stays 'dim6:v1' for Slice 3b. Bump on adapter or scoring
--   logic change. INDEPENDENT of REMEDIATION_ENGINE_VERSION_TAG (audit-fulfill)
--   and SCORING_VERSION (scanner composite).

CREATE TABLE IF NOT EXISTS citation_audit_response (
  response_id          TEXT PRIMARY KEY,         -- UUIDv4 minted by writer
  scan_id              TEXT NOT NULL,            -- audit session_id OR scanner scan_id (documentary)
  model_id             TEXT NOT NULL,            -- 'openai:gpt-4o' | 'anthropic:claude-sonnet' | 'google:gemini-2.0-flash' | 'perplexity:sonar'
  query_id             TEXT NOT NULL,            -- prompt-set-generator-emitted id, stable per scan
  query_text           TEXT NOT NULL,            -- the exact prompt sent to the model
  query_rationale      TEXT,                     -- why the prompt-set generator picked this query (may be null)
  response_text        TEXT,                     -- raw model output; null when unmeasurable
  citation_score       INTEGER NOT NULL,         -- 0-100; 0 when unmeasurable (excluded from formula)
  unmeasurable         INTEGER NOT NULL DEFAULT 0,  -- 1 when cell could not be scored
  truncated            INTEGER NOT NULL DEFAULT 0,  -- 1 when response hit max_tokens cap
  notes                TEXT,                     -- diagnostic notes (validator failures, retry path, fallback reason)
  engine_version       TEXT NOT NULL,            -- 'dim6:v1'
  schema_version       TEXT NOT NULL,            -- CORPUS_SCHEMA_VERSION at write time
  created_at           INTEGER NOT NULL          -- epoch millis
);

CREATE INDEX IF NOT EXISTS idx_citation_audit_response_scan ON citation_audit_response(scan_id);
CREATE INDEX IF NOT EXISTS idx_citation_audit_response_model ON citation_audit_response(model_id);
CREATE INDEX IF NOT EXISTS idx_citation_audit_response_created ON citation_audit_response(created_at);
