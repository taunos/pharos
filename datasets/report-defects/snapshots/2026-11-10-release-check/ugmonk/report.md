# Astrant Score v1 · Audit report

Generated 2026-11-10 22:00:16 UTC · session b1314b63

**https://ugmonk.com/**

## 55 — grade D

_Scored on 5 of 6 dimensions. Not applicable to this site: OpenAPI / API Catalog. Dimensions that were not scored are not counted in the score; 7 individual checks did not apply or could not be measured and are not counted._

_This report was scored with Astrant Score scoring version 1.5.1. Scores are only comparable between reports made with the same version. Astrant Score scoring version 1.5.1 (Nov 7, 2026) and Citation Visibility v5 (Nov 8, 2026) measure more strictly than earlier versions, so a lower score after these dates does not by itself mean your site got worse._

## Executive summary

Your site scored 55/100 (grade D) on the 5 of 6 dimensions we could score: some of the checks we ran passed, and several important ones did not.

The weakest areas: in our test questions, AI assistants rarely named your site (Citation Visibility, 30/100); we found your MCP server, but it isn't fully discoverable (no server card) (MCP Server Discoverability, 33/100); and the structured data (JSON-LD) on your homepage is incomplete (Structured Capability Data, 57/100).

What's working: your pages passed most of our readability checks.

OpenAPI / API Catalog did not apply to this site, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.

## Dimension breakdown

### llms.txt Quality — 69 C

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | Found an llms.txt file at /llms.txt. |
| Spec compliance (H1 + blockquote) | 50/100 | 25% | The file has an H1 title but no blockquote summary (a line starting with >). |
| Linked pages return useful markdown | 80/100 | 20% | 4 of the 5 llms.txt links we checked returned Markdown or plain text; the rest returned HTML or did not load. |
| Curation quality | 100/100 | 15% | The llms.txt link list has none of the problems we check for (more than 100 links, links to tag, archive or search-result pages, links with query strings). |
| Blockquote elevator-pitch quality | 0/100 | 15% | no blockquote to evaluate |

