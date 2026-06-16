# Score V3 — /score Hero Pivot + Scan-to-Route + Canonical Result Page — Spec v3 (DEPLOY-PROMPT-READY)

**Date:** 2026-06-16
**Supersedes:** spec v2. Integrates CLI v2 review (MED-1 RESOLVED by scanner read; best-effort-persist sibling; D6 dead-code trim) + Codex v2 review (server-first sessionStorage; sample wording; dead-code grep). **No gating unknowns remain.**
**Slice:** Score V3 — single-column score-panel /score hero; scans on **both /score and the homepage** route to a canonical `/score/[id]`; Score nav link; stale-copy cleanup.
**Naming:** single-column **score-panel** hero (`artboards-1.jsx:347-383`). "Beam" = REJECTED name, never use it. Page = **Astrant Score** / /score.
**Tier projection:** 3-5 cold rounds. **v3 is the final cold round** (CLI: "lock the two dispositions and it's deploy-prompt-ready") — both now locked below.
**Round tracker:** v1 → CLI (3 MED) + Codex (homepage scope) → v2 → CLI (MED-1 resolved + 2 dispositions) + Codex (impl-risk checks) → **v3 (this document; round 3 of 3-5 — final)**.
**Repo baseline:** `marketing-site/` post-Score-V2 (`4d643588`). V-reads current-branch-state.

---

## §0 Scope

Six workstreams on `marketing-site/`:
1. **/score hero pivot** — two-column → single-column score-panel; retire the A5 JSON.
2. **Full-width sample panel** — astrant.io self-scan as a SCORE; result-forward; weight demoted; rendered `SAMPLE` framing.
3. **Scan-to-route (BOTH surfaces)** — scan on /score OR homepage routes to `/score/[scanId]`. Homepage VISUAL stays Home V2; only its submit behavior changes.
4. **Canonical `/score/[id]`** — detailed report in the score-panel language; emailed token links + fresh anonymous scans; Score V2 mechanics preserved.
5. **Score nav link** — one `<Link href="/score">` in `SiteHeader` (no mobile-menu component).
6. **Stale-copy cleanup** — one live string (D6, trimmed).

---

## §1 Locked decisions

### D1 — /score hero: single-column score-panel (REDESIGN)
Per `artboards-1.jsx:347-383`. Vertical: eyebrow (`FREE · NO SIGNUP`, hot-class) → **H1 `Your Astrant Score`** (present + prominent already; this redesigns the surrounding layout) → descriptor (`An agent-discoverability rating across six dimensions.`) → body (A17) → **width-constrained scan form** → audit-upsell. No second column, no JSON. Hero does NOT render results inline (D3 routes them away).

### D2 — Full-width sample panel (retires A5 JSON; rendered SAMPLE framing — Codex #4)
Below the hero, full-width, `--color-rule` border-top. astrant.io self-scan as a SCORE:
- **Left:** large composite numeral + grade (`89 / 100 · Grade A-`), **`SAMPLE · ASTRANT.IO` caption rendered visibly** (UI-level signal, not just a source comment — the panel must read as a sample, never imply the visitor's own live result). Grade color via `gradeColorClass` (A- → emerald).
- **Right:** six dimension rows — `D{n}` · name · **bar** · score · weight. Result-forward (bar+score lead; weight = small mono annotation, D7).
- Values: V12 real astrant.io scan (observed: 89/100 · A-; D1 93, D2 100, D3 N/A, D4 73, D5 93; D6 = demo-preview row). Hardcoded snapshot + **refresh-on-deploy source comment**; no byte-pin.
- **A5 JSON retired** (OQ-7); content in git.

### D3 — Scan-to-route (MED-1 RESOLVED: synchronous persistence)
**CLI read the scanner: `/api/scan` `await`s the D1 INSERT (`scanner/src/index.ts` L176-193) BEFORE `return c.json` (L201) — not `waitUntil`.** `getPublicScan` → `GET /api/scan/:id` reads the same table. **The async race does NOT exist** → on scan success: **`router.push('/score/' + scanId)`**. Scanner untouched (I5 holds). Errors / rate-limit ("5 scans per IP per day") stay inline on the originating page, no route (OQ-5).

### D3.1 — Best-effort-persist resilience (OQ-8 ADOPTED; CLI sibling + Codex server-first)
The D1 INSERT is **best-effort** (`try/catch`, "don't fail the scan if D1 hiccups", L194). So a scan can return `200 + id` with **no row written** → a naive redirect lands on "Scan not found" — and with the 5-scans/IP/day limit the user often can't retry (result lost + locked out). The old inline flow masked this.
**Locked mitigation — `sessionStorage` handoff, SERVER-FIRST:**
- `ScanForm` stashes the successful scan result in `sessionStorage` keyed by `scanId` before routing.
- `/score/[id]` renders **server-first**: `getPublicScan(scanId)` is the source of truth; if the row EXISTS → render from server (normal, shareable path; sessionStorage unused).
- **Only on a server miss** (row absent — the rare best-effort-persist failure) → hydrate from `sessionStorage` so the scanning user still sees their result instead of "Scan not found."
- Server-first ordering satisfies Codex's caveat (sessionStorage never hides a server-consistency issue on the normal path; it's a fallback, not the primary). Preserves I5 (no scanner change). Makes the routed flow strictly ≥ the old inline flow.
- (Optional soft-degradation, hot-class: on the sessionStorage-fallback path, a quiet note that this result wasn't saved / isn't shareable. Not required for lock.)

