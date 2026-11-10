// Paid Audit report notes (2026-11-10): the report shows plain-language
// sub-check notes (plainScoreNote) in the check tables and "Finding:" lines,
// while remediation, the executive summary and the JSON export keep reading
// the raw scanner note. Plus the Organization entry clause and the version
// comparability notice.
import { describe, expect, it } from "vitest";
import { buildRemediationGaps, renderAuditHtml } from "./audit-pipeline";
import { AUDIT_REPORT_COPY, buildAuditReportModel } from "./audit-report-model";
import { buildExecutiveSummary } from "./audit-executive-summary";
import { remediationFor, T } from "./remediation-templates";
import { plainScoreNote } from "./score-notes";
import { VERSION_COMPARABILITY_NOTICE } from "./version-notice";
import { METHODOLOGY_CALIBRATION_MD } from "./methodology-content";
import type { AuditResult, ScanResult, SubCheck } from "./audit-types";

// The scanner's note for Rachel Queiroz's real @graph (MedicalBusiness #clinica
// without a description; Person #pessoa with description and sameAs), as
// scanner/src/report-truthfulness-r3.test.ts asserts it.
const RACHEL_ORG_NOTE =
  "Organization found: name=true, url=true, description=false, sameAs=0; entry=MedicalBusiness #clinica; description and sameAs present on Person #pessoa";
const RACHEL_ORG_PLAIN =
  "Your MedicalBusiness entry (#clinica) has a name and a URL but no description. Your Person entry (#pessoa) has a description and sameAs links, but this check reads the MedicalBusiness entry.";

const n = (id: string, notes: string) => plainScoreNote({ id, notes });

const sc = (id: string, score: number, notes: string, extra: Partial<SubCheck> = {}): SubCheck => ({
  id,
  name: id,
  weight: 20,
  score,
  passed: score >= 70,
  notes,
  ...extra,
});

function scan(scoringVersion: string | undefined = "1.5.1"): ScanResult {
  return {
    id: "scan-notes",
    url: "https://example-clinic.test/",
    composite: { score: 55, grade: "D" },
    dimensions_scored: 2,
    dimensions_total: 6,
    dimensions_applicable: 2,
    created_at: Date.UTC(2026, 10, 10),
    ...(scoringVersion ? { scoring_version: scoringVersion } : {}),
    dimensions: [
      {
        dimension_id: 1,
        dimension_name: "llms.txt Quality",
        score: 40,
        grade: "D",
        sub_checks: [
          sc("presence", 100, 'status=200, content-type="text/plain"', { weight: 25 }),
          sc("spec_compliance", 50, "h1=yes, blockquote=no", { weight: 25 }),
          sc("curation_quality", 80, "links contain query strings", { weight: 15 }),
        ],
      },
      {
        dimension_id: 4,
        dimension_name: "Structured Capability Data",
        score: 60,
        grade: "D",
        sub_checks: [
          sc("json_ld_present", 100, "3 valid JSON-LD block(s) on homepage", { weight: 25 }),
          sc("organization_schema", 60, RACHEL_ORG_NOTE),
          sc("service_offer_schema", 50, "1 Service/Product/Offer block(s); best match has 2/3 required fields"),
        ],
      },
    ],
  };
}

function audit(s = scan()): AuditResult {
  return { scan: s, gaps: buildRemediationGaps(s), engine_version: "v10" };
}

describe("plainScoreNote: Organization entry clause", () => {
  it("the customer's MedicalBusiness + Person @graph", () => {
    expect(n("organization_schema", RACHEL_ORG_NOTE)).toBe(RACHEL_ORG_PLAIN);
  });
  it.each([
    [
      "Organization found: name=true, url=true, description=true, sameAs=0; entry=Organization",
      "Your Organization entry has a name, URL and description.",
    ],
    [
      "Organization found: name=true, url=false, description=false, sameAs=2; entry=Dentist https://acme.com/org",
      "Your Dentist entry (https://acme.com/org) has a name but no URL or description.",
    ],
    [
      "Organization found: name=false, url=false, description=false, sameAs=0; entry=Organization #a",
      "Your Organization entry (#a) has no name, URL or description.",
    ],
    [
      "Organization found: name=true, url=true, description=false, sameAs=1; entry=Organization #a; description present on Corporation #b",
      "Your Organization entry (#a) has a name and a URL but no description. Your Corporation entry (#b) has a description, but this check reads the Organization entry.",
    ],
  ])("%s", (raw, plain) => {
    expect(n("organization_schema", raw)).toBe(plain);
  });
  it("old notes without the clause keep their earlier plain text", () => {
    expect(n("organization_schema", "Organization found: name=true, url=true, description=false, sameAs=0")).toBe(
      "Organization markup found, but it has no description.",
    );
  });
  it("an unknown clause falls through unchanged", () => {
    const odd = "Organization found: name=true, url=true, description=false, sameAs=0; entry=Organization; something else";
    expect(n("organization_schema", odd)).toBe(odd);
  });
});

