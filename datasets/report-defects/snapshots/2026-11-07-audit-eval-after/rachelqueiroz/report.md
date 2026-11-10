> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 20:07:03 UTC · session d6e5f5dc

**https://www.rachelqueiroz.com/**

## 80 — grade A-

_Scored on 3 of 6 dimensions applicable to this site. Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite._

## Executive summary

Your site scored 80/100 (grade A-): AI assistants and agents can find, read and describe your site well, with only a few gaps left.

The weakest areas: parts of your pages are hard for AI assistants to read (Agent-Parsable Content, 73/100); and your llms.txt, the short guide that points AI assistants to your key pages, is incomplete (llms.txt Quality, 75/100).

What's working: your structured data tells AI assistants clearly what you offer.

MCP Server Discoverability and OpenAPI / API Catalog did not apply to this site, so they are not counted in your score; Citation Visibility could not be measured on this run, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists the specific fix for each gap, weakest first.

## Dimension breakdown

### llms.txt Quality — 75 B

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/plain; charset=utf-8" |
| Spec compliance (H1 + blockquote) | 100/100 | 25% | h1=yes, blockquote=yes |
| Linked pages return useful markdown | 0/100 | 20% | 0/3 sampled links return markdown-ish content |
| Curation quality | 100/100 | 15% | clean link list |
| Blockquote elevator-pitch quality (LLM) | 64/100 | 15% | LLM rated blockquote 64/100 |

### MCP Server Discoverability — N/A (not applicable)

No MCP server card (/.well-known/mcp.json or /.well-known/mcp/server-card.json), no _mcp DNS TXT record and no MCP endpoint found, and no API was detected (OpenAPI / API Catalog is N/A). A content-only site is not expected to run an MCP server. Dimension marked N/A — composite math drops it without penalty.

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI / API catalog discovered (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). Site appears to be content-only from an API-catalog perspective. Dimension marked N/A — composite math drops it without penalty.

### Structured Capability Data — 88 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 1 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 60/100 | 20% | Organization found: name=true, url=true, description=false, sameAs=0 |
| Service / Product / Offer schema | 100/100 | 20% | 1 Service/Product/Offer block(s); best match has 3/3 required fields |
| FAQPage schema (count + conversational LLM eval) · N/A | — | 20% | 4 Q&A pair(s); Not measured: the AI rating of the FAQ questions was unavailable on this run. Weight redistributed across other Dim 4 sub-checks. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. Weight redistributed across other Dim 4 sub-checks. |

### Agent-Parsable Content — 73 B

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | Static-vs-rendered token overlap 100%; rendered HTML 1.0x the size of static. |
| Page weight + LCP | 100/100 | 15% | Page weight 0.06MB (65016 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade). |
| Markdown content negotiation | 25/100 | 25% | No markdown variant or content negotiation. Agents must fall back to HTML extraction. |
| Pricing text visibility · N/A | — | 20% | No /pricing, /plans, or /price path found, and no pricing-link discovered on homepage. Weight redistributed across other Dim 5 sub-checks. |
| Case-study scannability · N/A | — | 10% | No case-study path detected (/case-studies, /customers, /success-stories, or homepage anchors). Weight redistributed across other Dim 5 sub-checks. |

### Citation Visibility — N/A (not applicable)

All 40 cells came back unmeasurable (network or provider failures). Dimension dropped from composite. Dim 6 engine: dim6:v3 (4 models, prompt-set v3)

## Prioritized gaps + remediation

Sub-checks scoring below 100, ordered by lowest score first. Each gap includes specific remediation guidance generated for your site by our analysis engine.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** 0/3 sampled links return markdown-ish content

**Remediation:** The `/llms.txt` file contains links to pages that return markdown-ish content, but only 0 out of 3 sampled links were found to have useful markdown. To improve the quality of linked pages, ensure that all links in the `/llms.txt` file point to pages with relevant and useful markdown content. This can be achieved by reviewing and updating the links to point to pages with accurate and informative markdown. Estimated effort: 1 to 2 hours.

### Markdown content negotiation

_Agent-Parsable Content · 25/100 · weight 25%_

**Finding:** No markdown variant or content negotiation. Agents must fall back to HTML extraction.

**Remediation:** To improve the handling of `Accept: text/markdown` requests and `.md` variants of key pages, update the server configuration to support content negotiation for Markdown files. Specifically, add support for the `text/markdown` media type to the server's response headers for key pages with `.md` file extensions. This can be achieved by modifying the server's response headers to include the `Content-Type` header with the `text/markdown` value. Estimated effort: 30 minutes to 1 hour.

### Organization schema completeness

_Structured Capability Data · 60/100 · weight 20%_

**Finding:** Organization found: name=true, url=true, description=false, sameAs=0

**Remediation:** To improve the Organization JSON-LD block on the homepage, add a description to the existing Organization schema by editing the JSON-LD markup to include a descriptive text that accurately represents the website. This can be done by adding a new property to the existing Organization object, following the standard JSON-LD syntax and structure. Estimated effort: 1 to 2 hours.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 64/100 · weight 15%_

**Finding:** LLM rated blockquote 64/100

**Remediation:** To improve the blockquote summary inside the `/llms.txt` file, update the existing blockquote to provide a more concise and compelling elevator pitch that accurately represents the content of the file. This can be achieved by rephrasing the text to focus on the main benefits and key takeaways, ensuring it is clear, concise, and engaging. Estimated effort: 1 to 2 hours.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.