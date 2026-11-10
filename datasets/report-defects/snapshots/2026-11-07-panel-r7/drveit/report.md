> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 22:52:20 UTC · session 8416ce72

**https://drveit.com.br/**

## 78 — grade B

_Scored on 3 of 6 dimensions. Not applicable to this site: MCP Server Discoverability and OpenAPI / API Catalog. Not measured on this run: Citation Visibility. Dimensions that were not scored are not counted in the score; 5 individual checks did not apply or could not be measured and are not counted._

## Executive summary

Your site scored 78/100 (grade B) on the 3 of 6 dimensions we could score: many of the checks we ran passed, and the gaps below are worth fixing.

Because only 3 of 6 dimensions could be scored, this is a partial view of your site, and it is not comparable with a score based on more dimensions.

The weakest area: your llms.txt file passed only some of our checks (llms.txt Quality, 50/100).

What's working: your pages passed most of our readability checks.

MCP Server Discoverability and OpenAPI / API Catalog did not apply to this site, so they are not counted in your score; Citation Visibility could not be measured on this run, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.

## Dimension breakdown

### llms.txt Quality — 50 D

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/plain" |
| Spec compliance (H1 + blockquote) | 50/100 | 25% | h1=yes, blockquote=no |
| Linked pages return useful markdown | 0/100 | 20% | 0/5 sampled links return markdown-ish content |
| Curation quality | 80/100 | 15% | tag pages linked |
| Blockquote elevator-pitch quality | 0/100 | 15% | no blockquote to evaluate |

### MCP Server Discoverability — N/A (not applicable)

No supported MCP discovery signal was found: no MCP server card (/.well-known/mcp.json or /.well-known/mcp/server-card.json), nothing answering as an MCP server at /api/mcp, no MCP link in /llms.txt or on the homepage, no /.well-known/ucp profile declaring MCP and no _mcp DNS TXT record. No API evidence was found either (no OpenAPI description or API catalog, GraphQL endpoint or API documentation link). An MCP server may still exist elsewhere, so this dimension is marked N/A rather than scored.

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link), and no other API evidence was detected. This dimension is not counted in your score.

### Structured Capability Data — 82 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 2 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 60/100 | 20% | Organization found: name=true, url=true, description=false, sameAs=4 |
| Service / Product / Offer schema · N/A | — | 20% | We found no product pages, no prices on the homepage and no pricing page, so this check is not counted in your score. |
| FAQPage schema · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 100 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | About 100% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.05 MB (51644 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation · N/A | — | 25% | We found no Markdown version at the addresses we checked (https://drveit.com.br/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead. Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored. |
| Pricing text visibility · N/A | — | 20% | Not measured: we found no pricing page to check, and no prices on the homepage or on the 3 page(s) it links to that we sampled. This check is not counted in your score. |
| Case-study scannability | 100/100 | 10% | Sampled 1 page(s); avg 100/100. https://drveit.com.br/sorrisos-e-casos/ → 100 (headings: yes, lists: yes, bold text: yes). |

### Citation Visibility — N/A (not counted in score)

Citation Visibility was not run on this report: no AI assistant was set up to answer the test questions. It is not counted in your score. Astrant Citation Visibility v4 (4 AI models).

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### Organization schema completeness

_Structured Capability Data · 60/100 · weight 20%_

**Finding:** Organization found: name=true, url=true, description=false, sameAs=4

**Remediation:** The Organization block on your homepage is missing description. Add the missing fields, using the same name and description your site already shows. Links to social profiles (sameAs) are optional; add them only for profiles you really have. Estimated effort: under 30 minutes.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** 0/5 sampled links return markdown-ish content

**Remediation:** 0 of the 5 links we sampled from https://drveit.com.br/llms.txt returned Markdown or plain text; the others returned HTML or an error. If your platform can publish a clean Markdown version of each linked page (the llmstxt.org proposal suggests the page address with .md added), point the links at those versions. If it can't, the links still work as normal web pages and this check can stay below passing. Estimated effort: 2 to 8 hours, depending on your platform.

### Blockquote elevator-pitch quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** There is no blockquote summary in https://drveit.com.br/llms.txt to rate. Add one directly under the H1: a single paragraph on one line starting with >, saying what your business does and who it serves. Estimated effort: under 30 minutes.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 50/100 · weight 25%_

**Finding:** h1=yes, blockquote=no

**Remediation:** Add a one-paragraph summary directly under the H1 in https://drveit.com.br/llms.txt, written as a Markdown blockquote (the line starts with >). Say plainly what your business does and who it serves. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.