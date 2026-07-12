import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  TRIAGE_CTAS,
  buildTriagePrompt,
  fallbackResponse,
  parseLlmJson,
  triageCacheKey,
  validateSubmission,
  type Recommendation,
  type TriageResponse,
} from "@/lib/triage";
import { hashEmailForLog } from "@/lib/score-tokens";
import { normalizeEmail } from "@/lib/email-normalize";
import {
  checkTriageIpRateLimit,
  checkTriageCanonicalRateLimit,
} from "@/lib/rate-limit-kv";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

interface TriageEnv {
  TRIAGE_CACHE: KVNamespace;
  AI: Ai;
  UNSUBSCRIBE_SECRET?: string;
  // Privacy (OD#7): HMAC secret to pseudonymize IP in rate-limit keys.
  RATE_LIMIT_HASH_SECRET?: string;
}

function buildResponse(
  recommendation: Recommendation,
  explanation: string
): TriageResponse {
  return {
    ok: true,
    recommendation,
    explanation,
    cta: TRIAGE_CTAS[recommendation],
  };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Honeypot: if filled, return a fake standard recommendation silently.
  // Don't call the LLM, don't log, don't cache.
  if (
    body &&
    typeof body === "object" &&
    typeof (body as { referral_code?: unknown }).referral_code === "string" &&
    ((body as { referral_code: string }).referral_code.trim().length > 0)
  ) {
    return NextResponse.json(
      buildResponse(
        "standard",
        "Standard Implementation looks like a good fit based on your submission."
      )
    );
  }

  const env = getCloudflareContext().env as unknown as TriageEnv;

  // F-12 per-IP rate limit (10/hour fixed UTC bucket). MUST run AFTER honeypot
  // check above so honeypot-filled submissions don't reveal rate-limit state.
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipRl = await checkTriageIpRateLimit(env.TRIAGE_CACHE, ip, env.RATE_LIMIT_HASH_SECRET);
  if (!ipRl.allowed) {
    if (ipRl.misconfigured) {
      console.error("RATE_LIMIT_MISCONFIGURED: RATE_LIMIT_HASH_SECRET is not set");
      return NextResponse.json({ ok: false, error: "MISCONFIGURED" }, { status: 503 });
    }
    return NextResponse.json(
      { ok: false, error: "Too many requests. Try again in an hour." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  const validated = validateSubmission(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }
  const submission = validated.value;
  // F-01: normalize the optional email before any downstream use (cache key
  // is computed without email anyway, but log redaction must hash the
  // canonical form so the same address always produces the same hash).
  if (submission.email) {
    submission.email = normalizeEmail(submission.email);
  }
  const key = await triageCacheKey(submission);

  // Cache lookup
  const cached = await env.TRIAGE_CACHE.get(key);
  if (cached !== null) {
    try {
      const parsed = JSON.parse(cached) as {
        recommendation: Recommendation;
        explanation: string;
      };
      return NextResponse.json(
        buildResponse(parsed.recommendation, parsed.explanation)
      );
    } catch {
      // fall through to fresh evaluation if cached payload is corrupt
    }
  }

  // F-12 per-canonical rate limit (1/hour cooldown on identical canonical
  // hash). AFTER cache miss but BEFORE LLM call so duplicate submissions
  // can't repeatedly burn LLM cycles.
  const canonRl = await checkTriageCanonicalRateLimit(env.TRIAGE_CACHE, key);
  if (!canonRl.allowed) {
    return NextResponse.json(
      { ok: false, error: "This submission was already analyzed recently. Try again in an hour or vary the inputs." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  // Cache miss — call Workers AI
  const prompt = buildTriagePrompt(submission);
  let raw = "";
  try {
    const r = (await env.AI.run(MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0,
      seed: 42,
    })) as { response?: string };
    raw = r.response ?? "";
  } catch (err) {
    console.error("[triage] AI call failed:", err instanceof Error ? err.message : String(err));
    const fallback = fallbackResponse();
    return NextResponse.json(
      buildResponse(fallback.recommendation, fallback.explanation)
    );
  }

  const parsed = parseLlmJson(raw);
  const result = parsed ?? fallbackResponse();

  if (!parsed) {
    console.error(`[triage] LLM JSON parse failed; raw="${raw.slice(0, 200)}"`);
  }

  // Cache the parsed result for 30 days (don't cache fallbacks — they're transient)
  if (parsed) {
    await env.TRIAGE_CACHE.put(
      key,
      JSON.stringify({ recommendation: result.recommendation, explanation: result.explanation }),
      { expirationTtl: CACHE_TTL_SECONDS }
    );
  }

  if (submission.email) {
    // F-04: never log raw email. Hash with UNSUBSCRIBE_SECRET when bound;
    // fall back to "[unsalted]" marker so a missing-binding error is loud.
    // The marketing-site Worker already has UNSUBSCRIBE_SECRET bound (Slice
    // 2b); verify wrangler.jsonc exposes it to this route.
    const emailHash = env.UNSUBSCRIBE_SECRET
      ? await hashEmailForLog(submission.email, env.UNSUBSCRIBE_SECRET)
      : "[unsalted]";
    console.error(
      `[triage] new submission url=${submission.site_url} email_hash=${emailHash} → ${result.recommendation}`
    );
  }

  return NextResponse.json(
    buildResponse(result.recommendation, result.explanation)
  );
}
