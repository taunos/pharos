# Astrant Score v1 · Audit report

Generated 2026-11-10 21:52:33 UTC · session c50417d9

**https://tartinebakery.com/**

## 21 — grade F

_Scored on 4 of 6 dimensions. Not applicable to this site: MCP Server Discoverability and OpenAPI / API Catalog. Dimensions that were not scored are not counted in the score; 7 individual checks did not apply or could not be measured and are not counted._

_This report was scored with Astrant Score scoring version 1.5.1. Scores are only comparable between reports made with the same version. Astrant Score scoring version 1.5.1 (Nov 7, 2026) and Citation Visibility v5 (Nov 8, 2026) measure more strictly than earlier versions, so a lower score after these dates does not by itself mean your site got worse._

## Executive summary

Your site scored 21/100 (grade F) on the 4 of 6 dimensions we could score: most of the checks we ran did not pass.

The weakest areas: we found no usable llms.txt file, the short Markdown guide to your key pages (llms.txt Quality, 0/100); your homepage carries little structured data (JSON-LD) about what you offer (Structured Capability Data, 0/100); and in our test questions, AI assistants rarely named your site (Citation Visibility, 24/100).

MCP Server Discoverability and OpenAPI / API Catalog did not apply to this site, so they are not counted in your score.

The "Prioritized gaps + remediation" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.

## Dimension breakdown

### llms.txt Quality — 0 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 0/100 | 25% | There is no llms.txt file at /llms.txt (the server answered 404). |
| Spec compliance (H1 + blockquote) | 0/100 | 25% | No H1 title (a line starting with #) and no blockquote summary (a line starting with >). |
| Linked pages return useful markdown | 0/100 | 20% | No links in llms.txt for us to check. |
| Curation quality | 0/100 | 15% | There is no llms.txt file, so there is no link list to check. |
| Blockquote elevator-pitch quality | 0/100 | 15% | no blockquote to evaluate |

### MCP Server Discoverability — N/A (not applicable)

No supported MCP discovery signal was found: no MCP server card (/.well-known/mcp.json or /.well-known/mcp/server-card.json), nothing answering as an MCP server at /api/mcp, no MCP link in /llms.txt or on the homepage, no /.well-known/ucp profile declaring MCP and no _mcp DNS TXT record. No API evidence was found either (no OpenAPI description or API catalog, GraphQL endpoint or API documentation link). An MCP server may still exist elsewhere, so this dimension is marked N/A rather than scored.

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link), and no other API evidence was detected. This dimension is not counted in your score.

