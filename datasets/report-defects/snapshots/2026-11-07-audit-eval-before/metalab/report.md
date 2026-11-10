> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 19:52:24 UTC · session 168ee440

**https://www.metalab.com/**

## 24 — grade F

_Scored on 4 of 6 dimensions applicable to this site. Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite._

## Executive summary

Your site scored 24/100 (grade F): AI assistants will have a hard time finding your site and describing what you do.

The weakest areas: AI assistants can't find a usable llms.txt, the short guide that points them to your key pages (llms.txt Quality, 0/100); AI agents can't discover or use an MCP server for your site (MCP Server Discoverability, 15/100); and AI assistants struggle to read the content of your pages (Agent-Parsable Content, 30/100).

OpenAPI / API Catalog did not apply to this site, so it is not counted in your score; Citation Visibility could not be measured on this run, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists the specific fix for each gap, weakest first.

## Dimension breakdown

### llms.txt Quality — 0 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 0/100 | 25% | status=404 |
| Spec compliance (H1 + blockquote) | 0/100 | 25% | h1=no, blockquote=no |
| Linked pages return useful markdown | 0/100 | 20% | no links to sample |
| Curation quality | 0/100 | 15% | file missing — no link list to evaluate |
| Blockquote elevator-pitch quality (LLM) | 0/100 | 15% | no blockquote to evaluate |

### MCP Server Discoverability — 15 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Well-known discovery (mcp.json / server-card.json) | 0/100 | 30% | no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json |
| Tool coverage and quality | 0/100 | 20% | no card or no tools declared |
| OAuth metadata (when auth declared) | 100/100 | 15% | no auth declared (N/A) |
| Live MCP tools/list invocation | 0/100 | 25% | no transport URL in card to invoke |
| DNS TXT discovery (_mcp subdomain) | 0/100 | 10% | no TXT at _mcp.www.metalab.com |

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI / API catalog discovered (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). Site appears to be content-only from an API-catalog perspective. Dimension marked N/A — composite math drops it without penalty.

### Structured Capability Data — 45 D

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 1 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 100/100 | 20% | Organization found: name=true, url=true, description=true, sameAs=3 |
| Service / Product / Offer schema | 0/100 | 20% | no Service / Product / Offer schema |
| FAQPage schema (count + conversational LLM eval) | 0/100 | 20% | 0 Q&A pair(s); skipped (no questions) |
| Review / AggregateRating schema | 0/100 | 15% | no Review or AggregateRating (common for B2B SaaS — does not imply broken) |

### Agent-Parsable Content — 30 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 0/100 | 30% | Static-vs-rendered token overlap 16%; rendered HTML 5.4x the size of static. |
| Page weight + LCP | 100/100 | 15% | Page weight 0.09MB (92913 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade). |
| Markdown content negotiation | 25/100 | 25% | No markdown variant or content negotiation. Agents must fall back to HTML extraction. |
| Pricing text visibility · N/A | — | 20% | No /pricing, /plans, or /price path found, and no pricing-link discovered on homepage. Weight redistributed across other Dim 5 sub-checks. |
| Case-study scannability · N/A | — | 10% | No case-study path detected (/case-studies, /customers, /success-stories, or homepage anchors). Weight redistributed across other Dim 5 sub-checks. |

### Citation Visibility — N/A (not applicable)

All 40 cells came back unmeasurable (network or provider failures). Dimension dropped from composite. Dim 6 engine: dim6:v3 (4 models, prompt-set v3)

## Prioritized gaps + remediation

Sub-checks scoring below 100, ordered by lowest score first. Each gap includes specific remediation guidance generated for your site by our analysis engine.

### Presence

_llms.txt Quality · 0/100 · weight 25%_

**Finding:** status=404

**Remediation:** The `/llms.txt` file at the site root is missing, as indicated by a 404 status code. To address this, create a new file named `/llms.txt` at the site root and populate it with the necessary content. This can be done by adding a new file to the site's root directory and editing its contents to meet the site's requirements. Estimated effort: 1 to 2 hours.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 0/100 · weight 25%_

**Finding:** h1=no, blockquote=no

**Remediation:** To improve the structure of the `/llms.txt` file, add an H1 element as the first heading and a blockquote summary to provide a concise summary of the content. This can be achieved by inserting the first H1 element and a blockquote summary at the beginning of the file, following standard HTML structure guidelines. Estimated effort: 30 minutes to 1 hour.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** no links to sample

**Remediation:** To improve the linked pages from the `/llms.txt` file, add links to sample pages within the file to provide useful markdown content. This can be achieved by editing the `/llms.txt` file to include relevant links to sample pages, ensuring that users have access to useful information. Estimated effort: 1 to 2 hours.

### Curation quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** file missing — no link list to evaluate