### D4 — `/score/[id]` = canonical detailed result page (both entry paths)
Single result surface for emailed token links + fresh scans (D3/D9). Score-panel visual language (D2/D7) for the user-friendly detailed report. **Preserve verbatim:** EmailGate (+honeypot+token), CTA matrix, three-way narrative gate (arm-1 unreachable / arm-2 demo / arm-3 suppress), token-bound PDF, page-mode. Design changes; mechanics frozen.

### D5 — Score nav link (global SiteHeader)
One `<Link href="/score">Score</Link>` added to the nav, matching existing item markup/classNames (Edit-style). No mobile-menu component (V3); responsive classes inherited. Label `Score` (OQ-2). Global change — intentional.

### D6 — Stale-copy cleanup (TRIMMED to one live string — CLI §C)
`ScanResults`' only consumer is `ScanForm` (grep-confirmed); after D3+D9 both instances route → `ScanResults` renders NOWHERE → its "full report when remaining dimensions ship" line is **dead code**. Reconciling it is wasted lock-work — **dropped from D6**; it rides out with `ScanResults`' eventual deletion (Home V2).
**The one live string:** /score "When the score ships, we'll score ourselves first…" (stale + self-contradicting — the Score is live and the sample panel DOES self-score). Exact bytes at V5; replacement AWAITING LOCK (Bruno greenlight). Byte/marker discipline (full-line; preserve markdown).

### D7 — Result-forward hierarchy; weight demoted (Bruno feedback)
All dimension displays: per-dimension **bar + score/grade leads**; **weight = small secondary mono annotation**. Inverts the current `D{n} · weight%`-first hierarchy. Fixes "weights too small / don't resonate" by leading with the result, not enlarging the weight.

### D8 — Score V2 copy reconciliation preserved
No re-litigation of A1-A19. Layout + flow + the single D6 string only.

### D9 — Homepage scan routing IN-SCOPE (Bruno lock)
Homepage hero `ScanForm` ALSO routes to `/score/[scanId]` (shared `routeOnSuccess` prop). Fixes the "homepage shows the score inline, never takes you to /score" bug. **Boundary:** only the homepage scan-SUBMIT behavior changes (inline → route). Homepage VISUAL/layout/copy + any `ScanResults`→`ScorePanel` refactor stay **Home V2** (I6).

---

## §2 V-reads

**RESOLVED (CLI, against live system / scanner source):**
- **V0 = public-by-id ✓** — no-token GET of `/score/<scan_id>` renders the full score.
- **V1 = anonymous scans persist + retrievable ✓**; `getScanState` on a fresh scan renders EmailGate.
- **V1-sub (MED-1) = SYNCHRONOUS persistence ✓** — `/api/scan` awaits the INSERT before responding (`scanner/src/index.ts` L176-201). Clean `router.push`. (Sibling: INSERT is best-effort try/catch → D3.1 handoff.)
- **V3 = no mobile-menu component ✓** — D5 = one `<Link>`.
- **V6 = `ScanForm` shared with homepage ✓**; its ONLY consumer of `ScanResults` (grep-confirmed) → D6 trim + D9 routeOnSuccess.

