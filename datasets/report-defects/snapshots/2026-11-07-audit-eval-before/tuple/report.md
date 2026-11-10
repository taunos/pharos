> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 19:53:27 UTC · session ad4fc495

**https://tuple.app/**

## 19 — grade F

_Scored on 4 of 6 dimensions applicable to this site. Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite._

## Executive summary

Your site scored 19/100 (grade F): AI assistants will have a hard time finding your site and describing what you do.

The weakest areas: AI assistants can't find a usable llms.txt, the short guide that points them to your key pages (llms.txt Quality, 0/100); your pages carry little of the structured data AI assistants use to understand what you offer (Structured Capability Data, 0/100); and AI agents can't discover or use an MCP server for your site (MCP Server Discoverability, 15/100).

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
| DNS TXT discovery (_mcp subdomain) | 0/100 | 10% | no TXT at _mcp.tuple.app |

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI / API catalog discovered (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). Site appears to be content-only from an API-catalog perspective. Dimension marked N/A — composite math drops it without penalty.

### Structured Capability Data — 0 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 0/100 | 25% | no JSON-LD found on homepage |
| Organization schema completeness | 0/100 | 20% | no Organization schema |
| Service / Product / Offer schema | 0/100 | 20% | no Service / Product / Offer schema |
| FAQPage schema (count + conversational LLM eval) | 0/100 | 20% | 0 Q&A pair(s); skipped (no questions) |
| Review / AggregateRating schema | 0/100 | 15% | no Review or AggregateRating (common for B2B SaaS — does not imply broken) |

### Agent-Parsable Content — 68 C

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | Static-vs-rendered token overlap 99%; rendered HTML 1.0x the size of static. |
| Page weight + LCP | 100/100 | 15% | Page weight 0.08MB (83041 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade). |
| Markdown content negotiation | 25/100 | 25% | No markdown variant or content negotiation. Agents must fall back to HTML extraction. |
| Pricing text visibility | 50/100 | 20% | Detected https://tuple.app/pricing; 1 price token(s) but none with /period suffix. |
| Case-study scannability · N/A | — | 10% | No case-study path detected (/case-studies, /customers, /success-stories, or homepage anchors). Weight redistributed across other Dim 5 sub-checks. |

### Citation Visibility — N/A (not applicable)

All 40 cells came back unmeasurable (network or provider failures). Dimension dropped from composite. Dim 6 engine: dim6:v3 (4 models, prompt-set v3)

## Prioritized gaps + remediation

Sub-checks scoring below 100, ordered by lowest score first. Each gap includes specific remediation guidance generated for your site by our analysis engine.

### Presence

_llms.txt Quality · 0/100 · weight 25%_

**Finding:** status=404

**Remediation:** The `/llms.txt` file at the site root is missing, resulting in a 404 status code. To resolve this, create a new file named `/llms.txt` at the site root and populate it with the necessary content. This can be done by adding a new file to the site's root directory and editing its contents to meet the site's requirements. Estimated effort: 1 to 2 hours.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 0/100 · weight 25%_

**Finding:** h1=no, blockquote=no

**Remediation:** To improve the structure of the `/llms.txt` file, add an H1 element as the first heading and a blockquote summary to provide a concise summary of the content. This can be achieved by inserting the first H1 element and a blockquote summary at the beginning of the file, following the existing structure. Estimated effort: 30 minutes to 1 hour.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** no links to sample

**Remediation:** To improve the linked pages from inside the `/llms.txt` file, add links to sample pages to the file. This can be done by editing the `/llms.txt` file to include relevant sample links, ensuring they are properly formatted and follow best practices for markdown. Estimated effort: 1 to 2 hours.

### Curation quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** file missing — no link list to evaluate

**Remediation:** To improve the curation quality of the link list inside the `/llms.txt` file, add a link list to the file. This can be done by editing the file to include a list of relevant links, formatted in a way that is consistent with the existing file structure. Estimated effort: 1 to 2 hours.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** To improve the blockquote summary inside the `/llms.txt` file, add a blockquote element to the file with a brief, descriptive summary of the LLM's capabilities. This can be done by inserting a blockquote element with a concise overview of the LLM's features and functionality. The content should be written in a clear and concise manner, providing a summary of the LLM's capabilities. Estimated effort: 1 to 2 hours.

### Well-known discovery (mcp.json / server-card.json)

_MCP Server Discoverability · 0/100 · weight 30%_

**Finding:** no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json

**Remediation:** To improve the discovery card at `/.well-known/mcp.json` (or `/.well-known/mcp/server-card.json`), create a new JSON file at the root of the website with the required discovery card information. This file should contain the necessary metadata and schema details to accurately represent the website's capabilities and features. Estimated effort: 1 to 2 hours.

