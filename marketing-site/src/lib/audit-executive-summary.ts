// Executive summary for the paid Audit report (PDF + on-page).
//
// DETERMINISTIC: built only from the stored audit data, no LLM call, so it can
// never say anything the scan doesn't support. Every buyer-facing string lives
// in EXEC_SUMMARY_COPY below; the builder only selects and joins them.
//
// Output is 3–5 sentences (array; each renders as its own short paragraph):
//   1. overall score + what it means           (always)
//   2. weakest areas, or "no major weak areas"  (only when there are gaps)
//   3. what's working                           (when any dimension is strong)
//   4. caveats: N/A dimensions, partly-measured Citation Visibility (when any)
//   5. pointer to the remediation section, or "nothing to fix" (always)

import type { AuditResult, DimensionResult } from "./audit-types";

// Thresholds on a dimension's 0–100 score.
const WEAK_BELOW = 80; // below grade A- → listed as a weak area
const FAIL_BELOW = 40; // grade F → the stronger "fail" phrasing
const STRONG_FROM = 85; // listed under "what's working"
const MAX_LISTED = 3;

type DimPhrases = { fail: string; partial: string; strong: string };

export const EXEC_SUMMARY_COPY = {
  heading: "Executive summary",

  // Sentence 1: "<overall>: <band>". Bands follow the composite grade scale
  // (A/A- ≥80, B 70–79, C/D 40–69, F <40).
  overall: (score: number, grade: string) =>
    `Your site scored ${score}/100 (grade ${grade})`,
  overallBands: {
    strong:
      "AI assistants and agents can find, read and describe your site well, with only a few gaps left.",
    good: "AI assistants can find and read most of your site, but some gaps limit how accurately they describe what you do.",
    mixed:
      "AI assistants can find parts of your site, but significant gaps make it hard for them to describe what you do accurately.",
    weak: "AI assistants will have a hard time finding your site and describing what you do.",
  },

  // Sentence 2.
  weakestOne: (item: string) => `The weakest area: ${item}.`,
  weakestMany: (items: string) => `The weakest areas: ${items}.`,
  // Appended to each weak area so the reader can find it below.
  weakItem: (phrase: string, dimName: string, score: number) =>
    `${phrase} (${dimName}, ${score}/100)`,
  noMajorWeakAreas:
    "There are no major weak areas; the remaining gaps are smaller refinements.",

  // Sentence 3.
  working: (items: string) => `What's working: ${items}.`,

  // Sentence 4 parts (joined with "; " into one sentence).
  naApplied: (names: string, plural: boolean) =>
    `${names} did not apply to this site, so ${plural ? "they are" : "it is"} not counted in your score`,
  naUnmeasured: (names: string, plural: boolean) =>
    `${names} could not be measured on this run, so ${plural ? "they are" : "it is"} not counted in your score`,
  naCitationUnmeasured:
    "Citation Visibility could not be measured on this run, so it is not counted in your score",
  citationPartial: (assistants: number, ofAssistants: number, cells: number, ofCells: number) =>
    `Citation Visibility was only partly measured (${assistants} of ${ofAssistants} AI assistants returned usable answers, ${cells} of ${ofCells} test answers in all), so treat that score as provisional`,
  citationPartialNoModels: (cells: number, ofCells: number) =>
    `Citation Visibility was only partly measured (${cells} of ${ofCells} test answers were usable), so treat that score as provisional`,

  // Sentence 5.
  closingWithGaps: (gapsHeading: string) =>
    `The "${gapsHeading}" section below lists the specific fix for each gap, weakest first.`,
  closingNoGaps: "Every check scored 100, so there is nothing to fix right now.",

  // Plain-language phrases per dimension (by dimension_id) and score band.
  // fail = score below 40, partial = 40–79, strong = 85 and up.
  dimensions: {
    1: {
      fail: "AI assistants can't find a usable llms.txt, the short guide that points them to your key pages",
      partial: "your llms.txt, the short guide that points AI assistants to your key pages, is incomplete",
      strong: "your llms.txt gives AI assistants a clear guide to your key pages",
    },
    2: {
      fail: "AI agents can't discover or use an MCP server for your site",
      partial: "AI agents can only partly discover or use your MCP server",
      strong: "AI agents can discover and use your MCP server",
    },
    3: {
      fail: "AI agents can't find a machine-readable description of your API",
      partial: "the machine-readable description of your API is incomplete",
      strong: "AI agents can find a clear, machine-readable description of your API",
    },
    4: {
      fail: "your pages carry little of the structured data AI assistants use to understand what you offer",
      partial: "the structured data that tells AI assistants what you offer is incomplete",
      strong: "your structured data tells AI assistants clearly what you offer",
    },
    5: {
      fail: "AI assistants struggle to read the content of your pages",
      partial: "parts of your pages are hard for AI assistants to read",
      strong: "AI assistants can read your pages easily",
    },
    6: {
      fail: "AI assistants rarely name or cite your site in their answers",
      partial: "AI assistants name or cite your site only some of the time",
      strong: "AI assistants regularly name your site in their answers",
    },
  } as Record<number, DimPhrases>,
  // Any dimension without its own phrases (e.g. one added later).
  dimensionFallback: (name: string): DimPhrases => ({
    fail: `${name} needs significant work`,
    partial: `${name} needs work`,
    strong: `${name} is in good shape`,
  }),
} as const;

