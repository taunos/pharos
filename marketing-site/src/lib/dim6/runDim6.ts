// Slice 3b Dim 6 — runDim6 (Task 11) — ties orchestrator output to
// the SubCheck/DimensionResult shape audit-fulfill expects to splice into
// the scan result.
//
// Two callers:
//   - audit-fulfill (PAID path): replaces the scanner's free-tier demo Dim 6
//     with a real audit. Calls runDim6Paid().
//   - scanner free-tier branch (FREE path): scanner has its own standalone
//     module — does NOT import this file. See scanner/src/checks/dim6-citation.ts.
//
// Daily soft cap (locked decision 8): 100 paid audits/day, KV-tracked under
// `dim6:budget:<YYYY-MM-DD>`. When exceeded, runDim6Paid returns the same
// na:true demo-preview shape the free-tier emits, with a note about the cap.

import { runDim6Orchestrator, type OrchestratorEnv } from "./orchestrator";
import {
  ALL_MODEL_IDS,
  DIM6_ENGINE_VERSION,
  type CellEnvelope,
  type Dim6Result,
} from "./types";
import { DIM6_ENGINE_LINE } from "./disclosure";
import { resolveSiteReference } from "./reference";
import { canonicalDomain } from "./question-set";
import type { FetchLike } from "../safe-fetch";
import { capLength, collapseWhitespace, stripUnsafeChars } from "../llm-safety";

export interface Dim6SubCheck {
  id: string;
  name: string;
  weight: number;
  score: number;
  passed: boolean;
  notes: string;
  na?: boolean;
}

export interface Dim6Dimension {
  dimension_id: 6;
  dimension_name: "Citation Visibility";
  score: number;
  grade: string;
  sub_checks: Dim6SubCheck[];
  na?: boolean;
  // Set with na:true: Citation Visibility applies to every site, so an N/A
  // Dim 6 here was not measured (daily cap, no usable answers).
  unmeasured?: boolean;
  // Cells are NOT placed on the public dimension shape (would leak raw model
  // text into the per-scan JSON). Audit-fulfill consumes them separately for
  // the corpus write.
}

export interface RunDim6Result {
  dimension: Dim6Dimension;
  cells: CellEnvelope[]; // for the corpus writer
  raw: Dim6Result | null; // null when we short-circuited (free or daily-cap)
  // Test C-A R2-4: true ONLY for the daily-cap short-circuit, so the paid
  // fulfillment can defer instead of shipping a partial report as ready.
  capped: boolean;
}

const DAILY_CAP = 100;

function todayKey(): string {
  const now = new Date();
  // YYYY-MM-DD UTC
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "A-";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

// Sub-check signatures locked per spec §2.3 — Profound-swap path emits these
// SAME ids/names so the only field that changes is `source` ("diy" vs
// "profound") at the corpus row level. Don't rename.
const SUBCHECK_IDS = {
  domain_named_rate: "citation_domain_named_rate",
  url_referenced_rate: "citation_url_referenced_rate",
  context_relevant_rate: "citation_context_relevant_rate",
  no_competitor_first_rate: "citation_no_competitor_first_rate",
  // dim6:v5: informational (na, weight 0), present only when at least one
  // answer described a different person or business than the site says it is.
  misidentified_answers: "citation_misidentified_answers",
} as const;

// Compute per-cell breakdown rates by re-parsing the structured notes the
// ladder emitted. Notes shape: "score=X/100; domain_named=true; ...".
// Less brittle than re-running the parser here.
function rateOf(cells: CellEnvelope[], flag: string): number {
  const measurable = cells.filter((c) => !c.result.unmeasurable);
  if (measurable.length === 0) return 0;
  const trues = measurable.filter((c) =>
    c.result.notes.includes(`${flag}=true`)
  ).length;
  return Math.round((trues / measurable.length) * 100);
}

// Customer-facing model names, keyed by the provider prefix of the model id.
// An unknown provider keeps its prefix so a new model still shows something.
const MODEL_LABELS: Record<string, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  perplexity: "Perplexity",
};

export function modelLabel(modelId: string): string {
  const provider = modelId.split(":")[0];
  return MODEL_LABELS[provider] ?? provider;
}

