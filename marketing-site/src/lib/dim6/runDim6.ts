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
import { contentWords } from "./accuracy-judge";
import {
  REFERENCE_HTML_MAX_BYTES,
  REFERENCE_JSONLD_MAX_DEPTH,
  REFERENCE_LLMS_MAX_BYTES,
  REFERENCE_MAX_ENTITIES,
  resolveSiteReference,
} from "./reference";
import { canonicalDomain } from "./question-set";
import { checkableCounts, DIM6_MIN_CHECKABLE, DIM6_MIN_CHECKABLE_PER_MODEL, failedCheckBounds, isCheckable, isFailedCheck, isUncheckable, type CheckableCounts } from "./checkable";
import type { FetchLike } from "../safe-fetch";
import { capLength, collapseWhitespace, DISPLAY_TEXT_MAX, stripUnsafeChars, stripUnsafeCharsKeepLines } from "../llm-safety";

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
  // dim6:v6: informational (na, weight 0), present only when the site's own
  // text contradicts at least one answer.
  contradicted_answers: "citation_contradicted_answers",
  // dim6:v6: informational (na, weight 0): answers backed by the site's text,
  // with the evidence (present only when at least one), and the answers we
  // could not check (always present: option A).
  backed_answers: "citation_backed_answers",
  uncheckable_answers: "citation_uncheckable_answers",
} as const;

