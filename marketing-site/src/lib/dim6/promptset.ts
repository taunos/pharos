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
// - The instruction template includes an explicit AVOID list of
//   verbose-eliciting framings and a PREFER list of focused short-answer
//   forms. A post-generation regex validator rejects any query that
//   matches the AVOID list and falls back to a templated short-answer query.
//
// CC-3 (pass-4 polish): the templated fallback's category placeholder is
// derived from the URL's domain (or a generic "their software category"
// where derivation fails). Never sends the literal "[organization's
// category]" string to LLMs.

import type { PromptSetQuery } from "./types";

const AVOID_PATTERNS: RegExp[] = [
  /tell me everything/i,
  /comprehensive overview/i,
  /all the leading/i,
  /list every/i,
  /compare every/i,
  /\bcompare all\b/i,
  /\bin detail\b/i,
  /\bdeep dive\b/i,
  /detailed analysis/i,
];

// Pre-built, regex-validated query bank. We try LLM generation first, and
// fall back to the bank when generation fails (network, parse, or all
// generated queries fail the regex). The bank queries are intentionally
// short-answer-oriented and focused.
function buildBankQueries(
  scanUrl: string,
  category: string
): PromptSetQuery[] {
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
      text: `Name the top 3 ${category} vendors. One sentence per vendor, including the URL.`,
      rationale: "Bank fallback: top-3 short answer, prompts model to produce URL citations.",
    },
    {
      id: "q_bank_2",
      text: `What does ${host} do? Answer in one sentence.`,
      rationale: "Bank fallback: direct domain query, baseline 'is this domain known' check.",
    },
    {
      id: "q_bank_3",
      text: `Who are the most credible providers of ${category}? Give 3, one URL each.`,
      rationale: "Bank fallback: credibility-framed competitor short answer.",
    },
    {
      id: "q_bank_4",
      text: `If I'm researching ${category}, what 2-3 sites should I read first? Just URLs.`,
      rationale: "Bank fallback: research-intent short answer, URL-only output.",
    },
    {
      id: "q_bank_5",
      text: `Give me one paragraph: what is ${host} and why might I use it?`,
      rationale: "Bank fallback: paragraph-bounded direct domain check.",
    },
    {
      id: "q_bank_6",
      text: `Is ${host} a recognized name in ${category}? Yes or no, plus one sentence why.`,
      rationale: "Bank fallback: yes/no recognition check, forced short answer.",
    },
    {
      id: "q_bank_7",
      text: `List 3 ${category} tools by URL only.`,
      rationale: "Bank fallback: URL-only enumeration for citation-grounding.",
    },
    {
      id: "q_bank_8",
      text: `What's a quick alternative to ${host} in ${category}? Name one and link it.`,
      rationale: "Bank fallback: alternative-framing — tests competitor mention adjacent to target.",
    },
    {
      id: "q_bank_9",
      text: `In one sentence, position ${host} against its top competitor.`,
      rationale: "Bank fallback: positioning-framing — competitor-first risk check.",
    },
    {
      id: "q_bank_10",
      text: `Which ${category} provider should a small B2B SaaS company evaluate first? One name + URL.`,
      rationale: "Bank fallback: buyer-intent shortlist — single-pick short answer.",
    },
  ];
}

