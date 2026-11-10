// Score comparability notice, shown in the paid Audit report (under the
// coverage line) and on the methodology pages. One source so the surfaces
// cannot drift.
//
// The versions and dates are historical: they name the releases that made the
// measurement stricter (scanner/src/version.ts 1.5.1, 2026-11-07; Dim 6
// engine dim6:v5, 2026-11-08), not the current version, so they stay fixed
// when either engine is bumped again.

export const VERSION_COMPARABILITY_NOTICE =
  "Scores are only comparable between reports made with the same version. Astrant Score scoring version 1.5.1 (Nov 7, 2026) and Citation Visibility v5 (Nov 8, 2026) measure more strictly than earlier versions, so a lower score after these dates does not by itself mean your site got worse.";

/** The report's own scoring version, as stamped on the scan by the scanner ("1.5.1"); null when absent or malformed. */
export function reportScoringVersion(v: unknown): string | null {
  return typeof v === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? v : null;
}
