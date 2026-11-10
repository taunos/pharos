> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 19:51:09 UTC · session 4d5970a6

**https://ugmonk.com/**

## 39 — grade F

_Scored on 4 of 6 dimensions applicable to this site. Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite._

## Executive summary

Your site scored 39/100 (grade F): AI assistants will have a hard time finding your site and describing what you do.

The weakest areas: AI agents can't discover or use an MCP server for your site (MCP Server Discoverability, 15/100); your pages carry little of the structured data AI assistants use to understand what you offer (Structured Capability Data, 33/100); and AI assistants can't find a usable llms.txt, the short guide that points them to your key pages (llms.txt Quality, 38/100).

OpenAPI / API Catalog did not apply to this site, so it is not counted in your score; Citation Visibility could not be measured on this run, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists the specific fix for each gap, weakest first.

## Dimension breakdown

### llms.txt Quality — 38 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/markdown; charset=utf-8" |
| Spec compliance (H1 + blockquote) | 50/100 | 25% | h1=yes, blockquote=no |
| Linked pages return useful markdown | 0/100 | 20% | no links to sample |
| Curation quality | 0/100 | 15% | empty file — no links to evaluate |
| Blockquote elevator-pitch quality (LLM) | 0/100 | 15% | no blockquote to evaluate |

### MCP Server Discoverability — 15 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Well-known discovery (mcp.json / server-card.json) | 0/100 | 30% | no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json |
| Tool coverage and quality | 0/100 | 20% | no card or no tools declared |
| OAuth metadata (when auth declared) | 100/100 | 15% | no auth declared (N/A) |
| Live MCP tools/list invocation | 0/100 | 25% | no transport URL in card to invoke |
| DNS TXT discovery (_mcp subdomain) | 0/100 | 10% | no TXT at _mcp.ugmonk.com |

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI / API catalog discovered (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). Site appears to be content-only from an API-catalog perspective. Dimension marked N/A — composite math drops it without penalty.

### Structured Capability Data — 33 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 1 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 40/100 | 20% | Organization found: name=true, url=true, description=false, sameAs=0 |
| Service / Product / Offer schema | 0/100 | 20% | no Service / Product / Offer schema |
| FAQPage schema (count + conversational LLM eval) | 0/100 | 20% | 0 Q&A pair(s); skipped (no questions) |
| Review / AggregateRating schema | 0/100 | 15% | no Review or AggregateRating (common for B2B SaaS — does not imply broken) |

