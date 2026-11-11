// Remediation engine v6: every paid-Audit remediation is a fixed template
// selected by code from the scanner result (no model). These tests pin the
// coverage (every scanner check id has a template), the copy rules (no
// promises, no leaked placeholders, no internal jargon, an effort estimate),
// state selection from real scanner note shapes, and that no site text can
// reach a template slot.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIM6_REMEDIATION,
  REMEDIATION_CHECK_IDS,
  remediationFor,
  T,
  UNKNOWN_CHECK_REMEDIATION,
  type RemediationContext,
} from "./remediation-templates";
import type { SubCheck } from "./audit-types";

const ORIGIN = "https://example.com";
const sub = (id: string, notes: string, score = 0, extra: Partial<SubCheck> = {}): SubCheck => ({
  id,
  name: id,
  weight: 20,
  score,
  passed: false,
  notes,
  ...extra,
});
const ctx = (siblings: SubCheck[] = []): RemediationContext => ({ origin: ORIGIN, host: "example.com", siblings });
const presenceOk = sub("presence", 'status=200, content-type="text/plain"', 100, { passed: true });
const presenceMissing = sub("presence", "status=404", 0);

const NO = String.fromCharCode(0x2717);
const YES = String.fromCharCode(0x2713);
const ARROW = String.fromCharCode(0x2192);

