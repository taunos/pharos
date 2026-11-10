> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 19:48:50 UTC · session 10e74a28

**https://drveit.com.br/**

## 46 — grade D

_Scored on 4 of 6 dimensions applicable to this site. Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite._

## Executive summary

Your site scored 46/100 (grade D): AI assistants can find parts of your site, but significant gaps make it hard for them to describe what you do accurately.

The weakest areas: AI agents can't discover or use an MCP server for your site (MCP Server Discoverability, 15/100); the structured data that tells AI assistants what you offer is incomplete (Structured Capability Data, 41/100); and your llms.txt, the short guide that points AI assistants to your key pages, is incomplete (llms.txt Quality, 50/100).

What's working: AI assistants can read your pages easily.

OpenAPI / API Catalog did not apply to this site, so it is not counted in your score; Citation Visibility could not be measured on this run, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists the specific fix for each gap, weakest first.

## Dimension breakdown

### llms.txt Quality — 50 D

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/plain" |
| Spec compliance (H1 + blockquote) | 50/100 | 25% | h1=yes, blockquote=no |
| Linked pages return useful markdown | 0/100 | 20% | 0/5 sampled links return markdown-ish content |
| Curation quality | 80/100 | 15% | tag pages linked |
| Blockquote elevator-pitch quality (LLM) | 0/100 | 15% | no blockquote to evaluate |

### MCP Server Discoverability — 15 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Well-known discovery (mcp.json / server-card.json) | 0/100 | 30% | no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json |
| Tool coverage and quality | 0/100 | 20% | no card or no tools declared |
| OAuth metadata (when auth declared) | 100/100 | 15% | no auth declared (N/A) |
| Live MCP tools/list invocation | 0/100 | 25% | no transport URL in card to invoke |
| DNS TXT discovery (_mcp subdomain) | 0/100 | 10% | no TXT at _mcp.drveit.com.br |

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI / API catalog discovered (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). Site appears to be content-only from an API-catalog perspective. Dimension marked N/A — composite math drops it without penalty.

### Structured Capability Data — 41 D

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 2 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 80/100 | 20% | Organization found: name=true, url=true, description=false, sameAs=4 |
| Service / Product / Offer schema | 0/100 | 20% | no Service / Product / Offer schema |
| FAQPage schema (count + conversational LLM eval) | 0/100 | 20% | 0 Q&A pair(s); skipped (no questions) |
| Review / AggregateRating schema | 0/100 | 15% | no Review or AggregateRating (common for B2B SaaS — does not imply broken) |

### Agent-Parsable Content — 91 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | Static-vs-rendered token overlap 100%; rendered HTML 1.1x the size of static. |
| Page weight + LCP | 100/100 | 15% | Page weight 0.05MB (51644 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade). |
| Markdown content negotiation | 75/100 | 25% | .md variant exists at https://drveit.com.br/llms.txt but Accept: text/markdown negotiation isn't wired. |
| Pricing text visibility · N/A | — | 20% | No /pricing, /plans, or /price path found, and no pricing-link discovered on homepage. Weight redistributed across other Dim 5 sub-checks. |
| Case-study scannability · N/A | — | 10% | No case-study path detected (/case-studies, /customers, /success-stories, or homepage anchors). Weight redistributed across other Dim 5 sub-checks. |

### Citation Visibility — N/A (not applicable)

All 40 cells came back unmeasurable (network or provider failures). Dimension dropped from composite. Dim 6 engine: dim6:v3 (4 models, prompt-set v3)

## Prioritized gaps + remediation

Sub-checks scoring below 100, ordered by lowest score first. Each gap includes specific remediation guidance generated for your site by our analysis engine.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** 0/5 sampled links return markdown-ish content

**Remediation:** To improve the linked pages from inside the `/llms.txt` file, update the markdown content of the sampled links to ensure they provide useful information. This can be achieved by reviewing and editing the markdown content to make it more descriptive and relevant to the links. Estimated effort: 1 to 2 hours.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** To improve the blockquote summary inside the `/llms.txt` file, add a descriptive summary of the Learning Management System (LMS) functionality. This can be done by inserting a blockquote element with a brief, concise summary of the LMS features and benefits. Estimated effort: 1 to 2 hours.

### Well-known discovery (mcp.json / server-card.json)

_MCP Server Discoverability · 0/100 · weight 30%_

**Finding:** no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json

**Remediation:** To improve the discovery card at `/.well-known/mcp.json` (or `/.well-known/mcp/server-card.json`), create a new JSON file at the root of the website with the required discovery card information. This involves adding a new file with the correct schema and content, which can be done by following the standard for well-known discovery cards. Estimated effort: 1 to 2 hours.

