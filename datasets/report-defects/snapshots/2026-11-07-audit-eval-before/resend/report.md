> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 19:54:36 UTC · session 1c551ad0

**https://resend.com/**

## 57 — grade D

_Scored on 5 of 6 dimensions applicable to this site. Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite._

## Executive summary

Your site scored 57/100 (grade D): AI assistants can find parts of your site, but significant gaps make it hard for them to describe what you do accurately.

The weakest areas: AI agents can't discover or use an MCP server for your site (MCP Server Discoverability, 30/100); AI agents can't find a machine-readable description of your API (OpenAPI / API Catalog, 31/100); and the structured data that tells AI assistants what you offer is incomplete (Structured Capability Data, 45/100).

What's working: AI assistants can read your pages easily; and your llms.txt gives AI assistants a clear guide to your key pages.

Citation Visibility could not be measured on this run, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists the specific fix for each gap, weakest first.

## Dimension breakdown

### llms.txt Quality — 90 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/plain; charset=utf-8" |
| Spec compliance (H1 + blockquote) | 100/100 | 25% | h1=yes, blockquote=yes |
| Linked pages return useful markdown | 80/100 | 20% | 4/5 sampled links return markdown-ish content |
| Curation quality | 100/100 | 15% | clean link list |
| Blockquote elevator-pitch quality (LLM) | 58/100 | 15% | LLM rated blockquote 58/100 |

### MCP Server Discoverability — 30 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Well-known discovery (mcp.json / server-card.json) | 50/100 | 30% | card present at /.well-known/mcp.json but missing name or transports[] |
| Tool coverage and quality | 0/100 | 20% | 0 of 12 tools have description + inputSchema |
| OAuth metadata (when auth declared) | 100/100 | 15% | no auth declared (N/A) |
| Live MCP tools/list invocation | 0/100 | 25% | no transport URL in card to invoke |
| DNS TXT discovery (_mcp subdomain) | 0/100 | 10% | no TXT at _mcp.resend.com |

### OpenAPI / API Catalog — 31 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| API spec discovery | 100/100 | 25% | Found via well-known /.well-known/api-catalog at https://resend.com/.well-known/api-catalog (content-type=application/linkset+json). |
| Spec validity (parses + has version field) | 25/100 | 25% | JSON parsed but no "openapi" or "swagger" version field at the root. |
| Spec info completeness (title + version + description) | 0/100 | 15% | Spec is missing the "info" object entirely — required by OpenAPI 3.x §4.1. |
| Security schemes documented | 0/100 | 15% | No components.securitySchemes and no top-level security:[] — agents have no signal about how to authenticate. Add the relevant scheme(s) (apiKey / http bearer / OAuth) per OpenAPI 3.x §4.7. |
| Operation coverage + per-operation docs | 0/100 | 20% | Spec missing "paths" object — no operations defined. |

### Structured Capability Data — 45 D

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 1 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 100/100 | 20% | Organization found: name=true, url=true, description=true, sameAs=8 |
| Service / Product / Offer schema | 0/100 | 20% | no Service / Product / Offer schema |
| FAQPage schema (count + conversational LLM eval) | 0/100 | 20% | 0 Q&A pair(s); skipped (no questions) |
| Review / AggregateRating schema | 0/100 | 15% | no Review or AggregateRating (common for B2B SaaS — does not imply broken) |

### Agent-Parsable Content — 92 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | Static-vs-rendered token overlap 97%; rendered HTML 1.0x the size of static. |
| Page weight + LCP | 100/100 | 15% | Page weight 0.56MB (583389 bytes); LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade). |
| Markdown content negotiation | 100/100 | 25% | Accept: text/markdown returns text/markdown; charset=utf-8 (directly). |
| Pricing text visibility | 100/100 | 20% | Detected https://resend.com/pricing; 13 text-based price token(s); 7 with /period suffix. |
| Case-study scannability | 20/100 | 10% | Sampled 1 page(s); avg 20/100. https://resend.com/customers → 20 (h:✗ m:✗ l:✓ b:✗). |

### Citation Visibility — N/A (not applicable)

All 40 cells came back unmeasurable (network or provider failures). Dimension dropped from composite. Dim 6 engine: dim6:v3 (4 models, prompt-set v3)

## Prioritized gaps + remediation

Sub-checks scoring below 100, ordered by lowest score first. Each gap includes specific remediation guidance generated for your site by our analysis engine.

### Tool coverage and quality

_MCP Server Discoverability · 0/100 · weight 20%_

**Finding:** 0 of 12 tools have description + inputSchema

**Remediation:** The `tools[]` array inside the MCP server discovery card is missing descriptions and inputSchemas for all 12 tools. To improve tool coverage and quality, add a description and inputSchema for each tool in the `tools[]` array. This can be done by editing the discovery card to include the necessary metadata for each tool, following the format and structure already present in the card. Estimated effort: 1 to 2 hours.

### Live MCP tools/list invocation

_MCP Server Discoverability · 0/100 · weight 25%_

**Finding:** no transport URL in card to invoke

**Remediation:** To improve the transport URL declared in the MCP server discovery card, add a transport URL to the card. This can be done by editing the discovery card to include the correct transport URL, which should be a specific URL that matches the site's requirements. Estimated effort: 1 to 2 hours.

### DNS TXT discovery (_mcp subdomain)

_MCP Server Discoverability · 0/100 · weight 10%_

**Finding:** no TXT at _mcp.resend.com

**Remediation:** To improve the DNS TXT record at `_mcp.resend.com`, add a TXT record with the required information. This can be done by logging in to the DNS management console for resend.com and creating a new TXT record with the correct key and value. Estimated effort: 1 to 2 hours.

