// Free Score truthfulness (2026-11-07, run.mjs --tier free panel): the results
// page, the Score PDF and the Score email must list the same gaps, show the
// scanner's terse notes in plain words, and never print invented Dim 6 numbers.
import { describe, it, expect, vi } from "vitest";

vi.mock("resend", () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));

import type { DimensionResult, ScanResult, SubCheck } from "./audit-types";
import { scoreGaps } from "./score-display";
import { plainScoreNote } from "./score-notes";
import { renderScoreReportHTML } from "./score-pdf-template";
import { buildGapReportReadyPayload } from "./score-email";
import { DIM6_DISCLOSURE } from "./dim6/disclosure";

const sc = (id: string, score: number, passed: boolean, notes: string, extra: Partial<SubCheck> = {}): SubCheck => ({
  id, name: `Check ${id}`, weight: 25, score, passed, notes, ...extra,
});
const dim = (dimension_id: number, sub_checks: SubCheck[], extra: Partial<DimensionResult> = {}): DimensionResult => ({
  dimension_id, dimension_name: `Dim ${dimension_id}`, score: 50, grade: "D", sub_checks, ...extra,
});

// The pre-2026-11-07 stored free-tier Dim 6 note (still in D1 results_json).
const LEGACY_DIM6_NOTE =
  "Citation Visibility (Dim 6) measures what hosted models actually say about your domain — the dimension Cloudflare's Agent Readiness Score cannot see. Sample output: GPT-4o cites your domain 6/10 times, Claude 4/10, Gemini 2/10, Perplexity 7/10 — aggregate 47/100 D+.";

function scan(): ScanResult {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    url: "https://acme.com/",
    composite: { score: 61, grade: "C" },
    dimensions: [
      dim(1, [
        sc("presence", 0, false, "status=404"),
        sc("spec_compliance", 0, false, "h1=no, blockquote=no"),
      ]),
      dim(2, [
        // Passes at 70 (the scanner's pass mark): the PDF says "Passing", so
        // the page and email must not list it as a gap.
        sc("tool_coverage", 70, true, "12 tool(s) declared"),
        sc("live_invocation", 0, false, "tools/list returned status 500"),
      ]),
      dim(3, [sc("discovery", 0, false, "n/a", { na: true })], { na: true }),
      dim(4, [
        sc("json_ld_present", 0, false, "no JSON-LD found on homepage", { weight: 25 }),
        sc("organization_schema", 60, false, "Organization found: name=true, url=true, description=false, sameAs=0", { weight: 20 }),
        sc("review_schema", 0, false, "No Review markup found.", { na: true }),
      ]),
      dim(6, [sc("free_tier_dim6_preview", 0, false, LEGACY_DIM6_NOTE, { na: true, weight: 1 })], { na: true, score: 0, grade: "F" }),
    ],
    dimensions_scored: 6,
    dimensions_total: 6,
    dimensions_applicable: 3,
    created_at: 1_700_000_000_000,
    scoring_version: "1.5.1",
    tier: "free",
  };
}

describe("scoreGaps", () => {
  it("uses the Audit/PDF rule (not passed, not N/A), not score < 80", () => {
    const ids = scoreGaps(scan().dimensions).map((g) => g.sub.id);
    expect(ids).not.toContain("tool_coverage"); // 70, passed
    expect(ids).not.toContain("discovery"); // N/A dimension
    expect(ids).not.toContain("review_schema"); // N/A check
    expect(ids).not.toContain("free_tier_dim6_preview");
    expect(new Set(ids)).toEqual(new Set(["presence", "spec_compliance", "live_invocation", "json_ld_present", "organization_schema"]));
  });
  it("orders by weighted impact on the composite, highest first", () => {
    const ids = scoreGaps(scan().dimensions).map((g) => g.sub.id);
    // D4 json_ld 25/45 x 20 x 100 = 1111; D2 live 25/50 x 20 x 100 = 1000;
    // D1 presence = spec 25/50 x 15 x 100 = 750 (dimension order); D4 org 20/45 x 20 x 40 = 356.
    expect(ids).toEqual(["json_ld_present", "live_invocation", "presence", "spec_compliance", "organization_schema"]);
  });
  it("lists a check that did not pass even at score 80+", () => {
    const d = dim(1, [sc("presence", 85, false, "x")]);
    expect(scoreGaps([d]).map((g) => g.sub.id)).toEqual(["presence"]);
  });
});

