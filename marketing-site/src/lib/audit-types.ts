// Shared types for the Audit fulfillment pipeline.
//
// Mirrors the scanner's public ScanResult shape so we can store and operate
// on it without re-importing the scanner package. Keep field names in sync
// with /f/pharos/scanner/src/types.ts.

export type SubCheck = {
  id: string;
  name: string;
  weight: number;
  score: number;
  passed: boolean;
  notes: string;
};

export type DimensionResult = {
  dimension_id: number;
  dimension_name: string;
  score: number;
  grade: string;
  sub_checks: SubCheck[];
};

export type Composite = {
  score: number;
  grade: string;
};

export type ScanResult = {
  id: string;
  url: string;
  composite: Composite;
  dimensions: DimensionResult[];
  dimensions_scored: number;
  dimensions_total: number;
  created_at: number;
};

export type GapWithRemediation = {
  dimension_id: number;
  dimension_name: string;
  check_id: string;
  check_name: string;
  weight: number;
  score: number;
  notes: string;
  remediation: string;
};

export type AuditResult = {
  scan: ScanResult;
  gaps: GapWithRemediation[];
  engine_version: string;
};

export type SessionStatus =
  | "awaiting_payment"
  | "fulfilling"
  | "ready"
  | "error";

export type SessionRecord = {
  session_id: string;
  url: string;
  email: string;
  status: SessionStatus;
  created_at: number;
  started_at?: number;
  completed_at?: number;
  pdf_url?: string;
  json_url?: string;
  composite_score?: number;
  grade?: string;
  error_message?: string;
};
