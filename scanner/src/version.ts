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
 */
export const SCORING_VERSION = "1.1.0";