// [check id, scanner note (verbatim template shape), siblings, substring the
// selected template must contain]
const FIXTURES: [string, string, SubCheck[], string][] = [
  // r7: only 404 / 410 proves the file is missing.
  ["presence", "fetch failed", [], "We couldn't read https://example.com/llms.txt on this run (the request timed out or failed)."],
  ["presence", "status=403", [], "We couldn't read https://example.com/llms.txt on this run (it returned status 403)."],
  ["presence", "status=500", [], "(it returned status 500). If the file exists, check that your server lets automated clients fetch it"],
  ["presence", "status=410", [], "Create a file at https://example.com/llms.txt"],
  ["presence", "status=404", [], "Create a file at https://example.com/llms.txt"],
  ["presence", 'status=200, content-type="text/html"', [], "does not send it as text"],
  ["spec_compliance", "h1=no, blockquote=no", [presenceMissing], "Depends on Presence"],
  ["spec_compliance", "h1=no, blockquote=no", [presenceOk], "expects both at the top"],
  ["spec_compliance", "h1=yes, blockquote=no", [presenceOk], "Add a one-paragraph summary directly under the H1"],
  ["spec_compliance", "h1=no, blockquote=yes", [presenceOk], "Add an H1 line at the top"],
  ["linked_pages_quality", "no links to sample", [presenceMissing], "Depends on Presence"],
  ["linked_pages_quality", "no links to sample", [presenceOk], "in the form this check reads"],
  ["linked_pages_quality", "1/5 sampled links return markdown-ish content", [presenceOk], "1 of the 5 links we sampled"],
  ["curation_quality", "file missing — no link list to evaluate", [presenceMissing], "Depends on Presence"],
  ["curation_quality", "empty file — no links to evaluate", [presenceOk], "so there was no list to judge"],
  ["curation_quality", "180 links (>100); links contain query strings", [presenceOk], "cut it from 180 links"],
  ["blockquote_eval", "no blockquote to evaluate", [presenceMissing], "Depends on Presence"],
  ["blockquote_eval", "no blockquote to evaluate", [presenceOk], "There is no blockquote summary"],
  ["blockquote_eval", "blockquote contains instruction-like text; scored 0 without LLM eval", [presenceOk], "reads like instructions"],
  ["blockquote_eval", "blockquote contains instruction-like text; scored 0", [presenceOk], "reads like instructions"],
  ["blockquote_eval", "blockquote empty after cleaning", [presenceOk], "no readable text"],
  // 1.5.0 fixed rules: one fix phrase per failed rule.
  [
    "blockquote_eval",
    "0 of 2 blockquote rules met: one paragraph (no); 10 to 100 words (no, 132 words).",
    [presenceOk],
    "make it a single paragraph (a > line with no text starts a new one) and make it 10 to 100 words long (it has 132 now).",
  ],
  [
    "blockquote_eval",
    "1 of 2 blockquote rules met: one paragraph (yes); 10 to 100 words (no, 3 words).",
    [presenceOk],
    "Edit the blockquote summary in https://example.com/llms.txt: make it 10 to 100 words long (it has 3 now). This check scores two fixed rules",
  ],
  // A 1.5.0 note (three rules, 50 to 250 words) is not a state the 1.5.1 template speaks to.
  [
    "blockquote_eval",
    "2 of 3 blockquote rules met: one paragraph (yes); 50 to 250 words (yes, 80 words); names the business (no).",
    [presenceOk],
    "This check did not pass",
  ],
  // An AI rating (before 1.5.0) is not a state a template can speak to.
  ["blockquote_eval", "LLM rated blockquote 22/100", [presenceOk], "This check did not pass"],
  ["well_known", "no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json", [], "We found no MCP discovery card"],
  ["well_known", "card present at /.well-known/mcp/server-card.json but missing name or transports[]", [], "https://example.com/.well-known/mcp/server-card.json but not both"],
  ["well_known", "card present at /.well-known/mcp.json but invalid JSON", [], "is not valid JSON"],
  ["tool_coverage", "no card or no tools declared", [], "Depends on Well-known discovery"],
  ["tool_coverage", "card has no tools[] field (may be a minimal/discovery-only card)", [], "has no tools array"],
  ["tool_coverage", "0 of 12 tools have description + inputSchema", [], "0 of the 12 tools"],
  ["oauth_metadata", "auth=oauth2; OAuth metadata missing required endpoints", [], "is missing authorization_endpoint"],
  ["oauth_metadata", "auth=oauth2; OAuth metadata invalid JSON", [], "oauth-authorization-server is not valid JSON"],
  ["oauth_metadata", "auth=oauth2; /.well-known/oauth-authorization-server returned 404", [], "returned status 404"],
  ["oauth_metadata", "auth=oauth2; /.well-known/oauth-authorization-server returned no response", [], "did not respond"],
  ["live_invocation", "no transport URL in card to invoke", [sub("well_known", "no card at x", 0)], "Depends on Well-known discovery"],
  ["live_invocation", "no transport URL in card to invoke", [sub("well_known", "card present", 50)], "We found no URL in your discovery card"],
  ["live_invocation", "initialize returned status 401", [], "status 401, which usually means it requires sign-in"],
  ["live_invocation", "initialize timed out or failed for https://example.com/mcp", [], "the request timed out or failed"],
  ["live_invocation", "initialize returned status 500", [], "initialize returned status 500"],
  ["live_invocation", "initialize returned 200 but no result in body", [], "initialize returned no result"],
  ["live_invocation", "tools/list returned status 502", [], "tools/list returned status 502"],
  ["live_invocation", "tools/list returned 200 but no tools[] in body", [], "did not return a tools list"],
  ["live_invocation", "initialize returned 200 but the reply exceeded the scan limit", [], "larger than our scan limit"],
  ["dns_txt", "no TXT at _mcp.www.example.com", [], "_mcp.www.example.com"],
  ["dns_txt", "DoH status 500", [], "Our DNS lookup for _mcp.example.com failed"],
  ["dns_txt", "No TXT record at _mcp.example.com. Informational only: no ratified standard defines an _mcp DNS record, so this is not scored.", [], "We found no TXT record at _mcp.example.com"],
  ["dns_txt", "DNS lookup for _mcp.example.com did not complete. Informational only: no ratified standard defines an _mcp DNS record, so this is not scored.", [], "Our DNS lookup for _mcp.example.com failed"],
  ["discovery", "Found via homepage link https://example.com/docs/openapi.json (content-type=application/json).", [], "only through a link on your homepage"],
  ["discovery", "Found via homepage-link at https://example.com/docs/openapi.json (content-type=application/json).", [], "only through a link on your homepage"],
  ["spec_validity", "Spec at https://example.com/openapi.json did not parse as JSON or recognizable YAML.", [], "did not parse as JSON"],
  // 1.5.0: YAML is parsed in full; the old partial-credit note proves nothing now.
  ["spec_validity", "YAML spec detected (openapi 3.0.3). The scanner checks a YAML spec's version field and reachability only, so it gets partial credit here.", [], "This check did not pass"],
  ["spec_validity", 'YAML parsed but no "openapi" or "swagger" version field at the root.', [], "This check did not pass"],
  ["spec_validity", 'JSON parsed but no "openapi" or "swagger" version field at the root.', [], "no openapi or swagger version field"],
  ["info_completeness", "info: title=yes, version=no, description=<20 chars or missing (1/3)", [], "add info.version and info.description"],
  ["info_completeness", 'Spec is missing the "info" object entirely — required by OpenAPI 3.x §4.1.', [], "has no info object"],
  ["info_completeness", "Skipped — spec did not parse as JSON.", [], "needs a spec that parses"],
  ["info_completeness", "Skipped — spec did not parse as JSON or YAML.", [], "needs a spec that parses"],
  ["security_schemes", "No components.securitySchemes and no top-level security:[] — agents have no signal.", [], "doesn't say how clients authenticate"],
  ["security_schemes", "Skipped — spec did not parse as JSON.", [], "needs a spec that parses"],
  ["operation_coverage", "3 operation(s); 1/3 have a summary or description. (count=75, doc=33)", [], "2 of the 3 operations"],
  ["operation_coverage", "2 operation(s); 2/2 have a summary or description. (count=50, doc=100)", [], "All 2 operations"],
  ["operation_coverage", 'Spec missing "paths" object — no operations defined.', [], "defines no operations"],
  ["operation_coverage", "Skipped — spec did not parse as JSON.", [], "needs a spec that parses"],
  ["json_ld_present", "no JSON-LD found on homepage", [], "has no JSON-LD structured data"],
  ["json_ld_present", "2 JSON-LD block(s) present but failed to parse", [], "2 JSON-LD block(s) on your homepage failed"],
  ["organization_schema", "no Organization schema", [sub("json_ld_present", "no JSON-LD found on homepage", 0)], "it can be the same block suggested"],
  ["organization_schema", "no Organization schema", [sub("json_ld_present", "1 valid JSON-LD block(s) on homepage", 100, { passed: true })], "The JSON-LD on your homepage has no Organization block"],
  ["organization_schema", "Organization found: name=true, url=false, description=false, sameAs=0", [], "is missing url and description"],
  ["service_offer_schema", "no Service / Product / Offer schema", [], "If your site doesn't sell anything"],
  ["service_offer_schema", "2 Service/Product/Offer block(s); best match has 1/3 required fields", [], "has 1 of the 3 fields"],
  ["faq_schema", "3 Q&A pair(s); 1 is phrased as a question and has an answer of reasonable length.", [], "2 of the 3 Q&A pairs in your FAQPage markup do not meet this check's rules"],
  [
    "faq_schema",
    "6 Q&A pair(s); 1 is phrased as a question and has an answer of reasonable length. 5 entries are missing a question or an answer.",
    [],
    "5 of the 6 Q&A pairs in your FAQPage markup do not meet this check's rules",
  ],
  // The 1.5.0 note was scored by other length rules: general text.
  ["faq_schema", "3 Q&A pair(s); 1 read as clear questions with direct answers.", [], "If you revise your FAQPage markup"],
  // Before 1.5.0 (AI rating): the general advice, never a rating.
  ["faq_schema", "3 Q&A pair(s); LLM rated 3 question(s) avg 10/100", [], "If you revise your FAQPage markup"],
  ["faq_schema", "3 Q&A pair(s); 3 question(s); instruction-like text detected; scored 0 without LLM eval", [], "If you revise your FAQPage markup"],
  ["review_schema", "2 Review/AggregateRating block(s); well-formed=false", [], "We found 2 Review or AggregateRating"],
  ["review_schema", "2 Review/AggregateRating block(s); well-formed=false: each block is missing a required field", [], "but each is missing a field this check needs"],
  ["review_schema", "1 Review/AggregateRating block(s); well-formed=false: each block has a rating value or count that is not valid", [], "but their values did not pass our checks"],
  ["review_schema", "3 Review/AggregateRating block(s); well-formed=false: some blocks are missing a required field and others have a value that is not valid", [], "but none passed our checks"],
  [
    "case_study_scannability",
    `Sampled 1 page(s); avg 57/100. https://example.com/customers/a ${ARROW} 57 (headings: no, lists: yes, bold text: yes).`,
    [],
    "we found fewer than three subheadings (h2 or h3). If",
  ],
  ["js_vs_no_js_render_diff", "Static-vs-rendered token overlap 16%; rendered HTML 3.2x the size of static.", [], "About 16% of the distinct words"],
  ["js_vs_no_js_render_diff", "About 16% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs.", [], "About 16% of the distinct words"],
  ["js_vs_no_js_render_diff", "Static fetch returned minimal HTML (likely a JS-required SPA shell). Browser Rendering call failed; scored on static signal only.", [], "app shell"],
  ["js_vs_no_js_render_diff", "Static fetch returned 3000 chars of body text but no obvious pricing/capabilities signals. Free-tier.", [], "didn't find words such as pricing"],
  ["page_weight_lcp", "Page weight 1.52MB (1593835 bytes); LCP not measured (free tier).", [], "is 1.52 MB"],
  ["markdown_negotiation", "No markdown variant or content negotiation. Agents must fall back to HTML extraction.", [], "https://example.com/index.md"],
  [
    "markdown_negotiation",
    "We found no Markdown version at the addresses we checked (https://example.com/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead. Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored.",
    [],
    "https://example.com/index.md",
  ],
  ["markdown_negotiation", "Site did not respond to markdown or HTML requests.", [], "did not answer our requests"],
  ["pricing_text_visibility", "Detected https://example.com/pricing; no price patterns detected on the pricing page.", [], "We found a pricing page (https://example.com/pricing) but no prices"],
  ["pricing_text_visibility", "Detected pricing path https://example.com/plans but it didn't return 200.", [], "(https://example.com/plans) did not load"],
  ["pricing_text_visibility", "Detected https://example.com/pricing; 1 price token(s) but none with /period suffix.", [], "We found 1 price(s)"],
  ["pricing_text_visibility", "Detected https://example.com/pricing; prices found but appear inside modal-suggesting markup.", [], "looks like a popup"],
  ["case_study_scannability", "Detected case-study paths (https://example.com/customers) but none returned 200.", [], "did not load"],
  [
    "case_study_scannability",
    `Sampled 2 page(s); avg 43/100. https://example.com/customers/a ${ARROW} 43 (h:${NO} l:${YES} b:${NO}); https://example.com/customers/b ${ARROW} 43 (h:${NO} l:${YES} b:${NO}).`,
    [],
    "fewer than three subheadings (h2 or h3) and no bold text",
  ],
  ...Object.keys(DIM6_REMEDIATION).map(
    (id): [string, string, SubCheck[], string] => [id, "30% of measurable cells named the target domain.", [], "You cannot edit ChatGPT"],
  ),
];