### Tool coverage and quality

_MCP Server Discoverability · 0/100 · weight 20%_

**Finding:** no card or no tools declared

**Remediation:** To improve the `tools[]` array inside the MCP server discovery card, add a declaration of the available tools to this array. This can be done by editing the discovery card to include a list of tools that are currently supported by the server, ensuring that each tool is properly formatted and includes relevant details. Estimated effort: 1 to 2 hours.

### Live MCP tools/list invocation

_MCP Server Discoverability · 0/100 · weight 25%_

**Finding:** no transport URL in card to invoke

**Remediation:** To improve the transport URL declared in the MCP server discovery card, add a transport URL to the card. This can be done by editing the discovery card to include the necessary transport URL information. Estimated effort: 30 minutes to 1 hour.

### DNS TXT discovery (_mcp subdomain)

_MCP Server Discoverability · 0/100 · weight 10%_

**Finding:** no TXT at _mcp.drveit.com.br

**Remediation:** To improve the DNS TXT record at `_mcp.drveit.com.br`, add a TXT record with the required information. This can be done by accessing the DNS management settings for drveit.com.br and adding a new TXT record with the necessary details. Estimated effort: 30 minutes to 1 hour.

### Service / Product / Offer schema

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Service / Product / Offer schema

**Remediation:** To improve the Service / Product / Offer JSON-LD on commercial pages, add the missing schema markup to the relevant pages, specifically the homepage, pricing, and services pages. This can be achieved by adding the necessary JSON-LD code to the page's HTML head section, which typically involves editing the page's metadata or adding a new script tag. Estimated effort: 1 to 2 hours.

### FAQPage schema (count + conversational LLM eval)

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** 0 Q&A pair(s); skipped (no questions)

**Remediation:** To improve the FAQPage JSON-LD on the homepage or a dedicated FAQ page, add a Q&A pair to the existing JSON-LD markup. Specifically, create a new "question" and "answer" property within the "faqPage" object, following the standard schema.org format, and populate them with relevant content. This will enhance the page's conversational evaluation and overall schema quality. Estimated effort: 1 to 2 hours.

### Review / AggregateRating schema

_Structured Capability Data · 0/100 · weight 15%_

**Finding:** no Review or AggregateRating (common for B2B SaaS — does not imply broken)

**Remediation:** To improve the Review or AggregateRating JSON-LD on relevant pages, add a Review or AggregateRating schema block to the page's HTML, specifically including the required properties such as "reviewRating" and "ratingValue" to provide a clear and accurate review or rating for customers. This can be achieved by editing the page's HTML to include the necessary schema markup, which can be done by adding a new section to the page's content or modifying an existing section to include the required properties. Estimated effort: 1 to 2 hours.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 50/100 · weight 25%_

**Finding:** h1=yes, blockquote=no

**Remediation:** To improve the structure of the `/llms.txt` file, add a blockquote summary immediately following the first H1 heading. This can be done by inserting the blockquote HTML element after the H1 element, ensuring that the summary is properly formatted and accessible. Estimated effort: 30 minutes to 1 hour.

### Markdown content negotiation

_Agent-Parsable Content · 75/100 · weight 25%_

**Finding:** .md variant exists at https://drveit.com.br/llms.txt but Accept: text/markdown negotiation isn't wired.

**Remediation:** To improve the handling of `Accept: text/markdown` requests and `.md` variants of key pages, update the server configuration to wire Accept: text/markdown negotiation for the `.md` variant of key pages, ensuring that the server correctly identifies and serves Markdown content when requested. This can be achieved by modifying the server's response headers to include the correct Content-Type header for Markdown files. Estimated effort: 30 minutes to 1 hour.

### Curation quality

_llms.txt Quality · 80/100 · weight 15%_

**Finding:** tag pages linked

**Remediation:** The link list inside the `/llms.txt` file contains [site value] pages linked, which is below the expected quality. To improve the curation quality of the link list, add a brief description or categorization to each link to provide context and make it easier for users to navigate. This can be achieved by adding a descriptive attribute or metadata to each link in the `/llms.txt` file. Estimated effort: 1 to 2 hours.

### Organization schema completeness

_Structured Capability Data · 80/100 · weight 20%_

**Finding:** Organization found: name=true, url=true, description=false, sameAs=4

**Remediation:** To improve the Organization JSON-LD block on the homepage, add a description to the existing Organization schema to provide a clear and concise summary of the company, Drveit. This can be done by editing the JSON-LD markup to include a descriptive text for the "description" property. Estimated effort: 1 to 2 hours.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.