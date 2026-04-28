-- Pharos Corpus — initial six-table schema (Slice 2.0).
-- Per pharos-corpus-layer-spec.md §3.
-- CORPUS_SCHEMA_VERSION = "1.0.0" (see src/version.ts).
--
-- All primary keys are TEXT (UUIDv4 strings, generated server-side via
-- crypto.randomUUID() unless caller provides a deterministic id — e.g.
-- audit-fulfill passes session_id as scan_event.scan_id for idempotency).
-- All JSON-typed columns are TEXT, parsed/serialized at the application layer.
-- All timestamps are INTEGER (epoch millis).

-- ── 1. scan_event ───────────────────────────────────────────────────────────
-- One row per scan/audit/build event. The root entity; everything else FKs back.
CREATE TABLE IF NOT EXISTS scan_event (
  scan_id          TEXT PRIMARY KEY,
  customer_id      TEXT,                     -- nullable: free Score has no customer
  url              TEXT NOT NULL,
  tier             TEXT NOT NULL,            -- 'score' | 'audit' | 'implementation' | 'autopilot' | 'concierge'
  source_scan_id   TEXT,                     -- conversion arc: free-Score scan that led to a paid Audit
  parent_scan_id   TEXT,                     -- AutoPilot series: previous rescan in the series
  consent_basis    TEXT NOT NULL,            -- 'paid_optin' | 'free_optout_default' | 'subscription' | 'custom_engagement'
  status           TEXT NOT NULL,            -- 'pending' | 'recommendations_complete' | 'applied' | 'rescanned' | 'error'
  score_pre        INTEGER,                  -- composite score at time of scan (0-100), nullable when N/A
  score_post       INTEGER,                  -- composite score after remediation (rescan/Implementation/AutoPilot only)
  engine_version   TEXT NOT NULL,            -- writer-engine version, e.g. audit-fulfill REMEDIATION_ENGINE_VERSION_TAG
  schema_version   TEXT NOT NULL,            -- CORPUS_SCHEMA_VERSION at write time
  metadata         TEXT,                     -- JSON: per-tier extras (e.g. session_id, dodo payment_id)
  created_at       INTEGER NOT NULL,
  FOREIGN KEY (source_scan_id) REFERENCES scan_event(scan_id),
  FOREIGN KEY (parent_scan_id) REFERENCES scan_event(scan_id)
);

