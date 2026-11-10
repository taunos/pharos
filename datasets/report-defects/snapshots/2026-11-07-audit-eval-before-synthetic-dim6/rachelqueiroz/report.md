> SYNTHETIC DIM 6 INPUT — Citation Visibility numbers below are invented by the eval harness (shape identical to runDim6 output); the remediation text for them is real Llama output.

# Astrant · AEO Audit

Generated 2026-11-07 19:47:56 UTC · session c66a3f50

**https://www.rachelqueiroz.com/**

## 45 — grade D

_Scored on 5 of 6 dimensions applicable to this site. Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite._

## Executive summary

Your site scored 45/100 (grade D): AI assistants can find parts of your site, but significant gaps make it hard for them to describe what you do accurately.

The weakest areas: AI assistants rarely name or cite your site in their answers (Citation Visibility, 14/100); AI agents can't discover or use an MCP server for your site (MCP Server Discoverability, 15/100); and the structured data that tells AI assistants what you offer is incomplete (Structured Capability Data, 56/100).

What's working: AI assistants can read your pages easily.

OpenAPI / API Catalog did not apply to this site, so it is not counted in your score; Citation Visibility was only partly measured (4 of 4 AI assistants returned usable answers, 36 of 40 test answers in all), so treat that score as provisional.

The "Prioritized gaps + remediation" section below lists the specific fix for each gap, weakest first.

## Dimension breakdown

### llms.txt Quality — 67 C

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/plain; charset=utf-8" |
| Spec compliance (H1 + blockquote) | 100/100 | 25% | h1=yes, blockquote=yes |
| Linked pages return useful markdown | 0/100 | 20% | 0/3 sampled links return markdown-ish content |
| Curation quality | 100/100 | 15% | clean link list |
| Blockquote elevator-pitch quality (LLM) | 13/100 | 15% | LLM rated blockquote 13/100 |

### MCP Server Discoverability — 15 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Well-known discovery (mcp.json / server-card.json) | 0/100 | 30% | no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json |
| Tool coverage and quality | 0/100 | 20% | no card or no tools declared |
| OAuth metadata (when auth declared) | 100/100 | 15% | no auth declared (N/A) |
| Live MCP tools/list invocation | 0/100 | 25% | no transport URL in card to invoke |
| DNS TXT discovery (_mcp subdomain) | 0/100 | 10% | no TXT at _mcp.www.rachelqueiroz.com |

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI / API catalog discovered (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). Site appears to be content-only from an API-catalog perspective. Dimension marked N/A — composite math drops it without penalty.

### Structured Capability Data — 56 D

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 1 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 0/100 | 20% | no Organization schema |
| Service / Product / Offer schema | 100/100 | 20% | 1 Service/Product/Offer block(s); best match has 4/4 required fields |
| FAQPage schema (count + conversational LLM eval) | 56/100 | 20% | 4 Q&A pair(s); LLM rated 4 question(s) avg 50/100 (LLM output unusable; default) |
| Review / AggregateRating schema | 0/100 | 15% | no Review or AggregateRating (common for B2B SaaS — does not imply broken) |

### Agent-Parsable Content — 91 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | Static-vs-rendered token overlap 100%; rendered HTML 1.0x the size of static. |
| Page weight + LCP | 100/100 | 15% | Page weight 0.06MB (65016 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade). |
| Markdown content negotiation | 75/100 | 25% | .md variant exists at https://www.rachelqueiroz.com/llms.txt but Accept: text/markdown negotiation isn't wired. |
| Pricing text visibility · N/A | — | 20% | No /pricing, /plans, or /price path found, and no pricing-link discovered on homepage. Weight redistributed across other Dim 5 sub-checks. |
| Case-study scannability · N/A | — | 10% | No case-study path detected (/case-studies, /customers, /success-stories, or homepage anchors). Weight redistributed across other Dim 5 sub-checks. |

### Citation Visibility — 14 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Models name your domain | 17/100 | 40% | 17% of measurable cells named the target domain. 36/40 cells measurable across 4 models. Per-model averages: openai=12, anthropic=4, google=9, perplexity=31. |
| Models cite your URL | 6/100 | 30% | 6% of measurable cells included at least one URL on the target host. |
| Models treat your domain as the principal answer | 8/100 | 20% | 8% of measurable cells positioned the target domain in the first half of the response (vs a footer-style mention). |
| Competitor-first check (not measured) | 100/100 | 10% | Not measured: this Audit doesn't take a competitor list yet, so this check passes by default. |

## Prioritized gaps + remediation

Sub-checks scoring below 100, ordered by lowest score first. Each gap includes specific remediation guidance generated for your site by our analysis engine.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** 0/3 sampled links return markdown-ish content

**Remediation:** The `/llms.txt` file contains links to pages that return markdown-ish content, but only 0 out of 3 sampled links were found to have useful markdown. To improve the quality of linked pages, ensure that all links in the `/llms.txt` file point to pages with relevant and useful markdown content. This can be achieved by reviewing and updating the links to point to pages with accurate and informative markdown. Estimated effort: 1 to 2 hours.

### Well-known discovery (mcp.json / server-card.json)

