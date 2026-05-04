# Pharos / Astrant — Pending Follow-Ups

**Last updated:** 2026-05-04 (post Gemini paid-tier upgrade + 2.5 Flash migration; closes deferred item #6 by misdiagnosis-correction)

**Trigger-condition discipline (reframed 2026-05-03):** Items in "Deferred slices" and "Decisions awaiting trigger" sections are NOT open-ended defers — each has an explicit signal that pulls the trigger. Most triggers are downstream of the citation-tracking instrumentation slice (in flight, Cowork-side spec authoring); shipping that slice produces the signals that gate the rest.

This file tracks open work across sessions. Update when items close or new ones surface. Priority loosely ordered top-to-bottom.

---

## Immediate (Bruno sign-off required, ~10-min slices each)

### 1. Internal methodology doc updates (`pharos-citation-audit-calibration-methodology.md`)
- **Lives in OneDrive workspace** (acquisition asset, not in repo) — Bruno-driven edit.
- **Three diffs proposed in `reports/multi-known-positive-2026-05-02.md` §8:**
  - (a) §8 caveat #1 revised — internal version names the four specific anchors (Stripe/Salesforce/GitHub/HubSpot)
  - (b) §9 follow-up #1 ("Multi-known-positive expansion") marked complete with reference to today's ship-report
  - (c) New §9 entry — Pass 4 stub for "recognition-gradient + known-negative anchor calibration when triggered"

### 2. Slice A2.2 (optional polish) — rename "Known limits" heading
- **What:** Rename `## Known limits` → `## Calibration scope and known limits` in `marketing-site/src/lib/methodology-content.ts`.
- **Why:** After Slice A2.1 widened the framing sentence + lead-in to include positive calibration scope alongside limits, the heading itself remains stale ("Known limits" promises only-what's-missing; the section now leads with positive scope and adds limits).
- **Why optional:** mismatch is mild; heading is short and 80% accurate. Defer unless tonal coherence becomes a customer-conversation friction point.

### 3. Caveat removal slice — "one provider operationally absent" (post Gemini fix)
- **What:** Remove the "One provider operationally absent" caveat from `/methodology/calibration` (Known Limits section, [methodology-content.ts:60](marketing-site/src/lib/methodology-content.ts#L60)) and `/llms.txt` (Known Limits methodology block).
- **Why:** Gemini paid-tier + 2.5 Flash upgrade (2026-05-04, worker `e23ac215`) resolved the cause. Caveat is now stale; methodology page is currently disclosing a limit that no longer exists.
- **Trigger:** real-audit verification of 4-provider `judged_n` coverage. Run a single calibration audit on the dogfood domain (Astrant.io), confirm `judged_n: 4` across cells, then queue the caveat removal. ~$0.95 for the verification audit + ~10-min slice.
- **Cross-surface coordination:** if Pass 4 calibration ever ships with a different "operationally absent" disclosure, this caveat-removal slice's text changes accordingly. Currently no such coupling — straightforward two-surface text removal.

---

## Scheduled checkpoints (no persistent scheduler — calendar reminders)

The two cron jobs created in the prior session were session-only and died at conversation end. Either calendar these manually or run `/schedule` if that has a different (durable) mechanism.

### 3. 2026-05-16 — A2 regression check (+2 weeks from deploy)
- Re-verify the four published surfaces still serve correctly:
  - `https://www.astrant.io/methodology/calibration` → HTTP 200, contains `dim6:v3`
  - `https://www.astrant.io/methodology` → 307 redirect to `/methodology/calibration`, NOT 404
  - `https://www.astrant.io/llms.txt` → HTTP 200, contains `## Astrant Methodology`
  - `/score/[id]` (fresh test scan) → narrative section + rebrand caveat + qualifier rendered
- Check whether score-page V2 redesign has shipped in the interim — verify narrative still renders correctly under any new layout.
- Report to `F:\pharos\reports\publishing-bundle-regression-<date>.md`.

### 4. 2026-06-02 — Phase 1.5 status review (+1 month)
- Has parser URL-canonicalization fix shipped? If yes, queue caveat-removal slice across `/score/[id]`, `/methodology/calibration`, `/llms.txt`.
- Has Gemini per-provider semaphore shipped? Same: if yes, queue caveat-removal slice.
- `/llms.txt` provider-name scrub decision — re-evaluate posture; pre-existing copy at lines 1-22 names ChatGPT/Claude/Perplexity/Gemini.
- Pass 1 fill-in for internal methodology doc — Bruno-only task; check if it's been completed.
- Report to `F:\pharos\reports\phase-1.5-review-<date>.md`.

---

## Deferred slices (Phase 1.5 hardening, queued)

### 5. Parser URL-canonicalization fix (highest customer-impact)
- **Memory:** `project_dim6_url_canonicalization_bug.md` documents the bidirectional contamination on rebranded domains.
- **Two viable fix shapes:** (a) audit-create follows redirects to canonicalize stored `record.url`, (b) parser accepts brand-stem matches (e.g., notion.so/notion.com both register as "notion"). (a) preferred — normalizes input rather than matching logic; also handles pre-rebrand customer audits.
- **Surfaces affected when fixed:** rebrand caveat removed from /score/[id] narrative + /methodology/calibration Known Limits + /llms.txt Known Limits.
- **Trigger:** citation-tracking instrumentation surfaces "rebrand-domain customers blocking cite share" signal, OR audit volume from rebrand-domain customers becomes a measurable cite-share friction. Without instrumentation, currently disclosed-via-caveat is the right posture.

### 6. ~~Gemini per-provider semaphore~~ — OBSOLETE (closed by 2026-05-04 paid-tier upgrade + model migration)
- **Memory misdiagnosis correction:** the "rate-limit cascade" framing was wrong. Actual root cause was that `gemini-2.0-flash` was retired for new API users (HTTP 404 "no longer available to new users"). The semaphore engineering work would have isolated request budgets but wouldn't have made retired-model calls succeed.
- **Resolution:** Bruno upgraded the GCP project to paid Tier 1 + code upgraded to `gemini-2.5-flash`. Verified via 20-call parallel burst test (20/20 ok). See `reports/gemini-paid-tier-upgrade-2026-05-04.md`.
- **Cost impact:** per-audit Gemini contribution ~$0.10 at 2.5 Flash pricing; total per-audit cost goes from ~$0.85 (3-provider) to ~$0.95 (4-provider). Marginal vs $79 audit price.

### 7. `own_domain_evidence` corpus migration
- **Spec deviation from Slice 3b:** implementation collapsed `own_domain_evidence` and `judge_verdict` into `notes` + `response_text`.
- **Migration:** `0004_add_evidence_columns.sql` re-adds the columns as nullable + one-shot backfill from `notes` parsing for historical rows.
- **Why before corpus grows:** backfill friction compounds with row count. Currently ~360 cells (after 4-anchor expansion); manageable.
- **Trigger:** paying-customer audits start landing (corpus volume ramps) OR upcoming slice already touches the dim6 evidence schema (folding migration into that slice is cheaper than not). Until then, training-grade-corpus quality work isn't customer-impacting.

### 8. Per-page V2 redesigns (from design handoff)
- Home V2 · Beam V2 (`/score`) · Survey V2 (`/audit`) · Build V2 (`/implementation`) · Bespoke V2 (`/custom`) · Subs V2 (`/subscriptions`)
- One slice per page; foundation tokens already shipped (`0df931f` + `c658fc0e`).
- **Trigger:** acquirer-profile signal sharpens via citation-tracking instrumentation — the V2 design priorities differ if the live target is infrastructure-acquirer (Cloudflare/Vercel-class, MCP+llms.txt-toolchain narrative) vs martech-acquirer (HubSpot/Salesforce-class, methodology-rigor narrative) vs SEO-incumbent (Ahrefs/Semrush-class, AEO-transition narrative). Methodology execution arc is now closed (post-A3), so the foundation-tokens-only deferral trigger is partially met; sharpening the acquirer-profile signal is the remaining gate.

---

## Decisions awaiting trigger

### 9. Pass 4 calibration (recognition-gradient + known-negative anchor)
- **Trigger:** paying-customer-data availability OR specific customer conversation surfaces "does it work for my smaller domain" question.
- **Two sub-tasks:** (i) sample 2-3 intermediate-recognition anchors (Series A B2B SaaS at ~6-12 months public web presence) to validate slope monotonicity through customer-relevance gradient; (ii) add sub-100-page brochure site as known-negative control to validate judge's ceiling against over-AFFIRM.
- **Cost:** ~$0.85 × 4-5 anchors = ~$3.40-4.25 + setup time.

### 10. `/llms.txt` provider-name scrub
- **Decision deferred 2026-05-02:** keep ChatGPT/Claude/Perplexity/Gemini in product-marketing copy at lines 1-22; scrubbing would weaken agent-ingestion narrative.
- **Trigger to re-evaluate:** competitor moves, customer-conversation evidence, or shift in IP-protection posture.

---

## Closed 2026-05-03

- ✓ Slice A2.1 — methodology page §8 caveat #1 update (caveat replacement + lead-in widening + sentence 1 widening). Worker `9fd33768-3380-4db1-a7d3-0c1f7e7e620b`. Ship-report: `reports/slice-a2.1-deploy-2026-05-02.md`.
- ✓ Typography plugin fix — installed `@tailwindcss/typography` + registered via `@plugin` directive in `globals.css`. Resolves wall-of-text rendering bug pre-existing from Slice A2 (prose-* utilities were silent no-ops without the plugin). Worker `d7dd27fd-ae81-4e73-9bfb-c313cfb48fc7`.
- ✓ Footer Methodology link — added to `SiteFooter.tsx` mono caption row between `llms.txt` and `Privacy`. First user-discoverable surface for the methodology page (previously only reachable via direct URL). Worker `acd54644-b42d-4f5b-bdc2-609734a29c35`.
- ✓ Slice A3 — dogfood-methodology integration (homepage callout + Organization-schema `disambiguatingDescription` + footer href stable-hub-URL upgrade + stale-italic rewrite). Four edits across three files; agent-first reframe with site-wide Schema.org propagation via root layout. Completes the four-surface acquisition-narrative artifact stack (methodology page + llms.txt + MCP server + dogfood callout). Worker `1187011b-961c-42d6-992b-e198dc1f05bb`. Ship-report: `reports/slice-a3-deploy-2026-05-03.md`.
- ✓ ScanForm disclaimer cleanup — dropped italic styling and "Slice 3a" reference under the homepage scan form. Reworded to "Free public scan, no signup. Covers 5 of 6 dimensions today; Citation Visibility ships in an upcoming release." Worker `bd1bc2e0-3168-4d12-afcb-c60da24fd1e0`.
- ✓ Public-surface internal-naming sweep — scrubbed `Slice 3a` / `Phase 2 of Slice 2b` / `TODO comment in the scanner` from /score metadata + FAQ + hero, /terms heading + body, public/terms.md (raw-served markdown). Five user-facing strings cleaned across three files. Code comments deliberately left alone (dev-internal, not rendered). Engine-version stamps `dim6:vN` retained as legitimate public technical-version identifiers. Worker `2fd19f81-66a6-4645-bcb8-e9e1de5020b3`.

## In flight (Cowork-side spec authoring, parallel to CLI execution)

- **Citation-tracking instrumentation spec** (`pharos-citation-tracking-instrumentation-spec.md` v1, Cowork-side). The post-A3 strategic conversation's first deliverable. Direct-citation-probe corpus as primary signal + leading-indicator telemetry from already-collecting CF Workers Logs. Telemetry-surface investigation findings handed off in `reports/telemetry-surface-investigation-2026-05-03.md`. Internal-doc diffs ready for Bruno's OneDrive paste in `reports/internal-methodology-doc-diffs-2026-05-03.md`. Three downstream items (Phase 1.5 parser, V2 redesigns, llms.txt content emphasis) gate on this spec's signal outputs.

## Closed 2026-05-02

- ✓ Slice 3c (dim6:v2 → dim6:v3 prompt-set fix + engine bump)
- ✓ engineLine v3 bumps (disclosure.ts SOT + MCP mirror)
- ✓ TP-7 boundary fix on /score/methodology
- ✓ Foundation Slice A1 token gap-fill (--color-paper + type-scale + spacing tokens)
- ✓ Slice A2 publishing bundle (`/methodology/calibration` + `/methodology` hub stub + /score/[id] transparency narrative + /llms.txt methodology block)
- ✓ Multi-known-positive expansion (4/4 known-positive anchors confirm Outcome A at maximum strength — Stripe + Salesforce + GitHub + HubSpot)
- ✓ Stripe methodology retry — Outcome A confirmed (after attempt 1 INVALID due to Bug 2 + CC-3 contamination)

All shipped to production marketing-site. Worker versions: Foundation `c658fc0e`, TP-7 fix `844891b0`, A2 publishing `75d9edec`. Five ship-reports under `reports/` capture per-deploy details. Commit `2590906` on `origin/main`.