const CITATION_DIM_ID = 6;
const CITATION_SUMMARY_CHECK_ID = "citation_domain_named_rate";

function phrasesFor(d: DimensionResult): DimPhrases {
  return (
    EXEC_SUMMARY_COPY.dimensions[d.dimension_id] ??
    EXEC_SUMMARY_COPY.dimensionFallback(d.dimension_name)
  );
}

// "a; b; and c" — semicolons because some phrases contain commas.
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]}; and ${items[1]}`;
  return `${items.slice(0, -1).join("; ")}; and ${items[items.length - 1]}`;
}

// "A", "A and B", "A, B and C" — for dimension names.
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function overallBand(score: number): keyof typeof EXEC_SUMMARY_COPY.overallBands {
  if (score >= 80) return "strong";
  if (score >= 70) return "good";
  if (score >= 40) return "mixed";
  return "weak";
}

export type CitationCoverage = {
  measurableCells: number;
  totalCells: number;
  measuredModels: number | null; // null when the per-model list isn't parseable
  totalModels: number | null;
};

// Dim 6 records its coverage only inside the domain-named sub-check's notes,
// written by buildSubChecks in lib/dim6/runDim6.ts:
//   "<n>% of measurable cells named the target domain. <m>/<t> cells
//    measurable across <k> models. Per-model averages: openai=n/a, ..., perplexity=73."
// Returns null when the notes don't carry that shape.
export function citationCoverage(d: DimensionResult): CitationCoverage | null {
  const notes = d.sub_checks.find((s) => s.id === CITATION_SUMMARY_CHECK_ID)?.notes;
  if (!notes) return null;
  const cells = notes.match(/(\d+)\/(\d+) cells measurable/);
  if (!cells) return null;
  const perModel = notes.match(/Per-model averages: ([^]*?)\.?$/);
  let measuredModels: number | null = null;
  let totalModels: number | null = null;
  if (perModel) {
    const pairs = [...perModel[1].matchAll(/[\w.-]+=(n\/a|\d+)/g)];
    if (pairs.length > 0) {
      totalModels = pairs.length;
      measuredModels = pairs.filter((p) => p[1] !== "n/a").length;
    }
  }
  return {
    measurableCells: Number(cells[1]),
    totalCells: Number(cells[2]),
    measuredModels,
    totalModels,
  };
}

export function buildExecutiveSummary(
  audit: AuditResult,
  gapsHeading: string,
): string[] {
  const C = EXEC_SUMMARY_COPY;
  const { scan, gaps } = audit;
  const scored = scan.dimensions.filter((d) => !d.na);
  const naDims = scan.dimensions.filter((d) => d.na);

  const out: string[] = [];

  // 1. Overall.
  out.push(
    `${C.overall(scan.composite.score, scan.composite.grade)}: ${C.overallBands[overallBand(scan.composite.score)]}`,
  );

  // 2. Weakest areas (lowest score first; ties keep dimension order).
  if (gaps.length > 0) {
    const weak = scored
      .filter((d) => d.score < WEAK_BELOW)
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_LISTED)
      .map((d) => {
        const p = phrasesFor(d);
        return C.weakItem(d.score < FAIL_BELOW ? p.fail : p.partial, d.dimension_name, d.score);
      });
    if (weak.length === 0) out.push(C.noMajorWeakAreas);
    else if (weak.length === 1) out.push(C.weakestOne(weak[0]));
    else out.push(C.weakestMany(joinList(weak)));
  }

  // 3. What's working (highest score first; ties keep dimension order).
  const strong = scored
    .filter((d) => d.score >= STRONG_FROM)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LISTED)
    .map((d) => phrasesFor(d).strong);
  if (strong.length > 0) out.push(C.working(joinList(strong)));

  // 4. Caveats.
  const caveats: string[] = [];
  const naCitation = naDims.find((d) => d.dimension_id === CITATION_DIM_ID);
  const naOther = naDims.filter((d) => d.dimension_id !== CITATION_DIM_ID);
  // Unmeasured dimensions applied but could not be read on this run: never
  // say they "did not apply".
  const naInapplicable = naOther.filter((d) => !d.unmeasured);
  const naUnmeasured = naOther.filter((d) => d.unmeasured);
  if (naInapplicable.length > 0) {
    caveats.push(C.naApplied(joinNames(naInapplicable.map((d) => d.dimension_name)), naInapplicable.length > 1));
  }
  if (naUnmeasured.length > 0) {
    caveats.push(C.naUnmeasured(joinNames(naUnmeasured.map((d) => d.dimension_name)), naUnmeasured.length > 1));
  }
  if (naCitation) caveats.push(C.naCitationUnmeasured);
  const citation = scored.find((d) => d.dimension_id === CITATION_DIM_ID);
  const cov = citation ? citationCoverage(citation) : null;
  if (cov && cov.measurableCells < cov.totalCells) {
    caveats.push(
      cov.measuredModels !== null && cov.totalModels !== null
        ? C.citationPartial(cov.measuredModels, cov.totalModels, cov.measurableCells, cov.totalCells)
        : C.citationPartialNoModels(cov.measurableCells, cov.totalCells),
    );
  }
  if (caveats.length > 0) out.push(`${capitalize(caveats.join("; "))}.`);

  // 5. Closing.
  out.push(gaps.length > 0 ? C.closingWithGaps(gapsHeading) : C.closingNoGaps);

  return out;
}
