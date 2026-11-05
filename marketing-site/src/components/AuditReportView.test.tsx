import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuditReportBody, AuditReportHeader, AuditReportSummary } from "./AuditReportView";
import { parseAuditResult } from "./AuditResultsPoller";
import { renderAuditHtml } from "@/lib/audit-pipeline";
import {
  AUDIT_REPORT_COPY,
  buildAuditReportModel,
  scoreBand,
} from "@/lib/audit-report-model";
import type { AuditResult } from "@/lib/audit-types";

const SESSION = "fb92b10e-0000-4000-8000-000000000000";

function fixture(): AuditResult {
  return {
    engine_version: "v3",
    scan: {
      id: "scan-1",
      url: "https://example.com/",
      composite: { score: 72, grade: "B" },
      dimensions_scored: 3,
      dimensions_total: 6,
      dimensions_applicable: 2,
      created_at: Date.UTC(2026, 10, 4, 12, 30, 5, 123),
      dimensions: [
        {
          dimension_id: 1,
          dimension_name: "llms.txt Quality",
          score: 95,
          grade: "A",
          sub_checks: [
            { id: "present", name: "File present", weight: 20, score: 100, passed: true, notes: "Found at /llms.txt" },
            { id: "blockquote_eval", name: "Blockquote <pitch> & quality", weight: 15, score: 64, passed: false, notes: "LLM rated blockquote 64/100" },
          ],
        },
        {
          dimension_id: 3,
          dimension_name: "OpenAPI / API Catalog",
          score: 0,
          grade: "F",
          na: true,
          sub_checks: [
            { id: "openapi", name: "OpenAPI spec", weight: 50, score: 0, passed: false, notes: "No API surface detected; dimension dropped." },
          ],
        },
        {
          dimension_id: 4,
          dimension_name: "Structured Capability Data",
          score: 41,
          grade: "D",
          sub_checks: [
            { id: "jsonld", name: "JSON-LD Organization", weight: 30, score: 0, passed: false, notes: "No Organization JSON-LD" },
            { id: "faq", name: "FAQ schema", weight: 10, score: 0, passed: false, notes: "skipped", na: true },
          ],
        },
      ],
    },
    gaps: [
      { dimension_id: 4, dimension_name: "Structured Capability Data", check_id: "jsonld", check_name: "JSON-LD Organization", weight: 30, score: 0, notes: "No Organization JSON-LD", remediation: "Add an Organization JSON-LD block to the homepage <head>." },
      { dimension_id: 1, dimension_name: "llms.txt Quality", check_id: "blockquote_eval", check_name: "Blockquote <pitch> & quality", weight: 15, score: 64, notes: "LLM rated blockquote 64/100", remediation: "Rewrite the blockquote as a one-line elevator pitch." },
    ],
  };
}

