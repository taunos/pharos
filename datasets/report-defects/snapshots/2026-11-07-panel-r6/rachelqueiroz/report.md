> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 22:22:52 UTC · session da9c8828

**https://www.rachelqueiroz.com/**

## 89 — grade A-

_Scored on 3 of 6 dimensions. Not applicable to this site: MCP Server Discoverability and OpenAPI / API Catalog. Not measured on this run: Citation Visibility. Dimensions that were not scored are not counted in the score; 3 individual checks did not apply or could not be measured and are not counted._

## Executive summary

Your site scored 89/100 (grade A-) on the 3 of 6 dimensions we could score: most of the checks we ran passed, with a few gaps left.

Because only 3 of 6 dimensions could be scored, this is a partial view of your site, and it is not comparable with a score based on more dimensions.

The weakest area: your llms.txt file passed only some of our checks (llms.txt Quality, 75/100).

What's working: your pages passed most of our readability checks; and the structured data (JSON-LD) on your homepage passed most of our checks.

MCP Server Discoverability and OpenAPI / API Catalog did not apply to this site, so they are not counted in your score; Citation Visibility could not be measured on this run, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.

## Dimension breakdown

### llms.txt Quality — 75 B

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/plain; charset=utf-8" |
| Spec compliance (H1 + blockquote) | 100/100 | 25% | h1=yes, blockquote=yes |
| Linked pages return useful markdown | 0/100 | 20% | 0/3 sampled links return markdown-ish content |
| Curation quality | 100/100 | 15% | clean link list |
| Blockquote elevator-pitch quality | 67/100 | 15% | 2 of 3 blockquote rules met: one paragraph (yes); 50 to 250 words (yes, 52 words); names the business (no). |

### MCP Server Discoverability — N/A (not applicable)

No supported MCP discovery signal was found: no MCP server card (/.well-known/mcp.json or /.well-known/mcp/server-card.json), nothing answering as an MCP server at /api/mcp, no MCP link in /llms.txt or on the homepage, no /.well-known/ucp profile declaring MCP and no _mcp DNS TXT record. No API evidence was found either (no OpenAPI description or API catalog, GraphQL endpoint or API documentation link). An MCP server may still exist elsewhere, so this dimension is marked N/A rather than scored.

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link), and no other API evidence was detected. This dimension is not counted in your score.

### Structured Capability Data — 91 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 1 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 60/100 | 20% | Organization found: name=true, url=true, description=false, sameAs=0 |
| Service / Product / Offer schema | 100/100 | 20% | 2 Service/Product/Offer block(s); best match has 3/3 required fields |
| FAQPage schema | 100/100 | 20% | 4 Q&A pair(s); 4 read as clear questions with direct answers. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 100 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | About 100% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.06 MB (65016 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation · N/A | — | 25% | We found no Markdown version at the addresses we checked (https://www.rachelqueiroz.com/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead. Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored. |
| Pricing text visibility | 100/100 | 20% | No pricing page found, so we checked the prices shown on the homepage (https://www.rachelqueiroz.com/): 2 text-based price token(s); 0 with a billing period or marked one-time. |
| Case-study scannability · N/A | — | 10% | No case-study or portfolio page detected (homepage links such as /case-studies, /customers, /work, /portfolio, /casos or /projetos, and the /case-studies, /customers, /success-stories, /work and /portfolio paths). This check is not counted in your score. |

### Citation Visibility — N/A (not counted in score)

Citation Visibility was not run on this report: no AI assistant was set up to answer the test questions. It is not counted in your score. Astrant Citation Visibility v4 (4 AI models).

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** 0/3 sampled links return markdown-ish content

**Remediation:** 0 of the 3 links we sampled from https://www.rachelqueiroz.com/llms.txt returned Markdown or plain text; the others returned HTML or an error. If your platform can publish a clean Markdown version of each linked page (the llmstxt.org proposal suggests the page address with .md added), point the links at those versions. If it can't, the links still work as normal web pages and this check can stay below passing. Estimated effort: 2 to 8 hours, depending on your platform.

### Organization schema completeness

_Structured Capability Data · 60/100 · weight 20%_

**Finding:** Organization found: name=true, url=true, description=false, sameAs=0

**Remediation:** The Organization block on your homepage is missing description. Add the missing fields, using the same name and description your site already shows. Links to social profiles (sameAs) are optional; add them only for profiles you really have. Estimated effort: under 30 minutes.

### Blockquote elevator-pitch quality

_llms.txt Quality · 67/100 · weight 15%_

**Finding:** 2 of 3 blockquote rules met: one paragraph (yes); 50 to 250 words (yes, 52 words); names the business (no).

**Remediation:** Edit the blockquote summary in https://www.rachelqueiroz.com/llms.txt: name your business in it, as your llms.txt H1 or your domain names it. This check scores three fixed rules: one paragraph, 50 to 250 words, and your business name in the text. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.