**Residual for deploy prompt:**
- **V2 — `/score/[id]` current design** (restyle into score-panel; preserve mechanics verbatim).
- **V4 — /score current layout (`4d643588`):** two-column remnants / empty column + A5 JSON location (to retire).
- **V5 — D6 live string:** exact bytes + line ref (+ sweep for any other stale launch copy now that the ScanResults line is excluded).
- **V7 — V12 live astrant.io scan** for D2 values (inline; no byte-pin).
- **V8 — error/rate-limit states:** where they render, so D3/D9 keep them on the originating page.

---

## §3 Per-component change spec

### §3.1 `src/app/score/page.tsx`
D1 single-column hero; retire A5 JSON; D2 sample panel (ScorePanel §3.7, V12 values, rendered SAMPLE caption + refresh comment). "Six dimensions" strip → result-forward (D7) or folded into the sample-panel rows (hot-class).

### §3.2 `src/components/ScanForm.tsx` — `routeOnSuccess` prop (BOTH surfaces) + sessionStorage stash
`routeOnSuccess?: boolean`. When set: on success, **stash the result in `sessionStorage` (keyed by `scanId`), then `router.push('/score/' + scanId)`** (D3.1). Applied on the /score instance (§3.1) AND the homepage instance (D9). Errors / rate-limit stay inline (V8/OQ-5).

### §3.3 `src/app/score/[id]/page.tsx` — canonical result + server-first hydrate
Score-panel language (D4/D7) via `ScorePanel`. **Render server-first:** `getPublicScan(scanId)` primary; on a server MISS only, hydrate from `sessionStorage` (D3.1) — client-side, after the server attempt. **Preserve verbatim:** EmailGate (+honeypot+token), CTA matrix, narrative gate, token-bound PDF, page-mode.

