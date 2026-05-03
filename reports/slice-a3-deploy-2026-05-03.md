# Slice A3 — Dogfood-Methodology Integration — 2026-05-03

## Files modified

- [marketing-site/src/app/page.tsx:355-376](../marketing-site/src/app/page.tsx#L355-L376) — Edit (a.1) methodology callout block (MEASUREMENT LAYER eyebrow + blockquote + engine-version attribution + CTA)
- [marketing-site/src/app/page.tsx:377-378](../marketing-site/src/app/page.tsx#L377-L378) — Edit (a.2) italic rewrite (D-rw2: Score tool live + dogfood self-display pending)
- [marketing-site/src/app/layout.tsx:63](../marketing-site/src/app/layout.tsx#L63) — Edit (b) Organization schema extended with `disambiguatingDescription` (single-line, char-for-char identical to LOCKED_BODY)
- [marketing-site/src/components/SiteFooter.tsx:38](../marketing-site/src/components/SiteFooter.tsx#L38) — Edit (c) footer Methodology href: `/methodology/calibration` → `/methodology`

## Source-side verification (Step 7)

- (7.1) Locked body copy in page.tsx blockquote: **PASS**
- (7.2) Italic rewrite source-side (entity form `Astrant&apos;s` per codebase's existing `react/no-unescaped-entities` convention): **PASS**
- (7.3) layout.tsx `disambiguatingDescription` matches LOCKED_BODY (source-side lock-step): **PASS**
- (7.4) JSON-LD validity (Node `eval` parse + structure assertions): **PASS** — Organization has both `description` and `disambiguatingDescription`; Service preserved
- (7.5) Footer href changed (new present, old absent): **PASS**
- (7.6) Engine version still `dim6:v3` (recursive grep with `-r` for `v[4-9]` / `v[1-9][0-9]+` drift): **PASS** — zero matches

## Boundary discipline (Step 8)

- (8.1) Diff-hunk grep on three modified files for `HubSpot|Stripe|Salesforce|GitHub|Notion|OpenAI|Anthropic|Gemini|Perplexity|Claude|GPT-4|Sonnet`: **ZERO** matches
- (8.2) Cross-surface wording sanity (`training-data-saturated developer infrastructure` defensive): **ZERO** matches

## Build + deploy

- Deploy command: `cd marketing-site && npm run cf:deploy`
- Worker version ID: `1187011b-961c-42d6-992b-e198dc1f05bb`
- Live URL verified: https://www.astrant.io/

## Live-endpoint verification (https://www.astrant.io/)

- (10.1) Callout body present in homepage HTML: **PASS**
- (10.2) Live-side three-way lock-step (JSON-LD `disambiguatingDescription` = rendered `<blockquote>` text = LOCKED_BODY): **PASS**
- (10.3) Original Organization `description` UNCHANGED — brand-summary regression: **PASS**
- (10.4) Attribution line `Engine version dim6:v3` present: **PASS**
- (10.5) CTA link with `/methodology` href + "Inspect the methodology" text in same `<a>` tag: **PASS**
- (10.6) JSON-LD parses, multi-block-aware, with `disambiguatingDescription` correctly nested in Organization: **PASS**
- (10.7) Rewritten italic present (entity decoded by browser to literal apostrophe), old italic absent: **PASS**
- (10.8) Footer href is `/methodology` (not `/methodology/calibration`): **PASS** (old href absent)
- (10.9) Dogfood-section boundary discipline (Node-scoped to `id="dogfood"` section): **PASS** — zero forbidden terms
- (10.10) Service schema + 6 Offer descriptions UNCHANGED — regression check via re-extracted source descriptions: **PASS** — all 7 strings present in deployed HTML

## Cleanup

Verification HTML state: **deleted** (full PASS on all checks).

## Notes / open follow-ups

- **Apostrophe-encoding deviation from prompt's literal grep:** The italic rewrite uses `Astrant&apos;s` in JSX (not literal `Astrant's`) because the project enforces `react/no-unescaped-entities` (verified at [page.tsx:246](../marketing-site/src/app/page.tsx#L246) and [page.tsx:249](../marketing-site/src/app/page.tsx#L249)). Using a literal apostrophe would have failed the build's lint step. Step 7.2's source-side grep was adjusted at execution-time to look for the entity form. Step 10.7's live-side grep worked unchanged — browsers decode `&apos;` to literal `'` in rendered HTML, so the literal-apostrophe grep still matches. Lock-step compare at 10.2 was unaffected (LOCKED_BODY contains no apostrophe; only the italic rewrite did).
- **Sed-based blockquote extraction failed on minified HTML, switched to Node mid-execution.** The deploy prompt's Step 10.2 specified `sed -nE '/<blockquote[^>]*>/,/<\/blockquote>/p'` — line-based addressing — but Cloudflare/Next.js serves heavily-minified HTML where the blockquote and surrounding content live on one or few lines, causing sed to range-match across unrelated content. Substituted with Node-based regex extraction (`html.match(/<blockquote[^>]*>([\s\S]+?)<\/blockquote>/)`) for the lock-step compare. Same Node-based approach used for Step 10.9's dogfood-section scoping. Worth incorporating into the spec/prompt for future slices that verify rendered-HTML structure.
- **Dogfood-methodology integration is the fourth agent-readable surface in Astrant's acquisition-narrative artifact stack** (per spec Section 7): methodology page (live, post Slice A2.1) + llms.txt (live) + MCP server with `check_llms_txt` (live) + dogfood-section homepage callout (now live, with site-wide Schema.org propagation via the root-layout `disambiguatingDescription` field).

## Working-tree state

- 4 files modified, ready for commit (per C5 — no `git commit` was attempted during the slice)
- Pre-existing `.claude/settings.json` modification (unrelated WIP, NOT in slice scope, untouched)

DONE