**Remediation:** The link list inside the `/llms.txt` file is missing, preventing evaluation of its curation quality. To address this, create a link list within the `/llms.txt` file by adding a list of relevant links, formatted in a clear and organized manner. This can be achieved by editing the file to include a structured list of links, ensuring they are properly formatted and easily accessible. Estimated effort: 1 to 2 hours.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** To improve the blockquote summary inside the `/llms.txt` file, add a brief summary of the LLM's capabilities by inserting a blockquote element with a concise description of its features and benefits. This can be achieved by adding a blockquote element with a summary of the LLM's capabilities, ensuring the content is clear and concise. Estimated effort: 1 to 2 hours.

### Well-known discovery (mcp.json / server-card.json)

_MCP Server Discoverability · 0/100 · weight 30%_

**Finding:** no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json

**Remediation:** To improve the discovery card at /.well-known/mcp.json (or /.well-known/mcp/server-card.json), create a new JSON file at the root of the website with the required discovery card information. This involves adding a new file with the correct schema and content, which can be done by following the standard for well-known discovery cards. Estimated effort: 1 to 2 hours.

### Tool coverage and quality

_MCP Server Discoverability · 0/100 · weight 20%_

**Finding:** no card or no tools declared

**Remediation:** To improve the `tools[]` array inside the MCP server discovery card, add a declaration of the available tools to this section. This can be done by editing the discovery card to include a list of tools, such as a JSON array, that accurately reflects the tools provided by the website. Estimated effort: 1 to 2 hours.

### Live MCP tools/list invocation

_MCP Server Discoverability · 0/100 · weight 25%_

**Finding:** no transport URL in card to invoke

**Remediation:** To improve the transport URL declared in the MCP server discovery card, add a transport URL to the card. This can be done by editing the discovery card to include the necessary transport URL information. Estimated effort: 1 to 2 hours.

### DNS TXT discovery (_mcp subdomain)

_MCP Server Discoverability · 0/100 · weight 10%_

**Finding:** no TXT at _mcp.www.metalab.com

**Remediation:** To improve the DNS TXT record at `_mcp.metalab.com`, add a TXT record with the required information. This can be done by accessing the DNS management settings for metalab.com and creating a new TXT record with the specified details. Estimated effort: 30 minutes to 1 hour.

### Service / Product / Offer schema

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Service / Product / Offer schema

**Remediation:** To improve the Service / Product / Offer JSON-LD on commercial pages, add the missing schema markup to the Service / Product / Offer JSON-LD on commercial pages (homepage, pricing, services) by including the required properties, such as "name", "description", and "price", in the JSON-LD code. This can be achieved by editing the relevant JSON-LD code to include the necessary details, ensuring that the schema is properly formatted and follows the recommended best practices. Estimated effort: 1 to 2 hours.

### FAQPage schema (count + conversational LLM eval)

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** 0 Q&A pair(s); skipped (no questions)

**Remediation:** To improve the FAQPage JSON-LD on the homepage or a dedicated FAQ page, add a Q&A pair to the existing schema. Specifically, create a new question and answer pair in the FAQPage JSON-LD markup, following the standard format for schema.org properties, and ensure the conversational evaluation score improves. Estimated effort: 1 to 2 hours.

### Review / AggregateRating schema

_Structured Capability Data · 0/100 · weight 15%_

**Finding:** no Review or AggregateRating (common for B2B SaaS — does not imply broken)

**Remediation:** To improve the Review or AggregateRating JSON-LD on relevant pages, add a Review or AggregateRating schema block to the HTML of the relevant pages, including the required properties such as "reviewRating" and "ratingValue" to provide a clear and accurate rating for customers. This can be achieved by editing the page's HTML to include the necessary schema markup, which can be done by adding a new section to the page's HTML structure. Estimated effort: 1 to 2 hours.

### JS-vs-no-JS render diff

_Agent-Parsable Content · 0/100 · weight 30%_

**Finding:** Static-vs-rendered token overlap 16%; rendered HTML 5.4x the size of static.

**Remediation:** To improve the rendered HTML of your homepage and key commercial pages, ensure that the static and JavaScript-rendered DOM produce similar token overlap by reducing the discrepancy in HTML size. This can be achieved by optimizing JavaScript code to minimize the difference in HTML size between static and rendered versions. Specifically, review and refactor JavaScript code to reduce the rendered HTML size to be closer to the static HTML size. Estimated effort: 1 to 2 hours.

### Markdown content negotiation

_Agent-Parsable Content · 25/100 · weight 25%_

**Finding:** No markdown variant or content negotiation. Agents must fall back to HTML extraction.

**Remediation:** To improve the handling of `Accept: text/markdown` requests and `.md` variants of key pages, update the server configuration to support content negotiation for Markdown files. Specifically, add support for the `text/markdown` media type to the server's response headers, and ensure that `.md` variants of key pages are served with the correct content type. This will enable agents to correctly interpret the content of these pages. Estimated effort: 1 to 2 hours.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.