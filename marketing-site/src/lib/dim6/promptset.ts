// Slice 3b Dim 6 — prompt-set generator (Task 7).
//
// Generates ~10 short-answer queries per audit, dispatched across 4 models
// (=> ~30-40 corpus rows per audit). The queries probe whether the model
// cites the target domain when asked questions in its category.
//
// LOAD-BEARING for Dim 6 score correctness:
// - Without the short-answer constraint, models default to verbose
//   "comprehensive overview" essays that hit max_tokens (truncated:true)
//   without ever producing a citation. That biases scores artificially
//   low — the CELL is included in the formula even when truncated, but a
//   truncated essay rarely names a specific domain.
// - The instruction template uses positive phrasing ("write each query as
//   a short-answer question") rather than a primed AVOID bullet list,
//   which the small llama-3.1-8b model echoes back as templates rather
//   than avoiding (negation-failure pattern documented in
//   feedback_avoid_list_priming.md).
// - A post-generation regex validator rejects any query that matches a
//   small set of truly verbose-eliciting framings, with retry-once-with-
//   feedback before falling back to the templated bank.
//
// v3 changes (2026-05-02, post-Stripe-verification-attempt-1):
//   - Added TP-7 retry-once-with-feedback (Slice 3b Task 7 spec compliance;
//     the v2 generator was missing this and fell straight to bank on first
//     miss, which is what caused 100% Bank fallback on every paid audit).
//   - Replaced the AVOID bullet list in the gen prompt with positive
//     short-answer instructions. The bullet list was acting as an
//     example menu that the small model echoed back.
//   - Loosened the AVOID regex: dropped /\bin detail\b/ and /\bcompare all\b/
//     (over-matching natural query phrasings outside the verbose-eliciting
//     framings the spec was targeting).
//   - CC-3 fix: bank queries are domain-named only. Category-substituted
//     framings ("Name the top 3 ${category} vendors...") were producing
//     literal "their software category" placeholder text in production
//     because audit-fulfill never populates `signals` and category derivation
//     fell through to the generic fallback string. See deletion-site
//     comment in buildBankQueries below.

import type { PromptSetQuery } from "./types";

// Loosened from v2: dropped /\bin detail\b/i and /\bcompare all\b/i which
// were matching natural query phrasings outside the verbose-eliciting
// framings the spec targeted. Keep only the truly verbose-eliciting
// patterns. If the validator is over-strict, retry-once-with-feedback
// (added in v3) gives the model a chance to correct.
const AVOID_PATTERNS: RegExp[] = [
  /tell me everything/i,
  /comprehensive overview/i,
  /all the leading/i,
  /list every/i,
  /compare every/i,
  /\bdeep dive\b/i,
  /detailed analysis/i,
];

