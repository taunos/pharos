// Which checks are gaps in the paid Audit, and in what order.
//
// A gap is a sub-check that did not pass (sub.passed false, the same rule the
// Score PDF uses for its "Passing" label) and is not N/A. Gaps are ordered by
// weighted impact on the composite: (100 - score) x the sub-check's share of
// its dimension (weight over the dimension's non-N/A weights, as the
// dimension score renormalizes) x the dimension's composite weight.
//
// Pure: no Worker bindings, safe in the client report view.

import type { DimensionResult, GapWithRemediation, ScanResult, SubCheck } from "./audit-types";

// Mirror of scanner/src/scoring.ts SPEC_WEIGHTS (dimension weights in the
// composite).
export const DIMENSION_WEIGHTS: Record<number, number> = {
  1: 15,
  2: 20,
  3: 10,
  4: 20,
  5: 15,
  6: 20,
};

export function isGap(s: SubCheck): boolean {
  return !s.na && !s.passed;
}

/** Points-weighted impact of one sub-check on the composite (higher = costs more). */
export function gapImpact(dim: Pick<DimensionResult, "dimension_id" | "sub_checks">, weight: number, score: number): number {
  const dimWeight = DIMENSION_WEIGHTS[dim.dimension_id] ?? 0;
  const applicable = dim.sub_checks.filter((s) => !s.na).reduce((a, s) => a + (Number(s.weight) || 0), 0);
  if (applicable <= 0) return 0;
  return (100 - score) * ((Number(weight) || 0) / applicable) * dimWeight;
}

/**
 * Gaps to show, highest impact first; ties keep dimension order. A stored
 * gap whose sub-check passed (older audits listed every score below 100) is
 * dropped. A stored gap whose sub-check is no longer in the scan is kept.
 */
export function orderGaps<G extends Pick<GapWithRemediation, "dimension_id" | "check_id" | "weight" | "score">>(
  scan: Pick<ScanResult, "dimensions">,
  gaps: readonly G[],
): G[] {
  const ranked: { g: G; impact: number; i: number }[] = [];
  gaps.forEach((g, i) => {
    const dim = scan.dimensions.find((d) => d.dimension_id === g.dimension_id);
    const sub = dim?.sub_checks.find((s) => s.id === g.check_id);
    if (sub && !isGap(sub)) return;
    const impact = dim ? gapImpact(dim, g.weight, g.score) : 0;
    ranked.push({ g, impact, i });
  });
  ranked.sort((a, b) => b.impact - a.impact || a.g.dimension_id - b.g.dimension_id || a.i - b.i);
  return ranked.map((r) => r.g);
}
