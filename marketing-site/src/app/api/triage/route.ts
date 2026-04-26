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

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

interface TriageEnv {
  TRIAGE_CACHE: KVNamespace;
  AI: Ai;
}

function buildResponse(
  recommendation: Recommendation,
  explanation: string,
  cached: boolean
): TriageResponse {
  return {
    ok: true,
    recommendation,
    explanation,
    cta: TRIAGE_CTAS[recommendation],
    cached,
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
    typeof (body as { honeypot?: unknown }).honeypot === "string" &&
    ((body as { honeypot: string }).honeypot.trim().length > 0)
  ) {
    return NextResponse.json(
      buildResponse(
        "standard",
        "Standard Implementation looks like a good fit based on your submission.",
        false
      )
    );
  }

  const validated = validateSubmission(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }
  const submission = validated.value;
  const env = getCloudflareContext().env as unknown as TriageEnv;
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
        buildResponse(parsed.recommendation, parsed.explanation, true)
      );
    } catch {
      // fall through to fresh evaluation if cached payload is corrupt
    }
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
      buildResponse(fallback.recommendation, fallback.explanation, false)
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
    console.error(
      `[triage] new submission url=${submission.site_url} email=${submission.email} → ${result.recommendation}`
    );
  }

  return NextResponse.json(
    buildResponse(result.recommendation, result.explanation, false)
  );
}