_MCP Server Discoverability · 0/100 · weight 30%_

**Finding:** no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json

**Remediation:** To improve the discovery card at /.well-known/mcp.json (or /.well-known/mcp/server-card.json), create a new JSON file at the root of the website with the required discovery card information. This involves adding a new file with the correct schema and content, which should include the necessary details about the website's services and capabilities. Estimated effort: 1 to 2 hours.

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

**Finding:** no TXT at _mcp.www.rachelqueiroz.com

**Remediation:** To improve the DNS TXT record at `_mcp.rachelqueiroz.com`, add a TXT record with the required information. This can be done by accessing the DNS settings for the domain and adding a new TXT record with the necessary details. Estimated effort: 1 to 2 hours.

### Organization schema completeness

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Organization schema

**Remediation:** To improve the Organization JSON-LD block on the homepage, add the missing Organization schema markup to the homepage's HTML. This can be done by adding the necessary JSON-LD code to the page's header, which will provide the required information about the website's organization. This change involves writing and adding new markup, estimated effort: 1 to 2 hours.

### Review / AggregateRating schema

_Structured Capability Data · 0/100 · weight 15%_

**Finding:** no Review or AggregateRating (common for B2B SaaS — does not imply broken)

**Remediation:** To improve the Review or AggregateRating JSON-LD on relevant pages, add a Review or AggregateRating schema block to the page's HTML, including the required properties such as "reviewRating" and "ratingValue" to provide a clear and accurate rating for customers. This can be achieved by editing the page's HTML to include the necessary schema markup, which can be done by adding a new section to the page's content or modifying an existing section to include the required properties. Estimated effort: 1 to 2 hours.

### Models cite your URL

_Citation Visibility · 6/100 · weight 30%_

**Finding:** 6% of measurable cells included at least one URL on the target host.

**Remediation:** To improve the rate at which the four hosted models include a URL on your domain when answering relevant questions, update the models to include a URL on the target host in at least 94% of measurable cells. This can be achieved by reviewing and modifying the model responses to ensure they consistently include a URL on the target host. Specifically, examine the model output and update the relevant model configurations to include a URL in the majority of responses. Estimated effort: 1 to 2 hours.

### Models treat your domain as the principal answer

_Citation Visibility · 8/100 · weight 20%_

**Finding:** 8% of measurable cells positioned the target domain in the first half of the response (vs a footer-style mention).

**Remediation:** To improve the rate at which the four hosted models position the domain as the principal answer, update the response structure of the models to prioritize the target domain in the first half of their response. This can be achieved by modifying the response schema to ensure that the domain is prominently featured in the initial section of the response, rather than relegating it to a footer-style mention. Estimated effort: 1 to 2 hours.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 13/100 · weight 15%_

**Finding:** LLM rated blockquote 13/100

**Remediation:** To improve the blockquote summary inside the `/llms.txt` file, update the existing blockquote to provide a more concise and engaging elevator pitch that accurately represents the content of the file. This can be achieved by rewriting the blockquote to clearly and concisely summarize the key points of the file, making it more compelling and informative for users. Estimated effort: 1 to 2 hours.

### Models name your domain

_Citation Visibility · 17/100 · weight 40%_

**Finding:** 17% of measurable cells named the target domain. 36/40 cells measurable across 4 models. Per-model averages: openai=12, anthropic=4, google=9, perplexity=31.

**Remediation:** To improve the rate at which OpenAI GPT-4o, Anthropic Claude, Google Gemini, and Perplexity Sonar name your domain when asked about it directly, update the knowledge graph or entity database that these models rely on to include accurate and up-to-date information about your domain, specifically adding or enhancing the entries for "rachelqueiroz.com" to ensure they are correctly identified and associated with your website. This can be achieved by providing the necessary information to the relevant data providers or by working with a data enrichment service to update the relevant knowledge graph or entity database. Estimated effort: 2 to 4 hours.

### FAQPage schema (count + conversational LLM eval)

_Structured Capability Data · 56/100 · weight 20%_

**Finding:** 4 Q&A pair(s); LLM rated 4 question(s) avg 50/100 (LLM output unusable; default)

**Remediation:** To improve the FAQPage JSON-LD on the homepage, add more Q&A pairs to increase the conversational quality of the content. Specifically, the LLM rated the existing 4 question pairs with an average score of 50/100, indicating room for improvement. To enhance the FAQPage, add more relevant and high-quality Q&A pairs that provide clear and concise answers to common questions, ensuring they are well-structured and easy to understand. Estimated effort: 1 to 2 hours.

### Markdown content negotiation

_Agent-Parsable Content · 75/100 · weight 25%_

**Finding:** .md variant exists at https://www.rachelqueiroz.com/llms.txt but Accept: text/markdown negotiation isn't wired.

**Remediation:** To improve the handling of `Accept: text/markdown` requests and `.md` variants of key pages, update the server configuration to enable negotiation for `text/markdown` and ensure that the `.md` variant of key pages is properly linked to the main page. This can be achieved by adding or modifying the necessary configuration settings to allow the server to recognize and serve Markdown content. Estimated effort: 1 to 2 hours.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.