import { describe, expect, it } from "vitest";
import {
  buildExecutiveSummary,
  citationCoverage,
  EXEC_SUMMARY_COPY as C,
} from "./audit-executive-summary";
import type { AuditResult, DimensionResult, GapWithRemediation, SubCheck } from "./audit-types";

const GAPS_HEADING = "Prioritized gaps + remediation";

function sub(id: string, score: number, notes = "", na = false): SubCheck {
  return { id, name: id, weight: 20, score, passed: score >= 70, notes, ...(na ? { na: true } : {}) };
}

function dim(id: number, name: string, score: number, extra: Partial<DimensionResult> = {}): DimensionResult {
  return { dimension_id: id, dimension_name: name, score, grade: "X", sub_checks: [sub(`d${id}`, score)], ...extra };
}

function citationNotes(
  measurable: number,
  total: number,
  perModel = "ChatGPT not measured, Claude not measured, Gemini not measured, Perplexity 73",
) {
  return `100% of scored test answers named your domain. ${measurable} of ${total} test answers could be scored, across 4 AI models. Average by model: ${perModel}.`;
}

// Notes shape written before 2026-11-07; stored audits are re-rendered.
function oldCitationNotes(measurable: number, total: number, perModel = "openai=n/a, anthropic=n/a, google=n/a, perplexity=73") {
  return `100% of measurable cells named the target domain. ${measurable}/${total} cells measurable across 4 models. Per-model averages: ${perModel}.`;
}

function citationDim(score: number, notes: string): DimensionResult {
  return dim(6, "Citation Visibility", score, {
    sub_checks: [sub("citation_domain_named_rate", 100, notes), sub("citation_url_referenced_rate", score)],
  });
}

function gapFor(d: DimensionResult): GapWithRemediation {
  return {
    dimension_id: d.dimension_id,
    dimension_name: d.dimension_name,
    check_id: `d${d.dimension_id}`,
    check_name: `check ${d.dimension_id}`,
    weight: 20,
    score: d.score,
    notes: "",
    remediation: "fix it",
  };
}

function audit(composite: number, dims: DimensionResult[], gaps?: GapWithRemediation[]): AuditResult {
  return {
    engine_version: "v3",
    scan: {
      id: "s",
      url: "https://example.com/",
      composite: { score: composite, grade: composite >= 80 ? "A-" : composite >= 70 ? "B" : composite >= 40 ? "D" : "F" },
      dimensions: dims,
      dimensions_scored: dims.length,
      dimensions_total: 6,
      created_at: 0,
    },
    gaps: gaps ?? dims.filter((d) => !d.na && d.score < 100).map(gapFor),
  };
}

const NA_OPENAPI = dim(3, "OpenAPI / API Catalog", 0, {
  na: true,
  sub_checks: [sub("discovery", 0, "No OpenAPI found.", true)],
});

// The astrant.io test audit (2026-11-04), reduced to what the summary reads.
function astrantLike(): AuditResult {
  return audit(85, [
    dim(1, "llms.txt Quality", 95),
    dim(2, "MCP Server Discoverability", 100),
    NA_OPENAPI,
    dim(4, "Structured Capability Data", 69),
    dim(5, "Agent-Parsable Content", 93),
    citationDim(73, citationNotes(10, 40)),
  ]);
}

const weakest = (s: string[]) => s.find((x) => x.startsWith("The weakest"));

