> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.

# Astrant · AEO Audit

Generated 2026-11-07 21:37:51 UTC · session e3a7e9f7

**https://www.metalab.com/**

## 49 — grade D

_Scored on 3 of 6 dimensions. Not applicable to this site: MCP Server Discoverability and OpenAPI / API Catalog. Not measured on this run: Citation Visibility. Dimensions that were not scored are not counted in the score; 5 individual checks did not apply or could not be measured and are not counted._

## Executive summary

Your site scored 49/100 (grade D) on the 3 of 6 dimensions we could score: some of the checks we ran passed, and several important ones did not.

Because only 3 of 6 dimensions could be scored, this is a partial view of your site, and it is not comparable with a score based on more dimensions.

The weakest areas: we found no usable llms.txt file, the short Markdown guide to your key pages (llms.txt Quality, 0/100); and your pages failed most of our readability checks (Agent-Parsable Content, 30/100).

What's working: the structured data (JSON-LD) on your homepage passed most of our checks.

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

No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link), and no other API evidence was detected. This dimension is not counted in your score.

### Structured Capability Data — 100 A

| Check | Score | Weight | Notes |
|---|---|---|---|
| JSON-LD present on homepage | 100/100 | 25% | 1 valid JSON-LD block(s) on homepage |
| Organization schema completeness | 100/100 | 20% | Organization found: name=true, url=true, description=true, sameAs=3 |
| Service / Product / Offer schema · N/A | — | 20% | We found no sign that this site sells products or services online, so this check is not counted in your score. |
| FAQPage schema (count + conversational LLM eval) · N/A | — | 20% | No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score. |
| Review / AggregateRating schema · N/A | — | 15% | No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score. |

### Agent-Parsable Content — 30 F

| Check | Score | Weight | Notes |
|---|---|---|---|
| JS-vs-no-JS render diff | 0/100 | 30% | About 16% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. |
| Page weight | 100/100 | 15% | Homepage HTML size: 0.09 MB (92913 bytes). This check looks at page size only; it does not measure loading speed. |
| Markdown content negotiation | 25/100 | 25% | We found no Markdown version at the addresses we checked (https://www.metalab.com/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead. |
| Pricing text visibility · N/A | — | 20% | No /pricing, /plans, or /price path found, and no pricing-link discovered on homepage. This check is not counted in your score. |
| Case-study scannability · N/A | — | 10% | Not measured: this page builds its content with JavaScript, so its structure could not be read from the server's HTML. |

### Citation Visibility — N/A (not counted in score)

Citation Visibility was not run on this report: no AI assistant was set up to answer the test questions. It is not counted in your score. Astrant Citation Visibility v4 (4 AI models).

## Prioritized gaps + remediation

Checks that did not pass, ordered by how many points each one costs your overall score. Each comes with a standard fix for that check and what we found; the guidance is not written by hand for your site.

### JS-vs-no-JS render diff

_Agent-Parsable Content · 0/100 · weight 30%_

**Finding:** About 16% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs.

**Remediation:** About 16% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. Tools that don't run JavaScript (several AI crawlers among them) see only the HTML your server sends. Render the main content on the server (server-side rendering, pre-rendering or static generation) so the first HTML response contains it; on a website builder, check whether it offers this. Estimated effort: 2 to 5 days on a custom app.

### Markdown content negotiation

_Agent-Parsable Content · 25/100 · weight 25%_

**Finding:** We found no Markdown version at the addresses we checked (https://www.metalab.com/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead.

**Remediation:** When we asked your homepage for Markdown (Accept: text/markdown) it returned HTML, and we found no Markdown version at https://www.metalab.com/index.md. Serving Markdown is an emerging convention, not a standard: if your platform supports it, return a Markdown version of key pages to requests that ask for text/markdown, or publish one at the page address with .md added. Label a response text/markdown only if its body really is Markdown. Estimated effort: 1 to 3 days on a custom site; some hosted platforms can't do this.

### Presence

_llms.txt Quality · 0/100 · weight 25%_

**Finding:** status=404

**Remediation:** Create a file at https://www.metalab.com/llms.txt. Per the llmstxt.org proposal it is a plain Markdown file: an H1 line with your business or site name, a one-paragraph summary as a blockquote (a line starting with >), then short lists of links to your most important pages. Serve it as text/plain or text/markdown. Estimated effort: 1 to 2 hours.

### Spec compliance (H1 + blockquote)

_llms.txt Quality · 0/100 · weight 25%_

**Finding:** h1=no, blockquote=no

**Remediation:** Depends on Presence: there is no https://www.metalab.com/llms.txt yet. When you create it, start it with an H1 line (# followed by your business or site name), then a one-paragraph summary written as a Markdown blockquote (a line starting with >). Estimated effort: under 30 minutes.

### Linked pages return useful markdown

_llms.txt Quality · 0/100 · weight 20%_

**Finding:** no links to sample

**Remediation:** Depends on Presence: there is no https://www.metalab.com/llms.txt yet. When you create it, list your key pages as Markdown links on list lines (- [Page name](https://www.metalab.com/page)); this check then opens a sample of them. Estimated effort: under 30 minutes.

### Curation quality

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** file missing — no link list to evaluate

**Remediation:** Depends on Presence: there is no https://www.metalab.com/llms.txt yet. When you create it, keep the link list short and hand-picked: your main pages, not every URL on the site. Estimated effort: under 30 minutes.

### Blockquote elevator-pitch quality (LLM)

_llms.txt Quality · 0/100 · weight 15%_

**Finding:** no blockquote to evaluate

**Remediation:** Depends on Presence: there is no https://www.metalab.com/llms.txt yet. When you create it, put a one-paragraph summary under the H1 as a Markdown blockquote (a line starting with >), saying what your business does and who it serves. Estimated effort: under 30 minutes.

## Machine-readable export

The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page. _(JSON body omitted here; see audit.json)_

Generated by Astrant. Re-scan anytime at astrant.io/score.
Re-run the full audit at astrant.io/audit.