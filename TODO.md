# Pharos / Astrant — Pending Follow-Ups

**Last updated:** 2026-05-03 (post Slice A2.1 + typography fix + footer link)

This file tracks open work across sessions. Update when items close or new ones surface. Priority loosely ordered top-to-bottom.

---

## Immediate (Bruno sign-off required, ~10-min slices each)

### 1. Internal methodology doc updates (`pharos-citation-audit-calibration-methodology.md`)
- **Lives in OneDrive workspace** (acquisition asset, not in repo) — Bruno-driven edit.
- **Three diffs proposed in `reports/multi-known-positive-2026-05-02.md` §8:**
  - (a) §8 caveat #1 revised — internal version names the four specific anchors (Stripe/Salesforce/GitHub/HubSpot)
  - (b) §9 follow-up #1 ("Multi-known-positive expansion") marked complete with reference to today's ship-report
  - (c) New §9 entry — Pass 4 stub for "recognition-gradient + known-negative anchor calibration when triggered"

### 2. Dogfood-section methodology integration (homepage IA pull)
- **What:** Add a "See the methodology" link from the homepage Dogfood section to `/methodology/calibration`, anchored on the HubSpot-as-customer-tier finding from yesterday's multi-anchor calibration expansion.
- **Why:** Footer link (shipped 2026-05-03) gives the methodology a discoverable surface, but Dogfood-section integration converts methodology depth into a claims-substantiation moment for prospects reading the dogfood narrative. The HubSpot-tier signal is the load-bearing pull-quote — "we've validated our methodology on a brand at your recognition tier."
- **Why not now:** needs real copy work to find the natural insertion point in the existing Dogfood prose. Worth doing properly when revisiting homepage IA, not a quick drop-in.
- **Pull-quote source:** `reports/multi-known-positive-2026-05-02.md` §13 has a draft pull-quote already; may need shortening for a homepage-section context.
- **Awaits:** Bruno trigger to revisit homepage IA (or specific customer conversation that surfaces "does it work for my recognition tier" question).

### 3. Slice A2.2 (optional polish) — rename "Known limits" heading
- **What:** Rename `## Known limits` → `## Calibration scope and known limits` in `marketing-site/src/lib/methodology-content.ts`.
- **Why:** After Slice A2.1 widened the framing sentence + lead-in to include positive calibration scope alongside limits, the heading itself remains stale ("Known limits" promises only-what's-missing; the section now leads with positive scope and adds limits).
- **Why optional:** mismatch is mild; heading is short and 80% accurate. Defer unless tonal coherence becomes a customer-conversation friction point.

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
- **Customer-impact estimate:** ~5% of audited domains have rebrand history; current caveat surfaces correctly in transparency narrative.

### 6. Gemini per-provider semaphore
- **Pattern:** isolate Gemini's request budget so its 429 cascade doesn't starve the other providers.
- **Surfaces affected when fixed:** "one provider operationally absent" caveat removed from all three published surfaces.
- **Recovery:** ~25% of the cell budget (10 of 40 cells per audit currently unmeasurable on Gemini).

### 7. `own_domain_evidence` corpus migration
- **Spec deviation from Slice 3b:** implementation collapsed `own_domain_evidence` and `judge_verdict` into `notes` + `response_text`.
- **Migration:** `0004_add_evidence_columns.sql` re-adds the columns as nullable + one-shot backfill from `notes` parsing for historical rows.
- **Why before corpus grows:** backfill friction compounds with row count. Currently ~360 cells (after 4-anchor expansion); manageable.
- **Why not blocking:** training-grade-corpus quality work, not customer-impacting.

### 8. Per-page V2 redesigns (from design handoff)
- Home V2 · Beam V2 (`/score`) · Survey V2 (`/audit`) · Build V2 (`/implementation`) · Bespoke V2 (`/custom`) · Subs V2 (`/subscriptions`)
- One slice per page; foundation tokens already shipped (`0df931f` + `c658fc0e`).
- Defer until either (a) customer-conversation pull suggests V2 layouts would convert better, or (b) methodology arc fully closed and want pure execution slices.

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

## Closed 2026-05-02

- ✓ Slice 3c (dim6:v2 → dim6:v3 prompt-set fix + engine bump)
- ✓ engineLine v3 bumps (disclosure.ts SOT + MCP mirror)
- ✓ TP-7 boundary fix on /score/methodology
- ✓ Foundation Slice A1 token gap-fill (--color-paper + type-scale + spacing tokens)
- ✓ Slice A2 publishing bundle (`/methodology/calibration` + `/methodology` hub stub + /score/[id] transparency narrative + /llms.txt methodology block)
- ✓ Multi-known-positive expansion (4/4 known-positive anchors confirm Outcome A at maximum strength — Stripe + Salesforce + GitHub + HubSpot)
- ✓ Stripe methodology retry — Outcome A confirmed (after attempt 1 INVALID due to Bug 2 + CC-3 contamination)

All shipped to production marketing-site. Worker versions: Foundation `c658fc0e`, TP-7 fix `844891b0`, A2 publishing `75d9edec`. Five ship-reports under `reports/` capture per-deploy details. Commit `2590906` on `origin/main`.
