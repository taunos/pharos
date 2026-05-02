// Dim 6 — Citation Visibility (Slice 3b, free-tier scanner branch ONLY).
//
// CAPABILITY SEPARATION INVARIANT (locked decision 1):
// This module is STANDALONE. It MUST NOT import from marketing-site/src/lib/dim6/.
// It MUST NOT make ANY outbound calls to api.openai.com / api.anthropic.com /
// generativelanguage.googleapis.com / api.perplexity.ai. The scanner Worker
// has zero of OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_AI_API_KEY /
// PERPLEXITY_API_KEY — verified at deploy time.
//
// What this module emits: a static demo-preview DimensionResult with na:true,
// so the composite math drops Dim 6 from the formula (renormalizes over the
// other 5). Free-tier users see a teaser; the real audit ships with the $79
// audit. Demo content is duplicated here intentionally — the marketing-site
// has its own copy in marketing-site/src/lib/dim6/disclosure.ts. The two
// strings should stay close in spirit but they don't have to be byte-equal
// (the disclosure-mirror invariant only applies to mcp-server's mirror file).
//
// Future: when paid-tier scans go through the scanner directly (today they
// flow through audit-fulfill, which calls scanner with tier=paid AND ALSO
// runs Dim 6 separately), this stub stays as the FREE branch. Paid Dim 6
// invocation lives in audit-fulfill.

import type { DimensionResult, ScanTier } from "../types";

const FREE_TIER_DEMO_NOTE =
  "Citation Visibility (Dim 6) measures what hosted models actually say " +
  "about your domain — the dimension Cloudflare's Agent Readiness Score " +
  "cannot see. Free Score shows a static demo preview only; the live " +
  "4-model audit (OpenAI GPT-4o, Anthropic Claude, Google Gemini, " +
  "Perplexity Sonar — ~10 prompts, ~40 cells per audit) ships with the " +
  "$79 Audit. Sample output: GPT-4o cites your domain 6/10 times, Claude " +
  "4/10, Gemini 2/10, Perplexity 7/10 — aggregate 47/100 D+. (This is a " +
  "static example; your live audit measures your domain across these " +
  "4 models.)";

/**
 * Free-tier Dim 6: returns na:true with a demo-preview note. The composite
 * math drops it from the formula automatically (SPEC_WEIGHTS renormalizes
 * over the remaining dimensions). Paid-tier Dim 6 happens in audit-fulfill,
 * not here.
 *
 * The `tier` arg is accepted for symmetry with the other runDimN signatures
 * but ignored — the scanner's free-tier branch never escalates to a real
 * audit. If audit-fulfill ever flows paid scans back through this entry
 * point (it doesn't today), the right behavior is still to return na:true
 * here and let audit-fulfill splice in its own paid Dim 6 result.
 */
export async function runDim6(
  url: string,
  tier: ScanTier
): Promise<DimensionResult> {
  void url;
  void tier;
  return {
    dimension_id: 6,
    dimension_name: "Citation Visibility",
    score: 0,
    grade: "F",
    na: true,
    sub_checks: [
      {
        id: "free_tier_dim6_preview",
        name: "Citation Visibility (free-tier preview)",
        weight: 1,
        score: 0,
        passed: false,
        notes: FREE_TIER_DEMO_NOTE,
        na: true,
      },
    ],
  };
}
