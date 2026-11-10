# Astrant Score v1 · Audit report

Generated 2026-11-08 05:32:47 UTC · session afcc894a

**https://www.rachelqueiroz.com/**

## 67 — grade C

_Scored on 4 of 6 dimensions. Not applicable to this site: MCP Server Discoverability and OpenAPI / API Catalog. Dimensions that were not scored are not counted in the score; 4 individual checks did not apply or could not be measured and are not counted._

## Executive summary

Your site scored 67/100 (grade C) on the 4 of 6 dimensions we could score: some of the checks we ran passed, and several important ones did not.

The weakest area: in our test questions, AI assistants rarely named your site (Citation Visibility, 8/100).

What's working: your pages passed most of our readability checks; and the structured data (JSON-LD) on your homepage passed most of our checks.

MCP Server Discoverability and OpenAPI / API Catalog did not apply to this site, so they are not counted in your score.

The "Prioritized gaps + remediation" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.

## Dimension breakdown

### llms.txt Quality — 80 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | status=200, content-type="text/plain; charset=utf-8" |
| Spec compliance (H1 + blockquote) | 100/100 | 25% | h1=yes, blockquote=yes |
| Linked pages return useful markdown | 0/100 | 20% | 0/3 sampled links return markdown-ish content |
| Curation quality | 100/100 | 15% | clean link list |
| Blockquote elevator-pitch quality | 100/100 | 15% | 2 of 2 blockquote rules met: one paragraph (yes); 10 to 100 words (yes, 52 words). |

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
| FAQPage schema | 100/100 | 20% | 4 Q&A pair(s); 4 are phrased as questions and have an answer of reasonable length. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 100 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | About 100% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.06 MB (65016 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation · N/A | — | 25% | We found no Markdown version at the addresses we checked (https://www.rachelqueiroz.com/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead. Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored. |
| Pricing text visibility | 100/100 | 20% | No pricing page found, so we checked the prices shown on the homepage (https://www.rachelqueiroz.com/): 2 text-based price token(s); 0 with a billing period or marked one-time. |
| Case-study scannability · N/A | — | 10% | No case-study or portfolio page detected (homepage links such as /case-studies, /customers, /work, /portfolio, /casos or /projetos, and the /case-studies, /customers, /success-stories, /work and /portfolio paths). This check is not counted in your score. |

### Citation Visibility — 8 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Models name your domain | 13/100 | 40% | 13% of scored test answers named your domain and matched how your site describes itself. Of the 40 scored answers, 5 matched how your site describes itself, 8 described a different person or business than your site says it is, 3 did not say enough to check, and 24 did not show that the model knew your site. 40 of 40 test answers could be scored, across 4 AI models. Average by model: ChatGPT 0, Claude 0, Gemini 0, Perplexity 34. |
| Models cite your URL | 0/100 | 30% | 0% of scored test answers matched how your site describes itself and included at least one link to it. |
| Models treat your domain as the principal answer | 13/100 | 20% | 13% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end. |
| Competitor-first check (not measured) · N/A | — | 10% | Not measured: this Audit doesn't take a competitor list yet, so there is nothing to compare against. This check is not counted in your score. |
| Answers that described a different person or business than your site says it is | — | 0% | 8 of the 40 scored answers mixed up your site with a different person or business than your site says it is; they count as 0 in the checks above. Examples of what the AI said: Gemini: "The website rachelqueiroz.com is dedicated to the life and work of Rachel de Queiroz, a renowned Brazilian writer, journalist,"; Gemini: "rachelqueiroz.com is the professional portfolio website of Rachel Queiroz, a graphic designer and brand strategist. Essentially, it's a platform where she showcases her work in..."; ChatGPT: "As of my last update, I don't have specific information about the website rachelqueiroz.com. However, based on the name, it could potentially be related to...". Saying clearly who you are and what you do in your llms.txt file, structured data and homepage gives AI assistants that read your site the right description. It does not change what a model has already learned, so results can take time to change. This row is for information and is not counted again in your score. |

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### Models name your domain

_Citation Visibility · 13/100 · weight 40%_

**Finding:** 13% of scored test answers named your domain and matched how your site describes itself. Of the 40 scored answers, 5 matched how your site describes itself, 8 described a different person or business than your site says it is, 3 did not say enough to check, and 24 did not show that the model knew your site. 40 of 40 test answers could be scored, across 4 AI models. Average by model: ChatGPT 0, Claude 0, Gemini 0, Perplexity 34.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting to change here. What can help these models name your business is clear content on your own site that says who you are, what you do and who you serve, using your business name and domain; Organization or LocalBusiness structured data on your homepage; the same business name, address and description everywhere you are listed; and mentions on independent sources these models read, such as directories, press coverage, industry lists and reviews on third-party platforms. Estimated effort: 4+ hours.

### Models cite your URL

_Citation Visibility · 0/100 · weight 30%_

**Finding:** 0% of scored test answers matched how your site describes itself and included at least one link to it.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting that makes them link to your site. What can help is having pages worth citing: one clear page for each thing you offer, each at a single stable address with a canonical URL, that answers the question in plain text near the top. Links to those pages from independent sources, such as directories, press coverage and industry lists, can also help, because these models draw on what other sites say. Estimated effort: 2 to 4 hours.

### Models treat your domain as the principal answer

_Citation Visibility · 13/100 · weight 20%_

**Finding:** 13% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly. What can help them present your business as a main answer rather than a passing mention is stating plainly, near the top of your homepage and key pages, who you are, what you do and who you serve, with your business name and domain; structured data (such as Organization or LocalBusiness) that says the same thing; and the same description of your business on the third-party sites that list you. Estimated effort: 2 to 4 hours.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** 0/3 sampled links return markdown-ish content

**Remediation:** 0 of the 3 links we sampled from https://www.rachelqueiroz.com/llms.txt returned Markdown or plain text; the others returned HTML or an error. If your platform can publish a clean Markdown version of each linked page (the llmstxt.org proposal suggests the page address with .md added), point the links at those versions. If it can't, the links still work as normal web pages and this check can stay below passing. Estimated effort: 2 to 8 hours, depending on your platform.

### Organization schema completeness

_Structured Capability Data · 60/100 · weight 20%_

**Finding:** Organization found: name=true, url=true, description=false, sameAs=0

**Remediation:** The Organization block on your homepage is missing description. Add the missing fields, using the same name and description your site already shows. Links to social profiles (sameAs) are optional; add them only for profiles you really have. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.