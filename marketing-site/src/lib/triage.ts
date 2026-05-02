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
  // Honeypot field. Renamed from `honeypot` to `referral_code` in Slice 2b
  // because `honeypot` is a heavily-fingerprinted name on bot-framework
  // skip-lists. `referral_code` is plausible-real-form-field that humans
  // skip without thinking. Excluded from `triageCacheKey` canonical hash
  // (see below) so the rename is cache-safe — no version bump needed.
  referral_code?: string;
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

// PRE-LAUNCH MODE — paid checkouts disabled site-wide. The standard + custom
// CTAs that previously pointed at Dodo checkout URLs now route to the audit
// waitlist (which captures URL + email via /api/waitlist) so prospects don't
// hit a "merchant offline" error and we still capture intent.
//
// To restore real checkouts, swap the URLs below back to:
//   standard: https://checkout.dodopayments.com/buy/pdt_0NdQE5vccUUgOHMsF6Pzz?quantity=1
//   custom:   https://checkout.dodopayments.com/buy/pdt_0NdQEI47SFpulVd0Wo5IP?quantity=1
export const TRIAGE_CTAS: Record<Recommendation, TriageCta> = {
  standard: {
    label: "Notify me when Standard Implementation launches",
    url: "/audit#waitlist",
    description:
      "Pre-launch — drop your URL and email and we'll let you know the moment Standard Implementation opens. Build is delivered within 24 hours of payment as a Git-applicable patch file you apply with `git am` in 5 minutes — no repo access needed from us.",
  },
  custom: {
    label: "Notify me when Custom scoping opens",
    url: "/audit#waitlist",
    description:
      "Pre-launch — drop your URL and email and we'll let you know the moment Custom opens. Custom is a $250 deposit credited toward final fixed quote (not an extra fee), 30-minute scoping call within 1 business day, fixed quote within 48 hours, build over 2–4 weeks.",
  },
  not_fit: {
    label: "Email us about your situation",
    url: "mailto:contact@astrant.io?subject=Astrant%20fit%20check%20%E2%80%94%20unusual%20case",
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
  return `triage:v2:${hex}`;
}

export function buildTriagePrompt(s: TriageSubmission): string {
  const factors =
    s.complexity_factors.length > 0 ? s.complexity_factors.join(", ") : "none";
  return `You are a fit-check analyst for Astrant, an Agent Discoverability service for B2B SaaS companies.

Astrant has three engagement options:

1. STANDARD IMPLEMENTATION ($1,299, automated, delivered in <24 hours)
   - Suitable for the 80% case: typical B2B SaaS sites with standard product/service offerings
   - Includes: llms.txt generation, baseline MCP server with standard tools (get_capabilities, get_pricing, get_case_studies, book_demo, check_llms_txt, score_url), OpenAPI spec if a public API is detectable, JSON-LD schema injection, baseline monitoring
   - Does NOT include: custom MCP tools, multi-region content, multi-language content, content rewrites beyond pricing/services pages, multi-stakeholder coordination

2. CUSTOM IMPLEMENTATION (from $4,999, human-led, 2-4 weeks typical; $250 deposit at booking that's credited toward the final fixed quote)
   - This is where ALL genuinely complex implementation needs go — never route them to not_fit
   - Custom triggers (any of these alone is enough; two or more makes custom almost certain): complex public APIs requiring tailored OpenAPI (10+ operations), multi-region or multi-language content, custom MCP tools specific to the business (industry inventory, real-time booking, customer-state exposure), major content rewrites (20+ pages), multi-stakeholder approvals (legal/ops/IT/marketing need a human liaison), aggressive deadlines under 2 weeks
   - Budget signal: $5K+ budget combined with any complexity factor → almost always custom

3. NOT A FIT (use ONLY for the four specific misalignment patterns below — never for "complex enough to warrant a call" or "needs more discussion")
   - White-label agencies seeking reseller deals (different conversation entirely, email follow-up)
   - Content-only sites without commercial intent (free Score tool covers most of what they need)
   - Projects so small they don't need professional implementation (personal blogs, hobby projects)
   - Misaligned expectations (asking for unrelated services like SEO copywriting, paid ads management, social media management)

DECISION RULE (apply strictly):
- not_fit is ONLY for the four patterns above. If a prospect is a B2B SaaS, B2C SaaS, e-commerce, or marketplace with genuine implementation needs — no matter how complex or how much "discussion" the project might warrant — they route to either standard or custom, never to not_fit.
- "Needs a conversation," "needs to discuss specifics," or "exceeds Standard capabilities" all mean custom, not not_fit.
- When uncertain between standard and custom, prefer custom. Surfacing a $250-deposit scoping call is always better than undersizing a complex project into a $1,299 standard build.

PROSPECT SUBMISSION:
- Site URL: ${s.site_url}
- Site type: ${s.site_type}
- What they need beyond Standard: ${s.custom_needs}
- Complexity factors checked: ${factors}
- Budget range: ${s.budget_range}
- Timeline: ${s.timeline}

EXAMPLES (study these — your output should match this pattern):

Example 1:
Submission: B2B SaaS site, "Just want to be findable by AI agents, nothing fancy," no complexity factors checked, budget under $5K, flexible timeline.
Output: {"recommendation": "standard", "explanation": "Your situation matches the 80% case our Standard Implementation is built for — typical B2B SaaS without special complexity. The $1,299 build covers everything you described and ships within 24 hours."}

Example 2:
Submission: B2B SaaS fintech, "Public API with 60+ operations across payments and accounts, MCP tools to expose customer-specific account state, content in 9 languages, legal sign-off required," complexity factors checked: multi-region, public API, custom MCP tools, multi-stakeholder, tight deadline; budget $25K+; timeline within a month.
Output: {"recommendation": "custom", "explanation": "Your fintech setup triggers five distinct Custom paths — 60+ API operations needing tailored OpenAPI, multi-region content, customer-state-exposing MCP tools, multi-stakeholder approvals, and a tight deadline. Each one alone would warrant Custom; together they make it the only fit."}

Example 3:
Submission: 60-person SEO agency, "We want a white-label/reseller agreement to package your methodology under our brand and resell to our 180+ clients," no complexity factors, no specific budget, flexible timeline.
Output: {"recommendation": "not_fit", "explanation": "Reseller and white-label arrangements are a separate business conversation from our standard implementation packages. Drop us an email and we'll discuss whether a partnership makes sense."}

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_COMPLEXITY_FACTORS: ReadonlySet<string> = new Set(COMPLEXITY_FACTORS);

export type ValidationResult =
  | { ok: true; value: TriageSubmission }
  | { ok: false; error: string };

export function validateSubmission(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.site_url !== "string" || b.site_url.trim().length === 0) {
    return { ok: false, error: "site_url is required." };
  }
  try {
    new URL(b.site_url);
  } catch {
    return { ok: false, error: "site_url must be a valid URL." };
  }

  if (typeof b.site_type !== "string" || b.site_type.trim().length === 0) {
    return { ok: false, error: "site_type is required." };
  }

  if (typeof b.custom_needs !== "string") {
    return { ok: false, error: "custom_needs is required (50–2000 chars)." };
  }
  const len = b.custom_needs.trim().length;
  if (len < 50 || len > 2000) {
    return {
      ok: false,
      error: `custom_needs must be 50–2000 chars (got ${len}).`,
    };
  }

  if (!Array.isArray(b.complexity_factors)) {
    return { ok: false, error: "complexity_factors must be an array." };
  }
  if (!b.complexity_factors.every((x) => typeof x === "string")) {
    return { ok: false, error: "complexity_factors must be an array of strings." };
  }
  for (const f of b.complexity_factors as string[]) {
    if (!VALID_COMPLEXITY_FACTORS.has(f)) {
      return {
        ok: false,
        error: `Invalid complexity_factors entry "${f}". Each value must be one of: ${COMPLEXITY_FACTORS.map((x) => `"${x}"`).join(", ")}.`,
      };
    }
  }

  if (typeof b.budget_range !== "string" || b.budget_range.trim().length === 0) {
    return { ok: false, error: "budget_range is required." };
  }
  if (typeof b.timeline !== "string" || b.timeline.trim().length === 0) {
    return { ok: false, error: "timeline is required." };
  }

  if (b.email !== undefined) {
    if (typeof b.email !== "string") {
      return { ok: false, error: "email must be a string if provided." };
    }
    if (b.email.length > 0 && !EMAIL_RE.test(b.email)) {
      return {
        ok: false,
        error:
          "Invalid email format. Either omit the email field or provide a valid address.",
      };
    }
  }

  if (b.referral_code !== undefined && typeof b.referral_code !== "string") {
    return { ok: false, error: "referral_code must be a string." };
  }

  return { ok: true, value: b as unknown as TriageSubmission };
}

// Back-compat type-guard wrapper — kept for callers that only need a boolean.
export function isValidSubmission(body: unknown): body is TriageSubmission {
  return validateSubmission(body).ok;
}
