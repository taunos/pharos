import type { DimensionResult, Composite, SubCheck } from "./types";

// Slice 1: dims 1, 2, 4 only. Final-spec weights are 15/20/20 (sum 55);
// renormalize so the partial composite reads on a 0-100 scale within the slice.
export const SLICE1_WEIGHTS: Record<number, number> = {
  1: 15 / 55,
  2: 20 / 55,
  4: 20 / 55,
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
    const w = SLICE1_WEIGHTS[d.dimension_id] ?? 0;
    weighted += d.score * w;
  }
  const score = Math.round(weighted);
  return { score, grade: gradeFor(score) };
}

export function dimensionScore(subs: SubCheck[]): number {
  let total = 0;
  let denom = 0;
  for (const s of subs) {
    total += s.score * s.weight;
    denom += s.weight;
  }
  if (denom === 0) return 0;
  return Math.round(total / denom);
}
