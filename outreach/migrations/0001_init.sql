-- pharos-outreach D1 schema (spec §5, finalised in the build slice).
-- Every state change in code is a compare-and-set (UPDATE ... WHERE id=? AND state=?).
-- No reply bodies are stored. events.detail_json never holds an email address.

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,            -- registrable domain, lowercase
  source TEXT NOT NULL,
  country TEXT,                           -- ISO-3166 alpha-2 when known (EU/EEA exclusion, §10.2)
  state TEXT NOT NULL CHECK (state IN ('new','scored','contact_found','drafted','approved','sent',
    'followup_sent','replied','bounced','opted_out','disqualified','rejected','send_unknown','closed')),
  state_reason TEXT,
  icp_ok INTEGER,                         -- NULL = not reviewed; 1/0 after Bruno's review
  scan_id TEXT,
  scanned_at INTEGER,
  scan_attempts INTEGER NOT NULL DEFAULT 0,
  rescanned INTEGER NOT NULL DEFAULT 0,
  fact_sheet_json TEXT,
  contact_email TEXT,                     -- role address; purged by retention
  contact_source_url TEXT,
  batch_id TEXT,
  last_outbound_at INTEGER,
  terminal_at INTEGER,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_leads_state ON leads(state);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('initial','followup')),
  batch_id TEXT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  validator_report_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','queued','sending','sent','send_unknown','cancelled')),
  claim_id TEXT,
  claimed_at INTEGER,
  provider_message_id TEXT,
  provider_thread_id TEXT,
  rfc_message_id TEXT,
  not_before INTEGER NOT NULL,
  sent_at INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (lead_id, kind)
);
CREATE INDEX idx_messages_status ON messages(status, not_before);
CREATE INDEX idx_messages_rfc ON messages(rfc_message_id);
CREATE INDEX idx_messages_thread ON messages(provider_thread_id);

CREATE TABLE inbound (
  provider_message_id TEXT PRIMARY KEY,
  lead_id TEXT,
  class TEXT NOT NULL,
  confidence REAL,
  method TEXT,
  draft_id TEXT,
  received_at INTEGER NOT NULL,
  handled_at INTEGER
);
CREATE INDEX idx_inbound_lead ON inbound(lead_id);
CREATE INDEX idx_inbound_received ON inbound(received_at);

CREATE TABLE suppression (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email','domain')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending_approval','approved','expired','auto_approved')),
  mode_at_build TEXT NOT NULL,
  draft_count INTEGER NOT NULL DEFAULT 0,
  fallback_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  expires_at INTEGER NOT NULL
);

CREATE TABLE lead_scans (
  scan_id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delete_requested_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX idx_lead_scans_lead ON lead_scans(lead_id);
CREATE INDEX idx_lead_scans_created ON lead_scans(created_at);

CREATE TABLE control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 1,      -- starts paused; Bruno resumes in /admin
  pause_reason TEXT,
  paused_at INTEGER,
  drafting_paused INTEGER NOT NULL DEFAULT 0,
  last_stop_trip_at INTEGER,
  second_approval_at INTEGER,
  dns_verified_at INTEGER,
  ramp_start_at INTEGER,                  -- first approval; NULL = ramp not started
  ramp_paused_ms INTEGER NOT NULL DEFAULT 0,
  approved_batches INTEGER NOT NULL DEFAULT 0,
  consecutive_send_errors INTEGER NOT NULL DEFAULT 0,
  inbox_cursor TEXT,
  inbox_caught_up_at INTEGER,
  tick_lease_until INTEGER NOT NULL DEFAULT 0,
  tick_lease_id TEXT
);
INSERT INTO control (id) VALUES (1);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  lead_id TEXT,
  kind TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX idx_events_kind_at ON events(kind, at);