describe("plainScoreNote: notes converted for the paid report", () => {
  it.each([
    ["curation_quality", "clean link list", "The llms.txt link list has none of the problems we check for (more than 100 links, links to tag, archive or search-result pages, links with query strings)."],
    ["curation_quality", "file missing — no link list to evaluate", "There is no llms.txt file, so there is no link list to check."],
    ["curation_quality", "empty file — no links to evaluate", "The llms.txt file is empty, so there are no links to check."],
    ["curation_quality", "140 links (>100); tag pages linked; links contain query strings", "The llms.txt link list has 140 links (more than 100), links to tag pages and links with query strings (a ? in the address)."],
    ["curation_quality", "archive pages linked; search-result URLs linked", "The llms.txt link list has links to archive pages and links to search-result pages."],
    ["json_ld_present", "1 valid JSON-LD block(s) on homepage", "The homepage has 1 valid JSON-LD block (structured data)."],
    ["json_ld_present", "3 valid JSON-LD block(s) on homepage", "The homepage has 3 valid JSON-LD blocks (structured data)."],
    ["json_ld_present", "2 JSON-LD block(s) present but failed to parse", "The homepage has 2 JSON-LD blocks (structured data), but none could be read: the JSON is not valid."],
    [
      "service_offer_schema",
      "2 Service/Product/Offer block(s); best match has 2/3 required fields",
      "We found 2 Service, Product or Offer entries. The most complete one has 2 of the 3 fields we check: a name, a description, and who provides it (such as provider, brand or seller).",
    ],
    [
      "service_offer_schema",
      "1 Service/Product/Offer block(s); best match has 1/3 required fields (on the sampled product page https://acme.com/products/tote; none on the homepage)",
      "We found 1 Service, Product or Offer entry on the product page we sampled (https://acme.com/products/tote), and none on the homepage. The most complete one has 1 of the 3 fields we check: a name, a description, and who provides it (such as provider, brand or seller).",
    ],
    ["review_schema", "2 Review/AggregateRating block(s); well-formed=true", "We found 2 Review or AggregateRating blocks; at least one is complete and valid."],
    [
      "review_schema",
      "1 Review/AggregateRating block(s); well-formed=false: each block is missing a required field",
      "We found 1 Review or AggregateRating block, but it is not complete and valid: each block is missing a required field.",
    ],
    ["review_schema", "1 Review/AggregateRating block(s); well-formed=true", "We found 1 Review or AggregateRating block; it is complete and valid."],
    [
      "review_schema",
      "3 Review/AggregateRating block(s); well-formed=false: some blocks are missing a required field and others have a value that is not valid",
      "We found 3 Review or AggregateRating blocks, but none is complete and valid: some blocks are missing a required field and others have a value that is not valid.",
    ],
    [
      "pricing_text_visibility",
      "Detected https://acme.com/pricing; 4 text-based price token(s); 2 with a billing period or marked one-time.",
      "Pricing page https://acme.com/pricing: 4 prices in the page text; 2 with a billing period or marked one-time.",
    ],
    [
      "pricing_text_visibility",
      'Detected https://acme.com/pricing; 1 price token(s) but none with a billing period (such as "/month") or marked one-time.',
      'Pricing page https://acme.com/pricing: 1 price in the page text, but none with a billing period (such as "/month") or marked one-time.',
    ],
    [
      "pricing_text_visibility",
      "No pricing page found, so we checked the prices shown on the homepage (https://acme.com/): 3 text-based price token(s); 0 with a billing period or marked one-time.",
      "No pricing page found, so we checked the prices shown on the homepage (https://acme.com/): 3 prices in the page text; 0 with a billing period or marked one-time.",
    ],
    [
      "case_study_scannability",
      "Sampled 1 page(s); avg 67/100. https://acme.com/work/a → 67 (headings: yes, lists: yes, bold text: no).",
      "We checked one case-study page (https://acme.com/work/a) and scored it 67/100: it has headings and lists but no bold text.",
    ],
    [
      "case_study_scannability",
      "Sampled 1 page(s); avg 100/100. https://acme.com/cases/a → 100 (headings: yes, lists: yes, bold text: yes). (A case study linked from the index page https://acme.com/cases.)",
      "We checked one case-study page (https://acme.com/cases/a) and scored it 100/100: it has headings, lists and bold text. (A case study linked from the index page https://acme.com/cases.)",
    ],
    [
      "well_known",
      'valid card at /.well-known/mcp.json with name="Resend", transports=1',
      'Found a valid MCP server card at /.well-known/mcp.json. It names the server "Resend" and lists 1 transport URL.',
    ],
    ["oauth_metadata", "auth=oauth2; OAuth metadata valid", "The MCP server card declares sign-in (oauth2), and its OAuth metadata is valid."],
    [
      "oauth_metadata",
      "auth=oauth2; OAuth metadata missing required endpoints",
      "The MCP server card declares sign-in (oauth2), but its OAuth metadata is missing a required endpoint (authorization_endpoint or token_endpoint).",
    ],
    ["oauth_metadata", "auth=oauth2; OAuth metadata invalid JSON", "The MCP server card declares sign-in (oauth2), but its OAuth metadata is not valid JSON."],
    [
      "oauth_metadata",
      "auth=oauth2; /.well-known/oauth-authorization-server returned 404",
      "The MCP server card declares sign-in (oauth2), but its OAuth metadata at /.well-known/oauth-authorization-server did not load (HTTP 404).",
    ],
    [
      "oauth_metadata",
      "auth=bearer; /.well-known/oauth-authorization-server returned no response",
      "The MCP server card declares sign-in (bearer), but its OAuth metadata at /.well-known/oauth-authorization-server did not load (no response).",
    ],
    [
      "discovery",
      "Found via well-known /.well-known/api-catalog at https://resend.com/openapi.yaml (content-type=text/yaml; charset=utf-8). Read through the API catalog at https://resend.com/.well-known/api-catalog (its service-desc link).",
      "Found your API description at https://resend.com/openapi.yaml, through the standard address /.well-known/api-catalog. Read through the API catalog at https://resend.com/.well-known/api-catalog (its service-desc link).",
    ],
    [
      "discovery",
      "Found via canonical /openapi.json at https://acme.com/openapi.json (content-type=application/json).",
      "Found your API description at https://acme.com/openapi.json, through the common address /openapi.json.",
    ],
    [
      "discovery",
      "Found via homepage link https://acme.com/v1/api.yaml at https://acme.com/v1/api.yaml (content-type=unknown).",
      "Found your API description at https://acme.com/v1/api.yaml, through a link on your homepage.",
    ],
    [
      "markdown_negotiation",
      "Accept: text/markdown returns text/markdown; charset=utf-8 (directly). Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored.",
      "Your homepage returns Markdown when a request asks for it (Accept: text/markdown). Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored.",
    ],
    [
      "markdown_negotiation",
      "Accept: text/markdown returns text/markdown (redirected to .md variant).",
      "Your homepage returns Markdown when a request asks for it (Accept: text/markdown), by redirecting to a .md page.",
    ],
    ["info_completeness", "info: title=yes, version=yes, description=yes (3/3)", "The info section of your API description has a title, a version and a description."],
    [
      "info_completeness",
      "info: title=yes, version=no, description=<20 chars or missing (1/3)",
      "The info section of your API description has a title but no version or description (of 20 characters or more).",
    ],
    [
      "info_completeness",
      "info: title=no, version=no, description=<20 chars or missing (0/3)",
      "The info section of your API description has no title, version or description (of 20 characters or more).",
    ],
    [
      "operation_coverage",
      "83 operation(s); 83/83 have a summary or description. (count=100, doc=100)",
      "Your API description defines 83 operations; 83 of 83 have a summary or description.",
    ],
    [
      "operation_coverage",
      "1 operation(s); 0/1 have a summary or description. (count=20, doc=0)",
      "Your API description defines 1 operation; 0 of 1 have a summary or description.",
    ],
  ])("%s: %s", (id, raw, plain) => {
    expect(n(id, raw)).toBe(plain);
  });

  it.each([
    ["curation_quality", "the file has no Markdown links ([text](url)) to evaluate"],
    ["curation_quality", "tag pages linked; something new"],
    ["json_ld_present", "no JSON-LD found on homepage"],
    ["service_offer_schema", "no Service / Product / Offer schema"],
    ["review_schema", "2 Review/AggregateRating block(s); well-formed=true: odd"],
    ["pricing_text_visibility", "Detected pricing path https://acme.com/pricing but it didn't return 200."],
    ["case_study_scannability", "Sampled 2 page(s); avg 50/100."],
    ["citation_domain_named_rate", "6 of 10 scored test answers named your domain."],
    ["oauth_metadata", "No MCP server card found, so there is no declared authentication to check. This check is not counted in your score."],
    ["discovery", "Found via something else at https://acme.com/x (content-type=text/yaml)."],
  ])("%s: unknown or already-plain note falls through unchanged (%s)", (id, raw) => {
    expect(n(id, raw)).toBe(raw);
  });
});

