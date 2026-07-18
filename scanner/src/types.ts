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
  // Privacy (OD#7): HMAC secret used to pseudonymize the IP in rate-limit KV
  // keys, so no raw IP is stored at rest. Rate limiting fails closed if absent.
  RATE_LIMIT_HASH_SECRET?: string;
  // P0-C2 Chunk C: optional deferred-capture Queue producer binding. Optional so
  // the disabled build typechecks/deploys without a Queue created yet; when
  // absent, the producer still writes the durable outbox job (enqueued_at NULL)
  // and the watchdog leaves it repairable. No wrangler.jsonc binding is declared
  // in this chunk.
  CAPTURE_QUEUE?: Queue<CaptureJobMessage>;
  // P0-C2 Chunk E1: separate trust domain for the marketing capture-consumer
  // Service Binding (distinct from INTERNAL_SCANNER_ADMIN_KEY / INTERNAL_FULFILL_KEY).
  // Optional + fail-closed when absent; NOT provisioned/bound in this chunk.
  CAPTURE_CONSUMER_KEY?: string;
  // P0-C2 Chunk F1: Service Binding to marketing's R2 reconciliation endpoints
  // (scanner drives reconciliation but marketing owns R2). Optional + fail-closed;
  // NOT provisioned/bound in this chunk.
  MARKETING_R2?: Fetcher;
  RECONCILE_R2_KEY?: string;
  // P0-C2 Chunk F2: retention-sweep mode gate. Fail-closed — absent or any
  // non-exact value resolves to 'off' (parseRetentionMode). Not set in
  // wrangler.jsonc in this chunk; the sweep is unreachable in production
  // until activation.
  RETENTION_SWEEP_MODE?: string;
  // P0-C2 Chunk G: privacy-integration gate. Fail-closed — absent or any
  // non-exact value resolves to 'off' (parseIntegrationMode), and 'off' means
  // byte-identical legacy behavior on every touched surface. Not set anywhere
  // in this chunk; activation is separately gated (see the activation section
  // of the Chunk G ship-report).
  PRIVACY_INTEGRATION_MODE?: string;
}

// The ONLY value put on the capture Queue — the stable job_id. The consumer
// (Chunk E, marketing-owned) loads everything else from D1 by this id.
export type CaptureJobMessage = { job_id: string };

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