/** dim6:v4: competitor-first sub-check note when no competitor list was given. */
export const COMPETITOR_FIRST_NA_NOTE =
  "Not measured: this Audit doesn't take a competitor list yet, so there is nothing to compare against. This check is not counted in your score.";

const knewYourSite = (n: number, plural: string, singular: string) =>
  n === 1 ? `the 1 answer that said the model knew your site ${singular}` : `the ${n} answers that said the model knew your site ${plural}`;

/**
 * dim6:v5: domain-named note addition when the run had no usable description
 * of the site (missing, unreadable or too short). Fail closed: those answers
 * score 0.
 */
export const accuracyNotCheckedNote = (notChecked: number) =>
  `We could not find a clear description of your site on it, so ${
    notChecked === 0
      ? "an answer that said the model knew your site could not have been checked or counted"
      : `${knewYourSite(notChecked, "could not be checked and were", "could not be checked and was")} not counted (scored 0)`
  }. To fix this, say who you are and what you do in an llms.txt file, in structured data, or in your homepage title and description.`;

/** dim6:v5: domain-named note addition when the site's description tripped the injection screen. */
export const accuracyBlockedNote = (blocked: number) =>
  `We could not check these answers against your site's own description, because that description contains text aimed at automated checkers. So ${
    blocked === 0 ? "an answer that said the model knew your site would not have been counted" : `${knewYourSite(blocked, "were", "was")} not counted and scored 0`
  }.`;

const EVIDENCE_MAX_WORDS = 25;
const EVIDENCE_MAX_CHARS = 200;
const EVIDENCE_MAX_QUOTES = 3;

/**
 * dim6:v5: a short, deterministic quote from a provider answer, for the
 * wrong-description examples. Provider output is hostile: unsafe characters
 * stripped, markdown and citation markers dropped, double quotes turned into
 * single quotes, at most EVIDENCE_MAX_WORDS words / EVIDENCE_MAX_CHARS chars.
 * The report renderer escapes it; it is never sent to an LLM. Starts at the
 * first sentence that contains the domain or its first label (the brand),
 * else at the start of the answer, and runs on across sentences up to the
 * word cap (a lead sentence such as "No, x.com is not a local business." is
 * then followed by what the answer says it is).
 */