describe("paid report shows plain notes; consumers keep raw notes", () => {
  it("check table rows and Finding: lines are plain", () => {
    const m = buildAuditReportModel(audit(), "sess-0001");
    const rows = m.dimensions.flatMap((d) => (d.kind === "scored" ? d.checks : []));
    const row = (id: string) => rows.find((r) => r.id === id)!.notes;
    expect(row("organization_schema")).toBe(RACHEL_ORG_PLAIN);
    expect(row("presence")).toBe("Found an llms.txt file at /llms.txt.");
    expect(row("spec_compliance")).toBe("The file has an H1 title but no blockquote summary (a line starting with >).");
    expect(row("json_ld_present")).toBe("The homepage has 3 valid JSON-LD blocks (structured data).");
    const finding = m.gaps.find((g) => g.checkName === "organization_schema")!.finding;
    expect(finding).toBe(RACHEL_ORG_PLAIN);
  });

  it("rendered paid HTML carries the plain notes and no raw key=value notes", () => {
    const html = renderAuditHtml(audit(), "sess-0001");
    const body = html.slice(0, html.indexOf('<pre class="json"'));
    expect(body).toContain("Your MedicalBusiness entry (#clinica) has a name and a URL but no description.");
    expect(body).toContain("Your Person entry (#pessoa) has a description and sameAs links, but this check reads the MedicalBusiness entry.");
    expect(body).not.toMatch(/description=false|entry=|h1=yes|status=200|valid JSON-LD block\(s\)|best match has/);
  });

  it("remediation is chosen from the raw note, same as for the note without the entry clause", () => {
    const a = audit();
    const gap = a.gaps.find((g) => g.check_id === "organization_schema")!;
    expect(gap.notes).toBe(RACHEL_ORG_NOTE);
    expect(gap.remediation).toBe(T.organization_schema.missingFields("description"));
    const ctx = { origin: "https://example-clinic.test", host: "example-clinic.test", siblings: [] };
    const old = sc("organization_schema", 60, "Organization found: name=true, url=true, description=false, sameAs=0");
    expect(remediationFor(sc("organization_schema", 60, RACHEL_ORG_NOTE), ctx)).toBe(remediationFor(old, ctx));
  });

  it("building the report leaves the stored notes raw (executive summary, JSON export)", () => {
    const a = audit();
    const before = JSON.stringify(a);
    const m = buildAuditReportModel(a, "sess-0001");
    expect(JSON.stringify(a)).toBe(before);
    expect(m.jsonExport).toContain(RACHEL_ORG_NOTE);
    expect(m.executiveSummary).toEqual(buildExecutiveSummary(a, AUDIT_REPORT_COPY.gapsHeading));
  });
});