// Compute per-cell breakdown rates by re-parsing the structured notes the
// ladder emitted. Notes shape: "score=X/100; domain_named=true; ...".
// Less brittle than re-running the parser here.
// dim6:v6 option A: the denominator is the CHECKABLE answers (checkable.ts),
// the same cells the dimension score averages.
function rateOf(cells: CellEnvelope[], flag: string): number {
  const checkable = cells.filter(isCheckable);
  if (checkable.length === 0) return 0;
  const trues = checkable.filter((c) =>
    c.result.notes.includes(`${flag}=true`)
  ).length;
  return Math.round((trues / checkable.length) * 100);
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
 * count as 0 (dim6:v6 option A keeps this: the site controls its own
 * description, see checkable.ts).
 */
const notCheckedClause = (n: number) =>
  n === 0
    ? "an answer that said the model knew your site could not have been checked and would have been counted as 0"
    : `${knewYourSite(n, "could not be checked and were", "could not be checked and was")} counted as 0`;

export const accuracyNotCheckedNote = (notChecked: number) =>
  `We could not find or read a clear description of your site on it, so ${notCheckedClause(notChecked)}. To fix this, say who you are and what you do in an llms.txt file, in structured data, or in your homepage title and description.`;

/**
 * dim6:v5: domain-named note addition when the homepage structured data
 * describes more than REFERENCE_MAX_ENTITIES people or businesses (fail
 * closed: we can't tell which one the site is about).
 */
export const accuracyTooManyEntitiesNote = (notChecked: number) =>
  `Your homepage's structured data describes more than ${REFERENCE_MAX_ENTITIES} different people or businesses, so we could not tell which one your site is, and ${notCheckedClause(notChecked)}. To fix this, describe your own business or yourself in your structured data (as an Organization, LocalBusiness or Person), not every person or business you mention.`;

/** dim6:v5: the homepage or llms.txt is larger than we read in full (fail closed). */
export const accuracySourceTooLargeNote = (notChecked: number) =>
  `Your homepage or llms.txt file is larger than we read in full (${REFERENCE_HTML_MAX_BYTES / (1024 * 1024)} MB for the homepage, ${REFERENCE_LLMS_MAX_BYTES / 1024} KB for llms.txt), so we could not read all of your site's description of itself, and ${notCheckedClause(notChecked)}. To fix this, bring the file under that size.`;

/** dim6:v5: the homepage structured data is nested too deeply to read in full (fail closed). */
export const accuracyStructuredDataTooDeepNote = (notChecked: number) =>
  `Your homepage's structured data is nested more than ${REFERENCE_JSONLD_MAX_DEPTH} levels deep, so we could not read all of it, and ${notCheckedClause(notChecked)}. To fix this, put your Organization, LocalBusiness or Person entry at the top level of your structured data.`;

/**
 * dim6:v5: a homepage JSON-LD block is not valid JSON (fail closed: it may
 * hold an identity claim). Fix wording matches the Dim 4 remediation.
 */
export const accuracyStructuredDataUnreadableNote = (notChecked: number) =>
  `Your homepage's structured data has a block that is not valid JSON, so we could not read all of it, and ${notCheckedClause(notChecked)}. To fix this, correct the syntax in that block; Google's Rich Results Test or the Schema Markup Validator shows where it breaks.`;

const NOT_CHECKED_NOTES: Record<NonNullable<Dim6Result["accuracyNotCheckedReason"]>, (n: number) => string> = {
  too_many_entities: accuracyTooManyEntitiesNote,
  source_too_large: accuracySourceTooLargeNote,
  structured_data_too_deep: accuracyStructuredDataTooDeepNote,
  structured_data_unreadable: accuracyStructuredDataUnreadableNote,
};

/** dim6:v5: domain-named note addition when the site's description tripped the injection screen. */
export const accuracyBlockedNote = (blocked: number) =>
  `We could not check these answers against your site's own description, because that description contains text aimed at automated checkers. So ${
    blocked === 0 ? "an answer that said the model knew your site would have been counted as 0" : `${knewYourSite(blocked, "were", "was")} counted as 0`
  }.`;

const EVIDENCE_MAX_WORDS = 25;
const EVIDENCE_MAX_CHARS = 200;
const EVIDENCE_MAX_QUOTES = 3;

/**
 * dim6:v5: a short, deterministic quote from a provider answer, for the
 * wrong-description examples. Provider output is hostile: unsafe characters
 * stripped, markdown and citation markers dropped, double quotes turned into
 * single quotes, at most `maxWords` words / EVIDENCE_MAX_CHARS chars.
 * The report renderer escapes it; it is never sent to an LLM. Starts at
 * `from` when given (dim6:v6: the start of the sentence holding the confirmed
 * mix-up, see wrongAt), else at the first sentence that contains the domain
 * or its first label (the brand), else at the start of the answer, and runs
 * on across sentences up to the word cap (a lead sentence such as "No, x.com
 * is not a local business." is then followed by what the answer says it is).
 */
export function pickEvidenceQuote(text: string, domain: string, from?: number, maxWords = EVIDENCE_MAX_WORDS): string {
  const source = from !== undefined ? text.slice(sentenceStart(text, from)) : text;
  const flat = collapseWhitespace(
    stripUnsafeChars(source.replace(/(^|\n)\s*>\s?/g, "$1").replace(/(^|\n)\s*(?:[-*•]|\d+\.)\s+/g, "$1· "))
      .replace(/\s*\[\d+\]/g, "")
      .replace(/[*_`#|]+/g, "")
      .replace(/["“”]/g, "'")
  );
  const label = domain.split(".")[0];
  const needles = [domain.toLowerCase(), ...(label.length >= 4 ? [label.toLowerCase()] : [])];
  const sentences = flat.split(/(?<=[.!?])\s+/);
  const start = from !== undefined ? 0 : Math.max(0, sentences.findIndex((s) => needles.some((n) => s.toLowerCase().includes(n))));
  const words = sentences.slice(start).join(" ").split(" ").filter(Boolean);
  const q = capLength(words.slice(0, maxWords).join(" "), EVIDENCE_MAX_CHARS);
  const cut = words.length > maxWords || q.length < words.slice(0, maxWords).join(" ").length;
  return cut ? `${q}…` : q;
}

/** Start of the sentence (or line / list item) that holds offset `at`. */
function sentenceStart(text: string, at: number): number {
  const i = Math.max(0, Math.min(at, text.length));
  for (let j = i - 1; j >= 0; j--) {
    const c = text[j];
    if (c === "\n") return j + 1;
    if ((c === "." || c === "!" || c === "?") && /\s/.test(text[j + 1] ?? "")) return j + 1;
  }
  return 0;
}

/** dim6:v6: offset of the confirmed mix-up quote in the answer (notes `wrong_at=<n>`), or undefined. */
function wrongAt(c: CellEnvelope): number | undefined {
  const m = /(?:^|; )wrong_at=(\d{1,6})(?:;|$)/.exec(c.result.notes);
  return m ? Number(m[1]) : undefined;
}

const HEDGE_RE = /\b(?:I don't|I do not|don't have|not familiar|no (?:specific |current )?information|as of my last)\b/i;

/**
 * Up to EVIDENCE_MAX_QUOTES answers carrying `flag`, in cell order, one per
 * model first (so the examples show which models got it wrong), then filled
 * in order.
 */
export function pickWrongAnswerQuotes(
  cells: CellEnvelope[],
  domain: string,
  flag = "misidentified=true",
  max = EVIDENCE_MAX_QUOTES,
  maxWords = EVIDENCE_MAX_WORDS
): Array<{ model: string; quote: string }> {
  // Prefer answers whose quote states the wrong identity outright over hedged
  // ones ("I don't have specific information… could be…"), whose 25-word
  // quote often ends before the wrong identity appears. Stable: cell order
  // is kept within each group.
  const quoteOf = (c: CellEnvelope) => pickEvidenceQuote(judgedText(c), domain, wrongAt(c), maxWords);
  const hedged = (c: CellEnvelope) => HEDGE_RE.test(quoteOf(c));
  const flagged = cells.filter((c) => !c.result.unmeasurable && c.result.text && c.result.notes.includes(flag));
  const wrong = [...flagged.filter((c) => !hedged(c)), ...flagged.filter(hedged)];
  const chosen: CellEnvelope[] = [];
  for (const c of wrong) {
    if (chosen.length < max && !chosen.some((x) => x.modelId === c.modelId)) chosen.push(c);
  }
  for (const c of wrong) {
    if (chosen.length < max && !chosen.includes(c)) chosen.push(c);
  }
  chosen.sort((a, b) => wrong.indexOf(a) - wrong.indexOf(b));
  return chosen.map((c) => ({ model: modelLabel(c.modelId), quote: quoteOf(c) }));
}

function countFlag(cells: CellEnvelope[], flag: string): number {
  return cells.filter((c) => !c.result.unmeasurable && c.result.notes.includes(flag)).length;
}

// dim6:v6 copy: evidence, not verdicts (pending Bruno's approval,
// _tmp/report-truthfulness/copy-for-approval-dim6-v6-2026-11-12.md). Each
// verdict is shown as what the AI said next to what the site's own text says;
// counts say what was found, not who is right. Never "correct".
const BACKED = "were backed by your site's text";
// Bruno 2026-11-12: "the answers we could check against your site".
const CHECKED = "answers we could check against your site";
const checkedOf = (n: number) => (n === 1 ? "answer we could check against your site" : CHECKED);
const NAMES_DISCLOSURE = "We count your domain and the name your site gives itself; other brand names, nicknames or translations are not counted.";
const MIXUP_ROW_TAIL =
  "Saying clearly who you are and what you do in your llms.txt file, structured data and homepage gives AI assistants that read your site the right description. It does not change what a model has already learned, so results can take time to change. This row is for information and is not counted again in your score.";
const CONTRA_ROW_TAIL =
  "If your site's text is out of date, updating it is the fix; if it is right, stating these facts clearly on your site (for example in your llms.txt file) gives AI assistants that read it the right details. This row is for information and is not counted again in your score.";
const SITE_QUOTE_MAX_WORDS = 20;
const NOT_COUNTED_AGAIN = "This row is for information and is not counted again in your score.";
/** Under a section with no grade there is no score to count "again" in. */
const ungradedTail = (tail: string) => tail.replace(NOT_COUNTED_AGAIN, "This row is for information.");

/** The site's own words on the reference line holding `at`, field label removed, capped. */
export function siteTextAt(reference: string, at: number, maxWords = SITE_QUOTE_MAX_WORDS): string {
  if (!reference || at < 0 || at >= reference.length) return "";
  const start = reference.lastIndexOf("\n", at) + 1;
  const endNl = reference.indexOf("\n", at);
  const line = reference.slice(start, endNl === -1 ? reference.length : endNl);
  // Start at the quoted words, not the line start, when the line is long.
  const from = Math.max(0, at - start);
  const body = (from > 40 ? line.slice(from) : line).replace(/^(?:Name|Summary|Details|Title|Description|Main heading):\s*/, "");
  return pickEvidenceQuote(body, "", undefined, maxWords);
}

/** The site's first self-description line (llms.txt name, structured data or homepage title), capped. */
export function siteIdentityText(reference: string, maxWords = SITE_QUOTE_MAX_WORDS): string {
  const lines = (reference ?? "").split("\n").filter((l) => l && !/^From (?:llms\.txt|structured data|the homepage):$/.test(l));
  const pick = lines.find((l) => /^(?:Name|Title):/.test(l)) ?? lines[0] ?? "";
  return pickEvidenceQuote(pick.replace(/^(?:Name|Summary|Details|Title|Description|Main heading):\s*/, ""), "", undefined, maxWords);
}

/**
 * The answer text exactly as the accuracy judge saw it (stripUnsafeChars):
 * the offsets in the notes (wrong_at, claim_at) index into this text, not the
 * raw answer (Codex review: removed or NFKC-expanded characters would shift
 * them). site_at likewise indexes stripUnsafeCharsKeepLines(reference).
 */
function judgedText(c: CellEnvelope): string {
  return stripUnsafeChars(c.result.text ?? "");
}

/** Offsets in a cell's notes ("claim_at=12; site_at=340"). */
function noteOffset(c: CellEnvelope, key: string): number | undefined {
  const m = new RegExp(`(?:^|; )${key}=(\\d{1,6})(?:;|$)`).exec(c.result.notes);
  return m ? Number(m[1]) : undefined;
}

/** Up to `max` answers carrying `flag` (and passing `also`), one per model first, in cell order. */
function pickFlagged(cells: CellEnvelope[], flag: string, max: number, also: (c: CellEnvelope) => boolean = () => true): CellEnvelope[] {
  const flagged = cells.filter((c) => !c.result.unmeasurable && c.result.text && c.result.notes.includes(flag) && also(c));
  const chosen: CellEnvelope[] = [];
  for (const c of flagged) if (chosen.length < max && !chosen.some((x) => x.modelId === c.modelId)) chosen.push(c);
  for (const c of flagged) if (chosen.length < max && !chosen.includes(c)) chosen.push(c);
  return chosen.sort((a, b) => flagged.indexOf(a) - flagged.indexOf(b));
}

/** Shorten quotes, then drop them, until the note fits the report cell (RD-0122). */
function fitNote(build: (maxQuotes: number, maxWords: number) => string): string {
  for (const [q, w] of [
    [3, 25],
    [3, 15],
    [2, 15],
    [1, 15],
    [1, 10],
  ] as const) {
    const note = build(q, w);
    if (note.length <= DISPLAY_TEXT_MAX) return note;
  }
  return build(0, 0);
}

/**
 * The informational mix-up row: answers that linked the site to a different
 * named person or business, each with what the AI said, plus what the site
 * says about itself.
 */
export function mixupRowNote(cells: CellEnvelope[], domain: string, measurableCount: number, wrong: number, cutOff: number, reference = "", graded = true): string {
  const counts0 = (one: boolean) => (graded ? `; ${one ? "it counts" : "they count"} as 0 in the checks above.` : ".");
  const lead =
    wrong === 0
      ? `None of the ${measurableCount} ${checkedOf(measurableCount)} clearly linked your site to a different named person or business.`
      : `${wrong} of the ${measurableCount} ${checkedOf(measurableCount)} linked your site to a different named person or business${counts0(wrong === 1)}`;
  const cutHead = ` ${cutOff === 1 ? "1 answer was" : `${cutOff} answers were`} cut off by the AI's length limit after starting to describe a different person or business`;
  const cutSentence =
    cutOff === 0
      ? ""
      : graded
        ? `${cutHead}; ${cutOff === 1 ? "it counts" : "they count"} as 0 too, and ${
            wrong === 0 ? (cutOff === 1 ? "we do not count it" : "we do not count them") : cutOff === 1 ? "it is not included" : "they are not included"
          } in that number.`
        : `${cutHead}${wrong === 0 ? "" : `; ${cutOff === 1 ? "it is not included" : "they are not included"} in that number`}.`;
  const identity = siteIdentityText(reference);
  const siteSays = identity ? ` Your site describes itself as: "${identity}".` : "";
  return fitNote((maxQuotes, maxWords) => {
    const confirmed = pickFlagged(cells, "misidentified=true", maxQuotes);
    const cut = pickFlagged(cells, "possible_mixup_cut_off=true", Math.max(0, maxQuotes - confirmed.length));
    const quote = (c: CellEnvelope, suffix = "") =>
      `${modelLabel(c.modelId)} said: "${pickEvidenceQuote(judgedText(c), domain, wrongAt(c), maxWords)}${suffix}"`;
    const quotes = [...confirmed.map((c) => quote(c)), ...cut.map((c) => quote(c, " (cut off)"))];
    const examples = quotes.length > 0 ? ` ${quotes.join("; ")}.` : "";
    return `${lead}${cutSentence}${examples}${quotes.length > 0 ? siteSays : ""} ${graded ? MIXUP_ROW_TAIL : ungradedTail(MIXUP_ROW_TAIL)}`;
  });
}

/**
 * dim6:v6: the informational row for answers the site's own text contradicts
 * (right site, wrong facts): what the AI said and what the site says.
 */
export function contradictedRowNote(cells: CellEnvelope[], measurableCount: number, count: number, reference = "", graded = true): string {
  const lead = `${count} of the ${measurableCount} ${checkedOf(measurableCount)} said something your site's text contradicts${graded ? `; ${count === 1 ? "it counts" : "they count"} as 0 in the checks above` : ""}.`;
  return fitNote((maxQuotes, maxWords) => {
    const examples = pickFlagged(cells, "facts_contradicted=true", maxQuotes).map((c) => saidVsSite(c, reference, maxWords));
    return `${lead}${examples.length > 0 ? ` ${examples.join(". ")}.` : ""} ${graded ? CONTRA_ROW_TAIL : ungradedTail(CONTRA_ROW_TAIL)}`;
  });
}

/** `<Model> said: "<answer words>"; your site says: "<site words>"` from a cell's claim_at / site_at. */
function saidVsSite(c: CellEnvelope, reference: string, maxWords: number): string {
  const claimAt = noteOffset(c, "claim_at");
  const siteAt = noteOffset(c, "site_at");
  const said = pickEvidenceQuote(judgedText(c), "", claimAt, maxWords);
  const site = siteAt !== undefined ? siteTextAt(stripUnsafeCharsKeepLines(reference), siteAt, maxWords) : "";
  return site ? `${modelLabel(c.modelId)} said: "${said}"; your site says: "${site}"` : `${modelLabel(c.modelId)} said: "${said}"`;
}

/**
 * dim6:v6: the informational row for answers backed by the site's text: what
 * the AI said next to the site's words that back it (the same evidence the
 * other rows show for mix-ups and contradictions).
 */
/** Lowercase, accents removed, curly apostrophes straightened, hyphens and underscores as spaces, spaces collapsed. */
function canonName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[-_‐-―]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function backedRowNote(cells: CellEnvelope[], checkableCount: number, count: number, reference = "", domain = "", siteNames: string[] = []): string {
  const lead = `${count} of the ${checkableCount} ${checkedOf(checkableCount)} ${count === 1 ? "was backed by your site's text" : BACKED}.`;
  const hasEvidence = (c: CellEnvelope) => noteOffset(c, "claim_at") !== undefined && noteOffset(c, "site_at") !== undefined;
  // Bruno 2026-11-12: show an example only when the site's words visibly back
  // the answer: the two quotes share a content word other than the site's
  // own name (else e.g. "Agent Instructions — Ugmonk" next to "a brand known
  // for minimalist design"). Otherwise skip it and try the next; none left
  // gives the count alone.
  // The site's own name is masked out of both quotes as whole names (Codex
  // 2026-11-12): any case, accents, hyphens and possessives ("Ugmonk's"), plus
  // the domain with or without www and its first label. A word that is only
  // part of a longer name (e.g. "foundation") still counts as a shared word.
  const keyRef = stripUnsafeCharsKeepLines(reference);
  const label = domain.split(".")[0] ?? "";
  const names = [...new Set([...siteNames, `www.${domain}`, domain, label].map(canonName).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  const masked = (s: string) => {
    let t = canonName(s);
    for (const n of names) t = t.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}(?:'s)?(?=$|[^\\p{L}\\p{N}])`, "gu"), "$1 ");
    return contentWords(t);
  };
  const visiblyBacked = (maxWords: number) => (c: CellEnvelope) => {
    const said = masked(pickEvidenceQuote(judgedText(c), "", noteOffset(c, "claim_at"), maxWords));
    return [...masked(siteTextAt(keyRef, noteOffset(c, "site_at") ?? -1, maxWords))].some((w) => said.has(w));
  };
  return fitNote((maxQuotes, maxWords) => {
    const ok = visiblyBacked(maxWords);
    const examples = pickFlagged(cells, "accuracy=CORRECT", maxQuotes, (c) => hasEvidence(c) && ok(c)).map((c) => saidVsSite(c, reference, maxWords));
    return `${lead}${examples.length > 0 ? ` For example: ${examples.join(". ")}.` : ""} ${NOT_COUNTED_AGAIN}`;
  });
}

const UNCHECKABLE_ADVICE =
  "A fuller description of who you are and what you do on your site (your homepage, llms.txt file and structured data) gives us more of your site's own text to check answers against.";

const noteHas = (re: RegExp) => (c: CellEnvelope) => re.test(c.result.notes);

/**
 * dim6:v6 option A: the uncheckable answers on their own line. They are left
 * out of the score (checkable.ts); this row says how many and why.
 */
/** Why the uncheckable answers could not be checked, as a list of clauses. */
function uncheckableBreakdown(cells: CellEnvelope[]): { parts: string[]; notBacked: number } {
  const un = cells.filter(isUncheckable);
  const failed = un.filter(isFailedCheck).length;
  const cutOff = un.filter((c) => !isFailedCheck(c) && noteHas(/(?:^|; )unclear_why=truncated(?:;|$)/)(c)).length;
  const notBacked = un.length - failed - cutOff;
  const parts = [
    notBacked > 0 ? `${notBacked} said things your site's text does not clearly back or contradict` : null,
    cutOff > 0 ? `${cutOff} ${cutOff === 1 ? "was" : "were"} cut off by the AI's length limit before the part we would check` : null,
    failed > 0 ? `${failed} could not be checked because one of our checks failed` : null,
  ].filter((p): p is string => p !== null);
  return { parts, notBacked };
}

const joinClauses = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "");

/**
 * dim6:v6 option A: the uncheckable answers on their own line. They are left
 * out of the score (checkable.ts); this row says how many and why.
 */
export function uncheckableRowNote(cells: CellEnvelope[], measurableCount: number, uncheckable: number): string {
  const tail = "This row is for information and is not counted in your score.";
  if (uncheckable === 0) return `All ${measurableCount} test answers that came back could be checked against your site's text. ${tail}`;
  const { parts, notBacked } = uncheckableBreakdown(cells);
  const lead = `${uncheckable} of the ${measurableCount} test answers that came back ${uncheckable === 1 ? "is" : "are"} not counted in this score, because we could not check ${uncheckable === 1 ? "it" : "them"} against your site's text: ${joinClauses(parts)}.`;
  return `${lead}${notBacked > 0 ? ` ${UNCHECKABLE_ADVICE}` : ""} ${tail}`;
}

export function buildSubChecks(result: Dim6Result, hasCompetitorList: boolean, domain = ""): Dim6SubCheck[] {
  const cells = result.cells;
  const measurableCount = cells.length - result.unmeasurableCount;
  const counts = checkableCounts(cells);
  const checkableCount = counts.checkable;
  const checked = result.accuracyChecked === true;
  const reference = result.referenceText ?? "";

  const dnRate = rateOf(cells, "domain_named");
  const urlRate = rateOf(cells, "url_referenced");
  const ctxRate = rateOf(cells, "context_relevant");
  const compRate = rateOf(cells, "no_competitor_first");

  // RD-0123: the average is of per-answer scores, and says so. Keep "Average
  // answer score by model" last: audit-executive-summary.ts citationCoverage
  // parses it (and the "<m> of <t> test answers came back" count).
  const summary = `${measurableCount} of ${cells.length} test answers came back from the ${ALL_MODEL_IDS.length} AI models, and ${checkableCount} of those could be checked against your site's text and ${checkableCount === 1 ? "is" : "are"} counted in this score. Average answer score by model (0 to 100): ${ALL_MODEL_IDS.map(
    (m) => `${modelLabel(m)} ${result.perModelAverage[m] ?? "not measured"}`
  ).join(", ")}.`;

  // Counts of the checkable answer kinds. Rates above count backed answers
  // (and, for the link rate, URL-only answers) only: no other cell carries
  // the flags. The uncheckable answers have their own row (option A).
  const correct = countFlag(cells, "accuracy=CORRECT");
  const urlOnly = countFlag(cells, "url_only=true");
  const wrong = countFlag(cells, "misidentified=true");
  const cutOff = countFlag(cells, "possible_mixup_cut_off=true");
  const contradicted = countFlag(cells, "facts_contradicted=true");
  // DENY answers that still linked the site to someone else or stated a
  // contradicted fact are counted there, not here.
  const unknown = cells.filter(
    (c) => !c.result.unmeasurable && c.result.notes.includes("judge=DENY") && !/misidentified=true|possible_mixup_cut_off=true|facts_contradicted=true/.test(c.result.notes)
  ).length;
  const parts = [
    `${correct} ${correct === 1 ? "was backed by your site's text" : BACKED}`,
    urlOnly > 0 ? `${urlOnly} gave your homepage address when asked for it` : null,
    `${wrong} linked your site to a different named person or business`,
    cutOff > 0 ? `${cutOff} ${cutOff === 1 ? "was" : "were"} cut off by the AI's length limit after starting to describe a different person or business` : null,
    contradicted > 0 ? `${contradicted} ${contradicted === 1 ? "was" : "were"} contradicted by your site's text` : null,
    `${unknown} did not show that the model knew your site`,
  ].filter((p): p is string => p !== null);
  const breakdown = `Of the ${checkableCount} ${checkedOf(checkableCount)}, ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}.`;

  const subChecks: Dim6SubCheck[] = [
    {
      id: SUBCHECK_IDS.domain_named_rate,
      name: "Models name your site",
      weight: 40,
      score: dnRate,
      passed: dnRate >= 70,
      notes: checked
        ? `${dnRate}% of the ${CHECKED} named your site (by its domain or the name your site gives itself) and ${BACKED}. ${breakdown} ${NAMES_DISCLOSURE} ${summary}`
        : result.accuracyBlocked === true
          ? `${dnRate}% of the ${CHECKED} named your domain. ${accuracyBlockedNote(countFlag(cells, "accuracy_blocked=true"))} ${summary}`
          : `${dnRate}% of the ${CHECKED} named your domain. ${(result.accuracyNotCheckedReason ? NOT_CHECKED_NOTES[result.accuracyNotCheckedReason] : accuracyNotCheckedNote)(countFlag(cells, "accuracy_not_checked=true"))} ${summary}`,
    },
    {
      id: SUBCHECK_IDS.url_referenced_rate,
      name: "Models cite your URL",
      weight: 30,
      score: urlRate,
      passed: urlRate >= 70,
      notes: `${urlRate}% of the ${CHECKED} included a link to your site and either ${BACKED}, or gave your homepage address when asked for it.`,
    },
    {
      id: SUBCHECK_IDS.context_relevant_rate,
      name: "Models treat your domain as the principal answer",
      weight: 20,
      score: ctxRate,
      passed: ctxRate >= 70,
      notes: `${ctxRate}% of the ${CHECKED} ${BACKED} and named your site (by its domain or its own name) in the first half of the answer, rather than only at the end.`,
    },
    // dim6:v4: N/A without a competitor list (the cell scores give it no
    // points either, see parser.ts), so it is never a gap.
    hasCompetitorList
      ? {
          id: SUBCHECK_IDS.no_competitor_first_rate,
          name: "Competitor-first check (not measured)",
          weight: 10,
          score: compRate,
          passed: compRate >= 70,
          notes: `${compRate}% of the ${CHECKED} did not name a competitor before your domain.`,
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

  // Informational rows (na, weight 0): no scoring change, never a gap, and the
  // hostile quotes stay out of the domain-named note the executive summary
  // parses.
  if (checked && correct > 0) {
    subChecks.push({
      id: SUBCHECK_IDS.backed_answers,
      name: "Answers backed by your site's text",
      weight: 0,
      score: 0,
      passed: false,
      notes: backedRowNote(cells, checkableCount, correct, reference, domain, result.siteNames ?? []),
      na: true,
    });
  }
  subChecks.push(...evidenceRows(result, domain, true));
  // Option A: the uncheckable count always has its own line.
  subChecks.push({
    id: SUBCHECK_IDS.uncheckable_answers,
    name: "Answers with not enough evidence to check",
    weight: 0,
    score: 0,
    passed: false,
    notes: uncheckableRowNote(cells, measurableCount, counts.uncheckable),
    na: true,
  });
  return subChecks;
}

/**
 * dim6:v6 option A: the whole-dimension note when too few answers could be
 * checked for a grade (checkable.ts floor). The dimension is N/A ("not
 * measured"): not counted in the overall score.
 */
export function notEnoughEvidenceNote(
  result: Dim6Result,
  counts: CheckableCounts,
  failedGrades: { low: string; high: string } | null = null
): string {
  const cells = result.cells;
  const thin = counts.thinModels.map((m) => `${modelLabel(m)} ${counts.perModel[m]}`);
  const lead = failedGrades
    ? `Citation Visibility is not graded on this run: one of our checks failed on ${counts.failed} of the test answers, and depending on what ${counts.failed === 1 ? "that answer" : "those answers"} said, the grade could be anything from ${failedGrades.low} to ${failedGrades.high}. It is not counted in your score; this is a failure on our side, not something your site needs to fix.`
    : `Citation Visibility is not graded on this run: ${counts.checkable} of the ${cells.length} test answers could be checked against your site's text, and we grade it only when at least ${DIM6_MIN_CHECKABLE} can be checked, with at least ${DIM6_MIN_CHECKABLE_PER_MODEL} from each of the ${ALL_MODEL_IDS.length} AI models${
        thin.length > 0 ? ` (answers we could check: ${thin.join(", ")})` : ""
      }. It is not counted in your score.`;
  const missing = result.unmeasurableCount > 0 ? ` ${result.unmeasurableCount} of the ${cells.length} test answers did not come back from the AI models (network or provider failures).` : "";
  const { parts, notBacked } = uncheckableBreakdown(cells);
  const unShort = counts.uncheckable > 0 ? ` ${counts.uncheckable} of the answers that came back could not be checked against your site's text.` : "";
  const un = counts.uncheckable > 0 ? `${unShort.slice(0, -1)}: ${joinClauses(parts)}.` : "";
  // Mix-ups and contradictions are shown in their own rows under this note.
  const found = "";
  // Advice only for what the site can fix: answers its text does not cover,
  // or its own description being unusable. Never for our failed checks.
  const checked = result.accuracyChecked === true;
  const why = !checked
    ? result.accuracyBlocked === true
      ? ` ${accuracyBlockedNote(countFlag(cells, "accuracy_blocked=true"))}`
      : ` ${(result.accuracyNotCheckedReason ? NOT_CHECKED_NOTES[result.accuracyNotCheckedReason] : accuracyNotCheckedNote)(countFlag(cells, "accuracy_not_checked=true"))}`
    : notBacked > 0
      ? ` ${UNCHECKABLE_ADVICE}`
      : "";
  // One note for the whole section, capped at DISPLAY_TEXT_MAX by the report
  // (Codex 2026-11-12): shorten whole sentences, never cut one.
  const engine = ` ${DIM6_ENGINE_LINE}.`;
  for (const note of [
    `${lead}${missing}${un}${found}${why}${engine}`,
    `${lead}${missing}${unShort}${found}${why}${engine}`,
    `${lead}${missing}${unShort}${found}${why}`,
    `${lead}${missing}${unShort}${why}`,
  ]) {
    if (note.length <= DISPLAY_TEXT_MAX) return note;
  }
  return `${lead}${unShort}${why}`;
}

/**
 * The informational mix-up and contradiction rows (na, weight 0), present only
 * when the answers were checked and at least one was found. `graded` false:
 * under a section with no grade (option A floor), worded without "the checks
 * above".
 */
function evidenceRows(result: Dim6Result, domain: string, graded: boolean): Dim6SubCheck[] {
  if (result.accuracyChecked !== true) return [];
  const cells = result.cells;
  const checkableCount = checkableCounts(cells).checkable;
  const reference = result.referenceText ?? "";
  const wrong = countFlag(cells, "misidentified=true");
  const cutOff = countFlag(cells, "possible_mixup_cut_off=true");
  const contradicted = countFlag(cells, "facts_contradicted=true");
  const rows: Dim6SubCheck[] = [];
  if (wrong > 0 || cutOff > 0) {
    rows.push({
      id: SUBCHECK_IDS.misidentified_answers,
      name:
        cutOff > 0
          ? "Answers that linked, or may have linked, your site to a different person or business"
          : "Answers that linked your site to a different person or business",
      weight: 0,
      score: 0,
      passed: false,
      notes: mixupRowNote(cells, domain, checkableCount, wrong, cutOff, reference, graded),
      na: true,
    });
  }
  if (contradicted > 0) {
    rows.push({
      id: SUBCHECK_IDS.contradicted_answers,
      name: "Answers contradicted by your site's text",
      weight: 0,
      score: 0,
      passed: false,
      notes: contradictedRowNote(cells, checkableCount, contradicted, reference, graded),
      na: true,
    });
  }
  return rows;
}

/** Sub-check id of the N/A Dim 6 when too few answers were checkable (option A). */
export const DIM6_NOT_ENOUGH_EVIDENCE_ID = "dim6_not_enough_evidence";
/** Sub-check id of the N/A Dim 6 when our failed checks could change the grade. */
export const DIM6_CHECKS_FAILED_ID = "dim6_checks_failed";

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
    siteFacts: reference.verifiable ? { names: reference.names, addresses: reference.addresses } : null,
    // Injected description: the site owner is the likely attacker, so the
    // safe direction is down. Missing/short → not checked (also 0).
    referenceBlocked: !reference.verifiable && reference.reason === "injection",
  });
  if (reference.verifiable) {
    result.referenceText = reference.text;
    result.siteNames = reference.names.map((n) => n.text);
  }
  if (
    !reference.verifiable &&
    (reference.reason === "too_many_entities" || reference.reason === "source_too_large" || reference.reason === "structured_data_too_deep" || reference.reason === "structured_data_unreadable")
  ) {
    result.accuracyNotCheckedReason = reference.reason;
  }

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

  return { ...dim6FromResult(result, competitorHosts.length > 0, canonicalDomain(scanUrl) ?? ""), cells: result.cells, raw: result, capped: false };
}

/**
 * The Dim 6 dimension for a run with at least one measured answer: graded
 * when enough answers were checkable (checkable.ts floor), else N/A with the
 * reason (dim6:v6 option A). Exported for the replay tools and tests.
 */
export function dim6FromResult(result: Dim6Result, hasCompetitorList: boolean, domain: string): { dimension: Dim6Dimension } {
  const counts = checkableCounts(result.cells);
  // Our own failed checks are left out of the score, but they never decide a
  // grade (Codex review 2026-11-12, MED): counted as 0 or as 100 they must
  // give the same grade, or there is no grade.
  const bounds = failedCheckBounds(counts);
  const failedGrades = counts.failed > 0 && gradeFor(bounds.low) !== gradeFor(bounds.high) ? { low: gradeFor(bounds.low), high: gradeFor(bounds.high) } : null;
  if (!counts.meetsFloor || result.score === null || failedGrades) {
    return {
      dimension: {
        dimension_id: 6,
        dimension_name: "Citation Visibility",
        score: 0,
        grade: gradeFor(0),
        na: true,
        sub_checks: [
          {
            id: counts.meetsFloor && failedGrades ? DIM6_CHECKS_FAILED_ID : DIM6_NOT_ENOUGH_EVIDENCE_ID,
            name: counts.meetsFloor && failedGrades ? "Citation Visibility (not graded: our checks failed)" : "Citation Visibility (not enough evidence to grade)",
            weight: 1,
            score: 0,
            passed: false,
            notes: notEnoughEvidenceNote(result, counts, counts.meetsFloor ? failedGrades : null),
            na: true,
          },
          // Bruno 2026-11-12: the mix-up and contradiction evidence stays visible with no grade.
          ...evidenceRows(result, domain, false),
        ],
        unmeasured: true,
      },
    };
  }
  const subChecks = buildSubChecks(result, hasCompetitorList, domain);
  const score = result.score; // already aggregated 0-100 over the checkable answers

  return {
    dimension: {
      dimension_id: 6,
      dimension_name: "Citation Visibility",
      score,
      grade: gradeFor(score),
      sub_checks: subChecks,
    },
  };
}

export { DIM6_ENGINE_VERSION };
