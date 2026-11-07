// Executive summary for the paid Audit report (PDF + on-page).
//
// DETERMINISTIC: built only from the stored audit data, no LLM call, so it can
// never say anything the scan doesn't support. Every buyer-facing string lives
// in EXEC_SUMMARY_COPY below; the builder only selects and joins them.
//
// Output is 3–5 sentences (array; each renders as its own short paragraph):
//   1. overall score, dimensions covered, band  (always)
//  1b. coverage caveat                          (fewer than 4 dimensions scored,
//                                                or Citation Visibility not measured)
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
// Fewer scored dimensions than this → the summary says the score is partial.
const MIN_FULL_COVERAGE = 4;

type DimPhrases = { fail: string; partial: string; strong: string };

export const EXEC_SUMMARY_COPY = {
  heading: "Executive summary",

  // Sentence 1: "<overall>: <band>". Bands follow the composite grade scale
  // (A/A- ≥80, B 70–79, C/D 40–69, F <40). They describe what was measured,
  // never a predicted outcome.
  overall: (score: number, grade: string, scored: number, total: number) =>
    `Your site scored ${score}/100 (grade ${grade}) on the ${scored} of ${total} dimensions we could score`,
  overallBands: {
    strong: "most of the checks we ran passed, with a few gaps left.",
    good: "many of the checks we ran passed, and the gaps below are worth fixing.",
    mixed: "some of the checks we ran passed, and several important ones did not.",
    weak: "most of the checks we ran did not pass.",
  },

  // Sentence 1b, coverage (when coverage is limited). Fewer than
  // MIN_FULL_COVERAGE dimensions scored, or Citation Visibility not measured.
  coverageLow: (scored: number, total: number) =>
    `Because only ${scored} of ${total} dimensions could be scored, this is a partial view of your site, and it is not comparable with a score based on more dimensions.`,
  coverageNoCitation:
    "Citation Visibility, which tests what AI assistants say when asked about your site, was not measured on this run, so this score covers your site's own files and pages only.",

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
    `The "${gapsHeading}" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.`,
  closingNoGaps: "Every check we scored passed, so no changes are listed.",

  // Plain-language phrases per dimension (by dimension_id) and score band.
  // fail = score below 40, partial = 40–79, strong = 85 and up. They say
  // what our checks found, not what AI assistants will do.
  dimensions: {
    1: {
      fail: "we found no usable llms.txt file, the short Markdown guide to your key pages",
      partial: "your llms.txt file passed only some of our checks",
      strong: "your llms.txt file passed most of our checks",
    },
    2: {
      fail: "we could not find or use an MCP server for your site",
      partial: "your MCP server passed only some of our discovery checks",
      strong: "your MCP server passed most of our discovery checks",
    },
    3: {
      fail: "we found no complete machine-readable description (OpenAPI) of your API",
      partial: "the OpenAPI description of your API is incomplete",
      strong: "the OpenAPI description of your API passed most of our checks",
    },
    4: {
      fail: "your homepage carries little structured data (JSON-LD) about what you offer",
      partial: "the structured data (JSON-LD) on your homepage is incomplete",
      strong: "the structured data (JSON-LD) on your homepage passed most of our checks",
    },
    5: {
      fail: "your pages failed most of our readability checks",
      partial: "your pages passed only some of our readability checks",
      strong: "your pages passed most of our readability checks",
    },
    6: {
      fail: "in our test questions, AI assistants rarely named your site",
      partial: "in our test questions, AI assistants named your site only some of the time",
      strong: "in our test questions, AI assistants usually named your site",
    },
  } as Record<number, DimPhrases>,
  // Evidence-aware phrases (r4), chosen from the sub-check states so the
  // summary never contradicts the table. Dim 2: an MCP endpoint answered
  // (tools/list or an OAuth challenge) but there is no server card.
  mcpFoundNoCard: "we found your MCP server, but it isn't fully discoverable (no server card)",
  // Dim 4 (r5): a scored check read a sampled product page, not the homepage.
  structuredDataSampled: {
    partial: "the structured data (JSON-LD) we sampled is incomplete",
    strong: "the structured data (JSON-LD) we sampled passed most of our checks",
  },
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
  const p =
    EXEC_SUMMARY_COPY.dimensions[d.dimension_id] ??
    EXEC_SUMMARY_COPY.dimensionFallback(d.dimension_name);
  // r5: Dim 4 results that include a sampled product page are not "on your
  // homepage".
  if (d.dimension_id === 4 && d.sub_checks.some((s) => !s.na && /sampled product page/.test(String(s.notes ?? "")))) {
    return { ...p, ...EXEC_SUMMARY_COPY.structuredDataSampled };
  }
  return p;
}

/**
 * r4: the weak-area phrase for a dimension, read from its sub-check states,
 * not its score alone. Dim 2 with an MCP endpoint that answered never says
 * we could not find one. (Scanner 1.5.0 reads YAML specs in full, so the
 * r4 "only partly checked" Dim 3 phrase is gone.)
 */
