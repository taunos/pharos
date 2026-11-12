// Score comparability notice, shown in the paid Audit report (under the
// coverage line) and on the methodology pages. One source so the surfaces
// cannot drift.
//
// The versions and dates are historical: they name the releases that made the
// measurement stricter (scanner/src/version.ts 1.5.1, 2026-11-07; Dim 6
// engine dim6:v5, 2026-11-08), not the current version, so they stay fixed
// when either engine is bumped again.

// Release dates (YYYY-MM-DD, UTC) printed in the notice below. Bruno sets
// both on deploy day (combined notice approved 2026-11-12,
// copy-for-approval-before-merge-2026-11-12.md section 3).
export const SCANNER_1_5_2_DATE = "2026-11-13";
export const CITATION_VISIBILITY_V6_DATE = "2026-11-13";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-13" -> "Nov 13, 2026" (the notice's date style). */
export function noticeDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month || Number(m[3]) < 1 || Number(m[3]) > 31) throw new Error(`bad notice date: ${iso}`);
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

export const VERSION_COMPARABILITY_NOTICE =
  "Scores are only comparable between reports made with the same version. " +
  `Astrant Score scoring versions 1.5.1 (Nov 7, 2026) and 1.5.2 (${noticeDate(SCANNER_1_5_2_DATE)}) and Citation Visibility v5 (Nov 8, 2026) measure more strictly than earlier versions, so a lower score after these dates does not by itself mean your site got worse. ` +
  `Citation Visibility v6 (${noticeDate(CITATION_VISIBILITY_V6_DATE)}) counts only the answers it can check against your site's own text and gives no grade when too few can be checked, so its score for the same site can be higher or lower than v5's.`;

/** The report's own scoring version, as stamped on the scan by the scanner ("1.5.1"); null when absent or malformed. */
export function reportScoringVersion(v: unknown): string | null {
  return typeof v === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? v : null;
}
