# Astrant Score v1 · Audit report

Generated 2026-11-10 21:49:12 UTC · session 371fa2ad

**https://drveit.com.br/**

## 63 — grade C

_Scored on 4 of 6 dimensions. Not applicable to this site: MCP Server Discoverability and OpenAPI / API Catalog. Dimensions that were not scored are not counted in the score; 6 individual checks did not apply or could not be measured and are not counted._

_This report was scored with Astrant Score scoring version 1.5.1. Scores are only comparable between reports made with the same version. Astrant Score scoring version 1.5.1 (Nov 7, 2026) and Citation Visibility v5 (Nov 8, 2026) measure more strictly than earlier versions, so a lower score after these dates does not by itself mean your site got worse._

## Executive summary

Your site scored 63/100 (grade C) on the 4 of 6 dimensions we could score: some of the checks we ran passed, and several important ones did not.

The weakest areas: in our test questions, AI assistants rarely named your site (Citation Visibility, 27/100); and your llms.txt file passed only some of our checks (llms.txt Quality, 50/100).

What's working: your pages passed most of our readability checks.

MCP Server Discoverability and OpenAPI / API Catalog did not apply to this site, so they are not counted in your score.

The "Prioritized gaps + remediation" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.

## Dimension breakdown

### llms.txt Quality — 50 D

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 100/100 | 25% | Found an llms.txt file at /llms.txt. |
| Spec compliance (H1 + blockquote) | 50/100 | 25% | The file has an H1 title but no blockquote summary (a line starting with >). |
| Linked pages return useful markdown | 0/100 | 20% | 0 of the 5 llms.txt links we checked returned Markdown or plain text; the rest returned HTML or did not load. |
| Curation quality | 80/100 | 15% | The llms.txt link list has links to tag pages. |
| Blockquote elevator-pitch quality | 0/100 | 15% | no blockquote to evaluate |

### MCP Server Discoverability — N/A (not applicable)

No supported MCP discovery signal was found: no MCP server card (/.well-known/mcp.json or /.well-known/mcp/server-card.json), nothing answering as an MCP server at /api/mcp, no MCP link in /llms.txt or on the homepage, no /.well-known/ucp profile declaring MCP and no _mcp DNS TXT record. No API evidence was found either (no OpenAPI description or API catalog, GraphQL endpoint or API documentation link). An MCP server may still exist elsewhere, so this dimension is marked N/A rather than scored.

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link), and no other API evidence was detected. This dimension is not counted in your score.

