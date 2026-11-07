// r4: every note the scanner currently emits must select a remediation
// template that does not contradict it (no "no card" while a card exists,
// no "no prices" while prices were counted, ...). Inputs: every sub-check
// of the ten r3-final report-panel scans (real scanner 1.4.0 output), plus
// the note shapes scanner 1.4.1 can emit, each tied to a literal in the
// scanner source so the list cannot silently drift from the scanner.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { remediationFor, UNKNOWN_CHECK_REMEDIATION, type RemediationContext } from "./remediation-templates";
import type { SubCheck } from "./audit-types";

type Fixture = {
  sites: Array<{ site: string; url: string; dimensions: Array<{ dimension_id: number; na: boolean; sub_checks: SubCheck[] }> }>;
};
const FIX = JSON.parse(readFileSync(new URL("./__fixtures__/r3-final-subchecks.json", import.meta.url), "utf8")) as Fixture;

const SCANNER_SRC = (() => {
  const dir = new URL("../../../scanner/src/checks/", import.meta.url);
  return readdirSync(dir)
    .filter((f) => /\.ts$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n");
})();

const sc = (id: string, notes: string, score = 0, extra: Partial<SubCheck> = {}): SubCheck => ({ id, name: id, weight: 20, score, passed: score >= 70, notes, ...extra });
const NO = String.fromCharCode(0x2717);
const YES = String.fromCharCode(0x2713);
const ARROW = String.fromCharCode(0x2192);

// [check id, note as scanner 1.4.1 emits it, literal from the scanner source, siblings]
const CURRENT: Array<[string, string, string, SubCheck[]]> = [
  ["well_known", "no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json", "no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json", []],
  [
    "well_known",
    "no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json; an MCP server was found (an MCP endpoint answered at https://example.com/api/mcp) but it is not advertised with a server card",
    "but it is not advertised with a server card",
    [],
  ],
  ["well_known", "card present at /.well-known/mcp.json but missing a server name and a transport URL (transports[], remotes[] or remote.url)", "card present at ${from} but missing ${missing.join", []],
  ["well_known", "card present at /.well-known/mcp/server-card.json but missing a server name", '"a server name"', []],
  ["well_known", "card present at /.well-known/mcp.json but invalid JSON", "but invalid JSON", []],
  ["tool_coverage", "no card or no tools declared", "no card or no tools declared", []],
  ["tool_coverage", "card has no tools[] field (may be a minimal/discovery-only card)", "card has no tools[] field", []],
  ["tool_coverage", "2 tool(s) declared: 1 with a description, 0 with an input schema (inputSchema); 0 have both", "tool(s) declared: ${described.length} with a description", []],
  ["tool_coverage", "0 tool(s) declared: 0 with a description, 0 with an input schema (inputSchema); 0 have both", "tool(s) declared: ", []],
  ["oauth_metadata", "auth=oauth2; /.well-known/oauth-authorization-server returned 404", "returned ${r?.status", []],
  ["oauth_metadata", "auth=oauth2; OAuth metadata missing required endpoints", "OAuth metadata missing required endpoints", []],
  [
    "live_invocation",
    "no MCP endpoint answered: no server card with a transport URL, and https://example.com/api/mcp did not answer an MCP initialize request",
    "no MCP endpoint answered: no server card with a transport URL",
    [sc("well_known", "no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json")],
  ],
  [
    "live_invocation",
    "no transport URL in card to invoke, and https://example.com/mcp did not answer an MCP initialize request",
    "no transport URL in card to invoke",
    [sc("well_known", "card present at /.well-known/mcp.json but missing a transport URL", 50)],
  ],
  [
    "live_invocation",
    "no usable transport URL in card to invoke: the card's transport URL is not a valid web address",
    "no usable transport URL in card to invoke",
    [sc("well_known", 'valid card at /.well-known/mcp.json with name="x", transports=1', 100)],
  ],
  ["live_invocation", "tools/list timed out or failed for https://example.com/mcp", "tools/list timed out or failed for", [sc("well_known", "no card at x")]],
  ["live_invocation", "initialize returned status 500", "initialize returned status ${init.status}", [sc("well_known", 'valid card at /.well-known/mcp.json with name="x", transports=1', 100)]],
  ["dns_txt", "DNS lookup for _mcp.example.com did not complete. Informational only: no ratified standard defines an _mcp DNS record, so this is not scored.", "did not complete. ${DNS_TXT_INFO_NOTE}", []],
  ["dns_txt", "No TXT record at _mcp.example.com. Informational only: no ratified standard defines an _mcp DNS record, so this is not scored.", "`No TXT record at _mcp.${host}. ${DNS_TXT_INFO_NOTE}`", []],
  ["spec_validity", "Spec at https://example.com/openapi.yaml did not parse as JSON or recognizable YAML.", "did not parse as JSON or recognizable YAML.", []],
  ["spec_validity", 'YAML parsed but no "openapi" or "swagger" version field at the root.', '${fmt} parsed but no "openapi" or "swagger" version field at the root.', []],
  ["security_schemes", "Skipped — spec did not parse as JSON or YAML.", "Skipped — spec did not parse as JSON or YAML.", []],
  ["discovery", "Found via homepage link https://example.com/v1/api.yaml (content-type=text/plain).", "source: `homepage link ${candidate}`", []],
  ["json_ld_present", "2 JSON-LD block(s) present but failed to parse", "JSON-LD block(s) present but failed to parse", []],
  ["organization_schema", "Organization found: name=true, url=true, description=false, sameAs=0", "Organization found: name=", []],
  ["service_offer_schema", "no Service / Product / Offer schema", '"no Service / Product / Offer schema"', []],
  ["service_offer_schema", "1 Service/Product/Offer block(s); best match has 0/3 required fields", "best match has ${bestPartial}/3 required fields", []],
  [
    "service_offer_schema",
    "no Service / Product / Offer schema on the homepage or on the sampled product page (https://example.com/products/tote)",
    "no Service / Product / Offer schema on the homepage or on the sampled product page",
    [],
  ],
  [
    "service_offer_schema",
    "2 Service/Product/Offer block(s); best match has 2/3 required fields (on the sampled product page https://example.com/products/tote; none on the homepage)",
    "none on the homepage)",
    [],
  ],
  ["faq_schema", "FAQPage markup found, but none of its entries is a Question with an answer text (acceptedAnswer.text), so there are no Q&A pairs to rate.", "none of its entries is a Question", []],
  // 1.5.0 fixed-rule notes.
  // 1.5.1 fixed-rule notes.
  ["faq_schema", "4 Q&A pair(s); 1 is phrased as a question and has an answer of reasonable length.", "an answer of reasonable length.", []],
  [
    "faq_schema",
    "6 Q&A pair(s); 1 is phrased as a question and has an answer of reasonable length. 5 entries are missing a question or an answer.",
    "entries are missing a question or an answer.",
    [],
  ],
  [
    "blockquote_eval",
    "1 of 2 blockquote rules met: one paragraph (yes); 10 to 100 words (no, 120 words).",
    "of 2 blockquote rules met: one paragraph (${yesNo(onePara)}); ${BLOCKQUOTE_MIN_WORDS} to ${BLOCKQUOTE_MAX_WORDS} words (${yesNo(lengthOk)}, ${words} words).",
    [],
  ],
  ["spec_validity", "The YAML spec repeats a key (paths) in the same section, so we could not tell which version to read.", "in the same section, so we could not tell which version to read.", []],
  ["blockquote_eval", "blockquote contains instruction-like text; scored 0", '"blockquote contains instruction-like text; scored 0"', []],
  ["review_schema", "2 Review/AggregateRating block(s); well-formed=false", "Review/AggregateRating block(s); well-formed=", []],
  ["js_vs_no_js_render_diff", "About 16% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs.", "of the distinct words on your homepage appear in both", []],
  ["js_vs_no_js_render_diff", "Static fetch returned minimal HTML (likely a JS-required SPA shell). Live page rendering failed on this run, so this check was scored on your server's HTML only.", "Static fetch returned minimal HTML", []],
  ["page_weight_lcp", "Homepage HTML size: 1.52 MB (1593835 bytes). This check looks at page size only; it does not measure loading speed.", "Homepage HTML size: ", []],
  [
    "markdown_negotiation",
    "We found no Markdown version at the addresses we checked (https://example.com/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead.",
    "We found no Markdown version at the addresses we checked",
    [],
  ],
  ["markdown_negotiation", "Site did not respond to markdown or HTML requests.", "Site did not respond to markdown or HTML requests.", []],
  [
    "markdown_negotiation",
    "Site did not respond to markdown or HTML requests. Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored.",
    "serving Markdown is an emerging convention most hosts don't support yet, so this is not scored.",
    [],
  ],
  ["pricing_text_visibility", 'Detected https://example.com/pricing; 1 price token(s) but none with a billing period (such as "/month") or marked one-time.', "price token(s) but none with a billing period", []],
  ["pricing_text_visibility", "Detected https://example.com/pricing; no price patterns detected on the pricing page.", "no price patterns detected on the pricing page", []],
  ["pricing_text_visibility", "Detected https://example.com/pricing; prices found but appear inside modal-suggesting markup.", "modal-suggesting markup", []],
  ["pricing_text_visibility", "Detected pricing path https://example.com/plans but it didn't return 200.", "but it didn't return 200.", []],
  ["case_study_scannability", "Detected case-study paths (https://example.com/customers/a) but none returned 200.", "but none returned 200.", []],
  [
    "case_study_scannability",
    `Sampled 1 page(s); avg 43/100. https://example.com/customers/a ${ARROW} 43 (h:${NO} l:${YES} b:${NO}).`,
    "Sampled 1 page(s); avg ${b.score}/100.",
    [],
  ],
  // 1.4.2 note shapes.
  ["json_ld_present", "no JSON-LD found on homepage", '"no JSON-LD found on homepage"', []],
  ["organization_schema", "no Organization schema", '"no Organization schema"', [sc("json_ld_present", "1 valid JSON-LD block(s) on homepage", 100)]],
  ["info_completeness", 'Spec is missing the "info" object entirely — required by OpenAPI 3.x §4.1.', 'Spec is missing the "info" object entirely', []],
  ["info_completeness", "info: title=yes, version=no, description=<20 chars or missing (1/3)", "info: title=${hasTitle", []],
  ["operation_coverage", 'Spec missing "paths" object — no operations defined.', 'Spec missing "paths" object', []],
  ["operation_coverage", "Spec has paths object but zero HTTP operations.", "Spec has paths object but zero HTTP operations.", []],
  ["review_schema", "2 Review/AggregateRating block(s); well-formed=false: each block is missing a required field", "each block is missing a required field", []],
  ["review_schema", "1 Review/AggregateRating block(s); well-formed=false: each block has a rating value or count that is not valid", "each block has a rating value or count that is not valid", []],
  [
    "review_schema",
    "3 Review/AggregateRating block(s); well-formed=false: some blocks are missing a required field and others have a value that is not valid",
    "some blocks are missing a required field and others have a value that is not valid",
    [],
  ],
  [
    "pricing_text_visibility",
    'No pricing page found, so we checked the prices shown on the homepage (https://example.com/): 1 price token(s) but none with a billing period (such as "/month") or marked one-time.',
    "No pricing page found, so we checked the prices shown on the homepage (",
    [],
  ],
  [
    "pricing_text_visibility",
    'No pricing page found, so we checked the prices shown on https://example.com/mapa, a page linked from the homepage: 1 price token(s) but none with a billing period (such as "/month") or marked one-time.',
    "a page linked from the homepage: ",
    [],
  ],
  [
    "case_study_scannability",
    `Sampled 1 page(s); avg 57/100. https://example.com/customers/a ${ARROW} 57 (headings: no, lists: yes, bold text: yes).`,
    "(headings: ${yn(b.headings)}, lists: ${yn(b.lists)}, bold text: ${yn(b.bold)})",
    [],
  ],
];

/** The first contradiction between a note and the template selected for it, or null. */
function contradiction(s: SubCheck, siblings: SubCheck[], out: string): string | null {
  const n = s.notes;
  const has = (frag: string) => out.includes(frag);
  const sib = (id: string) => siblings.find((x) => x.id === id);
  const noCardAtAll = (sib("well_known")?.score ?? 0) === 0 && /^no card at /.test(sib("well_known")?.notes ?? "no card at");
  switch (s.id) {
    case "well_known":
      if (/card present at|valid card/.test(n) && has("We found no MCP discovery card")) return "no-card text for an existing card";
      if (/^no card at/.test(n) && has("We found a discovery card")) return "card text without a card";
      break;
    case "tool_coverage":
      if (/tool\(s\) declared|card has no tools/.test(n) && has("there is no discovery card")) return "no-card text for an existing card";
      if (/^[1-9]\d* tool\(s\) declared/.test(n) && has("has no tools array")) return "no-tools text with tools";
      if (/^0 tool\(s\) declared/.test(n) && has("0 of the 0 tools")) return "counts of zero tools";
      break;
    case "live_invocation":
      if ((/^no MCP endpoint answered/.test(n) || noCardAtAll) && (has("endpoint in your discovery card") || has("We found no URL in your discovery card")))
        return "card endpoint text without a card";
      if (!noCardAtAll && has("without a discovery card")) return "no-card text with a card";
      if (/not a valid web address/.test(n) && has("We found no URL")) return "no-URL text for a malformed URL";
      break;
    case "dns_txt":
      if (/did not complete|^DoH /.test(n) !== has("failed on this run")) return "lookup state mismatch";
      if (/^\d+ TXT record\(s\) at/.test(n) && has("We found no TXT record")) return "no-record text with a record";
      break;
    case "blockquote_eval":
      if (has("AI rating") || has("judgement, not a measurement")) return "AI-rating text after 1.5.0";
      if (/one paragraph \(yes\)/.test(n) && has("make it a single paragraph")) return "paragraph fix for one paragraph";
      if (/words \(yes,/.test(n) && has("make it 10 to 100 words long")) return "length fix for a valid length";
      if (has("name your business in it")) return "name fix after 1.5.1 (rule dropped)";
      if (/^\d of [23] blockquote rules met/.test(n) && has("There is no blockquote summary")) return "no-blockquote text with a blockquote";
      break;
    case "spec_validity":
      if (has("limit of our tool") || has("reads only the version field")) return "YAML-limit text after 1.5.0";
      if (/^YAML parsed/.test(n) && has("The JSON document we found")) return "JSON text for a YAML spec";
      break;
    case "discovery":
      if (!/homepage[ -]link/.test(n) && has("only through a link on your homepage")) return "homepage-link text the note does not prove";
      break;
    case "json_ld_present":
      if (/valid JSON-LD block|failed to parse/.test(n) && has("has no JSON-LD")) return "no-JSON-LD text with JSON-LD";
      if (!/^no JSON-LD found on homepage$/.test(n) && has("has no JSON-LD")) return "absence text the note does not prove";
      break;
    case "organization_schema":
      if (/^Organization found/.test(n) && has("has no Organization")) return "no-Organization text with an Organization";
      if (!/^no Organization schema$/.test(n) && (has("has no Organization") || has("no Organization structured data"))) return "absence text the note does not prove";
      break;
    case "info_completeness":
      if (!/missing the "info" object/.test(n) && has("has no info object")) return "no-info text the note does not prove";
      break;
    case "operation_coverage":
      if (!/^Spec missing "paths" object|zero HTTP operations/.test(n) && has("defines no operations")) return "no-operations text the note does not prove";
      break;
    case "review_schema":
      if (has("none has a ratingValue, reviewRating or author")) return "missing-field text for a validated block";
      if (/not valid$/.test(n) && /^\d+ Review/.test(n) && !/some blocks/.test(n) && has("is missing a field")) return "missing-field text for an invalid value";
      if (/each block is missing a required field$/.test(n) && has("values did not pass")) return "invalid-value text for a missing field";
      break;
    case "service_offer_schema":
      if (/Service\/Product\/Offer block/.test(n) && has("We found no Service, Product or Offer structured data")) return "no-markup text with markup";
      if (/sampled product page/.test(n) && (has("reads the homepage only") || has("block on your homepage"))) return "homepage-only text for a product page";
      break;
    case "faq_schema":
      if (/^[1-9]\d* Q&A pair/.test(n) && has("no questions")) return "no-questions text with questions";
      if (has("AI rating") || has("judgement, not a measurement")) return "AI-rating text after 1.5.0";
      break;
    case "js_vs_no_js_render_diff": {
      const pct = (n.match(/^About (\d+)% of the distinct words/) ?? n.match(/token overlap (\d+)%/))?.[1];
      if (pct && (!has(`About ${pct}% of the distinct words`) || has("almost no text"))) return "overlap figure not carried or shell text";
      if (has("% of the text on your homepage")) return "overlap read as a share of the text";
      if (!/minimal HTML/.test(n) && has("almost no text")) return "app-shell text the note does not prove";
      break;
    }
    case "page_weight_lcp": {
      const mb = (n.match(/^Homepage HTML size: (\d+\.\d{2}) MB/) ?? n.match(/^Page weight (\d+\.\d{2})MB/))?.[1];
      if (mb && Number(mb) >= 1 && !has(`is ${mb} MB`)) return "size not carried";
      break;
    }
    case "markdown_negotiation":
      if (/did not respond/.test(n) !== has("did not answer our requests")) return "response state mismatch";
      break;
    case "pricing_text_visibility": {
      const tokens = Number(n.match(/; (\d+) (?:text-based )?price token/)?.[1] ?? 0);
      if (tokens > 0 && has("but no prices in its HTML text")) return "no-prices text with prices";
      if (/no price patterns detected/.test(n) && /We found \d+ price/.test(out)) return "price count without prices";
      if (/didn't return 200/.test(n) !== has("did not load")) return "loading state mismatch";
      if (/^No pricing page found/.test(n) && /pricing page/i.test(out)) return "pricing-page text without a pricing page";
      break;
    }
    case "case_study_scannability":
      if (/^Sampled/.test(n) && has("did not load")) return "not-loading text for a loaded page";
      if ((/headings: no/.test(n) || n.includes(`h:${NO}`)) !== has("fewer than three subheadings")) return "headings state mismatch";
      break;
  }
  return null;
}

const ctxFor = (origin: string, siblings: SubCheck[]): RemediationContext => ({ origin, host: new URL(origin).host, siblings });

describe("r4: remediation templates never contradict the scanner note", () => {
  it.each(CURRENT.map((c, i) => [c[0], c[1].slice(0, 70), i] as const))("1.4.1 note %s: %s", (_id, _n, i) => {
    const [id, notes, literal, siblings] = CURRENT[i];
    expect(SCANNER_SRC, `scanner source no longer contains ${JSON.stringify(literal)}`).toContain(literal);
    const s = sc(id, notes, 0);
    const out = remediationFor(s, ctxFor("https://example.com", siblings));
    expect(contradiction(s, siblings, out)).toBeNull();
  });

  // Remediation is written only for gaps (audit-gaps: not N/A and not
  // passed), so those are the notes that can reach a template.
  const realCases = FIX.sites.flatMap((site) =>
    site.dimensions.flatMap((d) =>
      d.sub_checks.filter((s) => !s.na && !s.passed).map((s) => ({ site: site.site, origin: new URL(site.url).origin, s, siblings: d.sub_checks })),
    ),
  );

  it("the fixture holds the r3-final sub-checks of all 10 sites", () => {
    expect(FIX.sites).toHaveLength(10);
    expect(FIX.sites.reduce((n, x) => n + x.dimensions.reduce((m, d) => m + d.sub_checks.length, 0), 0)).toBe(250);
    expect(realCases.length).toBeGreaterThanOrEqual(30);
  });

  it.each(realCases.map((c, i) => [c.site, c.s.id, i] as const))("r3-final %s %s", (_site, _id, i) => {
    const { origin, s, siblings } = realCases[i];
    const out = remediationFor(s, ctxFor(origin, siblings));
    expect(contradiction(s, siblings, out), `${s.id}: ${s.notes}`).toBeNull();
  });

  it("an unrecognized note shape gets the neutral fallback, not a specific state", () => {
    for (const id of [
      "well_known",
      "tool_coverage",
      "service_offer_schema",
      "pricing_text_visibility",
      // r5: no invented absence or app-shell diagnosis.
      "js_vs_no_js_render_diff",
      "json_ld_present",
      "organization_schema",
      "info_completeness",
      "operation_coverage",
      "review_schema",
      // r6 (Codex round-5 leftover): these used to default to a specific state.
      "presence",
      "spec_compliance",
      "linked_pages_quality",
      "curation_quality",
      "blockquote_eval",
      "dns_txt",
      "discovery",
      "spec_validity",
      "security_schemes",
      "markdown_negotiation",
    ]) {
      expect(remediationFor(sc(id, "some future note shape"), ctxFor("https://example.com", []))).toBe(UNKNOWN_CHECK_REMEDIATION);
    }
  });

  it("r6: an unrecognized note stays neutral even when the llms.txt file exists", () => {
    const presenceOk = sc("presence", 'status=200, content-type="text/plain"', 100);
    for (const id of ["spec_compliance", "linked_pages_quality", "curation_quality", "blockquote_eval"]) {
      expect(remediationFor(sc(id, "some future note shape"), ctxFor("https://example.com", [presenceOk]))).toBe(UNKNOWN_CHECK_REMEDIATION);
    }
    // Passing states never get a "fix" template either.
    expect(remediationFor(sc("spec_compliance", "h1=yes, blockquote=yes"), ctxFor("https://example.com", [presenceOk]))).toBe(UNKNOWN_CHECK_REMEDIATION);
    expect(remediationFor(sc("curation_quality", "clean link list"), ctxFor("https://example.com", [presenceOk]))).toBe(UNKNOWN_CHECK_REMEDIATION);
    expect(
      remediationFor(
        sc("blockquote_eval", "2 of 2 blockquote rules met: one paragraph (yes); 10 to 100 words (yes, 80 words)."),
        ctxFor("https://example.com", [presenceOk]),
      ),
    ).toBe(UNKNOWN_CHECK_REMEDIATION);
    expect(remediationFor(sc("faq_schema", "3 Q&A pair(s); 3 are phrased as questions and have an answer of reasonable length."), ctxFor("https://example.com", []))).not.toMatch(/do not meet/);
    expect(remediationFor(sc("dns_txt", "1 TXT record(s) at _mcp.example.com. Informational only: no ratified standard defines an _mcp DNS record, so this is not scored."), ctxFor("https://example.com", []))).toBe(UNKNOWN_CHECK_REMEDIATION);
  });
});

describe("r7 (Codex r6): a failed measurement never selects absence wording", () => {
  const ctx = (siblings: SubCheck[]) => ctxFor("https://example.com", siblings);
  const ABSENCE = /there is no https:\/\/example\.com\/llms\.txt yet|Create a file at/;
  const DIM1_DEPENDENTS: Array<[string, string]> = [
    ["spec_compliance", "h1=no, blockquote=no"],
    ["linked_pages_quality", "no links to sample"],
    ["curation_quality", "file missing — no link list to evaluate"],
    ["blockquote_eval", "no blockquote to evaluate"],
  ];

  it.each(["fetch failed", "status=401", "status=403", "status=429", "status=500", "status=503"])("presence %s: the couldn't-read template, no absence", (note) => {
    const out = remediationFor(sc("presence", note), ctx([]));
    expect(out).not.toMatch(ABSENCE);
    expect(out).toMatch(/^We couldn't read https:\/\/example\.com\/llms\.txt on this run \(/);
    expect(out).toContain("If the file exists, check that your server lets automated clients fetch it; if it doesn't, create it — see the llms.txt format at llmstxt.org. Estimated effort: under 30 minutes.");
  });

  it.each(["status=404", "status=410"])("presence %s: the missing-file template", (note) => {
    expect(remediationFor(sc("presence", note), ctx([]))).toMatch(/^Create a file at https:\/\/example\.com\/llms\.txt/);
  });

  it.each(["fetch failed", "status=403", "status=500"])("Dim 1 dependents after presence %s: no absence wording", (note) => {
    const presence = sc("presence", note);
    for (const [id, n] of DIM1_DEPENDENTS) {
      const out = remediationFor(sc(id, n), ctx([presence]));
      expect(out, id).not.toMatch(ABSENCE);
      expect(out, id).toBe(UNKNOWN_CHECK_REMEDIATION);
    }
  });

  it("Dim 1 dependents after a 404: the missing-file text", () => {
    for (const [id, n] of DIM1_DEPENDENTS) {
      expect(remediationFor(sc(id, n), ctx([sc("presence", "status=404")])), id).toContain("there is no https://example.com/llms.txt yet");
    }
  });

  it("curation 'file missing' without a Presence result proves nothing", () => {
    expect(remediationFor(sc("curation_quality", "file missing — no link list to evaluate"), ctx([]))).toBe(UNKNOWN_CHECK_REMEDIATION);
  });

  const NO_CARD = "no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json";
  const wkUnread = sc("well_known", NO_CARD, 0, { evidence: { status: null, parsed: false, card_absent_proven: false } });
  const wkAbsent = sc("well_known", NO_CARD, 0, { evidence: { status: null, parsed: false, card_absent_proven: true } });

  it("Dim 2: card probes that failed get no 'no card' text", () => {
    expect(remediationFor(wkUnread, ctx([wkUnread]))).toBe(UNKNOWN_CHECK_REMEDIATION);
    expect(remediationFor(sc("tool_coverage", "no card or no tools declared"), ctx([wkUnread]))).toBe(UNKNOWN_CHECK_REMEDIATION);
    expect(
      remediationFor(
        sc("live_invocation", "no MCP endpoint answered: no server card with a transport URL, and https://example.com/api/mcp did not answer an MCP initialize request"),
        ctx([wkUnread]),
      ),
    ).toBe(UNKNOWN_CHECK_REMEDIATION);
  });

  it("Dim 2: 404 / 410 at both card addresses keeps the no-card text", () => {
    expect(remediationFor(wkAbsent, ctx([wkAbsent]))).toContain("We found no MCP discovery card");
    expect(remediationFor(sc("tool_coverage", "no card or no tools declared"), ctx([wkAbsent]))).toContain("there is no discovery card");
  });

  it("Dim 4: a homepage that was not read gets no 'has no markup' text", () => {
    const failed = { evidence: { status: null, parsed: false, ld_json_absent_proven: false } };
    const forbidden = sc("json_ld_present", "no JSON-LD found on homepage", 0, failed);
    expect(remediationFor(forbidden, ctx([forbidden]))).toBe(UNKNOWN_CHECK_REMEDIATION);
    expect(remediationFor(sc("organization_schema", "no Organization schema", 0, failed), ctx([forbidden]))).toBe(UNKNOWN_CHECK_REMEDIATION);
    expect(remediationFor(sc("service_offer_schema", "no Service / Product / Offer schema", 0, failed), ctx([forbidden]))).toBe(UNKNOWN_CHECK_REMEDIATION);
    // Read in full but "ld+json" not proven absent (e.g. truncated): no JSON-LD absence claim either.
    const truncated = { evidence: { status: 200, parsed: true, ld_json_absent_proven: false } };
    expect(remediationFor(sc("json_ld_present", "no JSON-LD found on homepage", 0, truncated), ctx([]))).toBe(UNKNOWN_CHECK_REMEDIATION);
  });

  it("Dim 4: a homepage read in full with no JSON-LD keeps the absence text", () => {
    const proven = { evidence: { status: 200, parsed: true, ld_json_absent_proven: true } };
    const ld = sc("json_ld_present", "no JSON-LD found on homepage", 0, proven);
    expect(remediationFor(ld, ctx([ld]))).toContain("Your homepage has no JSON-LD structured data");
    expect(remediationFor(sc("organization_schema", "no Organization schema", 0, proven), ctx([ld]))).toContain("Your homepage has no Organization structured data");
    expect(remediationFor(sc("service_offer_schema", "no Service / Product / Offer schema", 0, proven), ctx([ld]))).toContain("We found no Service, Product or Offer structured data");
  });
});