function weakPhraseByState(d: DimensionResult): string {
  const C = EXEC_SUMMARY_COPY;
  const p = phrasesFor(d);
  const band = d.score < FAIL_BELOW ? p.fail : p.partial;
  const check = (id: string) => d.sub_checks.find((s) => s.id === id);
  if (d.dimension_id === 2) {
    const card = check("well_known");
    const live = check("live_invocation");
    const answered = !!live && !live.na && live.score >= 70;
    const hasCard = !!card && !card.na && card.score > 0;
    if (answered && !hasCard) return C.mcpFoundNoCard;
    if (answered || hasCard) return p.partial;
  }
  return band;
}

/**
 * r7 (Codex r6 LOW): a phrase that claims a share of the checks ("passed
 * most", "failed most", "passed only some") is used only when the counts of
 * the dimension's applicable sub-checks support it, not from the weighted
 * score (metalab: 1 failed, 1 passed was "failed most").
 */
function countsSupport(phrase: string, d: DimensionResult): boolean {
  const applicable = d.sub_checks.filter((s) => !s.na);
  const passed = applicable.filter((s) => s.passed).length;
  const failed = applicable.length - passed;
  if (phrase.includes("passed most")) return passed > failed;
  if (phrase.includes("failed most")) return failed > passed;
  if (phrase.includes("passed only some")) return passed > 0 && failed > 0;
  return true;
}

function weakPhrase(d: DimensionResult): string {
  const phrase = weakPhraseByState(d);
  if (countsSupport(phrase, d)) return phrase;
  // Swap only between the two share-claiming phrases (Dim 5); otherwise the
  // neutral "<name> needs work" (a state-based phrase must not be undone).
  const p = phrasesFor(d);
  const shareClaim = (x: string) => x.includes("passed only some") || x.includes("failed most");
  const alt = [p.fail, p.partial].find((x) => x !== phrase && shareClaim(x) && countsSupport(x, d));
  return alt ?? EXEC_SUMMARY_COPY.dimensionFallback(d.dimension_name).partial;
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

// Dim 6 records its coverage only inside the domain-named sub-check's notes
// (the sub-check carries no structured counts), written by buildSubChecks in
// lib/dim6/runDim6.ts. Current shape:
//   "<n>% of scored test answers named your domain. <m> of <t> test answers
//    could be scored, across <k> AI models. Average by model: ChatGPT not
//    measured, ..., Perplexity 73."
// Stored audits written before 2026-11-07 carry the old shape, and are
// re-rendered, so it is still read:
//   "<n>% of measurable cells named the target domain. <m>/<t> cells
//    measurable across <k> models. Per-model averages: openai=n/a, ..., perplexity=73."
// Returns null when the notes carry neither shape.
export function citationCoverage(d: DimensionResult): CitationCoverage | null {
  const notes = d.sub_checks.find((s) => s.id === CITATION_SUMMARY_CHECK_ID)?.notes;
  if (!notes) return null;
  const cells =
    notes.match(/(\d+) of (\d+) test answers could be scored/) ??
    notes.match(/(\d+)\/(\d+) cells measurable/);
  if (!cells) return null;
  let measuredModels: number | null = null;
  let totalModels: number | null = null;
  const perModelNew = notes.match(/Average by model: ([^]*?)\.?$/);
  const perModelOld = notes.match(/Per-model averages: ([^]*?)\.?$/);
  let values: string[] = [];
  if (perModelNew) {
    values = perModelNew[1]
      .split(", ")
      .map((p) => p.match(/^\S.* (not measured|\d+)$/)?.[1])
      .filter((v): v is string => v !== undefined);
  } else if (perModelOld) {
    values = [...perModelOld[1].matchAll(/[\w.-]+=(n\/a|\d+)/g)].map((p) => p[1]);
  }
  if (values.length > 0) {
    totalModels = values.length;
    measuredModels = values.filter((v) => v !== "n/a" && v !== "not measured").length;
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

  // 1. Overall, with how many dimensions it covers.
  const total = Math.max(scan.dimensions_total ?? 0, scan.dimensions.length);
  out.push(
    `${C.overall(scan.composite.score, scan.composite.grade, scored.length, total)}: ${C.overallBands[overallBand(scan.composite.score)]}`,
  );
  // 1b. Coverage caveat right after the score.
  const citationMeasured = scored.some((d) => d.dimension_id === CITATION_DIM_ID);
  const lowCoverage = scored.length < MIN_FULL_COVERAGE;
  if (lowCoverage) out.push(C.coverageLow(scored.length, total));
  else if (!citationMeasured) out.push(C.coverageNoCitation);

  // 2. Weakest areas (lowest score first; ties keep dimension order).
  if (gaps.length > 0) {
    const weak = scored
      .filter((d) => d.score < WEAK_BELOW)
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_LISTED)
      .map((d) => C.weakItem(weakPhrase(d), d.dimension_name, d.score));
    if (weak.length === 0) out.push(C.noMajorWeakAreas);
    else if (weak.length === 1) out.push(C.weakestOne(weak[0]));
    else out.push(C.weakestMany(joinList(weak)));
  }

  // 3. What's working (highest score first; ties keep dimension order).
  // r7: a "passed most" claim the sub-check counts don't support is left out.
  const strong = scored
    .filter((d) => d.score >= STRONG_FROM && countsSupport(phrasesFor(d).strong, d))
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
  // Already said by the coverage sentence when that one is about Citation Visibility.
  if (naCitation && lowCoverage) caveats.push(C.naCitationUnmeasured);
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