### Structured Capability Data — 82 A-

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | The homepage has 2 valid JSON-LD blocks (structured data). |
| Organization schema completeness | 60/100 | 20% | Your Organization entry (#organization) has a name and a URL but no description. |
| Service / Product / Offer schema · N/A | — | 20% | We found no product pages, no prices on the homepage and no pricing page, so this check is not counted in your score. |
| FAQPage schema · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 100 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 100/100 | 30% | About 100% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.06 MB (58694 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation · N/A | — | 25% | We found no Markdown version at the addresses we checked (https://drveit.com.br/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead. Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored. |
| Pricing text visibility · N/A | — | 20% | Not measured: we found no pricing page to check, and no prices on the homepage or on the 3 page(s) it links to that we sampled. This check is not counted in your score. |
| Case-study scannability | 100/100 | 10% | We checked one case-study page (https://drveit.com.br/sorrisos-e-casos/) and scored it 100/100: it has headings, lists and bold text. |

### Citation Visibility — 27 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Models name your domain | 40/100 | 40% | 40% of scored test answers named your domain and matched how your site describes itself. Of the 40 scored answers, 17 matched how your site describes itself, 6 described a different person or business than your site says it is, 6 did not say enough to check, and 11 did not show that the model knew your site. 40 of 40 test answers could be scored, across 4 AI models. Average by model: ChatGPT 40, Claude 0, Gemini 27, Perplexity 40. |
| Models cite your URL | 0/100 | 30% | 0% of scored test answers matched how your site describes itself and included at least one link to it. |
| Models treat your domain as the principal answer | 40/100 | 20% | 40% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end. |
| Competitor-first check (not measured) · N/A | — | 10% | Not measured: this Audit doesn't take a competitor list yet, so there is nothing to compare against. This check is not counted in your score. |
| Answers that described a different person or business than your site says it is | — | 0% | 6 of the 40 scored answers mixed up your site with a different person or business than your site says it is; they count as 0 in the checks above. Examples of what the AI said: Gemini: "Yes, drveit.com.br offers services to individuals. It is the official website for Dr. Veit, a medical professional in Brazil who specializes in aesthetic medicine and..."; Claude: "drveit.com.br Based on the domain name, drveit.com.br appears to be a Brazilian business (indicated by the .com.br domain extension) that likely operates in one of..."; Perplexity: "Drveit.com.br sells oral-care products under the Dr. Veit brand, including: · Dr. Veit Soft toothbrush with soft Dupont Tynex® bristles · Dr. Veit Interdental toothbrush,...". Saying clearly who you are and what you do in your llms.txt file, structured data and homepage gives AI assistants that read your site the right description. It does not change what a model has already learned, so results can take time to change. This row is for information |

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### Models cite your URL

_Citation Visibility · 0/100 · weight 30%_

**Finding:** 0% of scored test answers matched how your site describes itself and included at least one link to it.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting that makes them link to your site. What can help is having pages worth citing: one clear page for each thing you offer, each at a single stable address with a canonical URL, that answers the question in plain text near the top. Links to those pages from independent sources, such as directories, press coverage and industry lists, can also help, because these models draw on what other sites say. Estimated effort: 2 to 4 hours.

### Models name your domain

_Citation Visibility · 40/100 · weight 40%_

**Finding:** 40% of scored test answers named your domain and matched how your site describes itself. Of the 40 scored answers, 17 matched how your site describes itself, 6 described a different person or business than your site says it is, 6 did not say enough to check, and 11 did not show that the model knew your site. 40 of 40 test answers could be scored, across 4 AI models. Average by model: ChatGPT 40, Claude 0, Gemini 27, Perplexity 40.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting to change here. What can help these models name your business is clear content on your own site that says who you are, what you do and who you serve, using your business name and domain; Organization or LocalBusiness structured data on your homepage; the same business name, address and description everywhere you are listed; and mentions on independent sources these models read, such as directories, press coverage, industry lists and reviews on third-party platforms. Estimated effort: 4+ hours.

### Organization schema completeness

_Structured Capability Data · 60/100 · weight 20%_

**Finding:** Your Organization entry (#organization) has a name and a URL but no description.

**Remediation:** The Organization block on your homepage is missing description. Add the missing fields, using the same name and description your site already shows. Links to social profiles (sameAs) are optional; add them only for profiles you really have. Estimated effort: under 30 minutes.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** 0 of the 5 llms.txt links we checked returned Markdown or plain text; the rest returned HTML or did not load.

**Remediation:** 0 of the 5 links we sampled from https://drveit.com.br/llms.txt returned Markdown or plain text; the others returned HTML or an error. If your platform can publish a clean Markdown version of each linked page (the llmstxt.org proposal suggests the page address with .md added), point the links at those versions. If it can't, the links still work as normal web pages and this check can stay below passing. Estimated effort: 2 to 8 hours, depending on your platform.

### Models treat your domain as the principal answer

_Citation Visibility · 40/100 · weight 20%_

**Finding:** 40% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end.

**Remediation:** You cannot edit ChatGPT, Claude, Gemini or Perplexity directly. What can help them present your business as a main answer rather than a passing mention is stating plainly, near the top of your homepage and key pages, who you are, what you do and who you serve, with your business name and domain; structured data (such as Organization or LocalBusiness) that says the same thing; and the same description of your business on the third-party sites that list you. Estimated effort: 2 to 4 hours.

### Blockquote elevator-pitch quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** There is no blockquote summary in https://drveit.com.br/llms.txt to rate. Add one directly under the H1: a single paragraph of 10 to 100 words, on a line starting with >, saying what your business does and who it serves. Estimated effort: under 30 minutes.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 50/100 · weight 25%_

**Finding:** The file has an H1 title but no blockquote summary (a line starting with >).

**Remediation:** Add a one-paragraph summary directly under the H1 in https://drveit.com.br/llms.txt, written as a Markdown blockquote (the line starts with >). Say plainly what your business does and who it serves. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.