// Pre-built, domain-named query bank (CC-3 v3 fix).
//
// COMPETITOR-ENUMERATION FRAMINGS: deliberately removed in dim6:v3 due to
// CC-3 cascade. The v2 bank had queries like "Name the top 3 ${category}
// vendors" that interpolated `category` derived from signals — but
// audit-fulfill never populates `signals` to runDim6Paid, so category
// fell through to the literal string "their software category" and the
// queries went to the LLM as "Name the top 3 their software category
// vendors..." which is nonsense. See pharos-stripe-decision-framework.md
// "Pre-retry queue" for the postmortem. Re-introduce category-substituted
// framings ONLY after audit-fulfill populates real category from scanner
// signals (Phase 1.5 hardening item — scanner already fetches homepage
// HTML in dim3-openapi.ts; expose it on scan result).
function buildBankQueries(scanUrl: string): PromptSetQuery[] {
  const host = (() => {
    try {
      return new URL(scanUrl).host;
    } catch {
      return scanUrl;
    }
  })();
  return [
    {
      id: "q_bank_1",
      text: `What does ${host} do? Answer in one sentence.`,
      rationale: "Bank fallback: direct domain query, baseline 'is this domain known' check.",
    },
    {
      id: "q_bank_2",
      text: `Have you heard of ${host}? If yes, one sentence on what they offer.`,
      rationale: "Bank fallback: recognition probe with short-answer constraint.",
    },
    {
      id: "q_bank_3",
      text: `Give me one paragraph: what is ${host} and why might I use it?`,
      rationale: "Bank fallback: paragraph-bounded direct domain check.",
    },
    {
      id: "q_bank_4",
      text: `Is ${host} a well-known name? Yes or no, plus one sentence why.`,
      rationale: "Bank fallback: yes/no recognition check, forced short answer.",
    },
    {
      id: "q_bank_5",
      text: `Summarize ${host} in two sentences. Include the URL.`,
      rationale: "Bank fallback: URL-grounded short summary.",
    },
    {
      id: "q_bank_6",
      text: `Who is the company behind ${host}? One sentence.`,
      rationale: "Bank fallback: ownership/identity probe, short answer.",
    },
    {
      id: "q_bank_7",
      text: `Name one product or service offered by ${host}. One sentence.`,
      rationale: "Bank fallback: capability probe — real product knowledge vs confabulation.",
    },
    {
      id: "q_bank_8",
      text: `In one sentence, what category of software does ${host} fit into?`,
      rationale: "Bank fallback: category-self-derivation probe.",
    },
    {
      id: "q_bank_9",
      text: `If a buyer asked you about ${host}, how would you describe it in one sentence?`,
      rationale: "Bank fallback: buyer-intent framed short answer.",
    },
    {
      id: "q_bank_10",
      text: `What URL would I visit to learn more about ${host}? Just one URL.`,
      rationale: "Bank fallback: URL-only enumeration for citation-grounding.",
    },
  ];
}

// Best-effort category extraction. Used only as context for the LLM
// generator's prompt — bank queries no longer depend on it (v3 / CC-3 fix).
// Falls back to a generic descriptor when signals are absent.
export function deriveCategoryFromSignals(
  scanUrl: string,
  signals: { homepageHtml?: string | null; titleTag?: string | null } = {}
): string {
  if (signals.titleTag) {
    const t = signals.titleTag.trim();
    const cleaned = t.split(/[|·–—-]/)[0].trim();
    if (cleaned.length >= 4 && cleaned.length <= 80) {
      return cleaned;
    }
  }
  if (signals.homepageHtml) {
    const m = /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i.exec(
      signals.homepageHtml
    );
    if (m && m[1].trim().length >= 10) {
      const desc = m[1].trim();
      const first = desc.split(/[.,;]/)[0].trim();
      if (first.length >= 4 && first.length <= 80) {
        return first;
      }
    }
  }
  // Generic fallback — never sent into bank queries (v3), only used as
  // generator-prompt context where the LLM can interpret "their software
  // category" as a placeholder rather than literal text.
  return "their software category";
}

// Workers AI client for prompt-set generation. We use the same llama-3.1-8b
// model the audit-fulfill remediation pipeline uses — already on the AI
// binding, no extra cost.
export interface PromptSetGenEnv {
  AI: Ai;
}

const GEN_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const TARGET_QUERY_COUNT = 10;
const MIN_VALID_QUERIES = 5;

