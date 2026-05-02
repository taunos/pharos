// Slice 3b Dim 6 v2 — semantic affirmation judge.
//
// Why this exists (parser-bug postmortem 2026-05-02):
//
// The v1 parser scored cells via pure substring-matching — if the response
// contained the target host string, it counted as a citation. This is wrong
// in two failure modes that surfaced on the Astrant dogfood scan:
//
//   1. Refusals that name the domain back. Perplexity returned answers like
//      "No, astrant.io does not appear in any of the provided search results"
//      → the substring "astrant.io" matches → v1 scored 70/100 → cell
//      counted as a citation despite being an explicit non-recognition.
//
//   2. Confabulated mentions. OpenAI/Anthropic invented plausible feature
//      sets for unknown domains ("Astrant.io is a project management
//      platform with real-time updates...") → substring matches → scored as
//      a citation even though the model has no actual training-data signal
//      for the brand.
//
// The v2 fix routes every successful adapter response through a Workers AI
// judge BEFORE the substring scoring runs. The judge returns one of two
// terminal verdicts (AFFIRM / DENY) for the question "did this response
// affirmatively mention the target domain as a known/recommended option?"
//
//   - AFFIRM → run the existing substring-scoring (parser.ts scoreResponse).
//     The granular sub-checks still differentiate "passing mention" from
//     "clean named citation with URL."
//   - DENY   → cell scores 0 but stays MEASURABLE (clean cell, no citation).
//     Distinct from `unmeasurable`, which is excluded from the score formula.
//
// Judge failure (Workers AI errors twice or returns non-conforming output)
// → cell becomes `unmeasurable` (excluded from formula, with diagnostic
// notes). Honest under uncertainty: don't score a cell when we can't tell
// whether the response was affirmative or not.
//
// Judge cost: 1 Workers AI call per cell post-canary-refusal. Workers AI is
// binding-priced (effectively $0 per call vs the ~$0.02-0.05 of the model
// API call itself). Total per-audit overhead: ~40 Workers AI calls = ~0
// dollars, ~5-15s wall-time when fanned out alongside the cell batches.
//
// Engine version bumped dim6:v1 → dim6:v2 in types.ts. Cache prefix change
// invalidates every v1 cell automatically; no manual purge needed. Existing
// audits load with the legacy `dim6:v1` engine_version stamp on their
// citation_audit_response rows — downstream analysis can filter by
// engine_version to separate v1 (over-counted) from v2 (judge-gated) data.

const JUDGE_MODEL = "@cf/meta/llama-3.1-8b-instruct";

// Strict-output validator. The judge prompt forces the model to emit ONLY
// "AFFIRM" or "DENY" on its own line. Any deviation → validator fail.
const VERDICT_PATTERN = /\b(AFFIRM|DENY)\b/;

export type JudgeVerdict =
  | { kind: "affirm" }
  | { kind: "deny" }
  | { kind: "unmeasurable"; reason: string };

export interface JudgeEnv {
  AI: Ai;
}

function buildJudgePrompt(targetUrl: string, responseText: string): string {
  // Truncate the response to keep the judge prompt under Workers AI's input
  // budget. 2000 chars captures the lead paragraph + first body section,
  // which is where citation/refusal signal lives. The judge's output is
  // binary so longer input doesn't help accuracy.
  const truncated =
    responseText.length > 2000
      ? `${responseText.slice(0, 2000)}\n[...truncated for judge]`
      : responseText;

  return `You evaluate whether an AI assistant's response AFFIRMATIVELY mentions a target domain as a known, recommended, or recognized option.

Target domain: ${targetUrl}

Response to evaluate:
"""
${truncated}
"""

A response is AFFIRM if it:
- Describes the target domain's product/service as a recognized option in its category.
- Recommends or names the target domain among alternatives.
- Attributes specific features, customers, or capabilities to the target domain that the response treats as factual.

A response is DENY if it:
- Says the domain is unknown, unrecognized, or not in available sources.
- Confuses the domain with a similarly-named brand (e.g. astrant.io confused with astronaut.io / astronomer.io).
- Only repeats the domain name because the question asked about it, without affirming any knowledge of the brand.
- Says "no", "I'm not familiar", "no information", or equivalent disclaimers anywhere in the first paragraph.

Output ONE word, then stop. No preamble. No explanation. No quotes.

Answer:`;
}

async function callJudgeOnce(
  env: JudgeEnv,
  prompt: string
): Promise<{ ok: true; verdict: "AFFIRM" | "DENY" } | { ok: false; reason: string }> {
  try {
    const r = (await env.AI.run(JUDGE_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8,
      temperature: 0,
      seed: 42,
    })) as { response?: string };
    const raw = (r.response ?? "").trim();
    if (!raw) {
      return { ok: false, reason: "empty judge response" };
    }
    const m = raw.match(VERDICT_PATTERN);
    if (!m) {
      return {
        ok: false,
        reason: `non-conforming verdict: ${raw.slice(0, 60)}`,
      };
    }
    return { ok: true, verdict: m[1] as "AFFIRM" | "DENY" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `judge error: ${msg.slice(0, 80)}` };
  }
}

/**
 * Run the affirmation judge with a single retry. On hard failure (judge
 * returns non-conforming output twice), the verdict is `unmeasurable` —
 * caller treats the cell as excluded from the score formula.
 */
export async function judgeAffirmation(
  env: JudgeEnv,
  targetUrl: string,
  responseText: string
): Promise<JudgeVerdict> {
  const prompt = buildJudgePrompt(targetUrl, responseText);

  const first = await callJudgeOnce(env, prompt);
  if (first.ok) {
    return first.verdict === "AFFIRM" ? { kind: "affirm" } : { kind: "deny" };
  }

  // Retry once with a slightly more aggressive instruction.
  const retryPrompt = `${prompt}

REMINDER: Output ONLY the single word AFFIRM or DENY. Nothing else.`;
  const second = await callJudgeOnce(env, retryPrompt);
  if (second.ok) {
    return second.verdict === "AFFIRM" ? { kind: "affirm" } : { kind: "deny" };
  }

  return {
    kind: "unmeasurable",
    reason: `judge failed twice: first=${first.reason.slice(0, 60)}; retry=${second.reason.slice(0, 60)}`,
  };
}
