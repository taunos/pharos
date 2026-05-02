// Slice 3b Dim 6 — DIY Citation Audit shared types.
//
// These types live in marketing-site/src/lib/dim6/ and MUST NOT be imported
// by the scanner Worker. The scanner has its own standalone Dim 6 module that
// emits free-tier demo content statically. Capability separation per locked
// decision 1: API keys live ONLY on marketing-site, so the orchestrator and
// adapters defined here run only on the paid-tier (audit-fulfill) path.

// Engine version stamped on every cell + corpus row. Bump on:
//   - prompt-template change in promptset.ts
//   - scoring formula / parser change (e.g. v1→v2 added the Workers AI
//     affirmation judge after substring-only v1 over-counted refusals
//     and confabulated mentions as citations — see affirmation-judge.ts
//     and the 2026-05-02 dogfood postmortem)
//   - model swap (drop a provider, add a 5th, change to Profound)
//
// Cache prefix in `dim6:vN:<modelId>:<sha256(prompt)>` so a version bump
// invalidates every cached cell automatically — no manual KV purge needed.
//
// History:
//   - dim6:v1 (Slice 3b initial, 2026-05-01): substring-only parser,
//     4 sub-checks (domain_named/url_referenced/context_relevant/
//     no_competitor_first) weighted 40/30/20/10. Over-counted refusals
//     and confabulations as citations on Astrant dogfood (2026-05-02).
//   - dim6:v2 (parser fix, 2026-05-02): added Workers AI affirmation
//     judge between canary-refusal check and substring scoring. Judge
//     returns AFFIRM/DENY; only AFFIRM cells run substring breakdown.
//     DENY cells score 0 but stay measurable (clean no-citation, real
//     signal). Judge failures mark cell unmeasurable (excluded).
//   - dim6:v3 (prompt-set generator fix, 2026-05-02): four-fix bundle
//     after Stripe verification attempt 1 (2026-05-02) returned
//     INVALID due to 100% Bank fallback contamination across 40 cells.
//     Bug 2 root cause: generator had NO TP-7 retry-once-with-feedback
//     (Slice 3b spec violation), and the AVOID-list bullet-list in the
//     gen prompt primed the small llama-3.1-8b model to echo forbidden
//     phrasings (negation-failure pattern; see
//     feedback_avoid_list_priming.md). v3 fixes: (a) retry-once-with-
//     feedback, (b) gen prompt restructured with positive instructions
//     instead of AVOID bullet list, (c) AVOID regex loosened (dropped
//     \bin detail\b + \bcompare all\b — over-matching), (d) CC-3:
//     bank queries use domain-named only (category-substituted
//     framings deliberately removed; re-introduce only after audit-
//     fulfill populates real category from signals — see
//     pharos-stripe-decision-framework.md "Pre-retry queue").
//     Engine bump auto-invalidates v2 model-call cell cache.
export const DIM6_ENGINE_VERSION = "dim6:v3";

// Locked at 4 models per locked decision 2. No 5th model in Slice 3b.
export type ModelId =
  | "openai:gpt-4o"
  | "anthropic:claude-sonnet"
  | "google:gemini-2.0-flash"
  | "perplexity:sonar";

export const ALL_MODEL_IDS: ModelId[] = [
  "openai:gpt-4o",
  "anthropic:claude-sonnet",
  "google:gemini-2.0-flash",
  "perplexity:sonar",
];

// One generated query the orchestrator dispatches across all 4 models.
// rationale stays nullable defensively (CC-2): we don't trust any single source
// of generator output to always populate it. Corpus row-build reads
// `query.rationale ?? null`.
export interface PromptSetQuery {
  id: string;       // stable per-scan id, e.g. q1, q2, ...
  text: string;     // the exact prompt sent to all 4 models
  rationale: string | null;
}

// Output of a single model call. Three terminal cell states:
//   - {unmeasurable:true}  — excluded from formula. score=0 nominal.
//   - {truncated:true}     — INCLUDED in formula. score is real, response hit max_tokens.
//   - normal               — INCLUDED. score derived from response.
export interface CellResult {
  text: string | null;       // raw response body, null when unmeasurable
  score: number;             // 0-100; 0 when unmeasurable
  unmeasurable: boolean;
  truncated: boolean;
  notes: string;             // diagnostic notes (validator failures, retry path, fallback reason)
}

export interface CellEnvelope {
  query: PromptSetQuery;
  modelId: ModelId;
  result: CellResult;
}

// What Dim 6 emits to the runDim6 caller in audit-fulfill. Maps cleanly onto a
// SubCheck[] for the dimension. Caller may also persist `cells` to the corpus
// (one row per cell via recordCitationAuditResponse).
export interface Dim6Result {
  // The aggregate score after excluding unmeasurable cells.
  // Returns null when EVERY cell was unmeasurable — caller marks dim na:true.
  score: number | null;
  cells: CellEnvelope[];
  perModelAverage: Record<ModelId, number | null>;  // null when all cells for that model were unmeasurable
  unmeasurableCount: number;
  totalCells: number;
}
