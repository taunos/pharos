> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 20:13:30 UTC · session c3c35f17

**https://linear.app/**

## 52 — grade D

_Scored on 3 of 6 dimensions applicable to this site. Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite._

## Executive summary

Your site scored 52/100 (grade D): AI assistants can find parts of your site, but significant gaps make it hard for them to describe what you do accurately.

The weakest area: your pages carry little of the structured data AI assistants use to understand what you offer (Structured Capability Data, 0/100).

What's working: your llms.txt gives AI assistants a clear guide to your key pages.

MCP Server Discoverability and OpenAPI / API Catalog did not apply to this site, so they are not counted in your score; Citation Visibility could not be measured on this run, so it is not counted in your score.

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

### MCP Server Discoverability — N/A (not applicable)

No MCP server card (/.well-known/mcp.json or /.well-known/mcp/server-card.json), no _mcp DNS TXT record and no MCP endpoint found, and no API was detected (OpenAPI / API Catalog is N/A). A content-only site is not expected to run an MCP server. Dimension marked N/A — composite math drops it without penalty.

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI / API catalog discovered (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). Site appears to be content-only from an API-catalog perspective. Dimension marked N/A — composite math drops it without penalty.

### Structured Capability Data — 0 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 0/100 | 25% | no JSON-LD found on homepage |
| Organization schema completeness | 0/100 | 20% | no Organization schema |
| Service / Product / Offer schema | 0/100 | 20% | no Service / Product / Offer schema |
| FAQPage schema (count + conversational LLM eval) · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. Weight redistributed across other Dim 4 sub-checks. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. Weight redistributed across other Dim 4 sub-checks. |

### Agent-Parsable Content — 83 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | Static-vs-rendered token overlap 96%; rendered HTML 1.0x the size of static. |
| Page weight + LCP | 50/100 | 15% | Page weight 1.20MB (1262256 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade). |
| Markdown content negotiation | 100/100 | 25% | Accept: text/markdown returns text/markdown; charset=utf-8 (directly). |
| Pricing text visibility | 100/100 | 20% | Detected https://linear.app/pricing; 7 text-based price token(s); 4 with /period suffix. |
| Case-study scannability | 0/100 | 10% | Sampled 1 page(s); avg 0/100. https://linear.app/case-studies → 0 (h:✗ l:✗ b:✗). |

### Citation Visibility — N/A (not applicable)

All 40 cells came back unmeasurable (network or provider failures). Dimension dropped from composite. Dim 6 engine: dim6:v3 (4 models, prompt-set v3)

## Prioritized gaps + remediation

Sub-checks scoring below 100, ordered by lowest score first. Each gap includes specific remediation guidance generated for your site by our analysis engine.

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

**Remediation:** To improve the Service / Product / Offer schema on the homepage, pricing, and services pages, add the necessary JSON-LD markup to the relevant pages to provide a clear and accurate description of the services offered by Linear. This can be achieved by adding the required schema properties, such as "name", "description", and "image", to the existing JSON-LD markup. This will ensure that search engines can understand the services offered by Linear and provide a better user experience. Estimated effort: 1 to 2 hours.

### Case-study scannability

_Agent-Parsable Content · 0/100 · weight 10%_

**Finding:** Sampled 1 page(s); avg 0/100. https://linear.app/case-studies → 0 (h:✗ l:✗ b:✗).

**Remediation:** To improve the structure of your case study pages, add headings, plain-text metrics, and skim-friendly markup to the case study pages. Specifically, ensure that each page has clear and concise headings (h), lists (l), and bullet points (b) to facilitate easy scanning. This can be achieved by reviewing and updating the existing content to include relevant headings and markup, and then applying a consistent format throughout the pages. Estimated effort: 1 to 2 hours.

### Page weight + LCP

_Agent-Parsable Content · 50/100 · weight 15%_

**Finding:** Page weight 1.20MB (1262256 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade).

**Remediation:** To improve the page weight and load timing of your key public pages (homepage, pricing, services), reduce the page weight by optimizing the size of the resources loaded on these pages. Specifically, consider compressing or minifying the files that contribute to the 1.20MB page weight, as noted by the scanner. This can be achieved by implementing file compression or minification techniques, such as using a content delivery network (CDN) or a build tool to reduce the file size of the resources loaded on these pages. Estimated effort: 1 to 2 hours.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 58/100 · weight 15%_

**Finding:** LLM rated blockquote 58/100

**Remediation:** To improve the blockquote summary inside the `/llms.txt` file, update the existing blockquote to provide a more compelling and concise elevator pitch that accurately represents the LLM's capabilities. This can be achieved by rewriting the blockquote to focus on the key benefits and unique value proposition of the LLM, making it more engaging and effective. Estimated effort: 1 to 2 hours.

### Curation quality

_llms.txt Quality · 80/100 · weight 15%_

**Finding:** 180 links (>100)

**Remediation:** To improve the curation quality of the link list inside the `/llms.txt` file, add more descriptive and relevant links to the file to increase its overall value. This can be achieved by reviewing the existing links and adding new ones that provide additional context and depth to the content. Estimated effort: 1 to 2 hours.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.