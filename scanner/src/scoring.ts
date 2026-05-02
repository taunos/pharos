import type { DimensionResult, Composite, SubCheck } from "./types";

// Slice 3a: SPEC_WEIGHTS replaces SLICE2A_WEIGHTS. The final-spec weights
// (OQ-04 §2) are the source of truth — composite math reads them directly,
// then renormalizes across only the dimensions actually applicable to this
// scan (i.e. attempted AND not whole-dimension N/A). This makes whole-
// dimension N/A handling work the same way sub-check N/A does inside
// dimensionScore: drop the term, redistribute its weight across the rest.
//
// Final-spec weights per OQ-04 §1 (sum 100):
//   Dim 1 — llms.txt Quality           15
//   Dim 2 — MCP Server Discoverability 20
//   Dim 3 — OpenAPI / API Catalog      10  (ships in Slice 3a / v1.2.0)
//   Dim 4 — Structured Capability Data 20
//   Dim 5 — Agent-Parsable Content     15
//   Dim 6 — Citation Visibility        20  (ships in Slice 3b — strategic
//                                            differentiator weight per spec;
//                                            do not deflate)
//
// History:
// - Slice 1 (3-of-6): runtime renormalized 15/20/20 over sum 55.
// - Slice 2a (4-of-6): runtime renormalized 15/20/20/15 over sum 70.
// - Slice 3a (5-of-6 catalog, may be 4-of-5 applicable when Dim 3 N/A):
//   composite renormalizes over the dimensions actually present on the wire,
//   minus any flagged na:true.
export const SPEC_WEIGHTS: Record<number, number> = {
  1: 15,
  2: 20,
  3: 10,
  4: 20,
  5: 15,
  6: 20,
};

// Backwards-compat alias for any tooling that imported the Slice 2a name.
// New code should reference SPEC_WEIGHTS directly. Same proportions as the
// pre-Slice-3a presentation transform for the four shipped dimensions, so
// content-only sites land at the same composite as v1.1.0 (parity invariant).
export const SLICE2A_WEIGHTS: Record<number, number> = {
  1: 15 / 70,
  2: 20 / 70,
  4: 20 / 70,
  5: 15 / 70,
};

export function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "A-";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

/**
 * Compute composite from the dimensions present on the scan. Drops dimensions
 * flagged with `na: true` and renormalizes the remaining SPEC_WEIGHTS so the
 * composite reads on a 0-100 scale within whatever subset applied. Dimensions
 * not present in the array (e.g. Dim 6 pre-Slice-3b) contribute zero weight
 * — they're neither attempted nor counted.
 *
 * Parity invariant: a content-only site with no API surface scoring under
 * v1.2.0 (Dim 3 returning na:true) must produce the same composite as the
 * same site under v1.1.0 (where Dim 3 wasn't attempted). The math here
 * delivers that — the four applicable dimensions {1,2,4,5} land at weights
 * 15/20/20/15 sum 70 in BOTH cases.
 */
export function compositeOf(dimensions: DimensionResult[]): Composite {
  let weighted = 0;
  let totalWeight = 0;
  for (const d of dimensions) {
    if (d.na) continue;
    const w = SPEC_WEIGHTS[d.dimension_id] ?? 0;
    weighted += d.score * w;
    totalWeight += w;
  }
  const score = totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);
  return { score, grade: gradeFor(score) };
}

/**
 * Compute a dimension's score from its sub-checks. Sub-checks marked with
 * `na: true` are excluded; their weight is redistributed proportionally
 * across the remaining sub-checks within the same dimension.
 *
 * Pattern A — null contract for new dimension runners (Slice 3a Dim 3 and
 * later): when EVERY sub-check is N/A (e.g. no API surface detected at all),
 * this returns null. The caller is responsible for marking the whole dimension
 * `na: true` and assigning a placeholder score (0 is fine — composite math
 * skips it). This makes "the dimension didn't apply" representable, not
 * silently coerced to a literal 0/100.
 *
 * Pattern B — existing runners (Dim 1/2/4/5) call dimensionScoreOrThrow which
 * throws if denom===0 instead of returning null. Their sub-checks are
 * structured so denom is never zero in practice (every dimension always has
 * at least the "presence"-style sub-check that scores 0 rather than N/A).
 * Throwing surfaces a regression loud rather than silently producing a 0/100.
 */
export function dimensionScore(subs: SubCheck[]): number | null {
  let total = 0;
  let denom = 0;
  for (const s of subs) {
    if (s.na) continue;
    total += s.score * s.weight;
    denom += s.weight;
  }
  if (denom === 0) return null;
  return Math.round(total / denom);
}

/**
 * Pattern B helper for the existing runners (Dim 1/2/4/5). Throws if every
 * sub-check is N/A. Never coerces to 0 — that would silently regress a
 * dimension to 0/100 if some future refactor flagged every sub-check N/A.
 */
export function dimensionScoreOrThrow(subs: SubCheck[]): number {
  const s = dimensionScore(subs);
  if (s === null) {
    throw new Error(
      "dimensionScoreOrThrow: every sub-check is N/A. " +
        "Use Pattern A (return null + na:true on the dimension) for new runners."
    );
  }
  return s;
}