describe("plainScoreNote", () => {
  const n = (id: string, notes: string) => plainScoreNote({ id, notes });
  it("rewrites the known terse scanner notes", () => {
    expect(n("presence", "status=404")).toBe("There is no llms.txt file at /llms.txt (the server answered 404).");
    expect(n("presence", "status=503")).toBe("/llms.txt did not load (the server answered HTTP 503).");
    expect(n("presence", 'status=200, content-type="text/plain; charset=utf-8"')).toBe("Found an llms.txt file at /llms.txt.");
    expect(n("presence", "fetch failed")).toBe("We could not load /llms.txt on this run.");
    expect(n("spec_compliance", "h1=yes, blockquote=no")).toBe("The file has an H1 title but no blockquote summary (a line starting with >).");
    expect(n("spec_compliance", "h1=no, blockquote=yes")).toBe("The file has a blockquote summary but no H1 title (a line starting with #).");
    expect(n("spec_compliance", "h1=yes, blockquote=yes")).toBe("The file starts with an H1 title and has a blockquote summary.");
    expect(n("spec_compliance", "h1=no, blockquote=no")).toBe("No H1 title (a line starting with #) and no blockquote summary (a line starting with >).");
    expect(n("linked_pages_quality", "no links to sample")).toBe("No links in llms.txt for us to check.");
    expect(n("linked_pages_quality", "0/3 sampled links return markdown-ish content")).toBe(
      "0 of the 3 llms.txt links we checked returned Markdown or plain text; the rest returned HTML or did not load.",
    );
    expect(n("organization_schema", "Organization found: name=true, url=true, description=false, sameAs=0")).toBe(
      "Organization markup found, but it has no description.",
    );
    expect(n("organization_schema", "Organization found: name=false, url=true, description=false, sameAs=2")).toBe(
      "Organization markup found, but it has no name or description.",
    );
    expect(n("organization_schema", "Organization found: name=true, url=true, description=true, sameAs=3")).toBe(
      "Organization markup found, with a name, url and description.",
    );
    expect(n("live_invocation", "tools/list returned 1 tools")).toBe("The MCP server answered and listed 1 tool.");
    expect(n("live_invocation", "tools/list returned 12 tools")).toBe("The MCP server answered and listed 12 tools.");
  });
  it("leaves every other note unchanged", () => {
    for (const [id, notes] of [
      ["presence", "status=200"],
      ["live_invocation", "tools/list returned status 500"],
      ["json_ld_present", "no JSON-LD found on homepage"],
      ["organization_schema", "no Organization schema"],
      ["other", "status=404"],
    ]) expect(n(id, notes)).toBe(notes);
  });
});

describe("Score PDF (free)", () => {
  const html = renderScoreReportHTML({ scan: scan(), email: "v@example.com", scoringVersion: "1.5.1" });
  it("never prints the stored Dim 6 demo note (invented numbers, D+, competitor claim)", () => {
    expect(html).not.toMatch(/6\/10|D\+|47\/100|Agent Readiness Score/);
    expect(html).toContain(DIM6_DISCLOSURE.freeTierPreview);
  });
  it("labels free-tier Dim 6 'not measured', not 'not applicable'", () => {
    const dim6 = html.slice(html.indexOf("Dim 6"));
    expect(dim6.slice(0, 600)).toContain("not measured");
    expect(dim6.slice(0, 600)).not.toContain("not applicable");
    // A genuinely inapplicable dimension keeps its label.
    const dim3 = html.slice(html.indexOf("Dim 3"));
    expect(dim3.slice(0, 600)).toContain("not applicable");
  });
  it("prints plain notes and keeps a passing 70 as Passing", () => {
    expect(html).not.toMatch(/status=404|h1=no|description=false/);
    expect(html).toContain("There is no llms.txt file at /llms.txt (the server answered 404).");
    expect(html).toMatch(/Check tool_coverage<\/td>[\s\S]*?Passing/);
  });
  it("does not call Citation Visibility a demo preview in the scope line", () => {
    expect(html).toContain("Citation Visibility is not measured in the free Score; it runs live with the $79 Audit.");
    expect(html).not.toContain("static demo preview");
  });
});

describe("Score email (free)", () => {
  const p = buildGapReportReadyPayload({
    toEmail: "v@example.com", scan: scan(), scanToken: "t", unsubscribeToken: "u",
    origin: "https://astrant.io", requestedDate: "2026-11-07",
  });
  it("Top gaps follow scoreGaps: same rule and order as the page, no passing check", () => {
    const top = scoreGaps(scan().dimensions).slice(0, 3).map((g) => g.sub.name);
    const listed = p.text.split("\n").filter((l) => l.startsWith("  • ")).map((l) => l.slice(4).split(" — ")[0]);
    expect(listed).toEqual(top);
    expect(p.text).not.toContain("Check tool_coverage");
    expect(p.html).not.toContain("Check tool_coverage");
  });
  it("shows plain notes", () => {
    expect(p.text).not.toMatch(/description=false|status=404|h1=no/);
    expect(p.text).toContain("There is no llms.txt file at /llms.txt (the server answered 404).");
  });
});
