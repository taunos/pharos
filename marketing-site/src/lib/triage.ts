// Triage layer for the /custom page: classifies a prospect submission
// into Standard / Custom / Not-fit using Workers AI, cached deterministically
// by canonical-submission hash so the same answers always produce the same
// recommendation.

export const RECOMMENDATIONS = ["standard", "custom", "not_fit"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export type TriageSubmission = {
  site_url: string;
  site_type: string;
  custom_needs: string;
  complexity_factors: string[];
  budget_range: string;
  timeline: string;
  email?: string;
  honeypot?: string;
};

export type TriageCta = {
  label: string;
  url: string;
  description: string;
};

export type TriageResponse = {
  ok: true;
  recommendation: Recommendation;
  explanation: string;
  cta: TriageCta;
  cached: boolean;
};

export const TRIAGE_CTAS: Record<Recommendation, TriageCta> = {
  standard: {
    label: "Buy Standard Implementation — $1,299",
    url: "https://checkout.dodopayments.com/buy/pdt_0NdQE5vccUUgOHMsF6Pzz?quantity=1",
    description:
      "Pay, paste your URL, answer 5 quick scoping questions. Build delivered as a PR within 24 hours.",
  },
  custom: {
    label: "Book your Custom scoping call ($250 deposit)",
    url: "https://checkout.dodopayments.com/buy/pdt_0NdQEI47SFpulVd0Wo5IP?quantity=1",
    description:
      "$250 deposit secures your slot — credited toward your final fixed quote, not an extra fee. 30-minute scoping call within 1 business day; fixed quote within 48 hours. Build delivered over 2-4 weeks with weekly progress updates.",
  },
  not_fit: {
    label: "Email us about your situation",
    url: "mailto:hello@pharos.dev?subject=Pharos%20fit%20check%20%E2%80%94%20unusual%20case",
    description:
      "Quick email exchange to explore whether there's a different way we can help, or point you to better-suited alternatives.",
  },
};

export const HEADINGS: Record<Recommendation, string> = {
  standard: "Standard Implementation fits",
  custom: "Custom is the right path",
  not_fit: "We're not the right fit",
};

export const SITE_TYPES = [
  "B2B SaaS",
  "B2C SaaS",
  "E-commerce",
  "Marketplace",
  "Content / Media",
  "Agency / Service business",
  "Other",
] as const;

export const COMPLEXITY_FACTORS = [
  "Multi-region or multi-language content",
  "Public API requiring tailored OpenAPI work (10+ operations)",
  "Custom MCP tools beyond standard get_capabilities/get_pricing/etc.",
  "Major content rewrites (20+ pages)",
  "Multi-stakeholder approvals (legal / IT / ops involvement)",
  "Tight deadline (need delivery within 2 weeks)",
  "None of these — we just want a deeper-than-Standard build",
] as const;

export const BUDGET_RANGES = [
  "Under $5,000 — exploring options",
  "$5,000–$10,000",
  "$10,000–$25,000",
  "$25,000+",
  "Don't know yet",
] as const;

export const TIMELINES = [
  "Within 2 weeks (rush)",
  "Within a month",
  "1–3 months",
  "Flexible / no specific deadline",
] as const;

export async function triageCacheKey(s: TriageSubmission): Promise<string> {
  const canonical = {
    site_url: s.site_url.toLowerCase().trim(),
    site_type: s.site_type,
    custom_needs: s.custom_needs.trim(),
    complexity_factors: [...s.complexity_factors].sort(),
    budget_range: s.budget_range,
    timeline: s.timeline,
  };
  const buf = new TextEncoder().encode(JSON.stringify(canonical));
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `triage:v1:${hex}`;
}

export function buildTriagePrompt(s: TriageSubmission): string {
  const factors =
    s.complexity_factors.length > 0 ? s.complexity_factors.join(", ") : "none";
  return `You are a fit-check analyst for Pharos, an Agent Discoverability service for B2B SaaS companies.

Pharos has three engagement options:

1. STANDARD IMPLEMENTATION ($1,299, automated, delivered in <24 hours)
   - Suitable for the 80% case: typical B2B SaaS sites with standard product/service offerings
   - Includes: llms.txt generation, baseline MCP server with standard tools (get_capabilities, get_pricing, get_case_studies, book_demo, check_llms_txt, score_url), OpenAPI spec if a public API is detectable, JSON-LD schema injection, baseline monitoring
   - Does NOT include: custom MCP tools, multi-region content, multi-language content, content rewrites beyond pricing/services pages, multi-stakeholder coordination

2. CUSTOM IMPLEMENTATION (from $5,000, human-led, 2-4 weeks typical; $250 deposit at booking that's credited toward the final fixed quote)
   - Suitable when standard tier insufficient
   - Genuine Custom triggers: complex public APIs requiring tailored OpenAPI (10+ operations), multi-region or multi-language content, custom MCP tools specific to the business (industry inventory, real-time booking, etc.), major content rewrites (20+ pages), multi-stakeholder approvals (legal/ops/IT/marketing teams need a human liaison), aggressive deadlines under 2 weeks

3. NOT A FIT
   - White-label agencies seeking reseller deals (different conversation, email follow-up)
   - Content-only sites without commercial intent (free Score tool covers most of what they need)
   - Projects so small they don't need professional implementation (e.g., personal blogs)
   - Misaligned expectations (asking for unrelated services like SEO copywriting, paid ads management, etc.)

PROSPECT SUBMISSION:
- Site URL: ${s.site_url}
- Site type: ${s.site_type}
- What they need beyond Standard: ${s.custom_needs}
- Complexity factors checked: ${factors}
- Budget range: ${s.budget_range}
- Timeline: ${s.timeline}

Decide which option fits best. Return ONLY a JSON object with this exact shape, no markdown, no preamble, no explanation outside the JSON:

{"recommendation": "standard" | "custom" | "not_fit", "explanation": "2-3 sentence explanation addressed directly to the prospect, mentioning specific details from their submission"}`;
}

export function parseLlmJson(raw: string):
  | { recommendation: Recommendation; explanation: string }
  | null {
  // Locate the first {...} JSON object in the response — models sometimes wrap.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as {
      recommendation?: string;
      explanation?: string;
    };
    if (
      typeof parsed.recommendation === "string" &&
      RECOMMENDATIONS.includes(parsed.recommendation as Recommendation) &&
      typeof parsed.explanation === "string" &&
      parsed.explanation.trim().length > 0
    ) {
      return {
        recommendation: parsed.recommendation as Recommendation,
        explanation: parsed.explanation.trim(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function fallbackResponse(): {
  recommendation: Recommendation;
  explanation: string;
} {
  return {
    recommendation: "custom",
    explanation:
      "We couldn't auto-route your submission — let's talk through it on a call. Booking the $250 deposit slot below is the safe bet; it's credited toward your final fixed quote.",
  };
}

export function isValidSubmission(body: unknown): body is TriageSubmission {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (typeof b.site_url !== "string" || b.site_url.trim().length === 0) return false;
  try {
    new URL(b.site_url);
  } catch {
    return false;
  }
  if (typeof b.site_type !== "string" || b.site_type.trim().length === 0) return false;
  if (typeof b.custom_needs !== "string") return false;
  const len = b.custom_needs.trim().length;
  if (len < 50 || len > 500) return false;
  if (!Array.isArray(b.complexity_factors)) return false;
  if (!b.complexity_factors.every((x) => typeof x === "string")) return false;
  if (typeof b.budget_range !== "string" || b.budget_range.trim().length === 0) return false;
  if (typeof b.timeline !== "string" || b.timeline.trim().length === 0) return false;
  if (b.email !== undefined && typeof b.email !== "string") return false;
  if (b.honeypot !== undefined && typeof b.honeypot !== "string") return false;
  return true;
}
