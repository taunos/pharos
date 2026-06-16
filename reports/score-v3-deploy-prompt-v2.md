# Score V3 Deploy Prompt v2

**Target repo:** `F:\pharos\marketing-site\`. `scanner/` READ-ONLY (synchronous persistence confirmed; no scanner change).
**Frozen source spec:** Score V3 spec v3. STANDALONE — locked artifacts inlined; do not consult the spec at execution.
**Supersedes v1.** Folds CLI v1 review (MED-1 dirty page.tsx; MED-2 A6 fit; §D NITs) + Codex v1 review (ScanResults contradiction; fallback Next.js precision; A6 lock-vs-halt).
**No schema migration. No scanner edits. No push.** "Beam" is a REJECTED name — never use it.

### Changelog v1 → v2
- **ScanForm always routes (Codex MED).** v1's "default preserves inline behavior" contradicted `ScanResults` grep=0. Resolved: `ScanForm` routes on scan success unconditionally — remove its inline `ScanResults` render + import; drop the `routeOnSuccess` prop (both surfaces route; no third caller per V6). `ScanResults` is then honestly unconsumed (grep=0).
- **Server-miss fallback = client shell BEFORE not-found (Codex MED).** `/score/[id]` is a server component; on `getPublicScan` miss it must NOT `notFound()` immediately — it renders a CLIENT fallback shell that checks `sessionStorage` first. And the normal-path sessionStorage clear needs a tiny CLIENT cleanup component (server can't touch browser storage).
- **Dirty homepage `page.tsx` (CLI MED-1).** `marketing-site/src/app/page.tsx` carries a PRE-EXISTING uncommitted hunk ("Astrant Pro" → "Pro", subscription tier ~L73) deliberately excluded from Score V2. Step 4 edits that file → naive `git add page.tsx` would silently conflate the unrelated rename (and `git add -p` is unavailable). V4 now diffs page.tsx + surfaces the hunk; Step 11 stashes it aside so the Score V3 commit excludes it (stays deferred) — no blind conflation.
- **A6 fit-validation (CLI MED-2).** The stale clause sits MID-PARAGRAPH ("Built the way we build for clients"). A blind sentence-swap = the Score V2 A10 failure. Step 7 now V-reads the full paragraph + validates A6 integrates grammatically; fitted-rewrite fallback if not; confirm "the sample above" still holds post-re-layout.
- **§D NITs:** A2 D6 row carries the `free_tier_dim6_preview` sub-check id (renders as demo row, not 0-bar); width-constrain via a /score WRAPPER, not the shared `ScanForm` (I6); add `Beam = 0` sweep; sessionStorage clear is client-side; concrete idempotency marker-greps.
- **Step-11 dirty-tree CORRECTED (post-v2 review, CLI §B / Codex):** the "always routes" refactor (Step 3, in `ScanForm.tsx`) means the homepage routes for free — **Score V3 does NOT edit `page.tsx`.** So the pre-existing "Astrant Pro"→"Pro" hunk can't be conflated; the v2 `git stash` dance was needless + self-contradictory. Step 11 now simply: don't `git add` `page.tsx`; verify it's excluded; HARD HALT if implementation somehow modified it. No stash. Step-10(g) fallback simulation method spelled out.

---

## Inline constraints (C1–C10)
**C1** no attribution (Bruno author). **C2** no push. **C3** Git Bash + Windows-portable (no `/tmp`, `2>/dev/null`, process substitution; run from `marketing-site/`). **C4** `npm run cf:deploy` (never bare wrangler). **C5** status+body curls, Node regex for minified HTML, no `-i` byte-diffs on CF, `--max-time` on SSE. **C6** TODO.md local. **C7** grep-verify locked constants/strings. **C8** pseudocode illustrative; §LOCKED exact incl. surrounding markdown; V-read ship-state wins on conflict. **C9** `&apos;` in JSX text. **C10** rendered text outside §LOCKED → HARD HALT.

---

## §LOCKED — content artifacts

**A1 — `ScorePanel` (NEW; illustrative structure, styling hot-class):** composite numeral + grade (Score V2 `gradeColorClass`; A- → emerald); six dimension rows, **result-forward**: `D{n}` · name · **bar** · score · weight-as-small-mono-annotation. Reuses `gradeColorClass`, `dimensionCountPhrase`, `isDim6DemoPreview`, demo-preview card. Single source of truth for the /score sample panel AND `/score/[id]`.

**A2 — /score sample values (V12 live astrant.io at build; no byte-pin):** composite `89 / 100 · Grade A-`; rows D1 93, D2 100, D3 N/A, D4 73, D5 93; **D6 = demo-preview row carrying sub-check id `free_tier_dim6_preview`** so `ScorePanel` renders it as a demo row (NOT a 0-bar). Refresh-on-deploy source comment.

**A3 — sample caption (rendered, visible):** `SAMPLE · ASTRANT.IO`. Must read as a sample; never imply the visitor's live result.

**A4 — D3.1 fallback note (rendered on server-miss path, IN PLACE of EmailGate; Bruno-LOCKED 2026-06-16):** `This result wasn&apos;t saved — run the scan again to get your emailed report and PDF.` (Greenlit as-is; no halt.)

**A5 — Score nav link:** `<Link href="/score">Score</Link>` — VISIBLE at all breakpoints (NOT `hidden md:inline`; it's the primary product link).

**A6 — /score stale clause (§3.6; build-time FITTED lock — V5 full-paragraph read + Bruno greenlight):** stale clause ≈ "When the score ships, we'll score ourselves first…" inside the "Built the way we build for clients" paragraph. Proposed reconciliation (intent): the Score is live and we self-score (the sample panel proves it). **The operator V-reads the FULL paragraph, fits the reconciliation into the sentence grammatically, and surfaces the exact fitted string for Bruno's greenlight before editing** — do NOT force a standalone sentence that doesn't integrate (the Score V2 A10 lesson). Confirm "the sample above" phrasing still holds after the Step 2 re-layout (the sample panel must still be above this text).

**A7 — "Where you're losing points" gap section (RESTORE; Bruno-locked 2026-06-16).** Score V2's per-dimension below-threshold sub-check notes (truncated ~80 chars) were dropped when ScorePanel went compact; Bruno restores them as a **distinct section BELOW `ScorePanel`** on `/score/[id]` (the panel stays the clean big-score moment; gaps live in their own section). Heading proposed `Where you're losing points` (hot-class, tunable). Per-dimension truncated notes for below-threshold dimensions, as Score V2 rendered inline — now sectioned, positioned to feed the email/Audit CTA. **Full gap detail still gates to the emailed PDF** (the section is a teaser, not the complete report). Honors the page's "the gap report tells you exactly what to fix" promise.

