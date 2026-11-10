> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 19:55:27 UTC · session 447dd351

**https://linear.app/**

## 42 — grade D

_Scored on 4 of 6 dimensions applicable to this site. Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite._

## Executive summary

Your site scored 42/100 (grade D): AI assistants can find parts of your site, but significant gaps make it hard for them to describe what you do accurately.

The weakest areas: your pages carry little of the structured data AI assistants use to understand what you offer (Structured Capability Data, 0/100); and AI agents can't discover or use an MCP server for your site (MCP Server Discoverability, 15/100).

What's working: your llms.txt gives AI assistants a clear guide to your key pages.

OpenAPI / API Catalog did not apply to this site, so it is not counted in your score; Citation Visibility could not be measured on this run, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists the specific fix for each gap, weakest first.

## Dimension breakdown

### llms.txt Quality — 91 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/plain; charset=utf-8" |
| Spec compliance (H1 + blockquote) | 100/100 | 25% | h1=yes, blockquote=yes |
| Linked pages return useful markdown | 100/100 | 20% | 5/5 sampled links return markdown-ish content |
| Curation quality | 80/100 | 15% | 180 links (>100) |
| Blockquote elevator-pitch quality (LLM) | 58/100 | 15% | LLM rated blockquote 58/100 |

### MCP Server Discoverability — 15 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Well-known discovery (mcp.json / server-card.json) | 0/100 | 30% | no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json |
| Tool coverage and quality | 0/100 | 20% | no card or no tools declared |
| OAuth metadata (when auth declared) | 100/100 | 15% | no auth declared (N/A) |
| Live MCP tools/list invocation | 0/100 | 25% | no transport URL in card to invoke |
| DNS TXT discovery (_mcp subdomain) | 0/100 | 10% | no TXT at _mcp.linear.app |

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

### Agent-Parsable Content — 83 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | Static-vs-rendered token overlap 96%; rendered HTML 1.0x the size of static. |
| Page weight + LCP | 50/100 | 15% | Page weight 1.20MB (1262256 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade). |
| Markdown content negotiation | 100/100 | 25% | Accept: text/markdown returns text/markdown; charset=utf-8 (directly). |
| Pricing text visibility | 100/100 | 20% | Detected https://linear.app/pricing; 5 text-based price token(s); 4 with /period suffix. |
| Case-study scannability | 0/100 | 10% | Sampled 1 page(s); avg 0/100. https://linear.app/case-studies → 0 (h:✗ m:✗ l:✗ b:✗). |

### Citation Visibility — N/A (not applicable)

All 40 cells came back unmeasurable (network or provider failures). Dimension dropped from composite. Dim 6 engine: dim6:v3 (4 models, prompt-set v3)

## Prioritized gaps + remediation

Sub-checks scoring below 100, ordered by lowest score first. Each gap includes specific remediation guidance generated for your site by our analysis engine.

### Well-known discovery (mcp.json / server-card.json)

_MCP Server Discoverability · 0/100 · weight 30%_

**Finding:** no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json

**Remediation:** To improve the discovery card at `/.well-known/mcp.json` (or `/.well-known/mcp/server-card.json`), create a new JSON file at the root of the website with the required discovery card information. This involves adding a new file with the correct schema and content, which should include the necessary details about the website's metadata. Estimated effort: 1 to 2 hours.

### Tool coverage and quality

_MCP Server Discoverability · 0/100 · weight 20%_

**Finding:** no card or no tools declared

**Remediation:** To improve the `tools[]` array inside the MCP server discovery card, add a new entry to declare the available tools. This can be done by editing the discovery card to include a new object with the required properties, such as name and description, to accurately represent the tools available on the site. Estimated effort: 1 to 2 hours.

### Live MCP tools/list invocation

_MCP Server Discoverability · 0/100 · weight 25%_

**Finding:** no transport URL in card to invoke

**Remediation:** To improve the transport URL declared in the MCP server discovery card, add a transport URL to the card. This can be done by editing the discovery card to include the necessary transport URL information. Estimated effort: 30 minutes to 1 hour.

### DNS TXT discovery (_mcp subdomain)

_MCP Server Discoverability · 0/100 · weight 10%_

**Finding:** no TXT at _mcp.linear.app

