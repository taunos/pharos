// F2 v6.1 D15 — shared trust-ladder primitives for F2 generators.
//
// Mirrors `audit-pipeline.ts` `enrichGap` engine v3 structure per V-C V-read:
//   cache check → call model → validate → retry once with feedback → deterministic fallback
//
// Cache: SESSIONS KV with `f2:<generator>:v1:<sha256>` prefixes (per spec v6.1 D15 +
// Codex MED clarification — reuse SESSIONS, not a new LLM_CACHE binding).
//
// v1.0 posture: every generator's `callModel` is gated behind F2_LLM_ENABLED flag.
// When unset (default), fallback fires immediately — customer gets deterministic,
// audit-disciplined artifacts. v1.1+ tunes prompts + flips the flag per generator.
// Per `feedback_llm_call_trust_pattern.md` + spec D10 (fully automated v1).

export interface F2LlmEnv {
  AI?: Ai;  // CF Workers AI binding (optional v1.0; required when F2_LLM_ENABLED)
  SESSIONS: KVNamespace;
  F2_LLM_ENABLED?: string;  // "true" enables LLM call path; default falls through to deterministic
}

const CACHE_TTL_SEC = 30 * 24 * 60 * 60;  // 30 days — matches audit-pipeline.ts REMEDIATION_CACHE_TTL

export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

// Canonical input hash — sorts keys lexicographically before stringify so equivalent
// inputs always produce the same cache key (per spec D15 + CLI NIT-2 v5).
export async function canonicalInputHash(input: Record<string, unknown>): Promise<string> {
  const sortedKeys = Object.keys(input).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of sortedKeys) sorted[k] = input[k];
  return sha256Hex(JSON.stringify(sorted));
}

export type ValidatorResult = { valid: true } | { valid: false; reason: string };
export type Validator<T> = (output: T) => ValidatorResult;

export interface GenerateWithTrustLadderOpts<T> {
  engineVersion: string;          // e.g., "f2:llms-txt:v1"
  cacheKeyInput: Record<string, unknown>;
  callModel: () => Promise<T | null>;
  validators: Array<Validator<T>>;
  retryWithFeedback: (failureReason: string) => Promise<T | null>;
  fallback: () => T;
  serialize: (value: T) => string;
  deserialize: (raw: string) => T;
}

export interface GenerateResult<T> {
  ok: true;
  value: T;
  source: "cache" | "llm" | "llm-retry" | "fallback";
}

export async function generateWithTrustLadder<T>(
  env: F2LlmEnv,
  opts: GenerateWithTrustLadderOpts<T>,
): Promise<GenerateResult<T>> {
  const inputHash = await canonicalInputHash(opts.cacheKeyInput);
  const cacheKey = `${opts.engineVersion}:${inputHash}`;

  // 1. Cache hit?
  try {
    const cached = await env.SESSIONS.get(cacheKey);
    if (cached !== null) {
      return { ok: true, value: opts.deserialize(cached), source: "cache" };
    }
  } catch {
    // KV hiccup — fall through to generate
  }

  const llmEnabled = env.F2_LLM_ENABLED === "true";

  if (llmEnabled) {
    // 2. Generate (first attempt)
    const first = await opts.callModel();
    if (first !== null) {
      const firstValid = runValidators(first, opts.validators);
      if (firstValid.valid) {
        await cacheWrite(env.SESSIONS, cacheKey, opts.serialize(first));
        return { ok: true, value: first, source: "llm" };
      }
      // 3. Retry once with validator-feedback
      const retry = await opts.retryWithFeedback(firstValid.reason);
      if (retry !== null) {
        const retryValid = runValidators(retry, opts.validators);
        if (retryValid.valid) {
          await cacheWrite(env.SESSIONS, cacheKey, opts.serialize(retry));
          return { ok: true, value: retry, source: "llm-retry" };
        }
        console.warn(
          `F2_TRUST_LADDER_FALLBACK engine=${opts.engineVersion} first=${firstValid.reason.slice(0, 100)} retry=${retryValid.reason.slice(0, 100)}`,
        );
      } else {
        console.warn(`F2_TRUST_LADDER_RETRY_EMPTY engine=${opts.engineVersion}`);
      }
    } else {
      console.warn(`F2_TRUST_LADDER_FIRST_EMPTY engine=${opts.engineVersion}`);
    }
  }

  // 4. Deterministic fallback (always safe; never hallucinated)
  const fallback = opts.fallback();
  await cacheWrite(env.SESSIONS, cacheKey, opts.serialize(fallback));
  return { ok: true, value: fallback, source: "fallback" };
}

function runValidators<T>(value: T, validators: Array<Validator<T>>): ValidatorResult {
  for (const v of validators) {
    const r = v(value);
    if (!r.valid) return r;
  }
  return { valid: true };
}

async function cacheWrite(kv: KVNamespace, key: string, value: string): Promise<void> {
  try {
    await kv.put(key, value, { expirationTtl: CACHE_TTL_SEC });
  } catch {
    // KV write failure shouldn't block customer delivery
  }
}

// Shared input shape for the 4 patch-time generators (everything except audit-recs).
export interface PatchTimeGeneratorInput {
  brand_name: string;
  domain: string;
  category: string;
  competitors: string[];
  baseline_scan_summary: string;  // short summary string; full scan available via baseline_scan_id
}
