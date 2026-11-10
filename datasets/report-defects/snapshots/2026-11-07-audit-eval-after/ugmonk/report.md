> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 20:09:55 UTC · session 2fb0c27c

**https://ugmonk.com/**

## 58 — grade D

_Scored on 3 of 6 dimensions applicable to this site. Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite._

## Executive summary

Your site scored 58/100 (grade D): AI assistants can find parts of your site, but significant gaps make it hard for them to describe what you do accurately.

The weakest areas: AI assistants can't find a usable llms.txt, the short guide that points them to your key pages (llms.txt Quality, 38/100); and the structured data that tells AI assistants what you offer is incomplete (Structured Capability Data, 57/100).

MCP Server Discoverability and OpenAPI / API Catalog did not apply to this site, so they are not counted in your score; Citation Visibility could not be measured on this run, so it is not counted in your score.

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

### MCP Server Discoverability — N/A (not applicable)

No MCP server card (/.well-known/mcp.json or /.well-known/mcp/server-card.json), no _mcp DNS TXT record and no MCP endpoint found, and no API was detected (OpenAPI / API Catalog is N/A). A content-only site is not expected to run an MCP server. Dimension marked N/A — composite math drops it without penalty.

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI / API catalog discovered (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). Site appears to be content-only from an API-catalog perspective. Dimension marked N/A — composite math drops it without penalty.

### Structured Capability Data — 57 D

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 1 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 60/100 | 20% | Organization found: name=true, url=true, description=false, sameAs=0 |
| Service / Product / Offer schema | 0/100 | 20% | no Service / Product / Offer schema |
| FAQPage schema (count + conversational LLM eval) · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. Weight redistributed across other Dim 4 sub-checks. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. Weight redistributed across other Dim 4 sub-checks. |

### Agent-Parsable Content — 80 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | Static-vs-rendered token overlap 97%; rendered HTML 1.0x the size of static. |
| Page weight + LCP | 100/100 | 15% | Page weight 0.08MB (79389 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade). |
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

**Remediation:** To improve the linked pages from the `/llms.txt` file, add links to sample content within this file to provide users with relevant examples. This can be achieved by editing the `/llms.txt` file to include sample links, which will enable users to access useful markdown content. Estimated effort: 1 to 2 hours.

### Curation quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** empty file — no links to evaluate

**Remediation:** The link list inside the `/llms.txt` file is empty, indicating no links to evaluate. To improve the curation quality, add relevant links to this file to provide users with valuable resources. Update the `/llms.txt` file by adding links to useful and relevant content, ensuring they are properly formatted and easily accessible. Estimated effort: 1 to 2 hours.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** To improve the blockquote summary inside the `/llms.txt` file, add a brief summary of the LLM's capabilities by inserting a blockquote element with a concise description of its features and benefits. This can be achieved by adding a blockquote element with a summary of the LLM's capabilities, such as its capabilities and benefits. Estimated effort: 1 to 2 hours.

### Service / Product / Offer schema

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Service / Product / Offer schema

**Remediation:** To improve the Service / Product / Offer schema on the commercial pages of the website, add the necessary JSON-LD markup to the relevant pages, specifically the homepage, pricing, and services pages, to provide accurate and detailed information about the services offered by UG Monks. This can be achieved by adding the required schema properties, such as name, description, and pricing details, to the existing JSON-LD code. Estimated effort: 1 to 2 hours.

### Case-study scannability

_Agent-Parsable Content · 0/100 · weight 10%_

**Finding:** Detected case-study paths (https://ugmonk.com/account/login) but none returned 200.

**Remediation:** To improve the structure of your case study pages, add headings, plain-text metrics, and skim-friendly markup to the case-study paths. Specifically, ensure that the case-study paths ([site value] but none returned 200) are properly formatted with clear and concise headings, and include relevant metrics in plain text, making it easier for users to quickly understand the content. This can be achieved by reviewing and updating the existing case study pages to include descriptive headings and relevant metrics, and using markup that allows for easy scanning of the content. Estimated effort: 1 to 2 hours.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 50/100 · weight 25%_

**Finding:** h1=yes, blockquote=no

**Remediation:** To improve the structure of the `/llms.txt` file, add a blockquote summary immediately following the first H1 heading. This can be done by inserting the blockquote element after the H1 element, ensuring that the summary is properly formatted and accessible. Estimated effort: 30 minutes to 1 hour.

### Organization schema completeness

_Structured Capability Data · 60/100 · weight 20%_

**Finding:** Organization found: name=true, url=true, description=false, sameAs=0

**Remediation:** To improve the Organization JSON-LD block on the homepage, add a description to the existing Organization schema by editing the JSON-LD markup to include a descriptive text for the organization. This can be done by adding a new property to the existing Organization object, following the standard JSON-LD syntax and formatting. Estimated effort: 1 to 2 hours.

### Markdown content negotiation

_Agent-Parsable Content · 75/100 · weight 25%_

**Finding:** .md variant exists at https://ugmonk.com/index.md but Accept: text/markdown negotiation isn't wired.

**Remediation:** To improve the handling of `Accept: text/markdown` requests and `.md` variants of key pages, update the server configuration to enable negotiation for `text/markdown` and ensure that the `.md` variant of key pages is properly linked to the main page. This can be achieved by adding or modifying the necessary server configuration settings to support Markdown content negotiation. Estimated effort: 1 to 2 hours.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.