const ALL_OUTPUTS = FIXTURES.map(([id, notes, sibs]) => remediationFor(sub(id, notes), ctx(sibs)));

// Copy rules every customer-facing remediation must meet.
const BANNED: RegExp[] = [
  /\bwill\b/i, // outcome promises ("will improve", "will enable")
  /guarantee/i,
  /\bLMS\b|learning management/i,
  /\[site value\]/,
  /\bSlice\b/,
  /dim6:v|dim\d\b/i,
  /\bensure[sd]? (?:that )?(?:AI|agents|models)\b/i,
  /\b1 to 2 hours\b.*\bMCP server\b/i,
];

describe("template coverage", () => {
  it("every check id the scanner emits has its own template", () => {
    const dir = new URL("../../../scanner/src/checks/", import.meta.url);
    const ids = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (!/^dim\d-.*\.ts$/.test(f) || f.endsWith(".test.ts")) continue;
      const src = readFileSync(new URL(f, dir), "utf8");
      for (const m of src.matchAll(/\bid: "([a-z0-9_]+)"/g)) ids.add(m[1]);
      for (const m of src.matchAll(/\bconst id = "([a-z0-9_]+)"/g)) ids.add(m[1]);
      // Dim 3's unmeasured path builds its ids from a tuple list.
      for (const m of src.matchAll(/\["([a-z_]+)", "[^"]+", \d+\]/g)) ids.add(m[1]);
    }
    // JSON-RPC request ids and the always-N/A free-tier Dim 6 preview are not checks that can be gaps.
    for (const notACheck of ["scanner-init", "scanner-list", "free_tier_dim6_preview"]) ids.delete(notACheck);
    expect(ids.size).toBeGreaterThanOrEqual(25);
    for (const id of ids) expect(REMEDIATION_CHECK_IDS, `missing template for ${id}`).toContain(id);
  });

  it("every Dim 6 sub-check id built by runDim6 has a template", () => {
    const src = readFileSync(new URL("./dim6/runDim6.ts", import.meta.url), "utf8");
    // citation_misidentified_answers (dim6:v5) and citation_contradicted_answers
    // (dim6:v6) are informational (always na), never a gap.
    const INFORMATIONAL = new Set(["citation_misidentified_answers", "citation_contradicted_answers"]);
    const ids = [...src.matchAll(/: "(citation_[a-z_]+)"/g)].map((m) => m[1]).filter((id) => !INFORMATIONAL.has(id));
    expect(ids).toHaveLength(4);
    for (const id of ids) expect(REMEDIATION_CHECK_IDS).toContain(id);
  });

  it("fixtures cover every check id", () => {
    const covered = new Set(FIXTURES.map((f) => f[0]));
    for (const id of REMEDIATION_CHECK_IDS) expect(covered, id).toContain(id);
  });

  it("an unknown check id gets the neutral fallback, not a guess", () => {
    expect(remediationFor(sub("brand_new_check", "x"), ctx())).toBe(UNKNOWN_CHECK_REMEDIATION);
  });
});

describe("state selection from scanner notes", () => {
  it.each(FIXTURES.map((f, i) => [f[0], f[1].slice(0, 60), i] as const))("%s: %s", (_id, _n, i) => {
    expect(ALL_OUTPUTS[i]).toContain(FIXTURES[i][3]);
  });

  it("is deterministic", () => {
    const again = FIXTURES.map(([id, notes, sibs]) => remediationFor(sub(id, notes), ctx(sibs)));
    expect(again).toEqual(ALL_OUTPUTS);
  });
});

describe("copy rules", () => {
  it.each(ALL_OUTPUTS.map((t, i) => [FIXTURES[i][0], t] as const))("%s: plain, bounded, ends with an effort estimate", (_id, t) => {
    for (const re of BANNED) expect(t).not.toMatch(re);
    expect(t).toMatch(/ Estimated effort: [^.]+\.$/);
    expect(t.match(/Estimated effort:/g)).toHaveLength(1);
    expect(t).not.toMatch(/[\n\r]/);
    expect(t).not.toMatch(/\{|\}|undefined|null|NaN/);
    expect(t.length).toBeLessThanOrEqual(900); // REMEDIATION_MAX_CHARS
    expect(t.length).toBeGreaterThan(80);
  });

  it("1.5.0: no template speaks of an AI rating or a YAML limit of the scanner", () => {
    const src = readFileSync(new URL("./remediation-templates.ts", import.meta.url), "utf8");
    const textBlock = src.slice(src.indexOf("export const DIM6_REMEDIATION"), src.indexOf("// ─── State selection"));
    expect(textBlock).not.toMatch(/AI rating|judgement, not a measurement|reads only the version field|limit of our tool/);
  });

  it("the template module text itself carries no banned pattern", () => {
    const src = readFileSync(new URL("./remediation-templates.ts", import.meta.url), "utf8");
    const textBlock = src.slice(src.indexOf("export const DIM6_REMEDIATION"), src.indexOf("// ─── State selection"));
    for (const re of BANNED) expect(textBlock).not.toMatch(re);
  });

  it("realistic effort for multi-day work (no '1 to 2 hours' for an MCP server, OpenAPI or server rendering)", () => {
    expect(T.well_known.noCard(ORIGIN)).toContain("several days to build a new MCP server");
    expect(T.operation_coverage.noOperations).toContain("1 to 3 days");
    expect(T.js_vs_no_js_render_diff.shell).toContain("2 to 5 days");
    expect(T.js_vs_no_js_render_diff.lowOverlap(10)).toContain("2 to 5 days");
  });

  it("uses correct terms: llms.txt is Markdown at /llms.txt, FAQPage uses mainEntity/acceptedAnswer, MCP card under /.well-known/", () => {
    expect(T.presence.missing(ORIGIN)).toMatch(/plain Markdown file/);
    expect(T.presence.missing(ORIGIN)).toContain("llmstxt.org");
    expect(T.faq_schema.general).toMatch(/mainEntity.*acceptedAnswer/);
    expect(T.faq_schema.rules(1, 2)).toMatch(/Question has a name.*acceptedAnswer/);
    expect(T.well_known.noCard(ORIGIN)).toContain(`${ORIGIN}/.well-known/mcp.json`);
    expect(ALL_OUTPUTS.join(" ")).not.toMatch(/HTML blockquote|<blockquote/i);
  });

  it("never asks for invented content", () => {
    for (const t of [T.review_schema.missing(1), T.review_schema.invalid(1), T.review_schema.general(1)]) {
      expect(t).toMatch(/Only add ratings markup for real ratings/);
    }
    expect(T.faq_schema.rules(2, 3)).toMatch(/don't add questions to raise this score/);
    expect(T.tool_coverage.counts(1, 1)).toMatch(/don't list tools it doesn't offer/);
    expect(T.service_offer_schema.none).toMatch(/price only if you publish one/);
    expect(T.organization_schema.missingFields("description")).toMatch(/only for profiles you really have/);
  });

  it("the DNS TXT template gives a record value", () => {
    const t = remediationFor(sub("dns_txt", "no TXT at _mcp.example.com", 0, { weight: 10 }), ctx());
    expect(t).toContain("mcp=https://example.com/.well-known/mcp.json");
    expect(t).toContain("weight of 10% in this dimension");
  });

  it("case-study remediation does not ask for metrics (criterion dropped in scanner 1.3.3)", () => {
    for (const t of ALL_OUTPUTS.filter((_, i) => FIXTURES[i][0] === "case_study_scannability")) {
      expect(t).not.toMatch(/metric/i);
    }
  });
});

describe("slots carry only measured values", () => {
  it("a pricing URL on another host is dropped, never printed", () => {
    const t = remediationFor(sub("pricing_text_visibility", "Detected https://evil.example/pricing; no price patterns detected on the pricing page."), ctx());
    expect(t).not.toContain("evil");
    expect(t).toContain("We found a pricing page but no prices");
  });

  it("a pricing URL with a query string is dropped", () => {
    const t = remediationFor(sub("pricing_text_visibility", "Detected https://example.com/pricing?x=IGNORE; no price patterns detected on the pricing page."), ctx());
    expect(t).not.toContain("IGNORE");
  });

  it("a DNS host that is not the audited host falls back to the audited host", () => {
    const t = remediationFor(sub("dns_txt", "no TXT at _mcp.evil.example"), ctx());
    expect(t).not.toContain("evil");
    expect(t).toContain("_mcp.example.com");
  });

  it("an MCP card path not in the fixed list is never printed", () => {
    const t = remediationFor(sub("well_known", "card present at /evil/path but invalid JSON"), ctx());
    expect(t).not.toContain("/evil/path");
  });

  it("an oversized count is not echoed", () => {
    const t = remediationFor(sub("tool_coverage", "99999999 of 99999999 tools have description + inputSchema"), ctx());
    expect(t).not.toContain("99999999");
  });
});
