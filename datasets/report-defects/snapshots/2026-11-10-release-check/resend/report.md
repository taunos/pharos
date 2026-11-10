# Astrant Score v1 · Audit report

Generated 2026-11-10 22:04:18 UTC · session 4c6e88cb

**https://resend.com/**

## 84 — grade A-

_Scored on 6 of 6 dimensions. 5 individual checks did not apply or could not be measured and are not counted._

_This report was scored with Astrant Score scoring version 1.5.1. Scores are only comparable between reports made with the same version. Astrant Score scoring version 1.5.1 (Nov 7, 2026) and Citation Visibility v5 (Nov 8, 2026) measure more strictly than earlier versions, so a lower score after these dates does not by itself mean your site got worse._

## Executive summary

Your site scored 84/100 (grade A-) on the 6 of 6 dimensions we could score: most of the checks we ran passed, with a few gaps left.

The weakest area: in our test questions, AI assistants named your site only some of the time (Citation Visibility, 40/100).

What's working: the OpenAPI description of your API passed most of our checks; the structured data (JSON-LD) on your homepage passed most of our checks; and your llms.txt file passed most of our checks.

The "Prioritized gaps + remediation" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.

## Dimension breakdown

### llms.txt Quality — 96 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | Found an llms.txt file at /llms.txt. |
| Spec compliance (H1 + blockquote) | 100/100 | 25% | The file starts with an H1 title and has a blockquote summary. |
| Linked pages return useful markdown | 80/100 | 20% | 4 of the 5 llms.txt links we checked returned Markdown or plain text; the rest returned HTML or did not load. |
| Curation quality | 100/100 | 15% | The llms.txt link list has none of the problems we check for (more than 100 links, links to tag, archive or search-result pages, links with query strings). |
| Blockquote elevator-pitch quality | 100/100 | 15% | 2 of 2 blockquote rules met: one paragraph (yes); 10 to 100 words (yes, 19 words). |

### MCP Server Discoverability — 86 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| Well-known discovery (mcp.json / server-card.json) | 100/100 | 30% | Found a valid MCP server card at /.well-known/mcp.json. It names the server "Resend" and lists 1 transport URL. |
| Tool coverage and quality | 70/100 | 20% | 12 tool(s) declared: 12 with a description, 0 with an input schema (inputSchema); 0 have both |
| OAuth metadata (when auth declared) | 100/100 | 15% | The MCP server card declares sign-in (oauth2), and its OAuth metadata is valid. |
| Live MCP tools/list invocation | 75/100 | 25% | The MCP endpoint at https://mcp.resend.com/mcp answered and requires OAuth sign-in (HTTP 401 with a Bearer challenge), so its tools could not be listed without an account. |
| DNS TXT discovery (_mcp subdomain) · N/A | — | 10% | No TXT record at _mcp.resend.com. Informational only: no ratified standard defines an _mcp DNS record, so this is not scored. |

### OpenAPI / API Catalog — 100 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| API spec discovery | 100/100 | 25% | Found your API description at https://resend.com/openapi.yaml, through the standard address /.well-known/api-catalog. Read through the API catalog at https://resend.com/.well-known/api-catalog (its service-desc link). |
| Spec validity (parses + has version field) | 100/100 | 25% | Valid YAML spec, openapi 3.0.3. |
| Spec info completeness (title + version + description) | 100/100 | 15% | The info section of your API description has a title, a version and a description. |
| Security schemes documented | 100/100 | 15% | components.securitySchemes declared: bearerAuth. |
| Operation coverage + per-operation docs | 100/100 | 20% | Your API description defines 83 operations; 83 of 83 have a summary or description. |

