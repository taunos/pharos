// Report truthfulness (2026-11-07): Dim 6 (Citation Visibility) remediation is
// fixed text, never model-written (the 8B model invented "model configuration
// file" fixes), and N/A sub-checks such as Dim 4 review_schema without ratings
// markup never become gap rows.
import { describe, expect, it } from "vitest";
import {
  DIM6_REMEDIATION,
  llmEnrichGaps,
  REMEDIATION_ENGINE_VERSION_TAG,
  validateRemediation,
  type AuditEnv,
} from "./audit-pipeline";
import type { ScanResult, SubCheck } from "./audit-types";
import { buildAuditReportModel } from "./audit-report-model";
import { renderScoreReportHTML } from "./score-pdf-template";

const DIM6_IDS = [
  "citation_domain_named_rate",
  "citation_url_referenced_rate",
  "citation_context_relevant_rate",
  "citation_no_competitor_first_rate",
];

const sc = (id: string, score: number, extra: Partial<SubCheck> = {}): SubCheck => ({
  id,
  name: id,
  weight: 25,
  score,
  passed: false,
  notes: "40% of measurable cells named the target domain.",
  ...extra,
});

function scan(): ScanResult {
  return {
    id: "scan-d6",
    url: "https://example-psychology.test/",
    composite: { score: 40, grade: "D" },
    dimensions_scored: 6,
    dimensions_total: 6,
    dimensions_applicable: 2,
    created_at: Date.UTC(2026, 10, 7),
    dimensions: [
      {
        dimension_id: 4,
        dimension_name: "Structured Capability Data",
        score: 40,
        grade: "D",
        sub_checks: [
          sc("organization_schema", 40, { weight: 20, notes: "Organization found: name=true, url=true, description=false, sameAs=0" }),
          sc("review_schema", 0, { weight: 15, na: true, notes: "No Review or AggregateRating markup found." }),
        ],
      },
      {
        dimension_id: 6,
        dimension_name: "Citation Visibility",
        score: 30,
        grade: "F",
        sub_checks: DIM6_IDS.map((id) => sc(id, 30)),
      },
    ],
  };
}

function env() {
  const prompts: string[] = [];
  const kv = new Map<string, string>();
  const e = {
    AI: {
      run: async (_m: string, input: { messages: { content: string }[] }) => {
        prompts.push(input.messages[0].content);
        return {
          response:
            "Update the Organization JSON-LD block on the homepage to add a description; the scanner found description=false. Estimated effort: 30 minutes to 1 hour.",
        };
      },
    },
    SESSIONS: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) },
  } as unknown as AuditEnv;
  return { env: e, prompts, kv };
}

describe("Dim 6 remediation is fixed text", () => {
  it("has exactly one text per Dim 6 check id", () => {
    expect(Object.keys(DIM6_REMEDIATION).sort()).toEqual([...DIM6_IDS].sort());
  });

  it.each(DIM6_IDS)("%s: deterministic text, no model call, nothing cached", async (id) => {
    const { env: e, prompts, kv } = env();
    const s = scan();
    s.dimensions = [{ ...s.dimensions[1], sub_checks: [sc(id, 30)] }];
    const [gap] = await llmEnrichGaps(e, s, "sess-d6");
    expect(gap.remediation).toBe(DIM6_REMEDIATION[id]);
    expect(prompts).toHaveLength(0);
    expect(kv.size).toBe(0);
  });

  it.each(DIM6_IDS)("%s: text is plain, promises nothing, ends with an effort estimate", (id) => {
    const t = DIM6_REMEDIATION[id];
    expect(t).toMatch(/Estimated effort: (under 30 minutes|30 minutes to 1 hour|1 to 2 hours|2 to 4 hours|4\+ hours)\.$/);
    expect(t).not.toMatch(/\bwill\b|guarantee|configuration file|update the models?/i);
    expect(t).toContain("You cannot edit ChatGPT, Claude, Gemini or Perplexity directly");
    expect(t).not.toContain("\n");
    // Passes the same gate model output must pass.
    expect(validateRemediation(t, "https://example-psychology.test/", id)).toEqual({ valid: true });
  });

  it("other checks still use the model; N/A review_schema is not a gap", async () => {
    const { env: e, prompts } = env();
    const gaps = await llmEnrichGaps(e, scan(), "sess-mixed");
    expect(gaps.map((g) => g.check_id)).toEqual(["organization_schema", ...DIM6_IDS]);
    expect(prompts).toHaveLength(1);
    expect(gaps.some((g) => g.check_id === "review_schema")).toBe(false);
  });

  it("remediation engine version is bumped past v4", () => {
    expect(REMEDIATION_ENGINE_VERSION_TAG).toBe("v5");
  });
});

describe("N/A review_schema renders as N/A, never 0", () => {
  it("Audit report model and Score PDF show a dash and N/A for it", () => {
    const s = scan();
    const m = buildAuditReportModel({ scan: s, gaps: [] } as never, "sess-render");
    const d4 = m.dimensions.find((d) => d.id === 4)!;
    if (d4.kind !== "scored") throw new Error("expected scored Dim 4");
    const row = d4.checks.find((c) => c.id === "review_schema")!;
    expect(row.scoreLabel).toBe("—");
    expect(row.name).toContain("N/A");

    const html = renderScoreReportHTML({ scan: s, email: "a@b.test", scoringVersion: "1.3.2" });
    const tr = html.slice(html.indexOf(">review_schema"), html.indexOf("</tr>", html.indexOf(">review_schema")));
    expect(tr).toContain("N/A");
    expect(tr).not.toContain("0/100");
  });
});
