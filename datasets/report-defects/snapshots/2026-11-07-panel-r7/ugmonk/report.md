> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 22:53:18 UTC · session cb23eb66

**https://ugmonk.com/**

## 71 — grade B

_Scored on 4 of 6 dimensions. Not applicable to this site: OpenAPI / API Catalog. Not measured on this run: Citation Visibility. Dimensions that were not scored are not counted in the score; 6 individual checks did not apply or could not be measured and are not counted._

## Executive summary

Your site scored 71/100 (grade B) on the 4 of 6 dimensions we could score: many of the checks we ran passed, and the gaps below are worth fixing.

Citation Visibility, which tests what AI assistants say when asked about your site, was not measured on this run, so this score covers your site's own files and pages only.

The weakest areas: we found your MCP server, but it isn't fully discoverable (no server card) (MCP Server Discoverability, 33/100); and your llms.txt file passed only some of our checks (llms.txt Quality, 69/100).

What's working: your pages passed most of our readability checks; and the structured data (JSON-LD) we sampled passed most of our checks.

OpenAPI / API Catalog did not apply to this site, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.

## Dimension breakdown

### llms.txt Quality — 69 C

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/markdown; charset=utf-8" |
| Spec compliance (H1 + blockquote) | 50/100 | 25% | h1=yes, blockquote=no |
| Linked pages return useful markdown | 80/100 | 20% | 4/5 sampled links return markdown-ish content |
| Curation quality | 100/100 | 15% | clean link list |
| Blockquote elevator-pitch quality | 0/100 | 15% | no blockquote to evaluate |

### MCP Server Discoverability — 33 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Well-known discovery (mcp.json / server-card.json) | 0/100 | 30% | no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json; an MCP server was found (an MCP endpoint answered at https://ugmonk.com/api/mcp) but it is not advertised with a server card |
| Tool coverage and quality | 0/100 | 20% | no card or no tools declared |
| OAuth metadata (when auth declared) · N/A | — | 15% | No MCP server card found, so there is no declared authentication to check. This check is not counted in your score. |
| Live MCP tools/list invocation | 100/100 | 25% | tools/list returned 1 tools |
| DNS TXT discovery (_mcp subdomain) · N/A | — | 10% | No TXT record at _mcp.ugmonk.com. Informational only: no ratified standard defines an _mcp DNS record, so this is not scored. |

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). The site does show API evidence (a link to an MCP endpoint, https://ugmonk.com/api/ucp/mcp), so it is not a content-only site: this dimension is marked N/A because there is no OpenAPI description to check, not because there is no API.

### Structured Capability Data — 88 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 1 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 60/100 | 20% | Organization found: name=true, url=true, description=false, sameAs=0 |
| Service / Product / Offer schema | 100/100 | 20% | 9 Service/Product/Offer block(s); best match has 3/3 required fields (on the sampled product page https://ugmonk.com/products/analog-task-cards-small; none on the homepage) |
| FAQPage schema · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 100 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | About 97% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.08 MB (79390 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation · N/A | — | 25% | We found no Markdown version at the addresses we checked (https://ugmonk.com/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead. Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored. |
| Pricing text visibility | 100/100 | 20% | No pricing page found, so we checked the prices shown on the homepage (https://ugmonk.com/en-br): 52 text-based price token(s); 0 with a billing period or marked one-time. |
| Case-study scannability · N/A | — | 10% | No case-study or portfolio page detected (homepage links such as /case-studies, /customers, /work, /portfolio, /casos or /projetos, and the /case-studies, /customers, /success-stories, /work and /portfolio paths). This check is not counted in your score. |

### Citation Visibility — N/A (not counted in score)

Citation Visibility was not run on this report: no AI assistant was set up to answer the test questions. It is not counted in your score. Astrant Citation Visibility v4 (4 AI models).

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### Well-known discovery (mcp.json / server-card.json)

_MCP Server Discoverability · 0/100 · weight 30%_

**Finding:** no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json; an MCP server was found (an MCP endpoint answered at https://ugmonk.com/api/mcp) but it is not advertised with a server card

**Remediation:** We found no MCP discovery card at https://ugmonk.com/.well-known/mcp.json or https://ugmonk.com/.well-known/mcp/server-card.json. If you run an MCP server, publish a JSON card at one of those addresses with the server's name and a transports list giving its URL (server cards are still a draft proposal, so the format may change). If you don't run one, building an MCP server is a development project, worth it only if you have tools or data you want AI agents to use, such as booking, ordering or account lookups. Estimated effort: 30 minutes to 1 hour for the card; several days to build a new MCP server.

### Tool coverage and quality

_MCP Server Discoverability · 0/100 · weight 20%_

**Finding:** no card or no tools declared

**Remediation:** Depends on Well-known discovery: there is no discovery card to read tools from. If you publish a card, list each tool your MCP server offers in its tools array, with a name, a plain-language description and an inputSchema. Estimated effort: 30 minutes to 1 hour.

### Organization schema completeness

_Structured Capability Data · 60/100 · weight 20%_

**Finding:** Organization found: name=true, url=true, description=false, sameAs=0

**Remediation:** The Organization block on your homepage is missing description. Add the missing fields, using the same name and description your site already shows. Links to social profiles (sameAs) are optional; add them only for profiles you really have. Estimated effort: under 30 minutes.

### Blockquote elevator-pitch quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** There is no blockquote summary in https://ugmonk.com/llms.txt to rate. Add one directly under the H1: a single paragraph on one line starting with >, saying what your business does and who it serves. Estimated effort: under 30 minutes.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 50/100 · weight 25%_

**Finding:** h1=yes, blockquote=no

**Remediation:** Add a one-paragraph summary directly under the H1 in https://ugmonk.com/llms.txt, written as a Markdown blockquote (the line starts with >). Say plainly what your business does and who it serves. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.