CREATE INDEX IF NOT EXISTS idx_scan_event_customer ON scan_event(customer_id);
CREATE INDEX IF NOT EXISTS idx_scan_event_url ON scan_event(url);
CREATE INDEX IF NOT EXISTS idx_scan_event_parent ON scan_event(parent_scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_event_source ON scan_event(source_scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_event_created ON scan_event(created_at);

-- ── 2. scan_finding ─────────────────────────────────────────────────────────
-- One row per detected finding (sub-check failure or partial-pass) on a scan.
-- evidence preserves enough context to reproduce the finding.
CREATE TABLE IF NOT EXISTS scan_finding (
  finding_id       TEXT PRIMARY KEY,
  scan_id          TEXT NOT NULL,
  dimension_id    INTEGER NOT NULL,          -- 1..6 per scoring rubric
  dimension_name   TEXT NOT NULL,
  check_id         TEXT NOT NULL,            -- e.g. 'presence', 'organization_schema'
  check_name       TEXT NOT NULL,
  score            INTEGER NOT NULL,         -- 0..100
  weight           INTEGER NOT NULL,         -- weight % within its dimension
  notes            TEXT NOT NULL,            -- raw scanner notes
  evidence         TEXT,                     -- JSON: {url, raw_value, ...} — replayable context
  schema_version   TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES scan_event(scan_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scan_finding_scan ON scan_finding(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_finding_check ON scan_finding(check_id);

-- ── 3. scan_recommendation ──────────────────────────────────────────────────
-- One row per remediation we generated for the customer. finding_ids links to
-- one or more findings the recommendation addresses (JSON array of finding_id
-- strings). recommendation_payload is the full text/structured output the
-- customer sees in the PDF or downstream surface.
CREATE TABLE IF NOT EXISTS scan_recommendation (
  recommendation_id      TEXT PRIMARY KEY,
  scan_id                TEXT NOT NULL,
  finding_ids            TEXT NOT NULL,      -- JSON array of finding_id strings
  check_id               TEXT NOT NULL,      -- denormalized for query convenience
  subject                TEXT,               -- artifact subject (CHECK_SUBJECTS lookup at gen time)
  recommendation_payload TEXT NOT NULL,      -- full LLM/template output
  estimated_effort       TEXT,               -- parsed effort string ("under 30 minutes", etc.)
  source                 TEXT NOT NULL,      -- 'llm' | 'fallback_template' | 'human'
  engine_version         TEXT NOT NULL,
  schema_version         TEXT NOT NULL,
  created_at             INTEGER NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES scan_event(scan_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scan_recommendation_scan ON scan_recommendation(scan_id);

-- ── 4. scan_application ─────────────────────────────────────────────────────
-- Implementation-tier+ only: which recommendation was actually applied, and
-- the payload that was delivered (may differ from recommendation_payload).
-- The delta between recommendation_payload and applied_payload is signal.
CREATE TABLE IF NOT EXISTS scan_application (
  application_id     TEXT PRIMARY KEY,
  recommendation_id  TEXT NOT NULL,
  scan_id            TEXT NOT NULL,           -- denormalized for direct queries
  applied_payload    TEXT NOT NULL,           -- final delivered text/patch (may diverge from recommendation_payload)
  delivery_mode      TEXT NOT NULL,           -- 'patch_file' | 'pr' | 'manual_email' | 'autopilot_auto'
  applied_at         INTEGER NOT NULL,
  notes              TEXT,                    -- human-supplied or pipeline-supplied delta explanation
  schema_version     TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  FOREIGN KEY (recommendation_id) REFERENCES scan_recommendation(recommendation_id) ON DELETE CASCADE,
  FOREIGN KEY (scan_id) REFERENCES scan_event(scan_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scan_application_rec ON scan_application(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_scan_application_scan ON scan_application(scan_id);

-- ── 5. scan_outcome ─────────────────────────────────────────────────────────
-- Rescan-derived: did applying the recommendation actually move the score?
-- Populated by AutoPilot rescans. score_delta is null until the rescan runs.
CREATE TABLE IF NOT EXISTS scan_outcome (
  outcome_id       TEXT PRIMARY KEY,
  application_id   TEXT NOT NULL,
  rescan_id        TEXT NOT NULL,             -- the scan_event that observed the outcome (FK to scan_event)
  score_delta      INTEGER,                   -- score_post - score_pre at the relevant check, can be negative
  observed_at      INTEGER NOT NULL,
  notes            TEXT,
  schema_version   TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  FOREIGN KEY (application_id) REFERENCES scan_application(application_id) ON DELETE CASCADE,
  FOREIGN KEY (rescan_id) REFERENCES scan_event(scan_id)
);

CREATE INDEX IF NOT EXISTS idx_scan_outcome_app ON scan_outcome(application_id);
CREATE INDEX IF NOT EXISTS idx_scan_outcome_rescan ON scan_outcome(rescan_id);

-- ── 6. strategist_annotation ────────────────────────────────────────────────
-- Concierge/Custom-tier only: human strategist commentary on a scan.
-- Schema author/body fields stay flexible; admin tooling lives in a later slice.
CREATE TABLE IF NOT EXISTS strategist_annotation (
  annotation_id    TEXT PRIMARY KEY,
  scan_id          TEXT NOT NULL,
  author           TEXT NOT NULL,             -- 'bruno' or future strategist handle
  body             TEXT NOT NULL,
  visibility       TEXT NOT NULL,             -- 'internal' | 'shared_with_customer'
  schema_version   TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES scan_event(scan_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategist_annotation_scan ON strategist_annotation(scan_id);