### Tool coverage and quality

_MCP Server Discoverability · 0/100 · weight 20%_

**Finding:** no card or no tools declared

**Remediation:** To improve the `tools[]` array inside the MCP server discovery card, add a declaration of tools to the card to ensure it is populated with relevant information. This can be achieved by editing the discovery card to include a list of tools, which can be done by adding a new field to the card with the necessary tool information. Estimated effort: 30 minutes to 1 hour.

### Live MCP tools/list invocation

_MCP Server Discoverability · 0/100 · weight 25%_

**Finding:** no transport URL in card to invoke

**Remediation:** To improve the transport URL declared in the MCP server discovery card, add a transport URL to the card. This can be done by editing the discovery card to include the necessary transport URL information. Estimated effort: 1 to 2 hours.

### DNS TXT discovery (_mcp subdomain)

_MCP Server Discoverability · 0/100 · weight 10%_

**Finding:** no TXT at _mcp.tuple.app

**Remediation:** To improve the DNS TXT record at `_mcp.tuple.app`, create a new TXT record with the required information. This can be done by accessing the DNS management settings for the tuple.app domain and adding a new TXT record with the specified details. Estimated effort: 1 to 2 hours.

### JSON-LD present on homepage

_Structured Capability Data · 0/100 · weight 25%_

**Finding:** no JSON-LD found on homepage

**Remediation:** This check scored 0/100 because: no JSON-LD found on homepage. Review the JSON-LD `<script>` block(s) on the homepage on your site and address what the notes describe. Estimated effort: 1 to 2 hours.

### Organization schema completeness

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Organization schema

**Remediation:** To improve the Organization JSON-LD block on the homepage, add the missing Organization schema markup to the homepage. This can be done by editing the homepage's metadata to include the required properties, such as the organization's name, logo, and contact information, in a structured and machine-readable format. This will enhance the homepage's discoverability and provide a better user experience for search engines. Estimated effort: 1 to 2 hours.

### Service / Product / Offer schema

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Service / Product / Offer schema

**Remediation:** To improve the Service / Product / Offer JSON-LD on commercial pages, add the missing schema to the Service / Product / Offer JSON-LD on the homepage, pricing, and services pages. This can be achieved by adding the necessary markup to the relevant pages, specifically including the required properties such as name, description, and price. This will involve writing and implementing the schema in a way that accurately represents the services and products offered by the website. Estimated effort: 1 to 2 hours.

### FAQPage schema (count + conversational LLM eval)

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** 0 Q&A pair(s); skipped (no questions)

**Remediation:** To improve the FAQPage JSON-LD on the homepage or a dedicated FAQ page, add a Q&A pair to the existing JSON-LD markup. Specifically, create a new "question" and "answer" property within the "FAQPage" schema, following the standard format for structuring question-answer pairs. This will enhance the page's semantic meaning and improve its conversational evaluation. Estimated effort: 1 to 2 hours.

### Review / AggregateRating schema

_Structured Capability Data · 0/100 · weight 15%_

**Finding:** no Review or AggregateRating (common for B2B SaaS — does not imply broken)

**Remediation:** To improve the Review or AggregateRating JSON-LD on relevant pages, add a Review or AggregateRating schema block to the page's HTML, specifically including the required properties such as "reviewRating" and "ratingValue" to provide a clear and accurate review or rating for users. This can be achieved by editing the page's HTML to include the necessary schema markup, which can be done by adding a new section to the page's content and populating it with the required data. Estimated effort: 1 to 2 hours.

### Markdown content negotiation

_Agent-Parsable Content · 25/100 · weight 25%_

**Finding:** No markdown variant or content negotiation. Agents must fall back to HTML extraction.

**Remediation:** To improve the handling of `Accept: text/markdown` requests and `.md` variants of key pages, update the server configuration to support content negotiation for Markdown files. Specifically, add support for the `text/markdown` media type to the server's response headers, allowing agents to request and receive Markdown content for these pages. This can be achieved by modifying the server's response headers to include the `Content-Type` header with the `text/markdown` value. Estimated effort: 30 minutes to 1 hour.

### Pricing text visibility

_Agent-Parsable Content · 50/100 · weight 20%_

**Finding:** Detected https://tuple.app/pricing; 1 price token(s) but none with /period suffix.

**Remediation:** To improve the pricing page's price visibility, add the /period suffix to the price token(s) on the pricing page so that prices appear as plain text. This can be achieved by modifying the price formatting in the relevant section of the pricing page to include the /period suffix, ensuring that prices are clearly visible to users. Estimated effort: 30 minutes to 1 hour.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.