> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 22:25:26 UTC · session e5d6fe69

**https://resend.com/**

## 94 — grade A

_Scored on 5 of 6 dimensions. Not measured on this run: Citation Visibility. Dimensions that were not scored are not counted in the score; 4 individual checks did not apply or could not be measured and are not counted._

## Executive summary

Your site scored 94/100 (grade A) on the 5 of 6 dimensions we could score: most of the checks we ran passed, with a few gaps left.

Citation Visibility, which tests what AI assistants say when asked about your site, was not measured on this run, so this score covers your site's own files and pages only.

There are no major weak areas; the remaining gaps are smaller refinements.

What's working: the OpenAPI description of your API passed most of our checks; the structured data (JSON-LD) on your homepage passed most of our checks; and your pages passed most of our readability checks.

The "Prioritized gaps + remediation" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.

## Dimension breakdown

### llms.txt Quality — 91 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/plain; charset=utf-8" |
| Spec compliance (H1 + blockquote) | 100/100 | 25% | h1=yes, blockquote=yes |
| Linked pages return useful markdown | 80/100 | 20% | 4/5 sampled links return markdown-ish content |
| Curation quality | 100/100 | 15% | clean link list |
| Blockquote elevator-pitch quality | 67/100 | 15% | 2 of 3 blockquote rules met: one paragraph (yes); 50 to 250 words (no, 19 words); names the business (yes). |

### MCP Server Discoverability — 86 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| Well-known discovery (mcp.json / server-card.json) | 100/100 | 30% | valid card at /.well-known/mcp.json with name="Resend", transports=1 |
| Tool coverage and quality | 70/100 | 20% | 12 tool(s) declared: 12 with a description, 0 with an input schema (inputSchema); 0 have both |
| OAuth metadata (when auth declared) | 100/100 | 15% | auth=oauth2; OAuth metadata valid |
| Live MCP tools/list invocation | 75/100 | 25% | The MCP endpoint at https://mcp.resend.com/mcp answered and requires OAuth sign-in (HTTP 401 with a Bearer challenge), so its tools could not be listed without an account. |
| DNS TXT discovery (_mcp subdomain) · N/A | — | 10% | No TXT record at _mcp.resend.com. Informational only: no ratified standard defines an _mcp DNS record, so this is not scored. |

### OpenAPI / API Catalog — 100 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| API spec discovery | 100/100 | 25% | Found via well-known /.well-known/api-catalog at https://resend.com/openapi.yaml (content-type=text/yaml; charset=utf-8). Read through the API catalog at https://resend.com/.well-known/api-catalog (its service-desc link). |
| Spec validity (parses + has version field) | 100/100 | 25% | Valid YAML spec, openapi 3.0.3. |
| Spec info completeness (title + version + description) | 100/100 | 15% | info: title=yes, version=yes, description=yes (3/3) |
| Security schemes documented | 100/100 | 15% | components.securitySchemes declared: bearerAuth. |
| Operation coverage + per-operation docs | 100/100 | 20% | 83 operation(s); 83/83 have a summary or description. (count=100, doc=100) |

### Structured Capability Data — 100 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 1 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 100/100 | 20% | Organization found: name=true, url=true, description=true, sameAs=8 |
| Service / Product / Offer schema | 100/100 | 20% | 2 Service/Product/Offer block(s); best match has 3/3 required fields |
| FAQPage schema · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 94 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | About 97% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.56 MB (583389 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation · N/A | — | 25% | Accept: text/markdown returns text/markdown; charset=utf-8 (directly). Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored. |
| Pricing text visibility | 100/100 | 20% | Detected https://resend.com/pricing; 13 text-based price token(s); 7 with a billing period or marked one-time. |
| Case-study scannability | 57/100 | 10% | Sampled 1 page(s); avg 57/100. https://resend.com/customers/gumroad → 57 (headings: no, lists: yes, bold text: yes). (A case study linked from the index page https://resend.com/customers.) |

### Citation Visibility — N/A (not counted in score)

Citation Visibility was not run on this report: no AI assistant was set up to answer the test questions. It is not counted in your score. Astrant Citation Visibility v4 (4 AI models).

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### Case-study scannability

_Agent-Parsable Content · 57/100 · weight 10%_

**Finding:** Sampled 1 page(s); avg 57/100. https://resend.com/customers/gumroad → 57 (headings: no, lists: yes, bold text: yes). (A case study linked from the index page https://resend.com/customers.)

**Remediation:** On the 1 case-study page(s) we sampled, we found fewer than three subheadings (h2 or h3). If you edit them, give each story a few clear subheadings (for example the client, the problem, what you did and the result) and put the key facts, only ones the client has agreed to share, in a short list. If the pages we sampled aren't case studies, this check doesn't apply and you can ignore it. Estimated effort: 1 to 2 hours per page.

### Blockquote elevator-pitch quality

_llms.txt Quality · 67/100 · weight 15%_

**Finding:** 2 of 3 blockquote rules met: one paragraph (yes); 50 to 250 words (no, 19 words); names the business (yes).

**Remediation:** Edit the blockquote summary in https://resend.com/llms.txt: make it 50 to 250 words long (it has 19 now). This check scores three fixed rules: one paragraph, 50 to 250 words, and your business name in the text. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.