**Remediation:** To improve the DNS TXT record at `_mcp.linear.app`, add a TXT record with the required information. This can be done by logging in to the DNS management interface for linear.app and creating a new TXT record with the correct key and value. Estimated effort: 30 minutes to 1 hour.

### JSON-LD present on homepage

_Structured Capability Data · 0/100 · weight 25%_

**Finding:** no JSON-LD found on homepage

**Remediation:** This check scored 0/100 because: no JSON-LD found on homepage. Review the JSON-LD `<script>` block(s) on the homepage on your site and address what the notes describe. Estimated effort: 1 to 2 hours.

### Organization schema completeness

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Organization schema

**Remediation:** To improve the Organization JSON-LD block on the homepage, add the missing Organization schema markup to the homepage's HTML. This can be done by adding the necessary JSON-LD code to the page's header, which will provide the required information about the organization. This change involves writing and adding new markup, so Estimated effort: 1 to 2 hours.

### Service / Product / Offer schema

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Service / Product / Offer schema

**Remediation:** To improve the Service / Product / Offer schema on the homepage, pricing, and services pages, add the necessary JSON-LD markup to the relevant pages to provide a clear and accurate description of the services offered by Linear. This can be achieved by adding the required schema properties, such as name, description, and pricing details, to the existing JSON-LD markup. Estimated effort: 1 to 2 hours.

### FAQPage schema (count + conversational LLM eval)

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** 0 Q&A pair(s); skipped (no questions)

**Remediation:** To improve the FAQPage JSON-LD on the homepage or a dedicated FAQ page, add a Q&A pair to the existing JSON-LD markup. Specifically, create a new "question" and "answer" property within the "FAQPage" schema, following the standard format for JSON-LD markup. This will provide the necessary structure for the FAQ page to be properly indexed and understood by search engines. Estimated effort: 1 to 2 hours.

### Review / AggregateRating schema

_Structured Capability Data · 0/100 · weight 15%_

**Finding:** no Review or AggregateRating (common for B2B SaaS — does not imply broken)

**Remediation:** To improve the Review or AggregateRating JSON-LD on relevant pages, add a Review or AggregateRating schema block to the page's HTML, specifically including the required properties such as rating, review count, and author. This can be done by editing the page's HTML to include the necessary schema markup, which can be found in the schema.org documentation. Estimated effort: 1 to 2 hours.

### Case-study scannability

_Agent-Parsable Content · 0/100 · weight 10%_

**Finding:** Sampled 1 page(s); avg 0/100. https://linear.app/case-studies → 0 (h:✗ m:✗ l:✗ b:✗).

**Remediation:** To improve the structure of your case study pages, add headings, plain-text metrics, and skim-friendly markup to the case study pages. Specifically, ensure that each page has a clear hierarchy of headings (h1, h2, h3, etc.) and that the page's main content is marked up with a clear and concise summary, metrics, and bullet points. This will make it easier for users to quickly understand the key takeaways from each case study. Estimated effort: 1 to 2 hours.

### Page weight + LCP

_Agent-Parsable Content · 50/100 · weight 15%_

**Finding:** Page weight 1.20MB (1262256 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade).

**Remediation:** To improve the page weight and load timing of your key public pages (homepage, pricing, services), consider reducing the page weight by optimizing images and other assets, and ensuring that the Browser Rendering /content endpoint is properly configured to measure the Largest Contentful Paint (LCP). This can be achieved by reviewing and compressing large files, leveraging browser caching, and verifying that the endpoint is correctly set up to provide the necessary data. Estimated effort: 1 to 2 hours.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 58/100 · weight 15%_

**Finding:** LLM rated blockquote 58/100

**Remediation:** To improve the blockquote summary inside the `/llms.txt` file, update the existing blockquote to provide a more compelling and concise elevator pitch that accurately represents the LLM's capabilities. This can be achieved by rewriting the blockquote to focus on the key benefits and unique value proposition of the LLM, making it more engaging and effective at capturing the user's attention. Estimated effort: 1 to 2 hours.

### Curation quality

_llms.txt Quality · 80/100 · weight 15%_

**Finding:** 180 links (>100)

**Remediation:** To improve the curation quality of the link list inside the `/llms.txt` file, add more descriptive and relevant links to the file to increase its overall value. This can be achieved by reviewing the existing links and adding new ones that provide additional context and depth to the content. Estimated effort: 1 to 2 hours.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.