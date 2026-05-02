// Inlined methodology calibration markdown for the
// /methodology/calibration server-rendered page. OpenNext's Cloudflare
// Workers runtime does not reliably resolve readFileSync paths under
// process.cwd(), so the content is inlined here per the same pattern as
// legal-content.ts.
//
// Source-of-truth: pharos-publishing-bundle-content.md (OneDrive workspace).
// Claims-level only — boundary discipline per
// feedback_published_claims_vs_private_techniques.md. No provider names,
// no specific thresholds, no calibration domain names, no regex specifics,
// no code references, no novel methodology insight names, no numbered
// Pass labels.

export const METHODOLOGY_CALIBRATION_MD = `# Calibration Methodology

**Engine version: dim6:v3 · Last calibrated: 2026-05-02**

## Why this page exists

Most agentic-discoverability scores are black boxes. Astrant's isn't. This page documents how Dim 6 (the citation-audit dimension) is calibrated, what the calibration validates, and what its known limits are. The methodology evolves with the product; the engine version above tells you which calibration generation produced your most recent Dim 6 score.

## How Dim 6 is measured

Dim 6 measures whether AI models cite your domain when asked questions a buyer or researcher might ask about your category. The Dim 6 pipeline runs in three stages:

1. **Prompt generation.** For each audited domain, Dim 6 generates a citation-eliciting query set from observed signals about the domain. Queries are deterministic (same domain produces the same prompts on repeat runs until the underlying signals change) and validated before being sent to citation-target models.

2. **Citation querying.** Each prompt is sent to multiple major language models. Responses are captured verbatim into Dim 6's audit corpus.

3. **Judging and scoring.** Each response is judged for whether it substantively engages with the audited domain. The Dim 6 composite reflects citation rate, citation specificity, and surrounding-context relevance.

Every step is engine-versioned. When Dim 6 calibration changes, the engine version increments and prior Dim 6 scores are not silently reinterpreted.

## What "Dim 6 calibrated" means

Most products that score domain visibility don't disclose how the score was derived. Dim 6 calibration follows a multi-pass methodology against a corpus of control domains chosen for known citation behavior. Each pass tests a different invariant of the Dim 6 pipeline:

- **Parser invariants.** Does Dim 6's citation-detection logic produce convergent results across providers and prompt categories where convergence is expected?
- **Judge invariants.** Does Dim 6's substantive-engagement judge produce verdicts that track the actual citation surface, or does it carry a constant bias regardless of ground truth?
- **Whole-pipeline invariants.** On a domain whose ground-truth citation surface is known to be high, do all providers converge on the expected high-citation behavior?

Calibration is iterative. Each pass surfaces a defect class invisible to the prior pass; each fix tightens Dim 6. The current engine version reflects three completed passes plus the corresponding fix bundles.

## Operational discipline (Dim 6 deploy practices)

Beyond the methodology itself, Dim 6 calibration is enforced by operational practices on every deploy:

- **Engine-versioned scoring with cache invalidation.** Bumping the Dim 6 engine version invalidates all prior cell-cache entries, so a calibration change cannot silently apply to historical Dim 6 scans without a re-run.
- **Validator-driven trust pattern.** Every Dim 6 LLM call is deterministic, validated post-generation, retried with feedback if validation fails, and falls back to a templated path if retry exhausts. Customers never see raw LLM output.
- **Sub-check decomposition.** Dim 6 composite scores decompose into named sub-checks. A Dim 6 score below the maximum tells you *which* aspect of citation surface is weak, not just that the score is low.
- **Verify-at-endpoint discipline.** Every Dim 6 deploy is verified by behavior assertions on a non-customer test domain before customer audits run on the new code.
- **Version-stamped recalibration.** When a Dim 6 calibration baseline is later discovered to have contamination, downstream thresholds are recalibrated against a clean baseline and the engine version increments. Previous Dim 6 numbers are preserved as historical context, never silently overwritten.

## Known limits

Methodology rigor includes being explicit about what hasn't been validated yet. Current limits at engine version dim6:v3:

- **Single high-end calibration anchor.** The methodology validates against one well-indexed major brand as a known-positive control. Future calibration passes will add more known-positive anchors to confirm the methodology generalizes across high-recognition domains.
- **No known-negative anchor.** The methodology has not yet been validated against a deliberately weak-signal control (e.g., a brochure site with minimal real citation surface). This is queued for the next calibration pass.
- **One provider operationally absent.** One of the four major-language-model providers in the audit corpus produces no judged verdicts due to upstream rate-limit behavior. Methodology runs on three-provider evidence pending a per-provider isolation fix.
- **Domain canonicalization sensitivity.** When a domain has migrated its canonical URL (e.g., a rebrand from \`.so\` to \`.com\`), the citation parser may underregister current-canonical citations and overregister legacy-canonical ones. Customers whose domains have rebranded should interpret per-cell scores with this caveat in mind. A canonicalization fix is queued.

Each of these limits is queued for resolution; engine version increments will reflect each fix as it ships.

## Methodology versioning history

| Engine | What changed |
|--------|--------------|
| dim6:v1 | Initial implementation. Calibration uncovered a parser-side defect class. |
| dim6:v2 | Parser defect resolved. Calibration introduced a multi-provider validation baseline; uncovered upstream defects in the prompt pipeline. |
| dim6:v3 | Prompt pipeline rebuilt with full trust-pattern compliance. Calibration validated the methodology against a known-positive control with strong cross-provider agreement. Current. |

## For technical evaluation

Technical-detail questions about Dim 6 calibration are welcome. Contact us at [contact@astrant.io](mailto:contact@astrant.io) for evaluator-shaped conversations about methodology depth.
`;