function expectWellFormed(sentences: string[]) {
  expect(sentences.length).toBeGreaterThanOrEqual(3);
  expect(sentences.length).toBeLessThanOrEqual(6);
  for (const s of sentences) {
    expect(s).toMatch(/^[A-Z"]/);
    expect(s).toMatch(/\.$/);
    expect(s).not.toMatch(/undefined|null|NaN/);
  }
}

describe("buildExecutiveSummary", () => {
  it("full case: overall, weakest, working, N/A + partial-citation caveat, closing", () => {
    const s = buildExecutiveSummary(astrantLike(), GAPS_HEADING);
    expectWellFormed(s);
    expect(s).toEqual([
      `Your site scored 85/100 (grade A-) on the 5 of 6 dimensions we could score: ${C.overallBands.strong}`,
      "The weakest areas: the structured data (JSON-LD) on your homepage is incomplete (Structured Capability Data, 69/100); and in our test questions, AI assistants named your site only some of the time (Citation Visibility, 73/100).",
      "What's working: your MCP server passed most of our discovery checks; your llms.txt file passed most of our checks; and your pages passed most of our readability checks.",
      "OpenAPI / API Catalog did not apply to this site, so it is not counted in your score; Citation Visibility was only partly measured (1 of 4 AI assistants returned usable answers, 10 of 40 test answers in all), so treat that score as provisional.",
      `The "${GAPS_HEADING}" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.`,
    ]);
  });

  it("fewer than 4 dimensions scored: a coverage sentence right after the score, no 'describe your site well'", () => {
    // Rachel-like: 80 A- from 3 of 6 dimensions, Citation Visibility not measured.
    const naCitation = dim(6, "Citation Visibility", 0, { na: true, unmeasured: true });
    const s = buildExecutiveSummary(
      audit(80, [dim(1, "llms.txt Quality", 90), NA_OPENAPI, dim(4, "Structured Capability Data", 85), dim(5, "Agent-Parsable Content", 70), naCitation]),
      GAPS_HEADING,
    );
    expectWellFormed(s);
    expect(s[0]).toBe(`Your site scored 80/100 (grade A-) on the 3 of 6 dimensions we could score: ${C.overallBands.strong}`);
    expect(s[1]).toBe(C.coverageLow(3, 6));
    const all = s.join(" ");
    expect(all).not.toMatch(/describe your site well|can find, read/);
    expect(all).toContain(C.naCitationUnmeasured);
  });

  it("Citation Visibility not measured with 4+ dimensions scored: coverage sentence names it once", () => {
    const naCitation = dim(6, "Citation Visibility", 0, { na: true, unmeasured: true });
    const s = buildExecutiveSummary(
      audit(85, [dim(1, "llms.txt Quality", 90), dim(2, "MCP Server Discoverability", 85), dim(4, "Structured Capability Data", 85), dim(5, "Agent-Parsable Content", 90), naCitation]),
      GAPS_HEADING,
    );
    expectWellFormed(s);
    expect(s[1]).toBe(C.coverageNoCitation);
    expect(s.join(" ")).not.toContain(C.naCitationUnmeasured);
  });

  it("4+ dimensions incl. Citation Visibility: no coverage sentence", () => {
    const s = buildExecutiveSummary(astrantLike(), GAPS_HEADING);
    expect(s).not.toContain(C.coverageNoCitation);
    expect(s.some((x) => x.startsWith("Because only"))).toBe(false);
  });

  it("no causal or outcome claims in the summary copy", () => {
    const strings: string[] = [
      ...Object.values(C.overallBands),
      ...Object.values(C.dimensions).flatMap((p) => [p.fail, p.partial, p.strong]),
      C.coverageLow(3, 6),
      C.coverageNoCitation,
      C.closingWithGaps(GAPS_HEADING),
      C.closingNoGaps,
    ];
    for (const t of strings) {
      expect(t).not.toMatch(/\bwill\b|hard time|can't|struggle|can find|can read|guarantee/i);
    }
  });

  it("no gaps: no weakest-areas sentence and the nothing-to-fix closing", () => {
    const a = audit(100, [dim(1, "llms.txt Quality", 100), dim(2, "MCP Server Discoverability", 100)], []);
    const s = buildExecutiveSummary(a, GAPS_HEADING);
    expectWellFormed(s);
    expect(s.join(" ")).not.toContain("weakest");
    expect(s[s.length - 1]).toBe(C.closingNoGaps);
  });

  it("gaps but every dimension 80+: says there are no major weak areas", () => {
    const s = buildExecutiveSummary(audit(88, [dim(1, "llms.txt Quality", 90), dim(5, "Agent-Parsable Content", 82)]), GAPS_HEADING);
    expectWellFormed(s);
    expect(s).toContain(C.noMajorWeakAreas);
  });

  it("lists at most three weakest areas, lowest first, with fail phrasing under 40", () => {
    const s = buildExecutiveSummary(
      audit(30, [
        dim(1, "llms.txt Quality", 50),
        dim(2, "MCP Server Discoverability", 10),
        dim(4, "Structured Capability Data", 39),
        dim(5, "Agent-Parsable Content", 45),
      ]),
      GAPS_HEADING,
    );
    expectWellFormed(s);
    expect(s[0]).toContain(C.overallBands.weak);
    expect(weakest(s)).toBe(
      `The weakest areas: ${C.dimensions[2].fail} (MCP Server Discoverability, 10/100); ${C.dimensions[4].fail} (Structured Capability Data, 39/100); and ${C.dimensions[5].fail} (Agent-Parsable Content, 45/100).`, // r7: its one check failed, so "failed most"
    );
    expect(s.join(" ")).not.toContain("What's working");
  });

  it("singular weakest-area sentence for one weak dimension", () => {
    const s = buildExecutiveSummary(audit(78, [dim(1, "llms.txt Quality", 95), dim(4, "Structured Capability Data", 61)]), GAPS_HEADING);
    expect(weakest(s)).toBe(`The weakest area: ${C.dimensions[4].partial} (Structured Capability Data, 61/100).`);
  });

  it("several Not Applicable dimensions are named together, plural", () => {
    const naDim5 = dim(5, "Agent-Parsable Content", 0, { na: true });
    const s = buildExecutiveSummary(audit(90, [dim(1, "llms.txt Quality", 90), NA_OPENAPI, naDim5]), GAPS_HEADING);
    expectWellFormed(s);
    expect(s).toContain(
      "OpenAPI / API Catalog and Agent-Parsable Content did not apply to this site, so they are not counted in your score.",
    );
  });

  it("Citation Visibility N/A (not measured this run) is not called 'did not apply'", () => {
    const naCitation = dim(6, "Citation Visibility", 0, {
      na: true,
      sub_checks: [sub("dim6_all_unmeasurable", 0, "All 40 cells came back unmeasurable.", true)],
    });
    const s = buildExecutiveSummary(audit(90, [dim(1, "llms.txt Quality", 90), naCitation]), GAPS_HEADING);
    expectWellFormed(s);
    expect(s).toContain(`${C.naCitationUnmeasured}.`);
    expect(s.join(" ")).not.toContain("Citation Visibility did not apply");
  });

  it("an unmeasured OpenAPI dimension (spec not read in full) is 'could not be measured', never 'did not apply'", () => {
    const unmeasured = dim(3, "OpenAPI / API Catalog", 0, { na: true, unmeasured: true });
    const s = buildExecutiveSummary(audit(90, [dim(1, "llms.txt Quality", 90), unmeasured]), GAPS_HEADING);
    expectWellFormed(s);
    expect(s).toContain("OpenAPI / API Catalog could not be measured on this run, so it is not counted in your score.");
    expect(s.join(" ")).not.toContain("did not apply");
  });

  it("unmeasured and not-applicable dimensions get separate caveats", () => {
    const unmeasured = dim(3, "OpenAPI / API Catalog", 0, { na: true, unmeasured: true });
    const naDim5 = dim(5, "Agent-Parsable Content", 0, { na: true });
    const s = buildExecutiveSummary(audit(90, [dim(1, "llms.txt Quality", 90), unmeasured, naDim5]), GAPS_HEADING);
    expect(s).toContain(
      "Agent-Parsable Content did not apply to this site, so it is not counted in your score; OpenAPI / API Catalog could not be measured on this run, so it is not counted in your score.",
    );
  });

  it("fully measured Citation Visibility adds no caveat", () => {
    const s = buildExecutiveSummary(
      audit(90, [dim(1, "llms.txt Quality", 90), citationDim(90, citationNotes(40, 40, "ChatGPT 90, Claude 88, Gemini 91, Perplexity 92"))]),
      GAPS_HEADING,
    );
    expect(s.join(" ")).not.toContain("partly measured");
  });

  it("partly measured Citation Visibility without a parseable per-model list uses the cells-only wording", () => {
    const notes = "100% of scored test answers named your domain. 12 of 40 test answers could be scored, across 4 AI models.";
    const s = buildExecutiveSummary(audit(90, [dim(1, "llms.txt Quality", 90), citationDim(90, notes)]), GAPS_HEADING);
    expect(s).toContain(`${C.citationPartialNoModels(12, 40)}.`);
  });

  it("old-format notes without a per-model list still use the cells-only wording", () => {
    const notes = "100% of measurable cells named the target domain. 12/40 cells measurable across 4 models.";
    const s = buildExecutiveSummary(audit(90, [dim(1, "llms.txt Quality", 90), citationDim(90, notes)]), GAPS_HEADING);
    expect(s).toContain(`${C.citationPartialNoModels(12, 40)}.`);
  });

  it("falls back to the dimension name for a dimension without its own phrases", () => {
    const s = buildExecutiveSummary(audit(60, [dim(7, "Future Dimension", 55)]), GAPS_HEADING);
    expect(weakest(s)).toBe("The weakest area: Future Dimension needs work (Future Dimension, 55/100).");
  });

  it("overall band follows the composite grade scale", () => {
    const band = (score: number) => buildExecutiveSummary(audit(score, [dim(1, "llms.txt Quality", score)]), GAPS_HEADING)[0];
    expect(band(80)).toContain(C.overallBands.strong);
    expect(band(79)).toContain(C.overallBands.good);
    expect(band(70)).toContain(C.overallBands.good);
    expect(band(69)).toContain(C.overallBands.mixed);
    expect(band(40)).toContain(C.overallBands.mixed);
    expect(band(39)).toContain(C.overallBands.weak);
  });
});

describe("citationCoverage", () => {
  it("parses cells and per-model coverage from the runDim6 notes", () => {
    expect(citationCoverage(citationDim(73, citationNotes(10, 40)))).toEqual({
      measurableCells: 10,
      totalCells: 40,
      measuredModels: 1,
      totalModels: 4,
    });
  });

  it("parses the old notes shape (stored audits written before 2026-11-07)", () => {
    expect(citationCoverage(citationDim(73, oldCitationNotes(10, 40)))).toEqual({
      measurableCells: 10,
      totalCells: 40,
      measuredModels: 1,
      totalModels: 4,
    });
    expect(citationCoverage(citationDim(73, oldCitationNotes(40, 40, "openai=90, anthropic=88, google=91, perplexity=92")))).toEqual({
      measurableCells: 40,
      totalCells: 40,
      measuredModels: 4,
      totalModels: 4,
    });
  });

  it("parses all-measured new notes and an unknown model label", () => {
    expect(citationCoverage(citationDim(73, citationNotes(36, 40, "ChatGPT 12, Claude 4, mistral not measured, Perplexity 31")))).toEqual({
      measurableCells: 36,
      totalCells: 40,
      measuredModels: 3,
      totalModels: 4,
    });
  });

  it("returns null when the notes don't carry coverage", () => {
    expect(citationCoverage(citationDim(73, "something else"))).toBeNull();
    expect(citationCoverage(dim(6, "Citation Visibility", 50))).toBeNull();
  });
});

describe("r4: weak-area phrases follow the sub-check evidence", () => {
  const mcp = (score: number, wellKnown: SubCheck, live: SubCheck) =>
    dim(2, "MCP Server Discoverability", score, { sub_checks: [wellKnown, sub("tool_coverage", 0), live] });
  const noCard = sub("well_known", 0, "no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json; an MCP server was found");
  const summary = (d: DimensionResult) => weakest(buildExecutiveSummary(audit(50, [dim(1, "llms.txt Quality", 90), d]), GAPS_HEADING)) ?? "";

  it("ugmonk: tools/list answered, no card -> found but not fully discoverable", () => {
    const s = summary(mcp(33, noCard, sub("live_invocation", 100, "tools/list returned 1 tools")));
    expect(s).toContain(`${C.mcpFoundNoCard} (MCP Server Discoverability, 33/100)`);
    expect(s).not.toContain(C.dimensions[2].fail);
  });

  it("linear: OAuth challenge (75), no card -> found but not fully discoverable", () => {
    expect(summary(mcp(25, noCard, sub("live_invocation", 75, "The MCP endpoint ... requires OAuth sign-in")))).toContain(C.mcpFoundNoCard);
  });

  it("a card but a failing endpoint -> 'passed only some', never 'could not find'", () => {
    const s = summary(
      dim(2, "MCP Server Discoverability", 30, {
        sub_checks: [sub("well_known", 50, "card present at /.well-known/mcp.json but missing a server name"), sub("tool_coverage", 100), sub("live_invocation", 0, "initialize returned status 500")],
      }),
    );
    expect(s).toContain(C.dimensions[2].partial);
  });

  it("r7: a card but no check passed -> neither 'passed only some' nor 'could not find'", () => {
    const s = summary(mcp(30, sub("well_known", 50, "card present at /.well-known/mcp.json but missing a server name"), sub("live_invocation", 0, "initialize returned status 500")));
    expect(s).not.toContain(C.dimensions[2].partial);
    expect(s).not.toContain(C.dimensions[2].fail);
    expect(s).toContain("MCP Server Discoverability needs work");
  });

  it("nothing answered and no card -> the fail phrase stays", () => {
    expect(summary(mcp(0, sub("well_known", 0, "no card at x"), sub("live_invocation", 0, "no MCP endpoint answered: ...")))).toContain(C.dimensions[2].fail);
  });

  const openApi = (subs: SubCheck[], score: number) => dim(3, "OpenAPI / API Catalog", score, { sub_checks: subs });

  it("1.5.0: no 'scanner could only partly check' phrase (YAML specs are read in full)", () => {
    const s = summary(
      openApi(
        [
          sub("discovery", 100),
          sub("spec_validity", 50, "YAML spec detected (openapi 3.0.3). The scanner checks a YAML spec's version field and reachability only, so it gets partial credit here."),
          sub("info_completeness", 0, "Not measured: the scanner cannot read this part of a YAML spec.", true),
        ],
        75,
      ),
    );
    expect(s).not.toMatch(/only partly check/);
    expect(s).toContain(C.dimensions[3].partial);
    expect(Object.keys(C)).not.toContain("openApiScannerLimited");
  });

  it("a real spec gap keeps 'incomplete'", () => {
    const s = summary(openApi([sub("discovery", 100), sub("spec_validity", 100), sub("info_completeness", 30, "info: title=yes, version=no")], 70));
    expect(s).toContain(C.dimensions[3].partial);
  });
});

describe("r5: Dim 4 phrases follow what was sampled", () => {
  const sd = (score: number, svcNotes: string) =>
    dim(4, "Structured Capability Data", score, {
      sub_checks: [
        sub("json_ld_present", 100, "2 valid JSON-LD block(s) on homepage"),
        sub("organization_schema", 30, "Organization found: name=true, url=false, description=false, sameAs=0"),
        sub("service_offer_schema", 100, svcNotes),
      ],
    });
  const PRODUCT = "1 Service/Product/Offer block(s); best match has 3/3 required fields (on the sampled product page https://ugmonk.com/products/x; none on the homepage)";
  const all = (d: DimensionResult) => buildExecutiveSummary(audit(60, [dim(1, "llms.txt Quality", 50), d]), GAPS_HEADING).join(" ");

  it("ugmonk: a sampled product page -> 'the structured data we sampled', never 'on your homepage'", () => {
    const s = all(sd(88, PRODUCT));
    expect(s).toContain(C.structuredDataSampled.strong);
    expect(s).not.toContain("on your homepage passed");
    expect(all(sd(60, PRODUCT))).toContain(C.structuredDataSampled.partial);
  });

  it("homepage-only results keep the homepage phrase", () => {
    expect(all(sd(88, "1 Service/Product/Offer block(s); best match has 3/3 required fields"))).toContain(C.dimensions[4].strong);
  });
});

describe("r7 (Codex r6 LOW): share-of-checks wording follows the sub-check counts", () => {
  it("metalab: Dim 5 at 33/100 with 1 failed and 1 passed check (3 N/A) does not say 'failed most'", () => {
    const d5 = dim(5, "Agent-Parsable Content", 33, {
      sub_checks: [sub("js_vs_no_js_render_diff", 0), sub("page_weight_lcp", 100), sub("a", 0, "", true), sub("b", 0, "", true), sub("c", 0, "", true)],
    });
    const text = buildExecutiveSummary(audit(50, [dim(1, "llms.txt Quality", 0), d5]), GAPS_HEADING).join(" ");
    expect(text).not.toContain("failed most of our readability checks");
    expect(text).toContain("your pages passed only some of our readability checks (Agent-Parsable Content, 33/100)");
  });

  it("a partial score with no passed check does not say 'passed only some'", () => {
    const d5 = dim(5, "Agent-Parsable Content", 60, { sub_checks: [sub("a", 60), sub("b", 60)] });
    const text = buildExecutiveSummary(audit(60, [d5]), GAPS_HEADING).join(" ");
    expect(text).not.toContain("passed only some");
    expect(text).toContain("your pages failed most of our readability checks (Agent-Parsable Content, 60/100)");
  });

  it("a high score with most checks failed is not listed as 'passed most'", () => {
    const d1 = dim(1, "llms.txt Quality", 88, { sub_checks: [sub("presence", 100), sub("a", 60), sub("b", 60)] });
    const text = buildExecutiveSummary(audit(88, [d1]), GAPS_HEADING).join(" ");
    expect(text).not.toContain("your llms.txt file passed most of our checks");
  });
});
