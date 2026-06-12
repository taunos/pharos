// F2 v6.1 D15 — Day-N audit recommendations generator (fires at Day 30/60/90).
//
// Engine version: f2:audit-recs:v1
// Output: AuditRecsOutput { whatChanged, trajectoryInterpretation, recommendations }
// v1.0: deterministic only. LLM-tuned in v1.1+ with dogfood audit-PDF corpus.

import {
  generateWithTrustLadder,
  type F2LlmEnv,
} from "./f2-llm-helpers";

const ENGINE_VERSION = "f2:audit-recs:v1";

export interface AuditRecsInput {
  brand_name: string;
  domain: string;
  day_n: 30 | 60 | 90;
  baseline_scan_summary: string;
  current_scan_summary: string;
  cite_share_baseline_pct: number;
  cite_share_current_pct: number;
}

export interface AuditRecsOutput {
  whatChanged: string;
  trajectoryInterpretation: string;
  recommendations: string[];
}

export async function generateAuditRecs(
  env: F2LlmEnv,
  input: AuditRecsInput,
): Promise<AuditRecsOutput> {
  const result = await generateWithTrustLadder<AuditRecsOutput>(env, {
    engineVersion: ENGINE_VERSION,
    cacheKeyInput: input as unknown as Record<string, unknown>,
    callModel: async () => null,           // v1.0: deterministic only
    validators: [],
    retryWithFeedback: async () => null,
    fallback: () => buildDeterministicRecs(input),
    serialize: (r) => JSON.stringify(r),
    deserialize: (s) => JSON.parse(s) as AuditRecsOutput,
  });
  return result.value;
}

// Audit-disciplined deterministic copy:
//   - Day 30 framed as "early signal, not outcome"
//   - Day 90 framed as "outcome + decision point"
//   - cite-share trajectory framed honestly (delta + range note, no promises)
function buildDeterministicRecs(input: AuditRecsInput): AuditRecsOutput {
  const delta = input.cite_share_current_pct - input.cite_share_baseline_pct;
  const sign = delta > 0 ? "+" : "";
  const dayLabel = `Day ${input.day_n}`;

  const whatChanged = `Scanner re-scan compared to your pre-implementation baseline. Cite-share across the 4 major-model providers moved ${sign}${delta.toFixed(1)} percentage points (${input.cite_share_baseline_pct.toFixed(1)}% → ${input.cite_share_current_pct.toFixed(1)}%).`;

  let trajectoryInterpretation: string;
  if (input.day_n === 30) {
    trajectoryInterpretation = `${dayLabel} is early signal, not outcome. Cite-share for B2B SaaS sites typically moves measurably between months 2 and 6 of consistent agent-discoverability surface area. A small or zero delta at Day 30 is normal — the implementation surface is in place; agent training corpora and RAG indexes update on their own cadence.`;
  } else if (input.day_n === 60) {
    trajectoryInterpretation = `${dayLabel} is mid-arc. Cite-share movement is starting to be discriminable from baseline noise; trend direction over the next 30 days is the strongest signal for ongoing-measurement value.`;
  } else {
    trajectoryInterpretation = `${dayLabel} is the outcome reading. Your full quarterly arc is visible — whether cite-share moved meaningfully, whether your implementation surface needs iteration, whether ongoing measurement via Standard is worth continuing.`;
  }

  const recommendations: string[] = [];
  if (input.day_n === 30 || input.day_n === 60) {
    recommendations.push("Stay the course — the implementation surface is correctly in place; the measurement loop captures the trajectory.");
    recommendations.push("If your llms.txt or MCP server content has changed since deploy, the next audit will catch the updates.");
  } else {
    recommendations.push("Decide whether to continue the measurement rhythm via Standard ($149/mo) — monthly cite-share tracking + scanner re-runs, same methodology, monthly cadence.");
    recommendations.push("Your patch + audit PDFs are yours unconditionally. If you deployed your MCP server, it keeps running on your Cloudflare account regardless of Standard continuation.");
  }

  return { whatChanged, trajectoryInterpretation, recommendations };
}