### Agent-Parsable Content — 80 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | Static-vs-rendered token overlap 99%; rendered HTML 1.0x the size of static. |
| Page weight + LCP | 100/100 | 15% | Page weight 0.08MB (79988 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade). |
| Markdown content negotiation | 75/100 | 25% | .md variant exists at https://ugmonk.com/index.md but Accept: text/markdown negotiation isn't wired. |
| Pricing text visibility · N/A | — | 20% | No /pricing, /plans, or /price path found, and no pricing-link discovered on homepage. Weight redistributed across other Dim 5 sub-checks. |
| Case-study scannability | 0/100 | 10% | Detected case-study paths (https://ugmonk.com/account/login) but none returned 200. |

### Citation Visibility — N/A (not applicable)

All 40 cells came back unmeasurable (network or provider failures). Dimension dropped from composite. Dim 6 engine: dim6:v3 (4 models, prompt-set v3)

## Prioritized gaps + remediation

Sub-checks scoring below 100, ordered by lowest score first. Each gap includes specific remediation guidance generated for your site by our analysis engine.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** no links to sample

**Remediation:** To improve the linked pages from the `/llms.txt` file, add links to sample content within this file to provide users with relevant examples. This can be achieved by editing the `/llms.txt` file to include sample links, which will enhance the user experience by providing tangible examples to learn from. Estimated effort: 1 to 2 hours.

### Curation quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** empty file — no links to evaluate

**Remediation:** The link list inside the `/llms.txt` file is empty, indicating no links to evaluate. To improve the curation quality, add relevant links to this file to provide users with valuable resources. Update the `/llms.txt` file by adding links to useful and relevant content, ensuring they are properly formatted and easily accessible. Estimated effort: 1 to 2 hours.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** To improve the blockquote summary inside the `/llms.txt` file, add a brief summary of the LLM's capabilities by inserting a blockquote element around a concise description of its features and benefits. This can be achieved by adding a blockquote element with a summary of the LLM's capabilities. Estimated effort: 1 to 2 hours.

### Well-known discovery (mcp.json / server-card.json)

_MCP Server Discoverability · 0/100 · weight 30%_

**Finding:** no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json

**Remediation:** To improve the discovery card at `/.well-known/mcp.json` (or `/.well-known/mcp/server-card.json`), create a new JSON file at the root of the website with the required discovery card information. This file should contain the necessary metadata and schema details to enable proper discovery and validation. Estimated effort: 1 to 2 hours.

### Tool coverage and quality

_MCP Server Discoverability · 0/100 · weight 20%_

**Finding:** no card or no tools declared

**Remediation:** To improve the `tools[]` array inside the MCP server discovery card, add a new entry to declare the available tools on the website. This can be done by editing the discovery card to include a new object with the necessary information, such as the tool name and its corresponding details. Estimated effort: 1 to 2 hours.

### Live MCP tools/list invocation

_MCP Server Discoverability · 0/100 · weight 25%_

**Finding:** no transport URL in card to invoke

**Remediation:** To improve the transport URL declared in the MCP server discovery card, add a transport URL to the card. This can be done by editing the discovery card to include the necessary transport URL information. Estimated effort: 1 to 2 hours.

### DNS TXT discovery (_mcp subdomain)

_MCP Server Discoverability · 0/100 · weight 10%_

**Finding:** no TXT at _mcp.ugmonk.com

**Remediation:** To improve the DNS TXT record at `_mcp.ugmonk.com`, add a TXT record with the necessary information. This can be done by logging into the DNS management interface for the domain and creating a new TXT record with the required details. Estimated effort: 30 minutes to 1 hour.

### Service / Product / Offer schema

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Service / Product / Offer schema

**Remediation:** To improve the Service / Product / Offer schema on the commercial pages of the website, add the necessary JSON-LD markup to the relevant pages, specifically the homepage, pricing, and services pages, to provide accurate and detailed information about the services offered by UG Monks. This can be achieved by adding the required schema properties, such as name, description, and pricing details, to the existing JSON-LD code. Estimated effort: 1 to 2 hours.

### FAQPage schema (count + conversational LLM eval)

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** 0 Q&A pair(s); skipped (no questions)

**Remediation:** To improve the FAQPage JSON-LD on the homepage or a dedicated FAQ page, add a Q&A pair to the existing JSON-LD markup. Specifically, create a new "question" and "answer" pair that accurately reflects a common question and answer about the website's content or services. This can be done by editing the existing JSON-LD schema to include additional "question" and "answer" properties, following the standard format for FAQPage schema. Estimated effort: 1 to 2 hours.

### Review / AggregateRating schema

_Structured Capability Data · 0/100 · weight 15%_

**Finding:** no Review or AggregateRating (common for B2B SaaS — does not imply broken)

**Remediation:** To improve the Review or AggregateRating JSON-LD on relevant pages, add a Review or AggregateRating schema block to the HTML of the pages that require customer reviews, such as product or service pages. This can be done by adding a new JSON-LD script tag containing the necessary schema markup, which should include details about the review and rating, such as the rating value and the number of reviews. Estimated effort: 1 to 2 hours.

### Case-study scannability

_Agent-Parsable Content · 0/100 · weight 10%_

**Finding:** Detected case-study paths (https://ugmonk.com/account/login) but none returned 200.

**Remediation:** To improve the structure of your case study pages, add headings, plain-text metrics, and skim-friendly markup to the case-study paths. Specifically, ensure that the case-study paths ([site value] but none returned 200) are properly formatted with clear and concise headings, and include relevant metrics in plain text to facilitate easy scanning. This can be achieved by reviewing and updating the existing case study pages to include descriptive headings and relevant metrics, and using markup that allows for easy skimming of the content. Estimated effort: 1 to 2 hours.

### Organization schema completeness

_Structured Capability Data · 40/100 · weight 20%_

**Finding:** Organization found: name=true, url=true, description=false, sameAs=0

**Remediation:** To improve the Organization JSON-LD block on the homepage, add a description to the existing Organization schema by editing the JSON-LD markup to include a descriptive text for the organization. This can be done by adding a new property to the existing Organization object, following the standard JSON-LD format. Estimated effort: 1 to 2 hours.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 50/100 · weight 25%_

**Finding:** h1=yes, blockquote=no

**Remediation:** To improve the structure of the `/llms.txt` file, add a blockquote summary immediately following the first H1 heading. This can be done by inserting the blockquote element after the H1 element, ensuring that the summary is properly formatted and accessible. Estimated effort: 30 minutes to 1 hour.

### Markdown content negotiation

_Agent-Parsable Content · 75/100 · weight 25%_

**Finding:** .md variant exists at https://ugmonk.com/index.md but Accept: text/markdown negotiation isn't wired.

**Remediation:** To improve the handling of `Accept: text/markdown` requests and `.md` variants of key pages, update the server configuration to enable negotiation for `text/markdown` and ensure that the `.md` variant of key pages is properly linked to the main page. This can be achieved by adding or modifying the necessary configuration settings to allow the server to recognize and serve Markdown content. Estimated effort: 1 to 2 hours.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.