// v3: positive-instruction prompt (replaces v2's AVOID bullet list which
// was priming the model to echo forbidden phrasings).
function buildGenPrompt(scanUrl: string, category: string): string {
  return `You are generating a prompt set for a citation-visibility audit. The audit asks 4 hosted models (GPT-4o, Claude, Gemini, Perplexity) the same questions and measures whether they cite the domain ${scanUrl}.

CATEGORY (derived from the site, may be approximate): ${category}
TARGET DOMAIN: ${scanUrl}

Generate exactly ${TARGET_QUERY_COUNT} short-answer questions a real user might type into a chatbot. Every query must satisfy ALL of:

- Maximum 30 words.
- Asks for a focused, factual answer (one sentence, one URL, one yes/no, one short paragraph).
- Reads as if a real user wrote it — never mentions the audit, the 4-model design, or "citation visibility."
- Mixes question types: some name the target domain directly, some describe a buyer-intent search in the category, some probe brand recognition.

OUTPUT — one JSON array of exactly ${TARGET_QUERY_COUNT} objects. No preamble, no commentary, no code fences:

[{"id":"q1","text":"Short question, max 30 words.","rationale":"Why this probes citation behavior."}, ...]

Rules:
- "id" is q1..q${TARGET_QUERY_COUNT}.
- "text" is the actual prompt sent to the 4 models.
- "rationale" is one sentence on why this prompt probes citation behavior.

Output the JSON array only.`;
}

interface GeneratedQuery {
  id?: unknown;
  text?: unknown;
  rationale?: unknown;
}

function passesAvoidList(text: string): boolean {
  return !AVOID_PATTERNS.some((re) => re.test(text));
}

function isWithinLengthBudget(text: string): boolean {
  // Match the 30-word cap from the gen prompt. Loose word count via whitespace
  // split — close enough for prompt-quality validation.
  const wordCount = text.trim().split(/\s+/).length;
  return wordCount > 0 && wordCount <= 40; // allow small slack over the 30 in prompt
}

function describeRejectionReasons(parsed: PromptSetQuery[]): string {
  // Build a one-paragraph diagnostic of why filtered queries were rejected,
  // for the retry-with-feedback prompt. Don't list every offending phrase —
  // give the model the rule, not the data.
  const reasons: string[] = [];
  let avoidHits = 0;
  let tooShort = 0;
  let tooLong = 0;
  for (const q of parsed) {
    if (q.text.length < 10) tooShort++;
    else if (!isWithinLengthBudget(q.text)) tooLong++;
    else if (!passesAvoidList(q.text)) avoidHits++;
  }
  if (avoidHits > 0) {
    reasons.push(
      `${avoidHits} of ${parsed.length} queries used verbose-eliciting phrases like "tell me everything", "comprehensive overview", "list every", "deep dive", or "detailed analysis"`
    );
  }
  if (tooLong > 0) {
    reasons.push(`${tooLong} queries exceeded the 30-word short-answer cap`);
  }
  if (tooShort > 0) {
    reasons.push(`${tooShort} queries were too short (under 10 chars) — likely empty placeholders`);
  }
  if (reasons.length === 0) {
    return `produced ${parsed.length} queries but ${MIN_VALID_QUERIES} or more focused short-answer questions are required`;
  }
  return reasons.join("; ");
}

async function callGenerator(env: PromptSetGenEnv, prompt: string): Promise<string> {
  try {
    const r = (await env.AI.run(GEN_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
      temperature: 0,
      seed: 42,
    })) as { response?: string };
    return (r.response ?? "").trim();
  } catch (e) {
    console.warn(
      `[dim6/promptset] generation call failed: ${e instanceof Error ? e.message : String(e)}`
    );
    return "";
  }
}

function filterValid(parsed: PromptSetQuery[]): PromptSetQuery[] {
  return parsed.filter(
    (q) =>
      q.text.length >= 10 &&
      isWithinLengthBudget(q.text) &&
      passesAvoidList(q.text)
  );
}

/**
 * Best-effort generation of a prompt set with TP-7 retry-once-with-feedback.
 * Returns ~10 queries. Falls back to the pre-built bank when generation
 * fails twice or produces too few valid queries on both attempts.
 *
 * v3 retry path (Slice 3b Task 7 spec compliance): on first-miss validator
 * rejection, retry once with prepended rejection reason. Bank fallback
 * fires only on second miss.
 */
