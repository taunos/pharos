> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 21:04:19 UTC · session 7016609a

**https://www.rachelqueiroz.com/**

## 79 — grade B

_Scored on 3 of 6 dimensions. Not applicable to this site: MCP Server Discoverability and OpenAPI / API Catalog. Not measured on this run: Citation Visibility. Dimensions that were not scored are not counted in the score._

## Executive summary

Your site scored 79/100 (grade B) on the 3 of 6 dimensions we could score: many of the checks we ran passed, and the gaps below are worth fixing.

Because only 3 of 6 dimensions could be scored, this is a partial view of your site, and it is not comparable with a score based on more dimensions.

The weakest areas: your pages passed only some of our readability checks (Agent-Parsable Content, 73/100); and your llms.txt file passed only some of our checks (llms.txt Quality, 75/100).

What's working: the structured data (JSON-LD) on your homepage passed most of our checks.

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
| Blockquote elevator-pitch quality (LLM) | 64/100 | 15% | LLM rated blockquote 64/100 |

### MCP Server Discoverability — N/A (not applicable)

No supported MCP discovery signal was found: no MCP server card (/.well-known/mcp.json or /.well-known/mcp/server-card.json), nothing answering as an MCP server at /api/mcp, no MCP link in /llms.txt or on the homepage, no /.well-known/ucp profile declaring MCP and no _mcp DNS TXT record. No API evidence was found either (no OpenAPI description or API catalog, GraphQL endpoint or API documentation link). An MCP server may still exist elsewhere, so this dimension is marked N/A rather than scored.

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link), and no other API evidence was detected. Dimension marked N/A — composite math drops it without penalty.

### Structured Capability Data — 87 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 1 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 60/100 | 20% | Organization found: name=true, url=true, description=false, sameAs=0 |
| Service / Product / Offer schema | 100/100 | 20% | 2 Service/Product/Offer block(s); best match has 3/3 required fields |
| FAQPage schema (count + conversational LLM eval) | 85/100 | 20% | 4 Q&A pair(s); LLM rated 4 question(s) avg 63/100 |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 73 B

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | Static-vs-rendered token overlap 100%; rendered HTML 1.0x the size of static. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.06 MB (65016 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation | 25/100 | 25% | No markdown variant or content negotiation. Agents must fall back to HTML extraction. |
| Pricing text visibility · N/A | — | 20% | No /pricing, /plans, or /price path found, and no pricing-link discovered on homepage. This check is not counted in your score. |
| Case-study scannability · N/A | — | 10% | No case-study or portfolio page detected (homepage links such as /case-studies, /customers, /work, /portfolio, /casos or /projetos, and the /case-studies, /customers, /success-stories, /work and /portfolio paths). This check is not counted in your score. |

### Citation Visibility — N/A (not counted in score)

Citation Visibility was not measured on this run: none of the 40 test answers from the AI assistants could be scored (network or provider failures). It is not counted in your score. Astrant Citation Visibility v4 (4 AI models).

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### Markdown content negotiation

_Agent-Parsable Content · 25/100 · weight 25%_

**Finding:** No markdown variant or content negotiation. Agents must fall back to HTML extraction.

**Remediation:** When we asked your homepage for Markdown (Accept: text/markdown) it returned HTML, and we found no Markdown version at https://www.rachelqueiroz.com/index.md. Serving Markdown is an emerging convention, not a standard: if your platform supports it, return a Markdown version of key pages to requests that ask for text/markdown, or publish one at the page address with .md added. Label a response text/markdown only if its body really is Markdown. Estimated effort: 1 to 3 days on a custom site; some hosted platforms can't do this.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** 0/3 sampled links return markdown-ish content

**Remediation:** 0 of the 3 links we sampled from https://www.rachelqueiroz.com/llms.txt returned Markdown or plain text; the others returned HTML or an error. If your platform can publish a clean Markdown version of each linked page (the llmstxt.org proposal suggests the page address with .md added), point the links at those versions. If it can't, the links still work as normal web pages and this check can stay below passing. Estimated effort: 2 to 8 hours, depending on your platform.

### Organization schema completeness

_Structured Capability Data · 60/100 · weight 20%_

**Finding:** Organization found: name=true, url=true, description=false, sameAs=0

**Remediation:** The Organization block on your homepage is missing description. Add the missing fields, using the same name and description your site already shows. Links to social profiles (sameAs) are optional; add them only for profiles you really have. Estimated effort: under 30 minutes.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 64/100 · weight 15%_

**Finding:** LLM rated blockquote 64/100

**Remediation:** Our automated AI rating of the blockquote summary in https://www.rachelqueiroz.com/llms.txt was 64/100; that is a judgement, not a measurement. If you revise it, say in one or two plain sentences what your business does, who it serves and what sets it apart, in the words your customers use. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.