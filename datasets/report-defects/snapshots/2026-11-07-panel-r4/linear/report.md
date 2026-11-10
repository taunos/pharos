> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 21:39:34 UTC · session b5d9e2f5

**https://linear.app/**

## 46 — grade D

_Scored on 4 of 6 dimensions. Not applicable to this site: OpenAPI / API Catalog. Not measured on this run: Citation Visibility. Dimensions that were not scored are not counted in the score; 4 individual checks did not apply or could not be measured and are not counted._

## Executive summary

Your site scored 46/100 (grade D) on the 4 of 6 dimensions we could score: some of the checks we ran passed, and several important ones did not.

Citation Visibility, which tests what AI assistants say when asked about your site, was not measured on this run, so this score covers your site's own files and pages only.

The weakest areas: your homepage carries little structured data (JSON-LD) about what you offer (Structured Capability Data, 0/100); and we found your MCP server, but it isn't fully discoverable (no server card) (MCP Server Discoverability, 25/100).

What's working: your llms.txt file passed most of our checks; and your pages passed most of our readability checks.

OpenAPI / API Catalog did not apply to this site, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.

## Dimension breakdown

### llms.txt Quality — 91 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/plain; charset=utf-8" |
| Spec compliance (H1 + blockquote) | 100/100 | 25% | h1=yes, blockquote=yes |
| Linked pages return useful markdown | 100/100 | 20% | 5/5 sampled links return markdown-ish content |
| Curation quality | 80/100 | 15% | 180 links (>100) |
| Blockquote elevator-pitch quality (LLM) | 58/100 | 15% | LLM rated blockquote 58/100 |

### MCP Server Discoverability — 25 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Well-known discovery (mcp.json / server-card.json) | 0/100 | 30% | no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json; an MCP server was found (an MCP endpoint answered at https://mcp.linear.app/mcp) but it is not advertised with a server card |
| Tool coverage and quality | 0/100 | 20% | no card or no tools declared |
| OAuth metadata (when auth declared) · N/A | — | 15% | No MCP server card found, so there is no declared authentication to check. This check is not counted in your score. |
| Live MCP tools/list invocation | 75/100 | 25% | The MCP endpoint at https://mcp.linear.app/mcp answered and requires OAuth sign-in (HTTP 401 with a Bearer challenge), so its tools could not be listed without an account. |
| DNS TXT discovery (_mcp subdomain) · N/A | — | 10% | No TXT record at _mcp.linear.app. Informational only: no ratified standard defines an _mcp DNS record, so this is not scored. |

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). The site does show API evidence (a link to https://linear.app/developers/graphql.md), so it is not a content-only site: this dimension is marked N/A because there is no OpenAPI description to check, not because there is no API.

### Structured Capability Data — 0 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 0/100 | 25% | no JSON-LD found on homepage |
| Organization schema completeness | 0/100 | 20% | no Organization schema |
| Service / Product / Offer schema | 0/100 | 20% | no Service / Product / Offer schema |
| FAQPage schema (count + conversational LLM eval) · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 90 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | About 96% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. |
| Page weight | 50/100 | 15% | Homepage HTML size: 1.20 MB (1262256 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation | 100/100 | 25% | Accept: text/markdown returns text/markdown; charset=utf-8 (directly). |
| Pricing text visibility | 100/100 | 20% | Detected https://linear.app/pricing; 7 text-based price token(s); 4 with a billing period or marked one-time. |
| Case-study scannability | 71/100 | 10% | Sampled 1 page(s); avg 71/100. https://linear.app/customers/saas → 71 (h:✓ l:✓ b:✗). (A case study linked from the index page https://linear.app/customers.) |

### Citation Visibility — N/A (not counted in score)

Citation Visibility was not run on this report: no AI assistant was set up to answer the test questions. It is not counted in your score. Astrant Citation Visibility v4 (4 AI models).

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### Well-known discovery (mcp.json / server-card.json)

_MCP Server Discoverability · 0/100 · weight 30%_

**Finding:** no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json; an MCP server was found (an MCP endpoint answered at https://mcp.linear.app/mcp) but it is not advertised with a server card

**Remediation:** We found no MCP discovery card at https://linear.app/.well-known/mcp.json or https://linear.app/.well-known/mcp/server-card.json. If you run an MCP server, publish a JSON card at one of those addresses with the server's name and a transports list giving its URL (server cards are still a draft proposal, so the format may change). If you don't run one, building an MCP server is a development project, worth it only if you have tools or data you want AI agents to use, such as booking, ordering or account lookups. Estimated effort: 30 minutes to 1 hour for the card; several days to build a new MCP server.

### JSON-LD present on homepage

_Structured Capability Data · 0/100 · weight 25%_

**Finding:** no JSON-LD found on homepage

**Remediation:** Your homepage has no JSON-LD structured data. Add a script block of type application/ld+json to the homepage that describes your business with schema.org Organization, or a more specific type such as LocalBusiness, ProfessionalService or Store, giving its name, url and description. Use only facts your site already states. Estimated effort: 1 to 2 hours.

### Organization schema completeness

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Organization schema

**Remediation:** Your homepage has no Organization structured data. Add an Organization block (or a more specific type such as LocalBusiness or ProfessionalService) in JSON-LD with your business's name, url and description; it can be the same block suggested under JSON-LD present. Estimated effort: 30 minutes to 1 hour.

### Service / Product / Offer schema

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Service / Product / Offer schema

**Remediation:** We found no Service, Product or Offer structured data on your homepage (this check reads the homepage only). If you sell services, add a Service block for each main service with name, description and provider (your Organization); if you sell products, use Product with an Offer, adding a price only if you publish one. If your site doesn't sell anything, this check doesn't fit it and you can leave it. Estimated effort: 1 to 3 hours.

### Tool coverage and quality

_MCP Server Discoverability · 0/100 · weight 20%_

**Finding:** no card or no tools declared

**Remediation:** Depends on Well-known discovery: there is no discovery card to read tools from. If you publish a card, list each tool your MCP server offers in its tools array, with a name, a plain-language description and an inputSchema. Estimated effort: 30 minutes to 1 hour.

### Page weight

_Agent-Parsable Content · 50/100 · weight 15%_

**Finding:** Homepage HTML size: 1.20 MB (1262256 bytes). This check looks at page size only; it does not measure loading speed.

**Remediation:** Your homepage's HTML document is 1.20 MB; this check measures the HTML file only (not images or scripts) and passes under 1 MB. Large HTML usually comes from data, scripts or styles written into the page; move them into separate files or trim them. Load time (LCP) was not measured. Estimated effort: 2 to 8 hours.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 58/100 · weight 15%_

**Finding:** LLM rated blockquote 58/100

**Remediation:** Our automated AI rating of the blockquote summary in https://linear.app/llms.txt was 58/100; that is a judgement, not a measurement. If you revise it, say in one or two plain sentences what your business does, who it serves and what sets it apart, in the words your customers use. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.