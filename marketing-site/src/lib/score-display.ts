export const DIM6_DEMO_SUBCHECK_ID = "free_tier_dim6_preview";
export function applicableDimensionCount(applicable: number | undefined, scored: number): number {
  return applicable ?? scored;
}
export function dimensionCountPhrase(applicable: number | undefined, scored: number, total: number): string {
  return `${applicableDimensionCount(applicable, scored)} of ${total}`;
}
/**
 * The "dropped from the composite" sentence after "Scored on X of Y".
 * Unmeasured dimensions (scanner security pass 2026-11-04: applies, but could
 * not be read in full this run) get their own sentence, and the "no API
 * surface" example is omitted when the OpenAPI dimension (Dim 3) is the one
 * that was unmeasured, so the copy never claims the site has no API.
 */
export function droppedDimensionsNote(scan: {
  dimensions_applicable?: number;
  dimensions_scored: number;
  dimensions: { dimension_id: number; na?: boolean; unmeasured?: boolean }[];
}): string {
  if (applicableDimensionCount(scan.dimensions_applicable, scan.dimensions_scored) >= scan.dimensions_scored) return "";
  const unmeasured = scan.dimensions.filter((d) => d.na && d.unmeasured);
  const inapplicable = scan.dimensions.some((d) => d.na && !d.unmeasured);
  if (unmeasured.length === 0) {
    return " Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite.";
  }
  const openApiUnmeasured = unmeasured.some((d) => d.dimension_id === 3);
  const applied = !inapplicable
    ? ""
    : openApiUnmeasured
      ? " Some dimensions did not apply to your site and were dropped from the composite."
      : " Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite.";
  return applied + " Some dimensions could not be measured on this run and were dropped from the composite.";
}
export function gradeColorClass(grade: string): string {
  if (grade.startsWith("A")) return "text-emerald-400";
  if (grade.startsWith("B")) return "text-emerald-300";
  if (grade === "C") return "text-yellow-400";
  if (grade === "D") return "text-orange-400";
  return "text-red-400";
}
export function isDim6DemoPreview(dim: { sub_checks?: { id: string }[] }): boolean {
  return dim.sub_checks?.some((sc) => sc.id === DIM6_DEMO_SUBCHECK_ID) ?? false;
}
