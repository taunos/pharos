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

export type EvalResult = { score: number; cached: boolean; raw?: string; fallback?: boolean };

export type EvalRequest = {
  // The prompt sent to the model. It carries a random per-call delimiter,
  // so it is NOT the cache key.
  prompt: string;
  // Stable cache-key material: a template id plus the cleaned site text.
  cacheKey: string;
  defaultScore?: number;
};

export async function evalWithCache(env: Env, req: EvalRequest): Promise<EvalResult> {
  const defaultScore = req.defaultScore ?? 50;
  const versionedKey = `llm:${CACHE_VERSION}:${MODEL}:${await sha256(req.cacheKey)}`;

  const cached = await env.CACHE.get(versionedKey);
  if (cached !== null) {
    const n = parseStrictScore(cached);
    if (n !== null) return { score: n, cached: true };
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
