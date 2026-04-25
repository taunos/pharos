import type { Env } from "../types";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
// Bump this prefix whenever any caller's prompt template changes — old cache
// entries become unreachable and naturally re-populate from the new template.
const CACHE_VERSION = "v1";
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type EvalResult = { score: number; cached: boolean; raw?: string };

export async function evalWithCache(
  env: Env,
  prompt: string,
  defaultScore = 50
): Promise<EvalResult> {
  const versionedKey = `llm:${CACHE_VERSION}:${MODEL}:${await sha256(prompt)}`;

  const cached = await env.CACHE.get(versionedKey);
  if (cached !== null) {
    const n = parseInt(cached, 10);
    return { score: Number.isFinite(n) ? n : defaultScore, cached: true };
  }

  let raw: string;
  try {
    const response = (await env.AI.run(MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8,
      temperature: 0,
      seed: 42,
    })) as { response?: string };
    raw = response.response ?? "";
  } catch {
    // Don't cache failures — transient AI errors shouldn't become permanent.
    return { score: defaultScore, cached: false };
  }

  const match = raw.match(/\d+/);
  const score = match ? Math.min(100, Math.max(0, parseInt(match[0], 10))) : defaultScore;

  await env.CACHE.put(versionedKey, String(score), { expirationTtl: CACHE_TTL_SECONDS });

  return { score, cached: false, raw };
}