export async function generatePromptSet(
  env: PromptSetGenEnv,
  scanUrl: string,
  signals: { homepageHtml?: string | null; titleTag?: string | null } = {}
): Promise<PromptSetQuery[]> {
  const category = deriveCategoryFromSignals(scanUrl, signals);
  const initialPrompt = buildGenPrompt(scanUrl, category);

  // First attempt.
  const raw1 = await callGenerator(env, initialPrompt);
  if (raw1) {
    const parsed1 = tryParseQueries(raw1);
    const valid1 = filterValid(parsed1);
    if (valid1.length >= TARGET_QUERY_COUNT) {
      console.log(
        `[dim6/promptset] generated ${valid1.length}/${TARGET_QUERY_COUNT} valid queries on first attempt`
      );
      return valid1.slice(0, TARGET_QUERY_COUNT);
    }
    if (valid1.length >= MIN_VALID_QUERIES) {
      // Got at least half — pad up from the bank. Deterministic cost ceiling.
      const padded = padFromBank(valid1, scanUrl);
      console.log(
        `[dim6/promptset] generated ${valid1.length} valid queries on first attempt; padded to ${padded.length} from bank`
      );
      return padded;
    }

    // First-miss retry-with-feedback (TP-7 ladder rung).
    const reason = describeRejectionReasons(parsed1);
    console.warn(
      `[dim6/promptset] first attempt produced ${valid1.length}/${parsed1.length} valid queries; retrying with feedback. reason="${reason}"`
    );
    const retryPrompt = `${initialPrompt}

Your previous attempt was rejected because: ${reason}.

Regenerate the JSON array. Keep every query under 30 words, focused on a single short answer, and avoid the verbose-eliciting phrases listed in the rules. Output the JSON array only.`;
    const raw2 = await callGenerator(env, retryPrompt);
    if (raw2) {
      const parsed2 = tryParseQueries(raw2);
      const valid2 = filterValid(parsed2);
      if (valid2.length >= TARGET_QUERY_COUNT) {
        console.log(
          `[dim6/promptset] generated ${valid2.length}/${TARGET_QUERY_COUNT} valid queries on retry`
        );
        return valid2.slice(0, TARGET_QUERY_COUNT);
      }
      if (valid2.length >= MIN_VALID_QUERIES) {
        const padded = padFromBank(valid2, scanUrl);
        console.log(
          `[dim6/promptset] generated ${valid2.length} valid queries on retry; padded to ${padded.length} from bank`
        );
        return padded;
      }
      console.warn(
        `[dim6/promptset] retry produced ${valid2.length} valid queries; using bank fallback.`
      );
    } else {
      console.warn(
        `[dim6/promptset] retry returned empty; using bank fallback.`
      );
    }
  } else {
    console.warn(
      `[dim6/promptset] first attempt returned empty; using bank fallback.`
    );
  }

  return buildBankQueries(scanUrl);
}

function padFromBank(
  partial: PromptSetQuery[],
  scanUrl: string
): PromptSetQuery[] {
  const bank = buildBankQueries(scanUrl);
  const padded = [...partial];
  for (const b of bank) {
    if (padded.length >= TARGET_QUERY_COUNT) break;
    if (!padded.some((q) => q.text === b.text)) padded.push(b);
  }
  return padded;
}

function tryParseQueries(raw: string): PromptSetQuery[] {
  let body = raw.trim();
  if (body.startsWith("```")) {
    body = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  const firstBracket = body.indexOf("[");
  const lastBracket = body.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket <= firstBracket) return [];
  const slice = body.slice(firstBracket, lastBracket + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: PromptSetQuery[] = [];
  parsed.forEach((q, idx) => {
    if (typeof q !== "object" || q === null) return;
    const obj = q as GeneratedQuery;
    const id = typeof obj.id === "string" && obj.id.length > 0 ? obj.id : `q${idx + 1}`;
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    if (text.length === 0) return;
    const rationale =
      typeof obj.rationale === "string" && obj.rationale.length > 0
        ? obj.rationale.trim()
        : null;
    out.push({ id, text, rationale });
  });
  return out;
}
