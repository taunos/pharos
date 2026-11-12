// Scanner 1.5.2 (2026-11-10 release check): RD-0117 page weight note,
// RD-0118 live_invocation names the endpoint tested, RD-0119 no "publish a
// card" advice when Shopify runs the store's MCP server.
import { describe, expect, it } from "vitest";
import { remediationFor, T, UNKNOWN_CHECK_REMEDIATION, type RemediationContext } from "./remediation-templates";
import { plainScoreNote } from "./score-notes";
import type { SubCheck } from "./audit-types";

const ORIGIN = "https://ugmonk.com";
const sub = (id: string, notes: string, score = 0, extra: Partial<SubCheck> = {}): SubCheck => ({
  id,
  name: id,
  weight: 20,
  score,
  passed: false,
  notes,
  ...extra,
});
const ctx = (siblings: SubCheck[] = []): RemediationContext => ({ origin: ORIGIN, host: "ugmonk.com", siblings });

const WK_FOUND =
  "no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json; an MCP server was found (an MCP endpoint answered at https://ugmonk.com/api/ucp/mcp) but it is not advertised with a server card";
const wk = (evidence: SubCheck["evidence"], notes = WK_FOUND) => sub("well_known", notes, 0, { evidence });

describe("RD-0119 well_known remediation", () => {
  it("Shopify runs the server: no advice to publish files under /.well-known/", () => {
    const s = wk({ card_absent_proven: true, mcp_endpoint: "https://ugmonk.com/api/ucp/mcp", mcp_hosted_by: "shopify" });
    const r = remediationFor(s, ctx([s]));
    expect(r).toBe(T.well_known.shopifyHosted(ORIGIN));
    expect(r).not.toMatch(/publish a JSON card/i);
    expect(r).toContain("run by Shopify");
    expect(r).toContain("up to Shopify");
    expect(r).not.toMatch(/30 minutes/);
  });

  it("a server found, host unknown: says it was found and who controls the card", () => {
    const s = wk({ card_absent_proven: true, mcp_endpoint: "https://acme.com/mcp" }, WK_FOUND.replace("https://ugmonk.com/api/ucp/mcp", "https://acme.com/mcp"));
    const r = remediationFor(s, ctx([s]));
    expect(r).toBe(T.well_known.foundServer(ORIGIN));
    expect(r).toContain("We found your MCP server");
    expect(r).toContain("up to the platform");
  });

  it("no server found: the original no-card text", () => {
    const s = wk({ card_absent_proven: true }, "no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json");
    expect(remediationFor(s, ctx([s]))).toBe(T.well_known.noCard(ORIGIN));
  });

  it("card absence not proven still gets the neutral text, Shopify or not", () => {
    const s = wk({ card_absent_proven: false, mcp_hosted_by: "shopify" });
    expect(remediationFor(s, ctx([s]))).toBe(UNKNOWN_CHECK_REMEDIATION);
  });

  it("tool_coverage: no 'publish a card' when Shopify runs the server", () => {
    const w = wk({ card_absent_proven: true, mcp_hosted_by: "shopify" });
    const t = sub("tool_coverage", "no card or no tools declared");
    expect(remediationFor(t, ctx([w, t]))).toBe(T.tool_coverage.noCardShopify);
    const w2 = wk({ card_absent_proven: true });
    expect(remediationFor(t, ctx([w2, t]))).toBe(T.tool_coverage.noCard);
  });
});

describe("RD-0118 live_invocation note names the endpoint tested", () => {
  it("1.5.2 note", () => {
    expect(plainScoreNote({ id: "live_invocation", notes: "tools/list returned 14 tools (endpoint tested: https://ugmonk.com/api/ucp/mcp)" })).toBe(
      "The MCP server at https://ugmonk.com/api/ucp/mcp answered and listed 14 tools."
    );
    expect(plainScoreNote({ id: "live_invocation", notes: "tools/list returned 1 tools (endpoint tested: https://ugmonk.com/api/mcp)" })).toBe(
      "The MCP server at https://ugmonk.com/api/mcp answered and listed 1 tool."
    );
  });
  it("older notes keep their text", () => {
    expect(plainScoreNote({ id: "live_invocation", notes: "tools/list returned 3 tools" })).toBe("The MCP server answered and listed 3 tools.");
  });
});

describe("RD-0117 page weight note", () => {
  it("the 1.5.2 note still selects the size-specific remediation", () => {
    const s = sub("page_weight_lcp", "Homepage HTML size: 1.20 MB (1262256 bytes), measured uncompressed. This check looks at page size only; it does not measure loading speed.", 50);
    expect(remediationFor(s, ctx([s]))).toBe(T.page_weight_lcp.heavy("1.20"));
  });
  it("over the counting cap: the general text (no exact size claimed)", () => {
    const s = sub(
      "page_weight_lcp",
      "Homepage HTML size: more than 3 MB uncompressed (we stopped counting at 3145728 bytes). This check looks at page size only; it does not measure loading speed.",
      0
    );
    expect(remediationFor(s, ctx([s]))).toBe(T.page_weight_lcp.general);
  });
});

describe("Codex review follow-ups", () => {
  it("a linked (untested) MCP URL is not called 'your MCP server'", () => {
    const s = wk(
      { card_absent_proven: true, mcp_endpoint: "https://acme.com/mcp" },
      "no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json; an MCP server was found (the site links an MCP endpoint (https://acme.com/mcp)) but it is not advertised with a server card"
    );
    expect(remediationFor(s, ctx([s]))).toBe(T.well_known.noCard(ORIGIN));
  });
  it("a sampled product listing page is named as such, and gets the neutral remediation", () => {
    expect(
      plainScoreNote({
        id: "service_offer_schema",
        notes: "2 Service/Product/Offer block(s); best match has 3/3 required fields (on the sampled product listing page https://drveit.com.br/produtos/; none on the homepage)",
      })
    ).toContain("on the product listing page we sampled (https://drveit.com.br/produtos/), and none on the homepage");
    expect(
      plainScoreNote({
        id: "service_offer_schema",
        notes: "2 Service/Product/Offer block(s); best match has 3/3 required fields (on the sampled product page https://ugmonk.com/products/x; none on the homepage)",
      })
    ).toContain("on the product page we sampled (https://ugmonk.com/products/x), and none on the homepage");
    const s = sub("service_offer_schema", "no Service / Product / Offer schema on the homepage or on the sampled product listing page (https://drveit.com.br/produtos/)");
    expect(remediationFor(s, ctx([s]))).toBe(UNKNOWN_CHECK_REMEDIATION);
  });
});
