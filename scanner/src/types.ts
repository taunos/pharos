export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  AI: Ai;
  // Optional bindings — used for paid-tier Dim 5 Browser Rendering. Free tier
  // never invokes them. Marked optional so local dev / older deployments still
  // typecheck if the secrets aren't set yet.
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  // Optional internal-auth secret for paid-tier scans. When absent, the scan
  // endpoint silently treats every request as free-tier (graceful degradation).
  INTERNAL_FULFILL_KEY?: string;
}

export type ScanTier = "free" | "paid";

export type SubCheck = {
  id: string;
  name: string;
  weight: number;
  score: number;
  passed: boolean;
  notes: string;
  // When true, this sub-check is N/A for the scanned site (e.g. no pricing
  // page found). The dimension's scoring math redistributes this sub-check's
  // weight across the remaining sub-checks proportionally. Display layer
  // should render these distinctly from a 0/100 score.
  na?: boolean;
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
  scoring_version: string;
  tier: ScanTier;
};
