// Slice 3b Dim 6 — per-provider model adapters.
//
// Each adapter wraps one provider's chat-completion endpoint with a uniform
// `callModel(prompt) -> AdapterResult` signature. The TP-7 ladder
// (retries, validators, fallback) is layered on top in ladder.ts — adapters
// here are intentionally dumb: send request, decode response, classify outcome.
//
// Per-provider contract differences (locked decision 2 + Task 5 spec):
//
//   OpenAI (gpt-4o):
//     POST https://api.openai.com/v1/chat/completions
//     Authorization: Bearer ${OPENAI_API_KEY}
//     body: { model, messages, seed: 42, max_tokens: 800, temperature: 0 }
//     response: choices[0].message.content
//     truncation: choices[0].finish_reason === "length"
//
//   Anthropic (claude-sonnet, current latest):
//     POST https://api.anthropic.com/v1/messages
//     x-api-key: ${ANTHROPIC_API_KEY}
//     anthropic-version: 2023-06-01
//     body: { model, messages, max_tokens: 1024 (REQUIRED), temperature: 0 }
//     NO seed parameter (Anthropic does not expose seed)
//     response: content[0].text  -- content[0].type can be "text" or "tool_use"
//     truncation: stop_reason === "max_tokens"
//
//   Google (gemini-2.0-flash):
//     POST https://generativelanguage.googleapis.com/v1beta/models/
//          gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}
//     body: { contents, generationConfig: { maxOutputTokens: 800, temperature: 0 } }
//     NO seed parameter
//     response: candidates[0].content.parts[0].text
//     SAFETY: when finishReason === "SAFETY", candidates[0].content.parts may
//             be missing entirely. Treat as unmeasurable.
//     truncation: candidates[0].finishReason === "MAX_TOKENS"
//
//   Perplexity (sonar):
//     POST https://api.perplexity.ai/chat/completions
//     Authorization: Bearer ${PERPLEXITY_API_KEY}
//     body: { model, messages, seed: 42, max_tokens: 800, temperature: 0 }
//     NOTE: seed only valid on `sonar` (Perplexity's smaller model). DO NOT
//           pass seed to `sonar-pro` if you ever switch models.
//     response: choices[0].message.content
//     truncation: choices[0].finish_reason === "length"

import type { ModelId } from "./types";

export interface AdapterEnv {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
}

export type AdapterOutcome =
  | { kind: "ok"; text: string; truncated: boolean }
  | { kind: "network"; reason: string }                    // network/timeout/abort
  | { kind: "rate_limit"; reason: string; retryAfterSec: number | null } // 429
  | { kind: "server_error"; reason: string; status: number; retryAfterSec: number | null } // 5xx
  | { kind: "client_error"; reason: string; status: number } // 4xx other than 429
  | { kind: "decode_error"; reason: string }               // valid HTTP, undecipherable body
  | { kind: "safety"; reason: string };                    // model-side safety refusal

export interface AdapterResult {
  modelId: ModelId;
  outcome: AdapterOutcome;
}

const REQUEST_TIMEOUT_MS = 45_000;

// Defensive Retry-After parser. Header may be:
//   - integer seconds: "30"
//   - HTTP-date: "Wed, 01 May 2026 12:00:00 GMT"
//   - missing/null
// Returns capped seconds in [0, 30] inclusive — caller decides whether the
// raw value warrants a fallback (>30 short-circuits to fallback per Task 6).
//
// We return -1 to signal "header unparseable / absent" so the ladder can
// distinguish that case from a parsed-and-capped value.
export function parseRetryAfter(raw: string | null): number {
  if (!raw) return -1;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return -1;

  // Integer-seconds form
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 0) return -1;
    return n;
  }

  // HTTP-date form
  const ts = Date.parse(trimmed);
  if (Number.isFinite(ts)) {
    const deltaSec = Math.ceil((ts - Date.now()) / 1000);
    if (deltaSec < 0) return 0;
    return deltaSec;
  }

  return -1;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ── OpenAI ────────────────────────────────────────────────────────────────