export function pickEvidenceQuote(text: string, domain: string): string {
  const flat = collapseWhitespace(
    stripUnsafeChars(text.replace(/(^|\n)\s*>\s?/g, "$1").replace(/(^|\n)\s*(?:[-*•]|\d+\.)\s+/g, "$1· "))
      .replace(/\s*\[\d+\]/g, "")
      .replace(/[*_`#|]+/g, "")
      .replace(/["“”]/g, "'")
  );
  const label = domain.split(".")[0];
  const needles = [domain.toLowerCase(), ...(label.length >= 4 ? [label.toLowerCase()] : [])];
  const sentences = flat.split(/(?<=[.!?])\s+/);
  const start = Math.max(0, sentences.findIndex((s) => needles.some((n) => s.toLowerCase().includes(n))));
  const words = sentences.slice(start).join(" ").split(" ").filter(Boolean);
  const q = capLength(words.slice(0, EVIDENCE_MAX_WORDS).join(" "), EVIDENCE_MAX_CHARS);
  const cut = words.length > EVIDENCE_MAX_WORDS || q.length < words.slice(0, EVIDENCE_MAX_WORDS).join(" ").length;
  return cut ? `${q}…` : q;
}

/**
 * Up to EVIDENCE_MAX_QUOTES WRONG answers, in cell order, one per model first
 * (so the examples show which models got it wrong), then filled in order.
 */
export function pickWrongAnswerQuotes(cells: CellEnvelope[], domain: string): Array<{ model: string; quote: string }> {
  const wrong = cells.filter((c) => !c.result.unmeasurable && c.result.text && c.result.notes.includes("misidentified=true"));
  const chosen: CellEnvelope[] = [];
  for (const c of wrong) {
    if (chosen.length < EVIDENCE_MAX_QUOTES && !chosen.some((x) => x.modelId === c.modelId)) chosen.push(c);
  }
  for (const c of wrong) {
    if (chosen.length < EVIDENCE_MAX_QUOTES && !chosen.includes(c)) chosen.push(c);
  }
  chosen.sort((a, b) => wrong.indexOf(a) - wrong.indexOf(b));
  return chosen.map((c) => ({ model: modelLabel(c.modelId), quote: pickEvidenceQuote(c.result.text ?? "", domain) }));
}

function countFlag(cells: CellEnvelope[], flag: string): number {
  return cells.filter((c) => !c.result.unmeasurable && c.result.notes.includes(flag)).length;
}

export function buildSubChecks(result: Dim6Result, hasCompetitorList: boolean, domain = ""): Dim6SubCheck[] {
  const cells = result.cells;
  const measurableCount = cells.length - result.unmeasurableCount;
  const checked = result.accuracyChecked === true;

  const dnRate = rateOf(cells, "domain_named");
  const urlRate = rateOf(cells, "url_referenced");
  const ctxRate = rateOf(cells, "context_relevant");
  const compRate = rateOf(cells, "no_competitor_first");

  const summary = `${measurableCount} of ${cells.length} test answers could be scored, across ${ALL_MODEL_IDS.length} AI models. Average by model: ${ALL_MODEL_IDS.map(
    (m) => `${modelLabel(m)} ${result.perModelAverage[m] ?? "not measured"}`
  ).join(", ")}.`;

  // dim6:v5: counts of the four answer kinds. Rates above count CORRECT
  // answers only (WRONG / UNCLEAR cells carry no domain_named etc. flags).
  const correct = countFlag(cells, "accuracy=CORRECT");
  const wrong = countFlag(cells, "misidentified=true");
  // "could not be checked": the judge failed twice, the answer was too long
  // to read in full, or it carried text aimed at automated checkers.
  const failed = countFlag(cells, "accuracy_failed=");
  const unclear = countFlag(cells, "accuracy_unclear=true") - failed;
  const unknown = countFlag(cells, "judge=DENY");
  const breakdown = `Of the ${measurableCount} scored ${measurableCount === 1 ? "answer" : "answers"}, ${correct} matched how your site describes itself, ${wrong} described a different person or business than your site says it is, ${unclear} did not say enough to check, ${
    failed > 0 ? `${failed} could not be checked (scored 0), ` : ""
  }and ${unknown} did not show that the model knew your site.`;

  const subChecks: Dim6SubCheck[] = [
    {
      id: SUBCHECK_IDS.domain_named_rate,
      name: "Models name your domain",
      weight: 40,
      score: dnRate,
      passed: dnRate >= 70,
      // Keep "<m> of <t> test answers could be scored ... Average by model:
      // ..." last: audit-executive-summary.ts citationCoverage parses it.
      notes: checked
        ? `${dnRate}% of scored test answers named your domain and matched how your site describes itself. ${breakdown} ${summary}`
        : result.accuracyBlocked === true
          ? `${dnRate}% of scored test answers named your domain. ${accuracyBlockedNote(countFlag(cells, "accuracy_blocked=true"))} ${summary}`
          : `${dnRate}% of scored test answers named your domain. ${accuracyNotCheckedNote(countFlag(cells, "accuracy_not_checked=true"))} ${summary}`,
    },
    // Only CORRECT answers carry the url/context flags (fail closed), so
    // these rates always count correctly described answers.
    {
      id: SUBCHECK_IDS.url_referenced_rate,
      name: "Models cite your URL",
      weight: 30,
      score: urlRate,
      passed: urlRate >= 70,
      notes: `${urlRate}% of scored test answers matched how your site describes itself and included at least one link to it.`,
    },
    {
      id: SUBCHECK_IDS.context_relevant_rate,
      name: "Models treat your domain as the principal answer",
      weight: 20,
      score: ctxRate,
      passed: ctxRate >= 70,
      notes: `${ctxRate}% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end.`,
    },
    // dim6:v4: N/A without a competitor list (the cell scores give it no
    // points either, see parser.ts), so it is never a gap. With no list the
    // old rate was really the AFFIRM rate (DENY cells carry no flag).
    hasCompetitorList
      ? {
          id: SUBCHECK_IDS.no_competitor_first_rate,
          name: "Competitor-first check (not measured)",
          weight: 10,
          score: compRate,
          passed: compRate >= 70,
          notes: `${compRate}% of scored test answers did not name a competitor before your domain.`,
        }
      : {
          id: SUBCHECK_IDS.no_competitor_first_rate,
          name: "Competitor-first check (not measured)",
          weight: 10,
          score: 0,
          passed: false,
          notes: COMPETITOR_FIRST_NA_NOTE,
          na: true,
        },
  ];

  // dim6:v5: wrong-description examples as an informational row (na, weight
  // 0): no scoring or weight change, never a gap, and the hostile quotes stay
  // out of the domain-named note the executive summary parses.
  if (checked && wrong > 0) {
    const quotes = pickWrongAnswerQuotes(cells, domain);
    const lead =
      wrong === 1
        ? `1 of the ${measurableCount} scored answers described a different person or business than your site says it is; it counts as 0 in the checks above.`
        : `${wrong} of the ${measurableCount} scored answers described a different person or business than your site says it is; they count as 0 in the checks above.`;
    const examples = quotes.length > 0 ? ` ${quotes.length === 1 ? "Example" : "Examples"}: ${quotes.map((q) => `${q.model}: "${q.quote}"`).join("; ")}.` : "";
    subChecks.push({
      id: SUBCHECK_IDS.misidentified_answers,
      name: "Answers that described a different person or business than your site says it is",
      weight: 0,
      score: 0,
      passed: false,
      notes: `${lead}${examples} This row is for information and is not counted again in your score.`,
      na: true,
    });
  }
  return subChecks;
}

/** Daily-cap note shown on a report that ships without Citation Visibility. */
export const DIM6_DAILY_CAP_NOTE =
  "Citation Visibility was not measured on this run: the daily limit for live AI assistant tests (100 paid audits per day) was reached. It is not counted in your score; the other dimensions are scored normally below.";

/**
 * Not-run note (r4): no AI assistant was set up for this run (every test
 * answer failed because no provider API key was configured), as opposed to
 * answers that failed on the network or at a provider.
 */
export const DIM6_NOT_RUN_NOTE = `Citation Visibility was not run on this report: no AI assistant was set up to answer the test questions. It is not counted in your score. ${DIM6_ENGINE_LINE}.`;

/** true when every cell failed only because its provider has no API key configured. */
export function noProviderConfigured(cells: Array<{ result: { unmeasurable: boolean; notes: string } }>): boolean {
  return cells.length > 0 && cells.every((c) => c.result.unmeasurable && /\b[A-Z_]+_API_KEY not set\b/.test(c.result.notes));
}

/** All-unmeasurable note: no AI assistant answer could be scored. */
export const dim6AllUnmeasurableNote = (totalAnswers: number) =>
  `Citation Visibility was not measured on this run: none of the ${totalAnswers} test answers from the AI assistants could be scored (network or provider failures). It is not counted in your score. ${DIM6_ENGINE_LINE}.`;

/**
 * Build the DAILY-CAP-EXCEEDED dimension. Distinct note from free-tier so
 * audit-fulfill can flag the customer cleanly.
 */
function buildDailyCapDim6(): Dim6Dimension {
  return {
    dimension_id: 6,
    dimension_name: "Citation Visibility",
    score: 0,
    grade: gradeFor(0),
    na: true,
    sub_checks: [
      {
        id: "dim6_daily_cap_exceeded",
        name: "Citation Visibility (daily cap)",
        weight: 1,
        score: 0,
        passed: false,
        // No re-run exists for a report shipped this way (the queue path
        // defers before this point instead), so the note promises none.
        notes: DIM6_DAILY_CAP_NOTE,
        na: true,
      },
    ],
    unmeasured: true,
  };
}

/**
 * Test C-A R2-4: non-incrementing peek at the paid Dim 6 daily budget, so the
 * paid fulfillment can defer BEFORE spending a scan + LLM calls. Same key and
 * threshold as runDim6Paid's own check (which stays authoritative for races).
 */
export async function isDim6CapReached(kv: KVNamespace): Promise<boolean> {
  const rawCount = await kv.get(`dim6:budget:${todayKey()}`);
  const count = rawCount ? parseInt(rawCount, 10) : 0;
  return Number.isFinite(count) && count >= DAILY_CAP;
}

export interface Dim6PaidEnv extends OrchestratorEnv {
  // Same KV used for the Dim 6 cell cache; we also use it for the daily-cap
  // counter. Distinct key prefix `dim6:budget:` so cache eviction never
  // bumps the counter.
  //
  // dim6:v5: fetch used for the site's own description (llms.txt + homepage,
  // reference.ts). Defaults to the global fetch; tests inject a stub.
  siteFetch?: FetchLike;
}

/**
 * Run a paid Dim 6 audit. Returns:
 *   - { dimension: na:true (daily-cap), cells: [], raw: null } when over the cap
 *   - { dimension: real, cells: full, raw: Dim6Result } on a successful run
 *   - { dimension: na:true (all unmeasurable), cells: full, raw: Dim6Result }
 *     when every cell came back unmeasurable (network-pocalypse). Composite
 *     drops the dim cleanly via na:true.
 */
export async function runDim6Paid(
  env: Dim6PaidEnv,
  scanUrl: string,
  signals: { homepageHtml?: string | null; titleTag?: string | null } = {},
  competitorHosts: string[] = []
): Promise<RunDim6Result> {
  // Daily-cap check.
  const budgetKey = `dim6:budget:${todayKey()}`;
  const rawCount = await env.cacheKv.get(budgetKey);
  const count = rawCount ? parseInt(rawCount, 10) : 0;
  if (Number.isFinite(count) && count >= DAILY_CAP) {
    console.warn(
      `[dim6/runDim6Paid] daily cap reached (${count}/${DAILY_CAP}); short-circuiting to na:true`
    );
    return {
      dimension: buildDailyCapDim6(),
      cells: [],
      raw: null,
      capped: true,
    };
  }
  // Increment BEFORE the call so concurrent requests under the cap can't
  // both squeak through. Best-effort.
  try {
    await env.cacheKv.put(budgetKey, String(count + 1), {
      // 36 hour TTL — long enough to span daylight saving / clock skew.
      expirationTtl: 36 * 60 * 60,
    });
  } catch {
    // KV write failure is non-fatal — we'll just slightly over-spend.
  }

  // dim6:v5: the site's own description, for the accuracy judge. Not
  // verifiable → AFFIRM answers score 0 (fail closed) and the report says
  // why: no usable description (accuracy_not_checked) or an injected one
  // (accuracy_blocked).
  const reference = await resolveSiteReference(scanUrl, env.siteFetch);
  if (!reference.verifiable) {
    console.log(`[dim6/runDim6Paid] accuracy not checked: reference ${reference.reason}`);
  }

  const result = await runDim6Orchestrator(env, {
    scanUrl,
    signals,
    competitorHosts,
    reference: reference.verifiable ? reference.text : null,
    // Injected description: the site owner is the likely attacker, so the
    // safe direction is down. Missing/short → not checked (also 0).
    referenceBlocked: !reference.verifiable && reference.reason === "injection",
  });

  // Every cell unmeasurable → na:true.
  if (result.score === null) {
    return {
      dimension: {
        dimension_id: 6,
        dimension_name: "Citation Visibility",
        score: 0,
        grade: gradeFor(0),
        na: true,
        sub_checks: [
          {
            id: "dim6_all_unmeasurable",
            name: "Citation Visibility (unmeasurable)",
            weight: 1,
            score: 0,
            passed: false,
            notes: noProviderConfigured(result.cells) ? DIM6_NOT_RUN_NOTE : dim6AllUnmeasurableNote(result.totalCells),
            na: true,
          },
        ],
        unmeasured: true,
      },
      cells: result.cells,
      raw: result,
      capped: false,
    };
  }

  const subChecks = buildSubChecks(result, competitorHosts.length > 0, canonicalDomain(scanUrl) ?? "");
  const score = result.score; // already aggregated 0-100

  return {
    dimension: {
      dimension_id: 6,
      dimension_name: "Citation Visibility",
      score,
      grade: gradeFor(score),
      sub_checks: subChecks,
    },
    cells: result.cells,
    raw: result,
    capped: false,
  };
}

export { DIM6_ENGINE_VERSION };
