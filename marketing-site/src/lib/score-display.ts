export const DIM6_DEMO_SUBCHECK_ID = "free_tier_dim6_preview";
export function applicableDimensionCount(applicable: number | undefined, scored: number): number {
  return applicable ?? scored;
}
export function dimensionCountPhrase(applicable: number | undefined, scored: number, total: number): string {
  return `${applicableDimensionCount(applicable, scored)} of ${total}`;
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