### Structured Capability Data — 0 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 0/100 | 25% | no JSON-LD found on homepage |
| Organization schema completeness | 0/100 | 20% | no Organization schema |
| Service / Product / Offer schema · N/A | — | 20% | We found no product pages, no prices on the homepage and no pricing page, so this check is not counted in your score. |
| FAQPage schema · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 67 C

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 50/100 | 30% | About 55% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.11 MB (117001 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation · N/A | — | 25% | We found no Markdown version at the addresses we checked (https://tartinebakery.com/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead. Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored. |
| Pricing text visibility · N/A | — | 20% | Not measured: we found no pricing page to check, and no prices on the homepage or on the 3 page(s) it links to that we sampled. This check is not counted in your score. |
| Case-study scannability · N/A | — | 10% | No case-study or portfolio page detected (homepage links such as /case-studies, /customers, /work, /portfolio, /casos or /projetos, and the /case-studies, /customers, /success-stories, /work and /portfolio paths). This check is not counted in your score. |

### Citation Visibility — 24 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Models name your domain | 38/100 | 40% | 38% of scored test answers named your domain and matched how your site describes itself. Of the 40 scored answers, 35 matched how your site describes itself, 3 described a different person or business than your site says it is, 1 did not say enough to check, and 1 did not show that the model knew your site. 40 of 40 test answers could be scored, across 4 AI models. Average by model: ChatGPT 27, Claude 38, Gemini 31, Perplexity 0. |
| Models cite your URL | 0/100 | 30% | 0% of scored test answers matched how your site describes itself and included at least one link to it. |
| Models treat your domain as the principal answer | 33/100 | 20% | 33% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end. |
| Competitor-first check (not measured) · N/A | — | 10% | Not measured: this Audit doesn't take a competitor list yet, so there is nothing to compare against. This check is not counted in your score. |
| Answers that described a different person or business than your site says it is | — | 0% | 3 of the 40 scored answers mixed up your site with a different person or business than your site says it is; they count as 0 in the checks above. Examples of what the AI said: Perplexity: "Tartinebakery.com offers several online ordering options: · Pickup and delivery orders at participating bakery locations. · Preorders for cakes and tarts, including special-order cakes for..."; Perplexity: "Yes. Tartine offers some options and accommodations for dietary restrictions: · Wheat-free items: Selected pastries, such as seasonal muffins and cheesecake, are labeled wheat-free, and..."; Perplexity: "tartinebakery.com does not require login or registration to access its general website content, such as bakery information, locations, and menus. However, registration may be required...". Saying clearly who you are and what you do in your llms.txt file, structured data and homepage gives AI assistants that read your site the right description. It does not change what a model has already learned, |

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### JSON-LD present on homepage

_Structured Capability Data · 0/100 · weight 25%_

**Finding:** no JSON-LD found on homepage

**Remediation:** Your homepage has no JSON-LD structured data. Add a script block of type application/ld+json to the homepage that describes your business with schema.org Organization, or a more specific type such as LocalBusiness, ProfessionalService or Store, giving its name, url and description. Use only facts your site already states. Estimated effort: 1 to 2 hours.

### Organization schema completeness

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Organization schema

**Remediation:** Your homepage has no Organization structured data. Add an Organization block (or a more specific type such as LocalBusiness or ProfessionalService) in JSON-LD with your business's name, url and description; it can be the same block suggested under JSON-LD present. Estimated effort: 30 minutes to 1 hour.

### Models cite your URL

_Citation Visibility · 0/100 · weight 30%_

**Finding:** 0% of scored test answers matched how your site describes itself and included at least one link to it.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting that makes them link to your site. What can help is having pages worth citing: one clear page for each thing you offer, each at a single stable address with a canonical URL, that answers the question in plain text near the top. Links to those pages from independent sources, such as directories, press coverage and industry lists, can also help, because these models draw on what other sites say. Estimated effort: 2 to 4 hours.

### Models name your domain

_Citation Visibility · 38/100 · weight 40%_

**Finding:** 38% of scored test answers named your domain and matched how your site describes itself. Of the 40 scored answers, 35 matched how your site describes itself, 3 described a different person or business than your site says it is, 1 did not say enough to check, and 1 did not show that the model knew your site. 40 of 40 test answers could be scored, across 4 AI models. Average by model: ChatGPT 27, Claude 38, Gemini 31, Perplexity 0.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting to change here. What can help these models name your business is clear content on your own site that says who you are, what you do and who you serve, using your business name and domain; Organization or LocalBusiness structured data on your homepage; the same business name, address and description everywhere you are listed; and mentions on independent sources these models read, such as directories, press coverage, industry lists and reviews on third-party platforms. Estimated effort: 4+ hours.

### JS-vs-no-JS render diff

_Agent-Parsable Content · 50/100 · weight 30%_

**Finding:** About 55% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs.

**Remediation:** About 55% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. Tools that don't run JavaScript (several AI crawlers among them) see only the HTML your server sends. Render the main content on the server (server-side rendering, pre-rendering or static generation) so the first HTML response contains it; on a website builder, check whether it offers this. Estimated effort: 2 to 5 days on a custom app.

### Presence

_llms.txt Quality · 0/100 · weight 25%_

**Finding:** There is no llms.txt file at /llms.txt (the server answered 404).

**Remediation:** Create a file at https://tartinebakery.com/llms.txt. Per the llmstxt.org proposal it is a plain Markdown file: an H1 line with your business or site name, a one-paragraph summary of 10 to 100 words as a blockquote (a line starting with >), then short lists of links to your most important pages. Serve it as text/plain or text/markdown. Estimated effort: 1 to 2 hours.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 0/100 · weight 25%_

**Finding:** No H1 title (a line starting with #) and no blockquote summary (a line starting with >).

**Remediation:** Depends on Presence: there is no https://tartinebakery.com/llms.txt yet. When you create it, start it with an H1 line (# followed by your business or site name), then a one-paragraph summary of 10 to 100 words written as a Markdown blockquote (a line starting with >). Estimated effort: under 30 minutes.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** No links in llms.txt for us to check.

**Remediation:** Depends on Presence: there is no https://tartinebakery.com/llms.txt yet. When you create it, list your key pages as Markdown links (- [Page name](https://tartinebakery.com/page)); this check then opens a sample of them. Estimated effort: under 30 minutes.

### Models treat your domain as the principal answer

_Citation Visibility · 33/100 · weight 20%_

**Finding:** 33% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly. What can help them present your business as a main answer rather than a passing mention is stating plainly, near the top of your homepage and key pages, who you are, what you do and who you serve, with your business name and domain; structured data (such as Organization or LocalBusiness) that says the same thing; and the same description of your business on the third-party sites that list you. Estimated effort: 2 to 4 hours.

### Curation quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** There is no llms.txt file, so there is no link list to check.

**Remediation:** Depends on Presence: there is no https://tartinebakery.com/llms.txt yet. When you create it, keep the link list short and hand-picked: your main pages, not every URL on the site. Estimated effort: under 30 minutes.

### Blockquote elevator-pitch quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** Depends on Presence: there is no https://tartinebakery.com/llms.txt yet. When you create it, put a one-paragraph summary of 10 to 100 words under the H1 as a Markdown blockquote (a line starting with >), saying what your business does and who it serves. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.