export async function callOpenAI(
  env: AdapterEnv,
  prompt: string
): Promise<AdapterResult> {
  const modelId: ModelId = "openai:gpt-4o";
  if (!env.OPENAI_API_KEY) {
    return {
      modelId,
      outcome: { kind: "client_error", reason: "OPENAI_API_KEY not set", status: 0 },
    };
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          seed: 42,
          max_tokens: 800,
        }),
      }
    );
  } catch (e) {
    return {
      modelId,
      outcome: { kind: "network", reason: e instanceof Error ? e.message : String(e) },
    };
  }
  if (res.status === 429) {
    return {
      modelId,
      outcome: {
        kind: "rate_limit",
        reason: `OpenAI 429`,
        retryAfterSec: parseRetryAfter(res.headers.get("retry-after")),
      },
    };
  }
  if (res.status >= 500) {
    return {
      modelId,
      outcome: {
        kind: "server_error",
        reason: `OpenAI ${res.status}`,
        status: res.status,
        retryAfterSec: parseRetryAfter(res.headers.get("retry-after")),
      },
    };
  }
  if (!res.ok) {
    const body = await safeReadBody(res);
    return {
      modelId,
      outcome: { kind: "client_error", reason: `OpenAI ${res.status}: ${body.slice(0, 200)}`, status: res.status },
    };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    return {
      modelId,
      outcome: { kind: "decode_error", reason: `OpenAI body not JSON: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
  const obj = json as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = obj.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || text.length === 0) {
    return { modelId, outcome: { kind: "decode_error", reason: "OpenAI: empty content" } };
  }
  const truncated = choice?.finish_reason === "length";
  return { modelId, outcome: { kind: "ok", text, truncated } };
}

// ── Anthropic ─────────────────────────────────────────────────────────────

export async function callAnthropic(
  env: AdapterEnv,
  prompt: string
): Promise<AdapterResult> {
  const modelId: ModelId = "anthropic:claude-sonnet";
  if (!env.ANTHROPIC_API_KEY) {
    return {
      modelId,
      outcome: { kind: "client_error", reason: "ANTHROPIC_API_KEY not set", status: 0 },
    };
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          // Use the current-latest sonnet alias. Anthropic publishes a stable
          // alias `claude-sonnet-4-5` (the "current latest" as of model release
          // notes). If the alias rotates between deploys we accept the lift —
          // dim6:v1 cache key invalidates per-prompt anyway.
          model: "claude-sonnet-4-5",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1024, // REQUIRED for Anthropic — distinct from the other 3
          temperature: 0,
          // Anthropic does NOT accept a `seed` parameter. Don't add one.
        }),
      }
    );
  } catch (e) {
    return {
      modelId,
      outcome: { kind: "network", reason: e instanceof Error ? e.message : String(e) },
    };
  }
  if (res.status === 429) {
    return {
      modelId,
      outcome: {
        kind: "rate_limit",
        reason: `Anthropic 429`,
        retryAfterSec: parseRetryAfter(res.headers.get("retry-after")),
      },
    };
  }
  if (res.status >= 500) {
    return {
      modelId,
      outcome: {
        kind: "server_error",
        reason: `Anthropic ${res.status}`,
        status: res.status,
        retryAfterSec: parseRetryAfter(res.headers.get("retry-after")),
      },
    };
  }
  if (!res.ok) {
    const body = await safeReadBody(res);
    return {
      modelId,
      outcome: { kind: "client_error", reason: `Anthropic ${res.status}: ${body.slice(0, 200)}`, status: res.status },
    };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    return {
      modelId,
      outcome: { kind: "decode_error", reason: `Anthropic body not JSON: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
  const obj = json as {
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
  };
  const block = obj.content?.[0];
  // Defensive: Anthropic may emit content blocks of type "tool_use" if a
  // future tools wiring lands. Accept only "text" blocks, fall through to
  // decode_error otherwise.
  if (!block || block.type !== "text" || typeof block.text !== "string" || block.text.length === 0) {
    return {
      modelId,
      outcome: {
        kind: "decode_error",
        reason: `Anthropic: content[0] not text or empty (type=${block?.type ?? "missing"})`,
      },
    };
  }
  const truncated = obj.stop_reason === "max_tokens";
  return { modelId, outcome: { kind: "ok", text: block.text, truncated } };
}

// ── Google Gemini ─────────────────────────────────────────────────────────

export async function callGemini(
  env: AdapterEnv,
  prompt: string
): Promise<AdapterResult> {
  const modelId: ModelId = "google:gemini-2.0-flash";
  if (!env.GOOGLE_AI_API_KEY) {
    return {
      modelId,
      outcome: { kind: "client_error", reason: "GOOGLE_AI_API_KEY not set", status: 0 },
    };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(env.GOOGLE_AI_API_KEY)}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 800,
          // No seed parameter on Gemini.
        },
      }),
    });
  } catch (e) {
    return {
      modelId,
      outcome: { kind: "network", reason: e instanceof Error ? e.message : String(e) },
    };
  }
  if (res.status === 429) {
    return {
      modelId,
      outcome: {
        kind: "rate_limit",
        reason: `Gemini 429`,
        retryAfterSec: parseRetryAfter(res.headers.get("retry-after")),
      },
    };
  }
  if (res.status >= 500) {
    return {
      modelId,
      outcome: {
        kind: "server_error",
        reason: `Gemini ${res.status}`,
        status: res.status,
        retryAfterSec: parseRetryAfter(res.headers.get("retry-after")),
      },
    };
  }
  if (!res.ok) {
    const body = await safeReadBody(res);
    return {
      modelId,
      outcome: { kind: "client_error", reason: `Gemini ${res.status}: ${body.slice(0, 200)}`, status: res.status },
    };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    return {
      modelId,
      outcome: { kind: "decode_error", reason: `Gemini body not JSON: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
  const obj = json as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };
  const candidate = obj.candidates?.[0];
  if (!candidate) {
    return { modelId, outcome: { kind: "decode_error", reason: "Gemini: no candidates" } };
  }
  // Safety refusal: candidate.content.parts may be missing entirely. Treat
  // as a categorical "safety" outcome so the ladder can flag the cell
  // unmeasurable rather than retrying (re-prompting won't bypass the safety
  // filter).
  if (candidate.finishReason === "SAFETY") {
    return { modelId, outcome: { kind: "safety", reason: "Gemini SAFETY refusal" } };
  }
  const text = candidate.content?.parts?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) {
    return {
      modelId,
      outcome: {
        kind: "decode_error",
        reason: `Gemini: no text in parts (finishReason=${candidate.finishReason ?? "missing"})`,
      },
    };
  }
  const truncated = candidate.finishReason === "MAX_TOKENS";
  return { modelId, outcome: { kind: "ok", text, truncated } };
}

// ── Perplexity ────────────────────────────────────────────────────────────

export async function callPerplexity(
  env: AdapterEnv,
  prompt: string
): Promise<AdapterResult> {
  const modelId: ModelId = "perplexity:sonar";
  if (!env.PERPLEXITY_API_KEY) {
    return {
      modelId,
      outcome: { kind: "client_error", reason: "PERPLEXITY_API_KEY not set", status: 0 },
    };
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(
      "https://api.perplexity.ai/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          // seed is valid on `sonar` only; if you ever switch model to
          // sonar-pro REMOVE this line — passing seed there errors out.
          seed: 42,
          max_tokens: 800,
        }),
      }
    );
  } catch (e) {
    return {
      modelId,
      outcome: { kind: "network", reason: e instanceof Error ? e.message : String(e) },
    };
  }
  if (res.status === 429) {
    return {
      modelId,
      outcome: {
        kind: "rate_limit",
        reason: `Perplexity 429`,
        retryAfterSec: parseRetryAfter(res.headers.get("retry-after")),
      },
    };
  }
  if (res.status >= 500) {
    return {
      modelId,
      outcome: {
        kind: "server_error",
        reason: `Perplexity ${res.status}`,
        status: res.status,
        retryAfterSec: parseRetryAfter(res.headers.get("retry-after")),
      },
    };
  }
  if (!res.ok) {
    const body = await safeReadBody(res);
    return {
      modelId,
      outcome: { kind: "client_error", reason: `Perplexity ${res.status}: ${body.slice(0, 200)}`, status: res.status },
    };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    return {
      modelId,
      outcome: { kind: "decode_error", reason: `Perplexity body not JSON: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
  const obj = json as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = obj.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || text.length === 0) {
    return { modelId, outcome: { kind: "decode_error", reason: "Perplexity: empty content" } };
  }
  const truncated = choice?.finish_reason === "length";
  return { modelId, outcome: { kind: "ok", text, truncated } };
}

// ── Dispatch by model id ──────────────────────────────────────────────────

export async function callAdapter(
  env: AdapterEnv,
  modelId: ModelId,
  prompt: string
): Promise<AdapterResult> {
  switch (modelId) {
    case "openai:gpt-4o":
      return callOpenAI(env, prompt);
    case "anthropic:claude-sonnet":
      return callAnthropic(env, prompt);
    case "google:gemini-2.0-flash":
      return callGemini(env, prompt);
    case "perplexity:sonar":
      return callPerplexity(env, prompt);
  }
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