### Structured Capability Data — 100 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | The homepage has 1 valid JSON-LD block (structured data). |
| Organization schema completeness | 100/100 | 20% | Your Organization entry (#organization) has a name, URL and description. |
| Service / Product / Offer schema | 100/100 | 20% | We found 2 Service, Product or Offer entries. The most complete one has 3 of the 3 fields we check: a name, a description, and who provides it (such as provider, brand or seller). |
| FAQPage schema · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 94 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | About 97% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.56 MB (583451 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation · N/A | — | 25% | Your homepage returns Markdown when a request asks for it (Accept: text/markdown). Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored. |
| Pricing text visibility | 100/100 | 20% | Pricing page https://resend.com/pricing: 13 prices in the page text; 7 with a billing period or marked one-time. |
| Case-study scannability | 57/100 | 10% | We checked one case-study page (https://resend.com/customers/gumroad) and scored it 57/100: it has lists and bold text but no headings. (A case study linked from the index page https://resend.com/customers.) |

### Citation Visibility — 40 D

| Check | Score | Weight | Notes |
|---|---|---|---|
| Models name your domain | 60/100 | 40% | 60% of scored test answers named your domain and matched how your site describes itself. Of the 40 scored answers, 33 matched how your site describes itself, 3 described a different person or business than your site says it is, 3 did not say enough to check, and 1 did not show that the model knew your site. 40 of 40 test answers could be scored, across 4 AI models. Average by model: ChatGPT 40, Claude 51, Gemini 54, Perplexity 13. |
| Models cite your URL | 0/100 | 30% | 0% of scored test answers matched how your site describes itself and included at least one link to it. |
| Models treat your domain as the principal answer | 57/100 | 20% | 57% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end. |
| Competitor-first check (not measured) · N/A | — | 10% | Not measured: this Audit doesn't take a competitor list yet, so there is nothing to compare against. This check is not counted in your score. |
| Answers that described a different person or business than your site says it is | — | 0% | 3 of the 40 scored answers mixed up your site with a different person or business than your site says it is; they count as 0 in the checks above. Examples of what the AI said: ChatGPT: "As of the latest information available, Resend.com offers various types of support to its customers, typically including: · Documentation: Comprehensive guides and documentation to help..."; Perplexity: "Resend offers several customer-support options: · Email and ticket support, with first-response and follow-up response SLAs. · Dedicated Slack support for eligible plans, providing direct..."; ChatGPT: "As of my last update, Resend.com is not widely recognized as a major company. It's possible that it could be a smaller business or a...". Saying clearly who you are and what you do in your llms.txt file, structured data and homepage gives AI assistants that read your site the right description. It does not change what a model has already learned, so results can take time to change. This row is for |

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### Models cite your URL

_Citation Visibility · 0/100 · weight 30%_

**Finding:** 0% of scored test answers matched how your site describes itself and included at least one link to it.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting that makes them link to your site. What can help is having pages worth citing: one clear page for each thing you offer, each at a single stable address with a canonical URL, that answers the question in plain text near the top. Links to those pages from independent sources, such as directories, press coverage and industry lists, can also help, because these models draw on what other sites say. Estimated effort: 2 to 4 hours.

### Models name your domain

_Citation Visibility · 60/100 · weight 40%_

**Finding:** 60% of scored test answers named your domain and matched how your site describes itself. Of the 40 scored answers, 33 matched how your site describes itself, 3 described a different person or business than your site says it is, 3 did not say enough to check, and 1 did not show that the model knew your site. 40 of 40 test answers could be scored, across 4 AI models. Average by model: ChatGPT 40, Claude 51, Gemini 54, Perplexity 13.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting to change here. What can help these models name your business is clear content on your own site that says who you are, what you do and who you serve, using your business name and domain; Organization or LocalBusiness structured data on your homepage; the same business name, address and description everywhere you are listed; and mentions on independent sources these models read, such as directories, press coverage, industry lists and reviews on third-party platforms. Estimated effort: 4+ hours.

### Models treat your domain as the principal answer

_Citation Visibility · 57/100 · weight 20%_

**Finding:** 57% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly. What can help them present your business as a main answer rather than a passing mention is stating plainly, near the top of your homepage and key pages, who you are, what you do and who you serve, with your business name and domain; structured data (such as Organization or LocalBusiness) that says the same thing; and the same description of your business on the third-party sites that list you. Estimated effort: 2 to 4 hours.

### Case-study scannability

_Agent-Parsable Content · 57/100 · weight 10%_

**Finding:** We checked one case-study page (https://resend.com/customers/gumroad) and scored it 57/100: it has lists and bold text but no headings. (A case study linked from the index page https://resend.com/customers.)

**Remediation:** On the 1 case-study page(s) we sampled, we found fewer than three subheadings (h2 or h3). If you edit them, give each story a few clear subheadings (for example the client, the problem, what you did and the result) and put the key facts, only ones the client has agreed to share, in a short list. If the pages we sampled aren't case studies, this check doesn't apply and you can ignore it. Estimated effort: 1 to 2 hours per page.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.