// Best-effort category extraction from the URL host. Strips TLD, splits on
// hyphens, falls back to a generic "their software category" — never sends
// literal placeholder strings to LLMs (CC-3 polish).
export function deriveCategoryFromSignals(
  scanUrl: string,
  signals: { homepageHtml?: string | null; titleTag?: string | null } = {}
): string {
  // 1. <title> tag if available — usually contains a category-relevant noun.
  if (signals.titleTag) {
    const t = signals.titleTag.trim();
    // Strip "| Brand" suffix, common pattern.
    const cleaned = t.split(/[|·–—-]/)[0].trim();
    if (cleaned.length >= 4 && cleaned.length <= 80) {
      return cleaned;
    }
  }
  // 2. Homepage <meta name="description"> — first 100 chars.
  if (signals.homepageHtml) {
    const m = /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i.exec(
      signals.homepageHtml
    );
    if (m && m[1].trim().length >= 10) {
      const desc = m[1].trim();
      // Take the first phrase up to a comma/period.
      const first = desc.split(/[.,;]/)[0].trim();
      if (first.length >= 4 && first.length <= 80) {
        return first;
      }
    }
  }
  // 3. Generic stack-agnostic fallback.
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

function buildGenPrompt(scanUrl: string, category: string): string {
  return `You are generating a prompt set for a citation-visibility audit. The audit asks 4 hosted models (GPT-4o, Claude, Gemini, Perplexity) the same questions and measures whether they cite the domain ${scanUrl}.

CATEGORY (derived from the site): ${category}
TARGET DOMAIN: ${scanUrl}

Generate exactly ${TARGET_QUERY_COUNT} prompts. Each prompt must be a SHORT-ANSWER question — bounded to roughly 200-500 tokens of model output.

AVOID these framings entirely (they elicit verbose essays that hit token limits without producing citations):
- "tell me everything about..."
- "comprehensive overview of..."
- "all the leading..."
- "list every..."
- "compare every..."
- "deep dive into..."
- "detailed analysis of..."

PREFER these framings (focused, short-answer):
- "Name the top 3 ___. One sentence per vendor, with URL."
- "What does ___ do? One sentence."
- "Give me one URL for ___."
- "In one paragraph: what is ___?"
- "Yes or no: is ___ a recognized vendor in <category>?"
- "Which 2-3 sites should I read first about <category>?"

OUTPUT FORMAT — one JSON array of objects, no preamble:
[{"id":"q1","text":"...","rationale":"..."}, ...]

Rules:
- "id" must be q1..q${TARGET_QUERY_COUNT}.
- "text" is the actual prompt sent to the 4 models. It must be a SHORT-ANSWER question. Do NOT mention the audit or the 4-model design — write each prompt as if a real user asked it.
- "rationale" is one sentence on why this prompt probes citation behavior.
- Mix prompt types: some direct domain queries, some category-vendor enumeration, some buyer-intent shortlists.

Output the JSON array only. No backticks. No commentary.`;
}

interface GeneratedQuery {
  id?: unknown;
  text?: unknown;
  rationale?: unknown;
}

function passesAvoidList(text: string): boolean {
  return !AVOID_PATTERNS.some((re) => re.test(text));
}

/**
 * Best-effort generation of a prompt set. Returns ~10 queries. Falls back
 * to the pre-built bank if generation fails or produces no valid queries.
 */
export async function generatePromptSet(
  env: PromptSetGenEnv,
  scanUrl: string,
  signals: { homepageHtml?: string | null; titleTag?: string | null } = {}
): Promise<PromptSetQuery[]> {
  const category = deriveCategoryFromSignals(scanUrl, signals);

  // Try LLM generation first.
  let raw = "";
  try {
    const r = (await env.AI.run(GEN_MODEL, {
      messages: [{ role: "user", content: buildGenPrompt(scanUrl, category) }],
      max_tokens: 1500,
      temperature: 0,
      seed: 42,
    })) as { response?: string };
    raw = (r.response ?? "").trim();
  } catch (e) {
    console.warn(
      `[dim6/promptset] generation call failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (raw) {
    const parsed = tryParseQueries(raw);
    const filtered = parsed.filter(
      (q) => q.text.length >= 10 && passesAvoidList(q.text)
    );
    if (filtered.length >= Math.ceil(TARGET_QUERY_COUNT / 2)) {
      // Got at least half — pad up to 10 from the bank so we always send
      // exactly ~10 prompts to the 4 models (deterministic cost ceiling).
      if (filtered.length >= TARGET_QUERY_COUNT) return filtered.slice(0, TARGET_QUERY_COUNT);
      const bank = buildBankQueries(scanUrl, category);
      const padded = [...filtered];
      for (const b of bank) {
        if (padded.length >= TARGET_QUERY_COUNT) break;
        if (!padded.some((q) => q.text === b.text)) padded.push(b);
      }
      return padded;
    }
    // Generation produced too few valid queries — fall through to bank.
    console.warn(
      `[dim6/promptset] LLM generated ${filtered.length}/${TARGET_QUERY_COUNT} valid queries (after AVOID filter); using bank fallback.`
    );
  } else {
    console.warn(
      `[dim6/promptset] LLM generation returned empty; using bank fallback.`
    );
  }

  return buildBankQueries(scanUrl, category);
}

function tryParseQueries(raw: string): PromptSetQuery[] {
  // Find a JSON array in the raw text. The model sometimes wraps in code
  // fences; strip them.
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
