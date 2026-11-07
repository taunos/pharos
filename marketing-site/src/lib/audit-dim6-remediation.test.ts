// Report truthfulness (2026-11-07): remediation is fixed template text, never
// model-written (engine v6; Dim 6 went first in v5), gaps are only checks
// that did not pass, ordered by weighted impact, and N/A sub-checks such as
// Dim 4 review_schema without ratings markup never become gap rows.
import { describe, expect, it } from "vitest";
import { buildRemediationGaps, REMEDIATION_ENGINE_VERSION_TAG } from "./audit-pipeline";
import { DIM6_REMEDIATION } from "./remediation-templates";
import { gapImpact, orderGaps } from "./audit-gaps";
import type { AuditResult, ScanResult, SubCheck } from "./audit-types";
import { AUDIT_REPORT_COPY, buildAuditReportModel } from "./audit-report-model";
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
  passed: score >= 70,
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
          sc("organization_schema", 60, { weight: 20, notes: "Organization found: name=true, url=true, description=false, sameAs=0" }),
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

describe("remediation is fixed text", () => {
  it("has exactly one text per Dim 6 check id", () => {
    expect(Object.keys(DIM6_REMEDIATION).sort()).toEqual([...DIM6_IDS].sort());
  });

  it.each(DIM6_IDS)("%s: the fixed Dim 6 text", (id) => {
    const s = scan();
    s.dimensions = [{ ...s.dimensions[1], sub_checks: [sc(id, 30)] }];
    const [gap] = buildRemediationGaps(s);
    expect(gap.remediation).toBe(DIM6_REMEDIATION[id]);
  });

  it.each(DIM6_IDS)("%s: text is plain, promises nothing, ends with an effort estimate", (id) => {
    const t = DIM6_REMEDIATION[id];
    expect(t).toMatch(/Estimated effort: (under 30 minutes|30 minutes to 1 hour|1 to 2 hours|2 to 4 hours|4\+ hours)\.$/);
    expect(t).not.toMatch(/\bwill\b|guarantee|configuration file|update the models?/i);
    expect(t).toContain("You cannot edit ChatGPT, Claude, Gemini or Perplexity directly");
    expect(t).not.toContain("\n");
  });

  it("N/A review_schema is not a gap; the other checks get their template", () => {
    const gaps = buildRemediationGaps(scan());
    expect(gaps.some((g) => g.check_id === "review_schema")).toBe(false);
    const org = gaps.find((g) => g.check_id === "organization_schema")!;
    expect(org.remediation).toContain("The Organization block on your homepage is missing description");
  });

  it("remediation engine version is bumped to v7", () => {
    expect(REMEDIATION_ENGINE_VERSION_TAG).toBe("v7");
  });
});

describe("gaps: only checks that did not pass, by weighted impact", () => {
  it("excludes passing checks even when they score below 100", () => {
    const s = scan();
    s.dimensions[0].sub_checks.push(sc("json_ld_present", 90, { weight: 25, passed: true, notes: "1 valid JSON-LD block(s) on homepage" }));
    s.dimensions[0].sub_checks.push(sc("service_offer_schema", 50, { weight: 20, passed: false, notes: "1 Service/Product/Offer block(s); best match has 2/3 required fields" }));
    const ids = buildRemediationGaps(s).map((g) => g.check_id);
    expect(ids).not.toContain("json_ld_present");
    expect(ids).toContain("service_offer_schema");
  });

  it("uses sub.passed, not score < 100 (a passing 75 is not a gap, a failing 60 is)", () => {
    const s = scan();
    s.dimensions = [
      {
        dimension_id: 5,
        dimension_name: "Agent-Parsable Content",
        score: 70,
        grade: "B",
        sub_checks: [
          sc("markdown_negotiation", 75, { passed: true, notes: ".md variant exists at https://x/index.md but Accept: text/markdown negotiation isn't wired." }),
          sc("page_weight_lcp", 50, { passed: false, notes: "Page weight 1.50MB (1572864 bytes); LCP not measured (free tier)." }),
        ],
      },
    ];
    expect(buildRemediationGaps(s).map((g) => g.check_id)).toEqual(["page_weight_lcp"]);
  });

  it("orders by (100 - score) x share of the dimension x dimension weight", () => {
    const s = scan();
    // Dim 4 (weight 20): org 60/100, weight 20 of 20 applicable (review N/A) -> 40 x 1 x 20 = 800.
    // Dim 6 (weight 20): each 30/100, weight 25 of 100 -> 70 x 0.25 x 20 = 350.
    const gaps = buildRemediationGaps(s);
    expect(gaps[0].check_id).toBe("organization_schema");
    expect(gapImpact(s.dimensions[0], 20, 60)).toBe(800);
    expect(gapImpact(s.dimensions[1], 25, 30)).toBe(350);
    // A low raw score in a light dimension can rank below a mid score in a heavy one.
    const light = { dimension_id: 3, sub_checks: [sc("discovery", 0, { weight: 25 }), sc("spec_validity", 100, { weight: 75 })] };
    const heavy = { dimension_id: 4, sub_checks: [sc("organization_schema", 40, { weight: 50 }), sc("json_ld_present", 100, { weight: 50 })] };
    expect(gapImpact(light, 25, 0)).toBe(250);
    expect(gapImpact(heavy, 50, 40)).toBe(600);
  });

  it("the report model drops stored passing gaps from older audits and re-orders by impact", () => {
    const s = scan();
    s.dimensions[0].sub_checks.push(sc("json_ld_present", 90, { weight: 25, passed: true }));
    const stored: AuditResult = {
      scan: s,
      engine_version: "v5",
      gaps: [
        // Older engine: dimension order, passing check included.
        { dimension_id: 4, dimension_name: "D4", check_id: "json_ld_present", check_name: "JSON-LD", weight: 25, score: 90, notes: "", remediation: "old" },
        { dimension_id: 6, dimension_name: "D6", check_id: "citation_domain_named_rate", check_name: "Named", weight: 25, score: 30, notes: "", remediation: "old" },
        { dimension_id: 4, dimension_name: "D4", check_id: "organization_schema", check_name: "Org", weight: 20, score: 60, notes: "", remediation: "old" },
      ],
    };
    const m = buildAuditReportModel(stored, "sess");
    expect(m.gaps.map((g) => g.checkName)).toEqual(["Org", "Named"]);
    expect(orderGaps(s, stored.gaps).map((g) => g.check_id)).toEqual(["organization_schema", "citation_domain_named_rate"]);
  });

  it("gaps intro and empty state describe the new rule", () => {
    expect(AUDIT_REPORT_COPY.gapsIntro).toMatch(/did not pass/);
    expect(AUDIT_REPORT_COPY.gapsIntro).toMatch(/costs your overall score/);
    expect(AUDIT_REPORT_COPY.gapsIntro).not.toMatch(/specific|lowest score first|analysis engine/);
    expect(AUDIT_REPORT_COPY.gapsEmpty).not.toMatch(/scored 100/);
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