(Hero H1 `Your Astrant Score`, descriptor, body PRESERVED from Score V2 — A16a/A17; only re-laid-out, no hero copy change.)

---

## Step 0 — V-reads + idempotency (FIRST)
- **V2 — `/score/[id]` current design:** hero, dimension breakdown, CTA matrix branching, three-way narrative gate, EmailGate mounts, token/`searchParams` + `getPublicScan` call — what to restyle into `ScorePanel`, what mechanics to PRESERVE VERBATIM.
- **V4 — /score layout + homepage diff + homepage-inert:** (a) two-column remnants / empty column + A5-JSON location on /score; (b) **`git diff marketing-site/src/app/page.tsx` — NOTE the pre-existing uncommitted hunk** (expected: "Astrant Pro"→"Pro" ~L73, deferred from Score V2). Score V3 does NOT edit page.tsx (Step 4 is verify-only), so this hunk stays deferred and out of the commit for free — do NOT touch or stage it; (c) confirm no homepage layout depends on the inline-results section (D9 removal inert — `ScanForm` self-contains results).
- **V5 — §3.6 stale clause:** the FULL surrounding paragraph + exact bytes + line ref + markdown; sweep /score for other stale launch copy (the `ScanResults` "remaining dimensions ship" line is dead code — do NOT reconcile).
- **V6-confirm — `ScanResults` consumers:** grep — expect `ScanForm` as the sole consumer (which Step 3 removes). A SECOND consumer → HALT (the always-route change assumes none).
- **V7 — live astrant.io scan** for A2 values.
- **V8 — error/rate-limit states** location, so routing keeps them inline.
- **Resolved (do not re-litigate):** V0 public-by-id; V1 persistence; V1-sub synchronous (`scanner/src/index.ts` L176-201; best-effort try/catch L194 → A4 handoff); V3 no mobile-menu.
- **Idempotency marker-greps (verify-and-fill-gaps):** `ScorePanel` exists? `ScanForm` already routes (no `ScanResults` import)? A5-JSON already absent from /score? Score `<Link>` present? Skip any already-done.

