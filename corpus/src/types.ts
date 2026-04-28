// Pharos Corpus — typed row + input shapes.
//
// Row types mirror the on-disk D1 schema (migrations/0001_initial_schema.sql).
// Input types are what callers (writer services like audit-fulfill) pass in;
// they omit auto-generated fields (created_at, schema_version) and may make
// scan_id optional where the writer wants the client to mint it.

export type Tier =
  | "score"
  | "audit"
  | "implementation"
  | "autopilot"
  | "concierge";

export type ConsentBasis =
  | "paid_optin"
  | "free_optout_default"
  | "subscription"
  | "custom_engagement";

export type ScanStatus =
  | "pending"
  | "recommendations_complete"
  | "applied"
  | "rescanned"
  | "error";

export type RecommendationSource = "llm" | "fallback_template" | "human";

export type DeliveryMode =
  | "patch_file"
  | "pr"
  | "manual_email"
  | "autopilot_auto";

export type AnnotationVisibility = "internal" | "shared_with_customer";

// ── Row types (what's on disk) ────────────────────────────────────────────

export interface ScanEventRow {
  scan_id: string;
  customer_id: string | null;
  url: string;
  tier: Tier;
  source_scan_id: string | null;
  parent_scan_id: string | null;
  consent_basis: ConsentBasis;
  status: ScanStatus;
  score_pre: number | null;
  score_post: number | null;
  engine_version: string;
  schema_version: string;
  metadata: string | null; // JSON-encoded
  created_at: number;
}

export interface ScanFindingRow {
  finding_id: string;
  scan_id: string;
  dimension_id: number;
  dimension_name: string;
  check_id: string;
  check_name: string;
  score: number;
  weight: number;
  notes: string;
  evidence: string | null; // JSON-encoded
  schema_version: string;
  created_at: number;
}

export interface ScanRecommendationRow {
  recommendation_id: string;
  scan_id: string;
  finding_ids: string; // JSON array
  check_id: string;
  subject: string | null;
  recommendation_payload: string;
  estimated_effort: string | null;
  source: RecommendationSource;
  engine_version: string;
  schema_version: string;
  created_at: number;
}

export interface ScanApplicationRow {
  application_id: string;
  recommendation_id: string;
  scan_id: string;
  applied_payload: string;
  delivery_mode: DeliveryMode;
  applied_at: number;
  notes: string | null;
  schema_version: string;
  created_at: number;
}

export interface ScanOutcomeRow {
  outcome_id: string;
  application_id: string;
  rescan_id: string;
  score_delta: number | null;
  observed_at: number;
  notes: string | null;
  schema_version: string;
  created_at: number;
}

export interface StrategistAnnotationRow {
  annotation_id: string;
  scan_id: string;
  author: string;
  body: string;
  visibility: AnnotationVisibility;
  schema_version: string;
  created_at: number;
}

// ── Input types (what callers pass) ────────────────────────────────────────
//
// Inputs omit schema_version (stamped by the client), created_at (set to now()),
// and engine_version on rows where the client supplies it from construction.
// scan_id is OPTIONAL on ScanEventInput — when omitted, client mints; when
// provided (e.g. audit-fulfill passing session_id for idempotency), used as-is.

export interface ScanEventInput {
  scan_id?: string;
  customer_id?: string | null;
  url: string;
  tier: Tier;
  source_scan_id?: string | null;
  parent_scan_id?: string | null;
  consent_basis: ConsentBasis;
  status: ScanStatus;
  score_pre?: number | null;
  score_post?: number | null;
  metadata?: Record<string, unknown> | null; // serialized to JSON by client
}

export interface ScanFindingInput {
  finding_id?: string;
  dimension_id: number;
  dimension_name: string;
  check_id: string;
  check_name: string;
  score: number;
  weight: number;
  notes: string;
  evidence?: Record<string, unknown> | null;
}

export interface ScanRecommendationInput {
  recommendation_id?: string;
  finding_ids: string[];
  check_id: string;
  subject?: string | null;
  recommendation_payload: string;
  estimated_effort?: string | null;
  source: RecommendationSource;
}

export interface ScanApplicationInput {
  application_id?: string;
  recommendation_id: string;
  scan_id: string;
  applied_payload: string;
  delivery_mode: DeliveryMode;
  applied_at?: number;
  notes?: string | null;
}

export interface ScanOutcomeInput {
  outcome_id?: string;
  application_id: string;
  rescan_id: string;
  score_delta?: number | null;
  observed_at?: number;
  notes?: string | null;
}

export interface StrategistAnnotationInput {
  annotation_id?: string;
  scan_id: string;
  author: string;
  body: string;
  visibility: AnnotationVisibility;
}
