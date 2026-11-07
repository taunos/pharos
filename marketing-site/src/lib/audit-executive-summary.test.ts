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

function citationNotes(measurable: number, total: number, perModel = "openai=n/a, anthropic=n/a, google=n/a, perplexity=73") {
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
      `The weakest areas: ${C.dimensions[2].fail} (MCP Server Discoverability, 10/100); ${C.dimensions[4].fail} (Structured Capability Data, 39/100); and ${C.dimensions[5].partial} (Agent-Parsable Content, 45/100).`,
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
      audit(90, [dim(1, "llms.txt Quality", 90), citationDim(90, citationNotes(40, 40, "openai=90, anthropic=88, google=91, perplexity=92"))]),
      GAPS_HEADING,
    );
    expect(s.join(" ")).not.toContain("partly measured");
  });

  it("partly measured Citation Visibility without a parseable per-model list uses the cells-only wording", () => {
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

  it("returns null when the notes don't carry coverage", () => {
    expect(citationCoverage(citationDim(73, "something else"))).toBeNull();
    expect(citationCoverage(dim(6, "Citation Visibility", 50))).toBeNull();
  });
});