// Visible text of an HTML string: drop <head>/<style>, strip tags, decode the
// entities either renderer emits, collapse whitespace.
function textOf(html: string): string {
  return html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function webText(audit: AuditResult): string {
  const model = buildAuditReportModel(audit, SESSION);
  return textOf(
    renderToStaticMarkup(
      <>
        <AuditReportHeader model={model} />
        <AuditReportSummary model={model} />
        <AuditReportBody model={model} />
      </>,
    ),
  );
}

// Every string in `needles` occurs in `hay`, in that order.
function expectInOrder(hay: string, needles: string[]) {
  let from = 0;
  for (const n of needles) {
    const at = hay.indexOf(n, from);
    expect(at, `"${n}" missing or out of order`).toBeGreaterThanOrEqual(0);
    from = at + n.length;
  }
}

// The buyer-visible sequence the PDF and the page must share.
function reportSequence(audit: AuditResult): string[] {
  const m = buildAuditReportModel(audit, SESSION);
  const seq: string[] = [m.generatedLabel, m.url, String(m.composite.score), m.composite.grade, m.scopeNote, AUDIT_REPORT_COPY.summaryHeading, ...m.executiveSummary, AUDIT_REPORT_COPY.dimensionsHeading];
  for (const d of m.dimensions) {
    seq.push(d.name);
    if (d.kind === "na") {
      seq.push(AUDIT_REPORT_COPY.naGrade, d.note);
    } else {
      seq.push(String(d.score), d.grade);
      for (const c of d.checks) seq.push(c.name, c.scoreLabel, c.weightLabel, c.notes);
    }
  }
  seq.push(AUDIT_REPORT_COPY.gapsHeading, AUDIT_REPORT_COPY.gapsIntro);
  if (m.gaps.length === 0) seq.push(AUDIT_REPORT_COPY.gapsEmpty);
  for (const g of m.gaps) {
    seq.push(g.checkName, g.dimensionName, g.metaLabel, AUDIT_REPORT_COPY.findingLabel, g.finding, AUDIT_REPORT_COPY.remediationLabel, g.remediation);
  }
  seq.push(AUDIT_REPORT_COPY.jsonHeading, AUDIT_REPORT_COPY.jsonIntro);
  for (const f of AUDIT_REPORT_COPY.footer) seq.push(f.before.trim(), f.label);
  return seq;
}

describe("buildAuditReportModel", () => {
  it("formats the header, scope and labels like the PDF", () => {
    const m = buildAuditReportModel(fixture(), SESSION);
    expect(m.generatedLabel).toBe("Generated 2026-11-04 12:30:05 UTC · session fb92b10e");
    expect(m.scopeNote).toContain("Scored on 2 of 6 dimensions applicable to this site.");
    expect(m.scopeNote).toContain("were dropped from the composite.");
    const d4 = m.dimensions[2];
    expect(d4.kind).toBe("scored");
    if (d4.kind !== "scored") return;
    expect(d4.checks[0]).toMatchObject({ scoreLabel: "0/100", weightLabel: "30%" });
    expect(d4.checks[1]).toMatchObject({ name: "FAQ schema · N/A", scoreLabel: "—" });
    expect(d4.band).toBe("low");
    expect(m.gaps[0].metaLabel).toBe("0/100 · weight 30%");
  });

  it("keeps dimension order from the payload", () => {
    const m = buildAuditReportModel(fixture(), SESSION);
    expect(m.dimensions.map((d) => d.id)).toEqual([1, 3, 4]);
  });

  it("sorts gaps lowest score first; equal scores keep the payload (dimension) order", () => {
    const a = fixture();
    const g = (dimension_id: number, check_id: string, score: number) => ({
      ...a.gaps[0], dimension_id, check_id, check_name: check_id, score,
    });
    // Stored order = dimension order, as llmEnrichGaps writes it.
    a.gaps = [g(1, "d1-64", 64), g(1, "d1-75", 75), g(4, "d4-0", 0), g(4, "d4-60a", 60), g(4, "d4-60b", 60), g(5, "d5-60", 60)];
    const m = buildAuditReportModel(a, SESSION);
    expect(m.gaps.map((x) => x.checkName)).toEqual(["d4-0", "d4-60a", "d4-60b", "d5-60", "d1-64", "d1-75"]);
    expect(a.gaps[0].check_id).toBe("d1-64"); // input not mutated
    expect(JSON.parse(m.jsonExport).gaps[0].check_id).toBe("d1-64"); // export stays the stored payload
  });

  it("carries the executive summary", () => {
    const m = buildAuditReportModel(fixture(), SESSION);
    expect(m.executiveSummary.length).toBeGreaterThanOrEqual(3);
    expect(m.executiveSummary[0]).toMatch(/^Your site scored 72\/100 \(grade B\)/);
  });

  it("uses the N/A note from the first sub-check, with the PDF fallback", () => {
    const a = fixture();
    expect(buildAuditReportModel(a, SESSION).dimensions[1]).toMatchObject({
      kind: "na",
      note: "No API surface detected; dimension dropped.",
    });
    a.scan.dimensions[1].sub_checks = [];
    expect(buildAuditReportModel(a, SESSION).dimensions[1]).toMatchObject({
      note: AUDIT_REPORT_COPY.naFallbackNote,
    });
  });

  it("omits the dropped-dimensions sentence when nothing was dropped", () => {
    const a = fixture();
    a.scan.dimensions_applicable = undefined;
    const m = buildAuditReportModel(a, SESSION);
    expect(m.scopeNote).toContain("Scored on 3 of 6");
    expect(m.scopeNote).not.toContain("dropped from the composite");
  });

  it("an unmeasured OpenAPI dimension: scope note and summary never claim 'no API surface' / 'did not apply'", () => {
    const a = fixture();
    const d3 = a.scan.dimensions[1];
    d3.unmeasured = true;
    d3.sub_checks = [
      {
        id: "discovery",
        name: "API spec discovery",
        weight: 25,
        score: 0,
        passed: false,
        na: true,
        notes:
          "Not measured — the API spec could not be read in full (size or time limit), so this dimension is not counted in your score. Found via well-known /.well-known/api-catalog at https://example.com/.well-known/api-catalog (content-type=application/json).",
      },
    ];
    const m = buildAuditReportModel(a, SESSION);
    expect(m.scopeNote).toBe(
      "Scored on 2 of 6 dimensions applicable to this site. Some dimensions could not be measured on this run and were dropped from the composite.",
    );
    const all = [m.scopeNote, ...m.executiveSummary].join(" ");
    expect(all).not.toContain("no API surface");
    expect(all).not.toContain("did not apply");
    expect(all).toContain("OpenAPI / API Catalog could not be measured on this run, so it is not counted in your score");
    const naBlock = m.dimensions.find((x) => x.id === 3)!;
    expect(naBlock).toMatchObject({ kind: "na" });
    expect((naBlock as { note: string }).note.startsWith("Not measured — the API spec could not be read in full")).toBe(true);
  });

  it("grade label: 'not measured' for an unmeasured dimension on the page AND in the paid PDF", () => {
    const a = fixture();
    a.scan.dimensions[1].unmeasured = true;
    const m = buildAuditReportModel(a, SESSION);
    expect(m.dimensions.find((x) => x.id === 3)).toMatchObject({ kind: "na", unmeasured: true });
    const page = renderToStaticMarkup(<AuditReportBody model={m} />);
    const pdf = renderAuditHtml(a, SESSION);
    for (const html of [page, pdf]) {
      expect(html).toContain(">not measured<");
      expect(html).not.toContain(">not applicable<");
    }
  });

  it("grade label: old scans without the flag render byte-identically ('not applicable', no unmeasured key)", () => {
    const a = fixture();
    const m = buildAuditReportModel(a, SESSION);
    const na = m.dimensions.find((x) => x.id === 3)!;
    expect(Object.keys(na).sort()).toEqual(["id", "kind", "name", "note"]);
    const page = renderToStaticMarkup(<AuditReportBody model={m} />);
    const pdf = renderAuditHtml(a, SESSION);
    for (const html of [page, pdf]) {
      expect(html).toContain(">not applicable<");
      expect(html).not.toContain("not measured");
    }
    // Explicit false behaves like absent.
    const b = fixture();
    b.scan.dimensions[1].unmeasured = false;
    expect(buildAuditReportModel(b, SESSION).dimensions).toEqual(m.dimensions);
  });

  it("bands scores on the PDF thresholds", () => {
    expect([100, 70, 69, 60, 59, 40, 39, 0].map(scoreBand)).toEqual(["high", "high", "mid", "mid", "low", "low", "fail", "fail"]);
  });
});

describe("page ↔ PDF parity", () => {
  it("renders the same content in the same order on the page and in the PDF", () => {
    const a = fixture();
    const seq = reportSequence(a);
    expectInOrder(textOf(renderAuditHtml(a, SESSION)), seq);
    expectInOrder(webText(a), seq);
  });

  it("parity holds with no gaps", () => {
    const a = { ...fixture(), gaps: [] };
    const seq = reportSequence(a);
    expect(seq).toContain(AUDIT_REPORT_COPY.gapsEmpty);
    expectInOrder(textOf(renderAuditHtml(a, SESSION)), seq);
    expectInOrder(webText(a), seq);
  });

  it("the JSON download sentence is in the PDF only", () => {
    const a = fixture();
    const pdf = textOf(renderAuditHtml(a, SESSION));
    expect(pdf).toContain(`${AUDIT_REPORT_COPY.jsonIntro}${AUDIT_REPORT_COPY.jsonIntroPdfOnly}`);
    expect(webText(a)).not.toContain(AUDIT_REPORT_COPY.jsonIntroPdfOnly.trim());
  });

  it("gaps render lowest score first in both the PDF and the page", () => {
    const a = fixture();
    a.gaps.reverse(); // 64 first, 0 second in the payload
    const seq = ["Dimension breakdown", AUDIT_REPORT_COPY.gapsHeading, "JSON-LD Organization", "Blockquote <pitch> & quality", AUDIT_REPORT_COPY.jsonHeading];
    expectInOrder(textOf(renderAuditHtml(a, SESSION)), seq);
    expectInOrder(webText(a), seq);
  });

  it("the page includes the full JSON export the PDF embeds", () => {
    const a = fixture();
    const html = renderToStaticMarkup(<AuditReportBody model={buildAuditReportModel(a, SESSION)} />);
    const pre = html.match(/<pre[^>]*data-testid="audit-report-json"[^>]*>([\s\S]*?)<\/pre>/);
    expect(pre).not.toBeNull();
    expect(JSON.parse(decode(pre![1]))).toEqual(a);
  });
});

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

describe("AuditReportView markup", () => {
  const html = renderToStaticMarkup(
    <>
      <AuditReportHeader model={buildAuditReportModel(fixture(), SESSION)} />
      <AuditReportBody model={buildAuditReportModel(fixture(), SESSION)} />
    </>,
  );

  it("renders one section per dimension, one row per scored sub-check and one card per gap", () => {
    expect(html.match(/data-testid="audit-report-dimension"/g)).toHaveLength(3);
    expect(html.match(/data-testid="audit-report-check"/g)).toHaveLength(4);
    expect(html.match(/data-testid="audit-report-gap"/g)).toHaveLength(2);
  });

  it("escapes payload text instead of injecting it", () => {
    expect(html).not.toContain("<pitch>");
    expect(html).toContain("&lt;pitch&gt;");
  });

  it("stays radius-free (rounded-* only on the functional spinner, which is not here)", () => {
    expect(html).not.toMatch(/\brounded(-|\b)/);
  });
});

describe("parseAuditResult", () => {
  it("accepts a stored audit payload", () => {
    const a = fixture();
    expect(parseAuditResult(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it.each([
    null,
    "nope",
    {},
    { scan: {}, gaps: [] },
    { scan: { url: "x", composite: { score: 1, grade: "F" }, dimensions: [] } },
    { scan: { url: "x", dimensions: [] }, gaps: [] },
  ])("rejects %j", (bad) => {
    expect(parseAuditResult(bad)).toBeNull();
  });
});
