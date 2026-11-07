import type { Env } from "../types";
import { parseStrictScore } from "./llm-safety";

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
// Bump this prefix whenever any caller's prompt template changes — old cache
// entries become unreachable and naturally re-populate from the new template.
// v2 (2026-11-04): injection-hardened prompts (nonce-delimited site text),
// strict output parsing, cache keyed on caller-supplied material.
export const CACHE_VERSION = "v2";
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Security pass 2026-11-04: hard cap on the prompt we send. Today's callers
// stay well under it (dim1 ~3.8k chars, dim4 ~3.4k); anything longer is not
// sent and scores like an AI failure.
export const MAX_PROMPT_CHARS = 6000;

// Security pass 2026-11-04: global soft cap on billable Workers AI calls per
// UTC day (KV read-modify-write, so concurrent bursts can overshoot a little;
// the best-effort IP rate limits only reduce that). Cache hits don't count. When spent,
// the call returns fallback:true exactly like an AI failure. Since 1.3.3 the
// scan-path callers (Dim 1 blockquote, Dim 4 FAQ) then mark the sub-check
// N/A "not measured" and ignore the default score.
export const DAILY_AI_CALL_CAP = 1000;

export function aiBudgetKey(now: Date = new Date()): string {
  return `ai:budget:${now.toISOString().slice(0, 10)}`;
}

async function getDailyAiCount(kv: KVNamespace): Promise<number> {
  const n = parseInt((await kv.get(aiBudgetKey())) ?? "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type EvalResult = { score: number; cached: boolean; raw?: string; fallback?: boolean };

export type EvalRequest = {
  // The prompt sent to the model. It carries a random per-call delimiter,
  // so it is NOT the cache key.
  prompt: string;
  // Stable cache-key material: a template id plus the cleaned site text.
  cacheKey: string;
  defaultScore?: number;
  // Count this call against DAILY_AI_CALL_CAP. Every scan-path caller (Dim 1
  // blockquote, Dim 4 FAQ) sets it.
  metered?: boolean;
  // 1.4.0: the number of items the prompt asks the model to rate (Dim 4 FAQ
  // questions). When set, a reply that scores each item on its own numbered
  // line ("1. 60 - ...", one line per item, in order) is accepted and
  // averaged; anything else is still held to the strict bare-integer rule.
  expectedCount?: number;
};

/** Output tokens for a bare score; a numbered reply gets room for each line. */
const BARE_MAX_TOKENS = 8;
const TOKENS_PER_NUMBERED_LINE = 24;
const MAX_NUMBERED_TOKENS = 200;

/**
 * 1.4.0: a per-item reply ("1. 60 - Sounds natural", "2) 75", one non-empty
 * line per item). Accepted only when there are exactly `count` lines, line i
 * starts with the index i (1-based) and a 0-100 score, and the score is not
 * glued to more digits or text. When the reply was cut at the token limit,
 * the last line must carry text after its score (its number could otherwise
 * be cut short). Returns the rounded average, or null.
 */
export function parseNumberedScores(raw: string, count: number, truncated = false): number | null {
  if (!Number.isInteger(count) || count < 1) return null;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length !== count) return null;
  let sum = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d{1,2})[.)]\s*(\d{1,3})(.*)$/.exec(lines[i]);
    if (!m || Number(m[1]) !== i + 1) return null;
    const n = Number(m[2]);
    const rest = m[3];
    if (n > 100) return null;
    if (rest !== "" && rest !== "." && !/^(?:\s*\/\s*100)?(?:\s|[-:,(–—])/.test(rest)) return null;
    if (truncated && i === lines.length - 1 && rest === "") return null;
    sum += n;
  }
  return Math.round(sum / count);
}

export async function evalWithCache(env: Env, req: EvalRequest): Promise<EvalResult> {
  const defaultScore = req.defaultScore ?? 50;
  const versionedKey = `llm:${CACHE_VERSION}:${MODEL}:${await sha256(req.cacheKey)}`;

  const cached = await env.CACHE.get(versionedKey);
  if (cached !== null) {
    const n = parseStrictScore(cached);
    if (n !== null) return { score: n, cached: true };
  }

  if (req.prompt.length > MAX_PROMPT_CHARS) {
    console.error(`[llm-eval] prompt over ${MAX_PROMPT_CHARS} chars (${req.prompt.length}); skipped, default score`);
    return { score: defaultScore, cached: false, fallback: true };
  }
  if (req.metered) {
    const used = await getDailyAiCount(env.CACHE);
    if (used >= DAILY_AI_CALL_CAP) {
      console.error(`[llm-eval] AI_BUDGET_EXHAUSTED: ${used}/${DAILY_AI_CALL_CAP} calls today; skipped, default score`);
      return { score: defaultScore, cached: false, fallback: true };
    }
    // Count the attempt before the call (we pay for failures too). Best-effort.
    try {
      await env.CACHE.put(aiBudgetKey(), String(used + 1), { expirationTtl: 60 * 60 * 48 });
    } catch (e) {
      console.error(`[llm-eval] failed to increment AI budget: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let raw: string;
  let truncated = false;
  const numbered = typeof req.expectedCount === "number" && req.expectedCount >= 1;
  const maxTokens = numbered
    ? Math.min(MAX_NUMBERED_TOKENS, BARE_MAX_TOKENS + TOKENS_PER_NUMBERED_LINE * (req.expectedCount as number))
    : BARE_MAX_TOKENS;
  try {
    const response = (await env.AI.run(MODEL, {
      messages: [{ role: "user", content: req.prompt }],
      max_tokens: maxTokens,
      temperature: 0,
      seed: 42,
    })) as { response?: string; usage?: { completion_tokens?: number } };
    raw = typeof response?.response === "string" ? response.response : "";
    const used = response?.usage?.completion_tokens;
    truncated = typeof used === "number" && used >= maxTokens;
  } catch {
    // Don't cache failures — transient AI errors shouldn't become permanent.
    return { score: defaultScore, cached: false, fallback: true };
  }

  // Strict: the whole output must be a bare integer 0-100. The old
  // first-integer-anywhere parse let an echoed payload ("100. Ignore...")
  // or chatter ("Score: 100") through. Non-conforming output is the default
  // score and is not cached, so a later scan can retry.
  const score = parseStrictScore(raw) ?? (numbered ? parseNumberedScores(raw, req.expectedCount as number, truncated) : null);
  if (score === null) return { score: defaultScore, cached: false, raw, fallback: true };

  await env.CACHE.put(versionedKey, String(score), { expirationTtl: CACHE_TTL_SECONDS });

  return { score, cached: false, raw };
}
