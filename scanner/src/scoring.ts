import type { DimensionResult, Composite, SubCheck } from "./types";

// Slice 2a: dims 1, 2, 4, 5 scored. Final-spec weights are 15/20/20/15 (sum 70);
// renormalize so the partial composite reads on a 0-100 scale within the slice.
//
// History:
// - Slice 1 (3-of-6): 15/55, 20/55, 20/55 = 27.3% / 36.4% / 36.4%
// - Slice 2a (4-of-6): 15/70, 20/70, 20/70, 15/70 = 21.4% / 28.6% / 28.6% / 21.4%
//
// Final-spec weights stay the source of truth in OQ-04 §2; this map is the
// presentation transform.
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

export function compositeOf(dimensions: DimensionResult[]): Composite {
  let weighted = 0;
  for (const d of dimensions) {
    const w = SLICE2A_WEIGHTS[d.dimension_id] ?? 0;
    weighted += d.score * w;
  }
  const score = Math.round(weighted);
  return { score, grade: gradeFor(score) };
}

/**
 * Compute a dimension's score from its sub-checks. Sub-checks marked with
 * `na: true` are excluded; their weight is redistributed proportionally
 * across the remaining sub-checks within the same dimension. This keeps
 * "no pricing page found" (etc.) from artificially deflating the dimension.
 */
export function dimensionScore(subs: SubCheck[]): number {
  let total = 0;
  let denom = 0;
  for (const s of subs) {
    if (s.na) continue;
    total += s.score * s.weight;
    denom += s.weight;
  }
  if (denom === 0) return 0;
  return Math.round(total / denom);
}
