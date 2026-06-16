# Score V3 — Ship Report (2026-06-16)

**Slice:** Score V3 — single-column score-panel `/score` hero; scans (on both `/score` and the homepage) route to a canonical `/score/[id]` result page; Score nav link; one stale-copy reconciliation; plus operator hot-round additions (see Deviations).
**Executed from:** Score V3 deploy prompt v2 (with the CLI-reviewed Step-11 correction applied: no stash). Frozen source spec: Score V3 spec v3.
**Deploy:** `npm run cf:deploy` (marketing-site). **Worker Version ID: `47cea939-e533-427b-bda6-4af99fcce17c`.** Live on astrant.io.
**Predecessor:** Score V2 (`4d643588`). **Author:** Bruno. No push. No scanner edits. No schema migration.

---

## V-read resolutions (Step 0)
- **V0 = public-by-id**, **V1 = anonymous scans persist + retrievable**, **V1-sub = synchronous persistence** (`scanner/src/index.ts` L176-201 awaits the D1 INSERT before responding; best-effort `try/catch` L194 → A4 sessionStorage handoff), **V3 = no mobile-menu**, **V6 = `ScanForm` is `ScanResults`' sole consumer** — all resolved against the live system/scanner in the spec rounds, re-confirmed at execution.
- **V2** — `/score/[id]` CTA matrix / narrative gate / EmailGate mounts identified and preserved verbatim. **V4** — `/score` two-column hero + A5 JSON located; homepage inert (ScanForm self-contains results). **V5** — stale clause = last sentence of the "Built the way we build" paragraph. **V7** — astrant.io sample values (89/A-, D1 93 D2 100 D3 N/A D4 73 D5 93, D6 demo). **V8** — ScanForm renders errors inline (no route on error/rate-limit).
- **Idempotency:** not previously shipped (no ScorePanel, ScanForm still imported ScanResults, A5 JSON present, no Score nav link).

## Phase verification
- **Phase 1-2 (static):** `tsc --noEmit` clean; `vitest` 12/12; `next build` clean (/score, /score/[id]). Sweeps all clean: A5 JSON retired; no two-column remnant; `ScanResults` consumer-grep = 0; `ScanForm` no longer imports it; stale "When the score ships" gone; Score `<Link href="/score">` present (no `hidden md:inline`); `gradeColorClass` single-source; `Beam` = 0 in slice files; `free_tier_dim6_preview` in the sample D6 row.
- **Phase 3-4 (deploy + endpoint):** cf:deploy success. Live curls: /score H1 "Your Astrant Score" + centered hero + Sample·astrant.io ScorePanel (89, D6 demo-preview row, no JSON) + audit CTA below sample + A6 line + nav Score link. /score/[id] ScorePanel (89, A- → `text-emerald`) + "Where you're losing points" + "Want these gaps fixed" audit upsell + EmailGate ("Get the full PDF gap report") + honeypot `website_url_2`. (Scan→route + degraded-fallback not curl-exercisable — rate limit + needs a real persist-miss — but public-by-id path confirmed and code deployed.)
- **Phase 5:** scoped `git add` (slice files only); `page.tsx` excluded; ship-report + archive.

## Locked-content / decisions
A1 ScorePanel (fresh, NOT a ScanResults rename) ✓ · A2 sample values + D6 `free_tier_dim6_preview` ✓ · A3 rendered SAMPLE caption ✓ · A4 fallback note (Bruno-locked) ✓ · A5 nav link visible all breakpoints ✓ · A6 fitted clause (greenlit): *"The Score is live now — and we score ourselves first: astrant.io's own Astrant Score is the sample above."* ✓ · D3 `router.push` + D3.1 server-first sessionStorage handoff ✓ · D4 `/score/[id]` restyle, CTA matrix/narrative gate/PDF preserved verbatim ✓ · D9 homepage routes via the shared always-route `ScanForm` (page.tsx untouched) ✓.

## Deviations (operator hot-round additions, Bruno-directed at the Step-9 gate)
1. **Centered hero** — `/score` hero centered (`max-w-3xl`, `text-center`) to fix the desktop empty-right gutter.
2. **Audit CTA relocated** — `/score`'s "Want a deeper read?" CTA moved to directly below the sample score panel (was page-bottom).
3. **Audit upsell added to `/score/[id]`** — new "Want these gaps fixed, prioritized?" section after Citation Visibility, before the footer. Beyond the locked CTA matrix (which is untouched); high-intent post-result upsell. NEW copy, Bruno-greenlit.
4. **`/score/[id]` widened** `max-w-3xl` → `max-w-6xl` to match the sample so ScorePanel breathes.
5. **Gap notes un-truncated** — "Where you're losing points" drops the ~80-char `…` cap; full notes wrap full-width.
6. **Full-width body text** — uncapped the section-intro paragraphs on `/score` + `/score/[id]` (Bruno design pref). Homepage same-pattern paragraphs DEFERRED to Home V2 (TODO item 14) — `page.tsx` never opened.
7. **A7 (gap section)** — "Where you're losing points" sectioned out of ScorePanel (Score V2 inline gap teasers, now a distinct section feeding the email/Audit CTA).

## `ScanResults` dead-code note
`ScanForm` now always routes (both surfaces), so `ScanResults.tsx` has **zero consumers** (grep-confirmed). Left in place, unconsumed; **deletion deferred to Home V2** behind a consumer-grep gate (TODO item 14).

## Dirty-tree handling (CLI MED-1, corrected)
The "ScanForm always routes" refactor means **Score V3 never edits `page.tsx`** — so the pre-existing `"Astrant Pro"→"Pro"` hunk can't be conflated. No stash needed: `page.tsx` simply excluded from `git add`; verified `git diff --cached` excludes it. The hunk + any Home V2 text-uncap stay deferred (TODO item 14).

## Convergence
Spec: 3 cold rounds (v1→v3, no direction reversal; V0/MED-1 resolved by reading the live system + scanner). Deploy prompt: v1→v2 (CLI MED-1 dirty-tree + MED-2 A6 fit; Step-11 stash obsoleted by the always-route refactor → corrected at execution). Execution added 7 operator hot-round visual deviations (centered hero, CTA placement, audit upsell, widths, gap notes, full-width text) — none architectural; all design-iteration at the gate.

## Memory-delta (proposed; Bruno greenlights)
1. Score V3 shipped — `/score` single-column score-panel; both surfaces route to `/score/[id]` (now the canonical result page Home V2's homepage redesign reuses); server-first sessionStorage resilience; Score nav link; ScorePanel is the shared score-visual single-source.
2. `ScanResults.tsx` queued for Home V2 deletion (unconsumed). Homepage full-width-text treatment + the `"Astrant Pro"→"Pro"` hunk deferred to Home V2 (page.tsx kept clean).

## Files (this slice)
NEW: `src/components/ScorePanel.tsx`, `src/components/score/SessionResult.tsx`.
MOD: `src/app/score/page.tsx`, `src/app/score/[id]/page.tsx`, `src/components/ScanForm.tsx`, `src/components/SiteHeader.tsx`.
EXCLUDED: `src/app/page.tsx` (Home V2 boundary; deferred hunks), TODO.md, .claude/settings.json.