### MCP Server Discoverability — 33 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Well-known discovery (mcp.json / server-card.json) | 0/100 | 30% | no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json; an MCP server was found (an MCP endpoint answered at https://ugmonk.com/api/mcp) but it is not advertised with a server card |
| Tool coverage and quality | 0/100 | 20% | no card or no tools declared |
| OAuth metadata (when auth declared) · N/A | — | 15% | No MCP server card found, so there is no declared authentication to check. This check is not counted in your score. |
| Live MCP tools/list invocation | 100/100 | 25% | The MCP server answered and listed 1 tool. |
| DNS TXT discovery (_mcp subdomain) · N/A | — | 10% | No TXT record at _mcp.ugmonk.com. Informational only: no ratified standard defines an _mcp DNS record, so this is not scored. |

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). The site does show API evidence (a link to an MCP endpoint, https://ugmonk.com/api/ucp/mcp), so it is not a content-only site: this dimension is marked N/A because there is no OpenAPI description to check, not because there is no API.

### Structured Capability Data — 57 D

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | The homepage has 1 valid JSON-LD block (structured data). |
| Organization schema completeness | 60/100 | 20% | Your Organization entry has a name and a URL but no description. |
| Service / Product / Offer schema | 0/100 | 20% | no Service / Product / Offer schema |
| FAQPage schema · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 100 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | About 99% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.08 MB (83656 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation · N/A | — | 25% | We found no Markdown version at the addresses we checked (https://ugmonk.com/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead. Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored. |
| Pricing text visibility | 100/100 | 20% | No pricing page found, so we checked the prices shown on the homepage (https://ugmonk.com/en-br): 50 prices in the page text; 0 with a billing period or marked one-time. |
| Case-study scannability · N/A | — | 10% | No case-study or portfolio page detected (homepage links such as /case-studies, /customers, /work, /portfolio, /casos or /projetos, and the /case-studies, /customers, /success-stories, /work and /portfolio paths). This check is not counted in your score. |

### Citation Visibility — 30 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Models name your domain | 45/100 | 40% | 45% of scored test answers named your domain and matched how your site describes itself. Of the 40 scored answers, 30 matched how your site describes itself, 4 described a different person or business than your site says it is, 4 did not say enough to check, and 2 did not show that the model knew your site. 40 of 40 test answers could be scored, across 4 AI models. Average by model: ChatGPT 20, Claude 35, Gemini 40, Perplexity 27. |
| Models cite your URL | 3/100 | 30% | 3% of scored test answers matched how your site describes itself and included at least one link to it. |
| Models treat your domain as the principal answer | 43/100 | 20% | 43% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end. |
| Competitor-first check (not measured) · N/A | — | 10% | Not measured: this Audit doesn't take a competitor list yet, so there is nothing to compare against. This check is not counted in your score. |
| Answers that described a different person or business than your site says it is | — | 0% | 4 of the 40 scored answers mixed up your site with a different person or business than your site says it is; they count as 0 in the checks above. Examples of what the AI said: ChatGPT: "Ugmonk.com is a lifestyle brand that focuses on creating high-quality, minimalist products. The company is known for its well-designed apparel, accessories, and home goods. Ugmonk..."; ChatGPT: "Ugmonk.com is not a website for a local business in the traditional sense. It is an online store that sells a variety of products, including..."; ChatGPT: "Ugmonk is a design-focused brand founded by Jeff Sheldon that offers a range of products including apparel, accessories, and home office goods. Known for its...". Saying clearly who you are and what you do in your llms.txt file, structured data and homepage gives AI assistants that read your site the right description. It does not change what a model has already learned, so results can take time to change. This row is for information and is not counted again |

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### Well-known discovery (mcp.json / server-card.json)

_MCP Server Discoverability · 0/100 · weight 30%_

**Finding:** no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json; an MCP server was found (an MCP endpoint answered at https://ugmonk.com/api/mcp) but it is not advertised with a server card

**Remediation:** We found no MCP discovery card at https://ugmonk.com/.well-known/mcp.json or https://ugmonk.com/.well-known/mcp/server-card.json. If you run an MCP server, publish a JSON card at one of those addresses with the server's name and a transports list giving its URL (server cards are still a draft proposal, so the format may change). If you don't run one, building an MCP server is a development project, worth it only if you have tools or data you want AI agents to use, such as booking, ordering or account lookups. Estimated effort: 30 minutes to 1 hour for the card; several days to build a new MCP server.

### Models cite your URL

_Citation Visibility · 3/100 · weight 30%_

**Finding:** 3% of scored test answers matched how your site describes itself and included at least one link to it.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting that makes them link to your site. What can help is having pages worth citing: one clear page for each thing you offer, each at a single stable address with a canonical URL, that answers the question in plain text near the top. Links to those pages from independent sources, such as directories, press coverage and industry lists, can also help, because these models draw on what other sites say. Estimated effort: 2 to 4 hours.

### Service / Product / Offer schema

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Service / Product / Offer schema

**Remediation:** We found no Service, Product or Offer structured data on your homepage (this check reads the homepage only). If you sell services, add a Service block for each main service with name, description and provider (your Organization); if you sell products, use Product with an Offer, adding a price only if you publish one. If your site doesn't sell anything, this check doesn't fit it and you can leave it. Estimated effort: 1 to 3 hours.

### Tool coverage and quality

_MCP Server Discoverability · 0/100 · weight 20%_

**Finding:** no card or no tools declared

**Remediation:** Depends on Well-known discovery: there is no discovery card to read tools from. If you publish a card, list each tool your MCP server offers in its tools array, with a name, a plain-language description and an inputSchema. Estimated effort: 30 minutes to 1 hour.

### Models name your domain

_Citation Visibility · 45/100 · weight 40%_

**Finding:** 45% of scored test answers named your domain and matched how your site describes itself. Of the 40 scored answers, 30 matched how your site describes itself, 4 described a different person or business than your site says it is, 4 did not say enough to check, and 2 did not show that the model knew your site. 40 of 40 test answers could be scored, across 4 AI models. Average by model: ChatGPT 20, Claude 35, Gemini 40, Perplexity 27.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting to change here. What can help these models name your business is clear content on your own site that says who you are, what you do and who you serve, using your business name and domain; Organization or LocalBusiness structured data on your homepage; the same business name, address and description everywhere you are listed; and mentions on independent sources these models read, such as directories, press coverage, industry lists and reviews on third-party platforms. Estimated effort: 4+ hours.

### Models treat your domain as the principal answer

_Citation Visibility · 43/100 · weight 20%_

**Finding:** 43% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly. What can help them present your business as a main answer rather than a passing mention is stating plainly, near the top of your homepage and key pages, who you are, what you do and who you serve, with your business name and domain; structured data (such as Organization or LocalBusiness) that says the same thing; and the same description of your business on the third-party sites that list you. Estimated effort: 2 to 4 hours.

### Organization schema completeness

_Structured Capability Data · 60/100 · weight 20%_

**Finding:** Your Organization entry has a name and a URL but no description.

**Remediation:** The Organization block on your homepage is missing description. Add the missing fields, using the same name and description your site already shows. Links to social profiles (sameAs) are optional; add them only for profiles you really have. Estimated effort: under 30 minutes.

### Blockquote elevator-pitch quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** There is no blockquote summary in https://ugmonk.com/llms.txt to rate. Add one directly under the H1: a single paragraph of 10 to 100 words, on a line starting with >, saying what your business does and who it serves. Estimated effort: under 30 minutes.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 50/100 · weight 25%_

**Finding:** The file has an H1 title but no blockquote summary (a line starting with >).

**Remediation:** Add a one-paragraph summary directly under the H1 in https://ugmonk.com/llms.txt, written as a Markdown blockquote (the line starts with >). Say plainly what your business does and who it serves. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.