describe("version comparability notice", () => {
  const NOTICE =
    "Scores are only comparable between reports made with the same version. Astrant Score scoring version 1.5.1 (Nov 7, 2026) and Citation Visibility v5 (Nov 8, 2026) measure more strictly than earlier versions, so a lower score after these dates does not by itself mean your site got worse.";

  it("is the approved sentence", () => {
    expect(VERSION_COMPARABILITY_NOTICE).toBe(NOTICE);
  });
  it("names this report's scoring version from the scan, under the coverage line", () => {
    const m = buildAuditReportModel(audit(), "sess-0001");
    expect(m.versionNote).toBe(`This report was scored with Astrant Score scoring version 1.5.1. ${NOTICE}`);
    const html = renderAuditHtml(audit(), "sess-0001");
    expect(html.indexOf(m.versionNote)).toBeGreaterThan(html.indexOf(m.scopeNote));
    expect(html.indexOf(m.versionNote)).toBeLessThan(html.indexOf(AUDIT_REPORT_COPY.summaryHeading));
  });
  it("leaves the version out when the scan has none or a malformed one", () => {
    expect(buildAuditReportModel(audit(scan("")), "s").versionNote).toBe(NOTICE);
    expect(buildAuditReportModel(audit(scan("1.5.1<b>")), "s").versionNote).toBe(NOTICE);
  });
  it("is on the calibration methodology page", () => {
    expect(METHODOLOGY_CALIBRATION_MD).toContain(NOTICE);
  });
});
