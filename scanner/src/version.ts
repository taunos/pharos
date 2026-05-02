/**
 * Scanner scoring engine version. Bump on any change that affects how scores
 * are computed (new dimension, new sub-check, weight changes, scoring math).
 * Stamped on every scan response as `scan.scoring_version`. Included in cache
 * keys so version bumps invalidate stale entries automatically.
 *
 * Distinct namespace from audit-fulfill's REMEDIATION_ENGINE_VERSION_TAG —
 * scanner version is about scoring math; remediation version is about
 * LLM-generated guidance. The two evolve independently.
 *
 * History:
 * - 1.0.0 (Slice 1, implicit before Slice 2a): Dim 1 + 2 + 4, 3-of-6 composite.
 * - 1.1.0 (Slice 2a): Adds Dim 5 (Agent-Parsable Content); composite becomes 4-of-6.
 * - 1.2.0 (Slice 3a, 2026-04-30): Adds Dim 3 (OpenAPI / API Catalog) with
 *   whole-dim N/A. Composite becomes 5-of-6 with renormalization across
 *   applicable dimensions. Replaces SLICE2A_WEIGHTS with SPEC_WEIGHTS in
 *   compositeOf. Adds ScanResult.dimensions_applicable. Parity invariant:
 *   content-only sites with Dim 3 N/A produce the same composite as v1.1.0.
 *   NOTE: v1.2.0 shipped with drifted SPEC_WEIGHTS (Dim 3 inflated 10→15,
 *   Dim 6 deflated 20→15). Content-only sites unaffected (parity holds at
 *   70 either way) but API-active scans diverged. Corrected in 1.2.1.
 * - 1.2.1 (Slice 3a hotfix, 2026-04-30): SPEC_WEIGHTS restored to canonical
 *   OQ-04 §1 values (15/20/10/20/15/20). Dim 6's 20% strategic-differentiator
 *   weight preserved for Slice 3b. Cache invalidates cleanly via prefix bump.
 */
export const SCORING_VERSION = "1.2.1";
