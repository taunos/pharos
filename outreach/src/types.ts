// Minimal shape of the scanner's ScanResult that this Worker reads
// (scanner/src/types.ts is the source of truth).
/** Evidence about the single response a sub-check is based on (scanner Dim 4). */
export type SubCheckEvidence = {
  status: number | null;
  content_type: string;
  parsed: boolean;
  requested_url?: string;
  final_url?: string;
  body_complete?: boolean;
  ld_json_absent_proven?: boolean;
};

export type SubCheck = {
  id: string;
  name: string;
  weight: number;
  score: number;
  passed: boolean;
  notes: string;
  na?: boolean;
  evidence?: SubCheckEvidence;
};
export type DimensionResult = {
  dimension_id: number;
  dimension_name: string;
  score: number;
  grade: string;
  sub_checks: SubCheck[];
  na?: boolean;
};
export type ScanResult = {
  id: string;
  url: string;
  composite: { score: number; grade: string };
  dimensions: DimensionResult[];
  dimensions_applicable: number;
  created_at: number;
  tier: string;
};

// Service Binding to pharos-scanner's ProspectScan entrypoint (RPC only).
export interface ProspectScanBinding {
  scan(url: string): Promise<ScanResult>;
  deleteScan(id: string): Promise<{ deleted: number }>;
}

export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  /** E5: marketing's opt-out lists (pharos-citation-tracking). Read-only, only via cross-list.ts. */
  OPTOUT_LISTS_DB?: D1Database;
  SCANNER: ProspectScanBinding;
  AI: AiBinding;
  // vars
  OUTREACH_MODE?: string;
  DAILY_CAP_MAX?: string;
  DRAFTS_PER_DAY?: string;
  WARMUP_DAYS?: string;
  DRAFT_EXPIRE_DAYS?: string;
  PROSPECT_SCANS_PER_DAY?: string;
  BENCHMARK_URL?: string;
  OPERATOR_ALERT_TO?: string;
  MAIL_PROVIDER?: string;
  MAIL_FROM?: string;
  MAIL_FROM_NAME?: string;
  ZOHO_ACCOUNTS_HOST?: string;
  ZOHO_MAIL_API_HOST?: string;
  PUBLIC_BASE_URL?: string;
  SCORE_BASE_URL?: string;
  PRIVACY_URL?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ADMIN_EMAIL?: string;
  // secrets (names only; values set by Bruno with `wrangler secret put`)
  POSTAL_ADDRESS?: string;
  OPTOUT_HMAC_SECRET?: string;
  SUPPRESSION_HMAC_SECRET?: string;
  MAIL_OAUTH_CLIENT_ID?: string;
  MAIL_OAUTH_CLIENT_SECRET?: string;
  MAIL_OAUTH_REFRESH_TOKEN?: string;
}

export type LeadState =
  | "new"
  | "scored"
  | "contact_found"
  | "drafted"
  | "approved"
  | "in_drafts"
  | "sent"
  | "followup_sent"
  | "replied"
  | "bounced"
  | "opted_out"
  | "disqualified"
  | "rejected"
  | "send_unknown"
  | "closed";

export type LeadRow = {
  id: string;
  domain: string;
  source: string;
  country: string | null;
  state: LeadState;
  state_reason: string | null;
  icp_ok: number | null;
  scan_id: string | null;
  scanned_at: number | null;
  scan_attempts: number;
  rescanned: number;
  fact_sheet_json: string | null;
  contact_email: string | null;
  contact_source_url: string | null;
  batch_id: string | null;
  last_outbound_at: number | null;
  terminal_at: number | null;
  updated_at: number;
  created_at: number;
};

export type MessageRow = {
  id: string;
  lead_id: string;
  kind: "initial" | "followup";
  batch_id: string | null;
  subject: string;
  body_text: string;
  validator_report_json: string;
  status: "draft" | "queued" | "drafting" | "in_drafts" | "sent" | "draft_unknown" | "expired" | "cancelled";
  claim_id: string | null;
  claimed_at: number | null;
  mailbox_draft_id: string | null;
  drafted_at: number | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  rfc_message_id: string | null;
  not_before: number;
  sent_at: number | null;
  retry_count: number;
  created_at: number;
  updated_at: number;
};

export type ControlRow = {
  id: 1;
  paused: number;
  pause_reason: string | null;
  paused_at: number | null;
  drafting_paused: number;
  last_stop_trip_at: number | null;
  second_approval_at: number | null;
  dns_verified_at: number | null;
  ramp_start_at: number | null;
  ramp_paused_ms: number;
  approved_batches: number;
  consecutive_send_errors: number;
  inbox_cursor: string | null;
  inbox_caught_up_at: number | null;
  sent_cursor: string | null;
  tick_lease_until: number;
  tick_lease_id: string | null;
};