## Step 1 — `src/components/ScorePanel.tsx` (NEW, fresh)
Per A1. Built fresh — NOT a `ScanResults` rename. Reuse Score V2 helpers. Renders the demo-preview row when a dimension carries `isDim6DemoPreview` (A2 D6).

## Step 2 — `src/app/score/page.tsx`
Single-column hero (eyebrow `FREE · NO SIGNUP` → preserved H1 `Your Astrant Score` → descriptor → A17 body → **scan form inside a width-constrained /score WRAPPER** (do NOT edit `ScanForm`'s own width — I6) → audit upsell). Retire the A5 JSON block. Full-width sample panel below (border-top `--color-rule`): `ScorePanel` + A2 values + A3 rendered caption + refresh comment. "Six dimensions" strip → result-forward (D7) or folded into the panel rows (hot-class). No inline results.

## Step 3 — `src/components/ScanForm.tsx` — always route (remove inline)
On scan success: **stash the result in `sessionStorage` keyed by `scanId`, then `router.push('/score/' + scanId)`** — unconditionally (no `routeOnSuccess` prop; both surfaces route). **Remove the inline `ScanResults` render + its import.** Errors / rate-limit stay inline on the originating page (V8). After this, `ScanResults` has no consumer.

## Step 4 — Homepage (VERIFY-ONLY — D9)
The homepage `ScanForm` inherits routing from Step 3 (`ScanForm` always routes) — **no `page.tsx` edit is needed or permitted.** No homepage layout/visual/copy change (I6). V4(c) confirms the inline-results removal is inert. The pre-existing "Astrant Pro"→"Pro" hunk in `page.tsx` stays untouched and out of the commit (Step 11) — Score V3 never opens this file for writing.

## Step 5 — `src/app/score/[id]/page.tsx` — ScorePanel + server-first + client fallback shell
- Restyle the result into `ScorePanel` (D4/D7). **Preserve verbatim:** EmailGate (+honeypot+token), CTA matrix branching, three-way narrative gate (arm-1 unreachable comment / arm-2 demo / arm-3 suppress), token-bound PDF, page-mode.
- **Server-first (this server component):** `getPublicScan(scanId)`. **Row exists →** render the full page from server; mount a tiny **CLIENT cleanup component** that clears the `sessionStorage` entry for `scanId` (server can't touch browser storage — Codex/CLI).
- **Row MISS → do NOT `notFound()` yet.** Render a **CLIENT fallback shell** that reads `sessionStorage[scanId]`: if present → `ScorePanel` + the **A4 rescan note in place of EmailGate** (NOT the full page — getScanState/EmailGate/PDF can't function without the row); if absent → the existing not-found UI. `notFound()`/not-found only AFTER the client check fails.
- **A7 gap section (RESTORE):** below `ScorePanel`, render the per-dimension below-threshold sub-check notes (truncated ~80 chars, the Score V2 behavior) as a distinct "Where you're losing points" section, positioned to feed the email/Audit CTA. Full detail stays in the PDF. (Server path only; the degraded sessionStorage fallback may omit it if the stashed payload lacks the notes — best-effort.)

## Step 6 — `src/components/SiteHeader.tsx` — Score nav link (A5)
Add `<Link href="/score">Score</Link>`, existing item markup/classNames (Edit-style) BUT **visible at all breakpoints** (no `hidden md:inline`). Global.

## Step 7 — /score stale clause (§3.6) — fitted lock (A6)
V-read the FULL paragraph (V5). Fit the A6 reconciliation into the sentence grammatically; confirm "the sample above" still holds post-Step-2 layout; surface the EXACT fitted string for Bruno's greenlight; THEN full-line/clause edit (byte/marker-safe). Do NOT force a non-integrating standalone sentence (A10 lesson). Do NOT touch the dead `ScanResults` line. HALT if the live paragraph differs materially from the A6 intent.

## Step 8 — Static verification (Phase 1–2)
- `npm run build` + typecheck + test clean.
- **Sweeps (enumerate; 0 unless noted):** A5 JSON removed from /score; no two-column grid remnant; `<Link href="/score">` present in SiteHeader **without `hidden md:inline`**; `gradeColorClass` single-source; `ScorePanel` is new (not a `ScanResults` rename); **`ScanResults` consumer-grep = 0** (Step 3 removed the sole consumer — Codex MED resolved; note in ship-report, do NOT delete this slice); `ScanForm` no longer imports `ScanResults`; the A6 clause reconciled (exact, byte/marker-safe); the dead `ScanResults` "remaining dimensions ship" line left untouched; **`Beam` = 0 in slice-touched files** (rejected name — Score V2 leaked it into comments; case-sensitive); `free_tier_dim6_preview` present in the A2 sample D6 row.

## Step 9 — Deploy (STOP-AND-CONFIRM GATE — Bruno 2026-06-16)
**After Step 8 (static verification) PASSES, STOP.** Surface to Bruno: the diff summary (files touched), the Step-8 sweep results, and the fitted A6 string (Step 7). Get Bruno's explicit OK BEFORE the production deploy. THEN `npm run cf:deploy` from `marketing-site/`; record the Worker version id. This is a production deploy — do NOT carry straight through.

## Step 10 — Endpoint verification (Phase 3–4)
Status+body (C5); Node regex for minified HTML.
- (a) /score → single-column hero + preserved H1 + sample panel (visible `SAMPLE` caption; D6 renders as demo row not 0-bar; no JSON; no empty column); (b) scan on /score → routes to `/score/[scanId]`, renders; (c) **scan on HOMEPAGE → routes to `/score/[scanId]`, renders** (reported bug fixed); (d) fresh anonymous result renders server-side publicly (no token); (e) emailed token link still renders; (f) errors/rate-limit stay on the originating page, no route; (g) **degraded fallback — simulate via devtools: set `sessionStorage["<bogus-uuid>"]` to a scan-result JSON, then visit `/score/<bogus-uuid>` (`getPublicScan` miss + sessionStorage hit) → client shell renders `ScorePanel` + A4 note, NOT EmailGate, NOT "Couldn't load capture state"; with NO sessionStorage → not-found**; (h) Score V2 result cases (demo / absent-Dim-6 / A- grade emerald) correct on the panel; (i) EmailGate + honeypot byte-identical to baseline on the server path; (j) homepage VISUAL unchanged (only submit routes); (k) nav "Score" present + visible on a narrow viewport, links to /score on every page; (l) PDF token-gated.

## Step 11 — Ship-report + commit + archive
- **Dirty-tree handling (CLI MED-1) — BEFORE the Score V3 commit:** the pre-existing "Astrant Pro"→"Pro" hunk in `page.tsx` (V4) must NOT ride the Score V3 commit. Recommended: `git stash push -- marketing-site/src/app/page.tsx` to set it aside (the Step 4 routing edit is preserved separately — if stash refuses because both changes are staged, unstage first), commit Score V3, then `git stash pop` to restore the deferred rename to the working tree, uncommitted. If the routing edit and the rename share lines and pop conflicts → HALT, surface to Bruno. (Fallback only with Bruno's explicit ok: ride along + ship-report note.) The rename stays DEFERRED (its 17a naming-drift decision is unresolved — do not pre-empt it).
- `git add` EXPLICIT paths only; HARD HALT on anything outside the touched set. No `git add -A`. TODO.md + `.claude/settings.json` unstaged.
- Ship-report: V-read resolutions (incl. V4 page.tsx diff disposition), Phase 1–5 PASS/FAIL, locked-content audit (A1-A6 + preserved hero copy + the fitted A6 final string), **`ScanResults` dead-code note (grep=0; deletion deferred to Home V2)**, the page.tsx stash disposition, deviations, convergence point, **memory-delta** (proposed; Bruno greenlights): Score V3 shipped — single-column score-panel /score; both surfaces route to `/score/[id]` (now the canonical result page Home V2 reuses); server-first sessionStorage resilience; Score nav link; `ScanResults` queued for Home V2 deletion; the "Astrant Pro"→"Pro" hunk remains deferred (17a).
- Commit, Bruno author, NO attribution (C1). Suggested: `feat(score): Score V3 — single-column score-panel /score, both-surface scan routing to /score/[id], Score nav link`.
- No push (C2). Archive deploy prompt + spec v3 with the ship-report.
- HOT rounds (operator): /score hero + sample panel typography/bars/spacing; `/score/[id]` detail; eyebrow; optional A4 soft-degradation polish.