### Spec info completeness (title + version + description)

_OpenAPI / API Catalog · 0/100 · weight 15%_

**Finding:** Spec is missing the "info" object entirely — required by OpenAPI 3.x §4.1.

**Remediation:** To improve the completeness of the OpenAPI spec, add the `info` block with `info.title`, `info.version`, and `info.description` fields. This can be done by creating a new file or updating an existing one to include the required information, such as the API title, version, and a brief description. Estimated effort: 1 to 2 hours.

### Security schemes documented

_OpenAPI / API Catalog · 0/100 · weight 15%_

**Finding:** No components.securitySchemes and no top-level security:[] — agents have no signal about how to authenticate. Add the relevant scheme(s) (apiKey / http bearer / OAuth) per OpenAPI 3.x §4.7.

**Remediation:** To improve the security of your OpenAPI specification, add a `components.securitySchemes` block to define the security schemes used by your API. Specifically, include the relevant scheme(s) such as apiKey, http bearer, or OAuth as per OpenAPI 3.x standards. This can be done by adding a new section to the OpenAPI spec that outlines the security schemes used by your API, including any necessary details such as authentication types and token formats. Estimated effort: 1 to 2 hours.

### Operation coverage + per-operation docs

_OpenAPI / API Catalog · 0/100 · weight 20%_

**Finding:** Spec missing "paths" object — no operations defined.

**Remediation:** To improve the OpenAPI spec, add a `paths` block with operations that include `summary` and `description` documentation. Specifically, create a new `paths` block with at least one operation that includes a `summary` and a `description` to provide a clear and concise explanation of the operation's purpose. This will enhance the overall documentation of the API and improve the user experience. Estimated effort: 1 to 2 hours.

### Service / Product / Offer schema

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Service / Product / Offer schema

**Remediation:** To improve the Service / Product / Offer JSON-LD on commercial pages, add the missing schema to the Service / Product / Offer JSON-LD on the homepage, pricing, and services pages. This can be achieved by adding the necessary markup to the relevant pages, which typically involves editing the page's HTML to include the required schema properties. Estimated effort: 1 to 2 hours.

### FAQPage schema (count + conversational LLM eval)

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** 0 Q&A pair(s); skipped (no questions)

**Remediation:** To improve the FAQPage JSON-LD on the homepage or a dedicated FAQ page, add a Q&A pair to the existing JSON-LD markup. Specifically, create a new "question" and "answer" property within the "FAQPage" schema, following the standard format for JSON-LD markup. This will involve writing and formatting the new Q&A pair in a way that is consistent with the existing schema. Estimated effort: 1 to 2 hours.

### Review / AggregateRating schema

_Structured Capability Data · 0/100 · weight 15%_

**Finding:** no Review or AggregateRating (common for B2B SaaS — does not imply broken)

**Remediation:** To improve the Review or AggregateRating JSON-LD on relevant pages, add a Review or AggregateRating schema block to the page's HTML, including the required properties such as rating, review count, and review author. This can be done by editing the page's HTML to include the necessary schema markup, which can be found in the schema.org documentation. Estimated effort: 1 to 2 hours.

### Case-study scannability

_Agent-Parsable Content · 20/100 · weight 10%_

**Finding:** Sampled 1 page(s); avg 20/100. https://resend.com/customers → 20 (h:✗ m:✗ l:✓ b:✗).

**Remediation:** To improve the structure of your case study pages, add headings, plain-text metrics, and skim-friendly markup to the existing case study pages. Specifically, ensure that each page has a clear hierarchy of headings (h1, h2, h3, etc.) and that the page's main content is marked up with a clear and concise summary, metrics, and benefits. This will make it easier for users to quickly understand the key points of each case study. Estimated effort: 1 to 2 hours.

### Spec validity (parses + has version field)

_OpenAPI / API Catalog · 25/100 · weight 25%_

**Finding:** JSON parsed but no "openapi" or "swagger" version field at the root.

**Remediation:** To improve the OpenAPI / Swagger spec document's parseability and version field, update the root of the OpenAPI document to include a valid `openapi` or `swagger` field with a version number. Specifically, add a line to the root of the document to specify the OpenAPI version, for example, `openapi: 3.0.2`. This will ensure the document is properly formatted and versioned. Estimated effort: 30 minutes to 1 hour.

### Well-known discovery (mcp.json / server-card.json)

_MCP Server Discoverability · 50/100 · weight 30%_

**Finding:** card present at /.well-known/mcp.json but missing name or transports[]

**Remediation:** To improve the discovery card at /.well-known/mcp.json, add a name to the existing card by editing the file to include a valid name in the required "name" field. This can be done by opening the file and adding the missing name information, following the standard format for the field. Estimated effort: 30 minutes to 1 hour.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 58/100 · weight 15%_

**Finding:** LLM rated blockquote 58/100

**Remediation:** To improve the blockquote summary inside the `/llms.txt` file, update the existing content to provide a clear and concise elevator pitch that accurately represents the LLM's capabilities. This can be achieved by rewriting the blockquote to focus on the key benefits and unique value proposition of the LLM, ensuring it is engaging, informative, and free of errors. Estimated effort: 1 to 2 hours.

### Linked pages return useful markdown

_llms.txt Quality · 80/100 · weight 20%_

**Finding:** 4/5 sampled links return markdown-ish content

**Remediation:** To improve the linked pages from inside the `/llms.txt` file, update the file to include markdown links that point to relevant and useful content. Specifically, review the 4/5 sampled links that currently have markdown-ish content and ensure they accurately reflect the intended destination and provide a clear description of the linked content. This can be achieved by editing the `/llms.txt` file to include descriptive and accurate markdown links. Estimated effort: 1 to 2 hours.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.