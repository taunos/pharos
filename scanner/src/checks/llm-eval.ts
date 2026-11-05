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
// the sub-check gets the same default score / note as an AI failure.
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
};

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
  try {
    const response = (await env.AI.run(MODEL, {
      messages: [{ role: "user", content: req.prompt }],
      max_tokens: 8,
      temperature: 0,
      seed: 42,
    })) as { response?: string };
    raw = typeof response?.response === "string" ? response.response : "";
  } catch {
    // Don't cache failures — transient AI errors shouldn't become permanent.
    return { score: defaultScore, cached: false, fallback: true };
  }

  // Strict: the whole output must be a bare integer 0-100. The old
  // first-integer-anywhere parse let an echoed payload ("100. Ignore...")
  // or chatter ("Score: 100") through. Non-conforming output is the default
  // score and is not cached, so a later scan can retry.
  const score = parseStrictScore(raw);
  if (score === null) return { score: defaultScore, cached: false, raw, fallback: true };

  await env.CACHE.put(versionedKey, String(score), { expirationTtl: CACHE_TTL_SECONDS });

  return { score, cached: false, raw };
}
