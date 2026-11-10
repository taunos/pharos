> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 21:05:05 UTC · session 9ff8bad4

**https://tartinebakery.com/**

## 16 — grade F

_Scored on 3 of 6 dimensions. Not applicable to this site: MCP Server Discoverability and OpenAPI / API Catalog. Not measured on this run: Citation Visibility. Dimensions that were not scored are not counted in the score._

## Executive summary

Your site scored 16/100 (grade F) on the 3 of 6 dimensions we could score: most of the checks we ran did not pass.

Because only 3 of 6 dimensions could be scored, this is a partial view of your site, and it is not comparable with a score based on more dimensions.

The weakest areas: we found no usable llms.txt file, the short Markdown guide to your key pages (llms.txt Quality, 0/100); your homepage carries little structured data (JSON-LD) about what you offer (Structured Capability Data, 0/100); and your pages passed only some of our readability checks (Agent-Parsable Content, 52/100).

MCP Server Discoverability and OpenAPI / API Catalog did not apply to this site, so they are not counted in your score; Citation Visibility could not be measured on this run, so it is not counted in your score.

The "Prioritized gaps + remediation" section below lists each check that did not pass, with a suggested change, starting with the ones that cost the most points.

## Dimension breakdown

### llms.txt Quality — 0 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| Presence | 0/100 | 25% | status=404 |
| Spec compliance (H1 + blockquote) | 0/100 | 25% | h1=no, blockquote=no |
| Linked pages return useful markdown | 0/100 | 20% | no links to sample |
| Curation quality | 0/100 | 15% | file missing — no link list to evaluate |
| Blockquote elevator-pitch quality (LLM) | 0/100 | 15% | no blockquote to evaluate |

### MCP Server Discoverability — N/A (not applicable)

No supported MCP discovery signal was found: no MCP server card (/.well-known/mcp.json or /.well-known/mcp/server-card.json), nothing answering as an MCP server at /api/mcp, no MCP link in /llms.txt or on the homepage, no /.well-known/ucp profile declaring MCP and no _mcp DNS TXT record. No API evidence was found either (no OpenAPI description or API catalog, GraphQL endpoint or API documentation link). An MCP server may still exist elsewhere, so this dimension is marked N/A rather than scored.

### OpenAPI / API Catalog — N/A (not applicable)

No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link), and no other API evidence was detected. Dimension marked N/A — composite math drops it without penalty.

### Structured Capability Data — 0 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 0/100 | 25% | no JSON-LD found on homepage |
| Organization schema completeness | 0/100 | 20% | no Organization schema |
| Service / Product / Offer schema | 0/100 | 20% | no Service / Product / Offer schema |
| FAQPage schema (count + conversational LLM eval) · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 52 D

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 50/100 | 30% | Static-vs-rendered token overlap 48%; rendered HTML 2.3x the size of static. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.11 MB (116969 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation | 25/100 | 25% | No markdown variant or content negotiation. Agents must fall back to HTML extraction. |
| Pricing text visibility · N/A | — | 20% | No /pricing, /plans, or /price path found, and no pricing-link discovered on homepage. This check is not counted in your score. |
| Case-study scannability · N/A | — | 10% | No case-study or portfolio page detected (homepage links such as /case-studies, /customers, /work, /portfolio, /casos or /projetos, and the /case-studies, /customers, /success-stories, /work and /portfolio paths). This check is not counted in your score. |

### Citation Visibility — N/A (not counted in score)

Citation Visibility was not measured on this run: none of the 40 test answers from the AI assistants could be scored (network or provider failures). It is not counted in your score. Astrant Citation Visibility v4 (4 AI models).

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

### Service / Product / Offer schema

_Structured Capability Data · 0/100 · weight 20%_

**Finding:** no Service / Product / Offer schema

**Remediation:** We found no Service, Product or Offer structured data on your homepage (this check reads the homepage only). If you sell services, add a Service block for each main service with name, description and provider (your Organization); if you sell products, use Product with an Offer, adding a price only if you publish one. If your site doesn't sell anything, this check doesn't fit it and you can leave it. Estimated effort: 1 to 3 hours.

### Markdown content negotiation

_Agent-Parsable Content · 25/100 · weight 25%_

**Finding:** No markdown variant or content negotiation. Agents must fall back to HTML extraction.

**Remediation:** When we asked your homepage for Markdown (Accept: text/markdown) it returned HTML, and we found no Markdown version at https://tartinebakery.com/index.md. Serving Markdown is an emerging convention, not a standard: if your platform supports it, return a Markdown version of key pages to requests that ask for text/markdown, or publish one at the page address with .md added. Label a response text/markdown only if its body really is Markdown. Estimated effort: 1 to 3 days on a custom site; some hosted platforms can't do this.

### Presence

_llms.txt Quality · 0/100 · weight 25%_

**Finding:** status=404

**Remediation:** Create a file at https://tartinebakery.com/llms.txt. Per the llmstxt.org proposal it is a plain Markdown file: an H1 line with your business or site name, a one-paragraph summary as a blockquote (a line starting with >), then short lists of links to your most important pages. Serve it as text/plain or text/markdown. Estimated effort: 1 to 2 hours.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 0/100 · weight 25%_

**Finding:** h1=no, blockquote=no

**Remediation:** Depends on Presence: there is no https://tartinebakery.com/llms.txt yet. When you create it, start it with an H1 line (# followed by your business or site name), then a one-paragraph summary written as a Markdown blockquote (a line starting with >). Estimated effort: under 30 minutes.

### JS-vs-no-JS render diff

_Agent-Parsable Content · 50/100 · weight 30%_

**Finding:** Static-vs-rendered token overlap 48%; rendered HTML 2.3x the size of static.

**Remediation:** Only 48% of the text on your homepage after JavaScript runs is also in the HTML your server sends first. Tools that don't run JavaScript (several AI crawlers among them) see only that part. Render the main content on the server (server-side rendering, pre-rendering or static generation) so the first HTML response contains it; on a website builder, check whether it offers this. Estimated effort: 2 to 5 days on a custom app.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** no links to sample

**Remediation:** Depends on Presence: there is no https://tartinebakery.com/llms.txt yet. When you create it, list your key pages as Markdown links on list lines (- [Page name](https://tartinebakery.com/page)); this check then opens a sample of them. Estimated effort: under 30 minutes.

### Curation quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** file missing — no link list to evaluate

**Remediation:** Depends on Presence: there is no https://tartinebakery.com/llms.txt yet. When you create it, keep the link list short and hand-picked: your main pages, not every URL on the site. Estimated effort: under 30 minutes.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** Depends on Presence: there is no https://tartinebakery.com/llms.txt yet. When you create it, put a one-paragraph summary under the H1 as a Markdown blockquote (a line starting with >), saying what your business does and who it serves. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.