### §3.4 `src/components/ScanResults.tsx` — unconsumed; deletion deferred (Codex #2)
After D3+D9, `ScanResults` renders nowhere. Do NOT refactor into `ScorePanel` (MED-2 — would couple the homepage visual). Leave in place, unconsumed. **Deploy prompt MUST: grep-confirm zero consumers + note the dead code in the ship-report** (Codex #2 — so it doesn't silently accumulate); actual deletion deferred to Home V2 cleanup.

### §3.5 `src/components/SiteHeader.tsx` — Score nav link (D5)
One `<Link href="/score">Score</Link>`, existing item markup/classNames (Edit-style). No mobile-menu work.

### §3.6 /score live stale string (D6) — locked artifact post-V5
"When the score ships, we'll score ourselves first…" → reconciled (AWAITING LOCK; Bruno greenlight). Audit + byte/marker discipline. (The ScanResults line is NOT touched — dead code.)

### §3.7 `src/components/ScorePanel.tsx` — NEW (built fresh — MED-2)
Composite numeral + grade (`gradeColorClass`); dimension rows (`D{n}` · name · bar · score · weight-annotation, result-forward D7). Consumed by the /score sample panel (D2) AND `/score/[id]` (D4) — single source of truth (demo ≡ real result). Reuses Score V2 helpers (`gradeColorClass`, `dimensionCountPhrase`, `isDim6DemoPreview`, demo-preview card). Built fresh, NOT a `ScanResults` rename.

---

## §4 Architecture invariants preserved

- **I1 Email-flow security** — EmailGate POST/honeypot/token/PDF unchanged; presentational redesign over frozen mechanics.
- **I2 Score V2 copy reconciliation (A1-A19)** preserved (except the single D6 string).
- **I3 Amber discipline** — accent = CTA fill + documented exceptions; grade colors via helper; no new amber.
- **I4 Design substrate** — CSS-var tokens only; radius-free; no new colors; Edit-style className preservation.
- **I5 No scanner change** — synchronous-persistence read + the sessionStorage handoff (vs a scanner persist-await) keep the scanner untouched.
- **I6 Homepage VISUAL/layout = Home V2** — this slice changes the homepage scan-SUBMIT behavior only (inline → route). `/score/[id]` built here is the shared result page Home V2 reuses.
- **I7 Three-way narrative gate + B1 arm-1 unreachability** preserved on `/score/[id]`.

---

## §5 Verification plan

- **Phase 1 — V-reads:** V2/V4/V5/V7/V8 (all gating V-reads already resolved). Idempotency.
- **Phase 2 — Static:** build + typecheck + test clean. Sweeps: A5 JSON removed from /score; no two-column remnant; the D6 live string reconciled (exact, scoped, byte/marker-safe); `<Link href="/score">` present in SiteHeader; `gradeColorClass` single-source; `ScorePanel` is new (not a ScanResults rename); `routeOnSuccess` on both ScanForm instances; **`ScanResults` consumer-grep = 0 (dead-code confirm, Codex #2)**.
- **Phase 3 — Local render matrix:** (a) /score → single-column hero + H1 + sample panel (no JSON/empty column); (b) scan on /score → routes to `/score/[scanId]`, renders; (c) **scan on HOMEPAGE → routes to `/score/[scanId]`, renders** (the reported bug, fixed); (d) fresh anonymous result page renders publicly (no token); (e) emailed token link still renders; (f) errors/rate-limit stay on the originating page, no route; (g) **server-first hydrate: normal scan renders from `getPublicScan`; simulated D1-write-miss falls back to sessionStorage (NOT "Scan not found") — D3.1 acceptance**; (h) Score V2 result cases (demo/absent-Dim-6/A- grade) correct; (i) EmailGate + honeypot byte-identical to baseline; (j) homepage VISUAL unchanged (only submit routes).
- **Phase 4 — Deploy + endpoint:** `npm run cf:deploy`; status+body curls: /score H1 + sample panel (SAMPLE caption visible); a live scan on each surface → route + render; nav link on every page → /score; PDF token-gated; `A-` emerald on the panel.
- **Phase 5 — Ship-report + hot handoff:** screenshots (/score hero+sample; a real `/score/[id]`; homepage→route); ship-report (V-read resolutions, phase marks, locked-content audit, **`ScanResults` dead-code note**, deviations, convergence point, memory-delta); scoped `git add` + HARD HALT; commit (C1); archive. Hot rounds: score-panel typography/bars/spacing, eyebrow, result-page detail, optional D3.1 soft-degradation note.

---

## §6 Out of scope

Homepage hero VISUAL/layout redesign + `ScanResults`→`ScorePanel` refactor + `ScanResults` deletion (**Home V2**) · other V2 pages · Subs V2 Pro-differentiation (shape C) · Score V2 A1-A19 reconciliation · scanner scan logic · pricing.

---

## §7 Open questions — ALL RESOLVED

- OQ-1 MOOT (V0 public-by-id). OQ-2 `Score`. OQ-3 (b) `ScorePanel` fresh; `ScanResults` unconsumed, deletion deferred behind grep gate. OQ-4 keep demo + refresh + rendered SAMPLE. OQ-5 errors stay inline. OQ-6 `routeOnSuccess` both surfaces. OQ-7 retire A5 JSON. **OQ-8 ADOPTED** — sessionStorage handoff, server-first (D3.1). No open questions remain; the only AWAITING-LOCK item is the §3.6 copy string (Bruno greenlight at deploy-prompt time, V5 bytes).

---

## §8 Convergence-pattern note

Round 3 of 3-5 — **final cold round; deploy-prompt-ready.** v2→v3 resolved the last gating unknown (MED-1 = synchronous, clean `router.push`) and adopted the two CLI dispositions: OQ-8 sessionStorage handoff repurposed as best-effort-persist resilience (server-first, reconciling CLI's resilience aim with Codex's "don't hide server consistency"), and the D6 dead-code trim (the ScanResults line goes dark under D9, so reconciling it was wasted work — inverse of Score V2's B1, where a falsehood rendered always). Net arc: V0 collapsed the architectural risk early, Codex's homepage-routing correction made the slice fix both reported bugs, and the residual was implementation-resilience, not direction. Remaining: V2/V4/V5/V7/V8 V-reads + the one §3.6 copy lock → deploy prompt v1. Carry-forward from Score V2: lock copy against V-read literal bytes incl. markdown markers; scope zero-sweeps to exact strings; grep dead code before relying on its removal.
