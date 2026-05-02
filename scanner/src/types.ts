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
  // Slice 2b: separate trust domain for Score email-capture admin endpoints.
  // Distinct from INTERNAL_FULFILL_KEY (which gates paid-tier audit/scan flows
  // and money-handling paths) so a single secret compromise no longer breaches
  // money flows + PII read-back + destructive actions + state changes in one
  // stroke. Both secrets initially hold independent random values and are
  // rotated independently. When absent, all Slice 2b admin endpoints reject.
  INTERNAL_SCANNER_ADMIN_KEY?: string;
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
  // Slice 3a: when true, this whole dimension is N/A for the scanned site
  // (e.g. Dim 3 OpenAPI on a content-only site with no API surface). The
  // composite math drops it via SPEC_WEIGHTS renormalization, the consumer
  // surfaces (results page, PDFs, email) render it distinctly from a 0/100,
  // and dimensions_applicable counts it out so the "Scored on X of Y" copy
  // reflects the user's actual surface, not the catalog.
  na?: boolean;
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
  // Slice 1/2a: dimensions ATTEMPTED in this engine version (4 of 6 in v1.1.0,
  // 5 of 6 in v1.2.0 once Dim 3 ships). Reflects engine capability.
  dimensions_scored: number;
  dimensions_total: number;
  // Slice 3a: dimensions THAT APPLIED to this URL — i.e. attempted minus those
  // marked whole-dimension N/A. For a content-only site under v1.2.0 with Dim 3
  // returning na:true, dimensions_applicable=4, dimensions_scored=5. Always
  // <= dimensions_scored. Non-optional on the wire (scanner always emits it).
  dimensions_applicable: number;
  created_at: number;
  scoring_version: string;
  tier: ScanTier;
};
