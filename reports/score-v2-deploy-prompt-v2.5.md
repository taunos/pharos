# Score V2 Redesign — Deploy Prompt v2.5 (EXECUTION-READY)

**Target repo:** `F:\pharos\` — primarily `marketing-site/`. `scanner/` READ-ONLY (grep only).
**Frozen source spec:** Score V2 spec v4. STANDALONE — every locked artifact inlined; do not consult the spec at execution.
**Supersedes v2.4.** Folds CLI v2.4 review (1 MED + 1 LOW — markdown-marker preservation on A11/A19) + Codex's `upcoming release` sweep note. Marker-preservation audit now complete across all 5 score.md/llms.txt artifacts. **No HIGH/architecture outstanding — execution-ready.**
**No schema migration. No scanner edits. No push.**

### Changelog v2.4 → v2.5
- **A11 — prepend `- ` (CLI MED).** `score.md:12-17` is a 6-item bullet list (`- **llms.txt Quality** (15%) — …`). A11 lacked the leading `- `, so verbatim replacement of line 17 would drop the bullet and break the list (6th dimension renders as a loose paragraph). Fixed.
- **A19 — bold the FAQ question (CLI LOW).** Sibling FAQ questions are bold (`**…?**`); A19's `Is the Score live?` lacked `**`. Now `**Is the Score live?**`.
- **`upcoming release` sweep scoped (Codex note).** Legal/robots copy legitimately contains "upcoming release"; the sweep targets the Dim-6/Score context only — ENUMERATE and classify hits, do NOT bare-fail or touch out-of-scope occurrences.
- **Marker-preservation audit (all 5 public-doc artifacts):** A11 (bullet ✓ now), A12 (plain paragraph ✓), A13 (list-item + link ✓), A18 (`**Status:**` bold ✓), A19 (bold question ✓ now). Every locked artifact now matches its target line's markdown structure.

### Scope line (per Bruno's "whole /score PAGE, not site-wide" lock)
**Renamed to "Astrant Score" this slice:** rendered `score/page.tsx` only (H1 + `<title>` + its two page-level JSON-LD `name` fields). **Deferred (stay current naming):** `layout.tsx:84` root Offer (Bruno-confirmed), `llms.txt` link label, `score.md` title/H1.

### Bruno lock dispositions
OQ-1 real V12 JSON. OQ-5 A3/arm-1 comment/arm-3 suppress. OQ-6 "3"→"4". OQ-7 `layout.tsx:89` NO-OP + `layout.tsx:84` NO-OP (deferred). OQ-8 8a. §3.4 value-leads (A4). HERO: H1 `Your Astrant Score`; title+JSON-LD names canonical `Astrant Score`; whole /score page; site-wide deferred. A19 = REPLACE (locked). A12 = full literal (Bruno confirm via V10). A17 body + A16a descriptor + A18 CTA hot-round-tunable.

---

## Inline constraints (C1–C10)
**C1** no attribution (Bruno author). **C2** no push. **C3** Git Bash + Windows-portable (no `/tmp`, `2>/dev/null`, process substitution; run from `marketing-site/`). **C4** `npm run cf:deploy`. **C5** status+body curls, Node regex for minified HTML, no `-i` byte-diffs on CF, `--max-time` on SSE. **C6** TODO.md local. **C7** grep-verify locked constants. **C8** pseudocode illustrative, §LOCKED exact (INCLUDING surrounding markdown markers — list `- `, bold `**`, links); V-read wins on conflict. **C9** `&apos;` in JSX text. **C10** rendered text outside §LOCKED → HARD HALT.

---

## §LOCKED — content artifacts (verbatim, markers included; only authorized rendered-text changes)

**A1 — `score-display.ts` (NEW).** `gradeColorClass` is `if/startsWith` (NOT a switch — `A-`/suffix grades live):
```ts
export const DIM6_DEMO_SUBCHECK_ID = "free_tier_dim6_preview";
export function applicableDimensionCount(applicable: number | undefined, scored: number): number {
  return applicable ?? scored;
}
export function dimensionCountPhrase(applicable: number | undefined, scored: number, total: number): string {
  return `${applicableDimensionCount(applicable, scored)} of ${total}`;
}
export function gradeColorClass(grade: string): string {
  if (grade.startsWith("A")) return "text-emerald-400";
  if (grade.startsWith("B")) return "text-emerald-300";
  if (grade === "C") return "text-yellow-400";
  if (grade === "D") return "text-orange-400";
  return "text-red-400";
}
export function isDim6DemoPreview(dim: { sub_checks?: { id: string }[] }): boolean {
  return dim.sub_checks?.some((sc) => sc.id === DIM6_DEMO_SUBCHECK_ID) ?? false;
}
```

**A2 — Demo-preview card line:** `Demo preview — live with $79 Audit` (numbers from imported `DIM6_DISCLOSURE.freeTierPreview`).

**A3 — Narrative arm-2 (value-leads):** `Citation Visibility runs live across 4 AI models with the $79 Audit. Below is a static demo preview of that check.` (+ imported `freeTierPreview`. Arm1 comment-only. Arm3 suppress.)

**A4 — EmailGate line (value-leads):** `Your full report: predicted lift per gap, remediation paths, and your score across {dimensionsLine} dimensions.` (ALT count-leads if flipped: `{dimensionsLine} dimensions analyzed. Predicted lift per gap. Remediation paths.`)

**A5 — /score code-block JSON** (REAL V12 into `<live>`; Dim 6 exactly as shown):
```json
{
  "url": "astrant.io",
  "score": <live>,
  "grade": "<live>",
  "view": "abridged",
  "dimensions": {
    "llms_txt":   { "score": <live>, "weight": 15 },
    "mcp_server": { "score": <live>, "weight": 20 },
    "openapi":    { "score": <live>, "weight": 10 },
    "jsonld":     { "score": <live>, "weight": 20 },
    "parsable":   { "score": <live>, "weight": 15 },
    "citation":   { "demo_preview": true, "note": "live with $79 Audit" }
  },
  "next": "Run the $79 Audit for prioritized gaps"
}
```

**A6 — /score metadata description (`:11`):** `Free Astrant Score: six dimensions of AI-agent discoverability — five scored live, plus a Citation Visibility demo preview. Citation Visibility runs live across 4 AI models with the $79 Audit.`

**A7 — /score FAQ Citation Q&A (`:42-43`):** Q `Does the free Score check Citation Visibility?` A `The free Score includes a static demo preview of Citation Visibility (dimension 6). The live check — your brand probed across 4 AI models — runs with the $79 Audit.`

**A8 — /score FAQ #1 (`:39`)** — replace the FULL phrase `a public grade across the dimensions we currently cover` → `a public grade across six dimensions`.

**A9 — ScanForm.tsx:84:** `Six dimensions. Citation Visibility appears as a demo preview on the free Score — live with the $79 Audit.`

**A10 — AuditCheckoutForm.tsx:76** (replaces "gives you 5 of 6 dimensions immediately"): `Includes the live Citation Visibility audit across 4 AI models — shown as a demo preview on the free Score.`

**A11 — public/score.md line 17 (BULLET ITEM — keep the leading `- `):** `- **Citation Visibility** (20%) — Static demo preview on the free Score; the live audit of where you're cited across ChatGPT, Claude, Perplexity, and Gemini runs with the $79 Audit.` (This is the 6th item of the score.md:12-17 bullet list; the `- ` prefix is mandatory or the list breaks.)

**A12 — public/score.md line 6 — FULL LITERAL replacement line** (plain paragraph, no marker; V10-confirm nothing material dropped — rewords value props, Bruno confirm): `A URL-input scan across 6 dimensions — dimensions 1–5 scored live; dimension 6 (Citation Visibility) is a static demo preview on the free tier, live across 4 AI models with the $79 Audit. Public score on screen, detailed gap report to your inbox, monthly auto-rescan so you can watch your score improve.`

**A13 — public/llms.txt:7 — FULL list item, PRESERVING the markdown marker + link** (label stays current per the deferral): `- [Agent Discoverability Score](/score.md): Free. URL-input scan across 6 dimensions — dimensions 1–5 scored live; dimension 6 (Citation Visibility) is a static demo preview on the free tier and runs live across 4 AI models with the $79 Audit. Live now at astrant.io/score.`

**A14 — SixDimensions.tsx:30-35 (OQ-8a; field split).** `{ name, weight, description }`. ONLY: `name` `Citation Visibility & Monitoring`→`Citation Visibility`; `weight` `20%` UNCHANGED; `description` `Live audit of where you're cited across ChatGPT, Claude, Perplexity, Gemini.`→`A static demo preview on the free Score; the live audit of where AI models cite you runs with the $79 Audit.` Preserve every className; homepage untouched (I13).

**A15 — score-pdf-template.ts** "ships in an upcoming release" suffix → `Citation Visibility ships as a static demo preview on the free Score and runs live with the $79 Audit.`

**A16 — /score "Astrant Score" rename — WHOLE PAGE (4 instances; Bruno-confirmed).** H1 = possessive `Your Astrant Score`; `<title>` + JSON-LD `name` = canonical `Astrant Score`:
- **A16a — H1** (`:99-101`): `Agent Discoverability Score` → **`Your Astrant Score`**. PLUS descriptor under the H1: `An agent-discoverability rating across six dimensions.` (descriptor/eyebrow/slotting hot-class; suggested eyebrow `FREE · NO SIGNUP`.)
- **A16b — `<title>`** (`:9`): full title → **`Astrant Score — Free AI Discoverability Check`** (V10-confirm; avoids "Astrant Score — Astrant"; Bruno-tunable keywords).
- **A16c — JSON-LD Service `name`** (`:20`): → `Astrant Score`.
- **A16d — JSON-LD Offer `name`** (`:27`): → `Astrant Score`.
(c/d mechanical term-swaps; preserve other fields. Page-level only — GLOBAL `layout.tsx:84` Offer DEFERRED.)

**A17 — /score HERO BODY (`:102-108`; hot-round-tunable):** `A live, public score — no signup. Five dimensions are scored live; Citation Visibility (dimension 6) is a static demo preview on the free Score, and runs live across 4 AI models with the $79 Audit. Content-only sites have OpenAPI auto-marked N/A.`

**A18 — public/score.md line 4 — FULL-LINE replacement (keep `**Status:**` bold):** `**Status:** Launching soon — join waitlist at https://astrant.io/score` → `**Status:** Live — run it free at https://astrant.io/score` (drop "join waitlist"; CTA Bruno-tunable).

**A19 — public/score.md lines 36-37 — launch FAQ (Bruno-locked: REPLACE; keep the bold question marker):** `When does the Score launch?` / `Soon... you'll be among the first to run it the day it ships.` → Q `**Is the Score live?**` A `Yes — it's live now. Run it free at https://astrant.io/score, no signup required.` (Match the sibling FAQ markdown — bold question.)

---

## Step 0 — V-reads + idempotency (FIRST; verify-and-fill-gaps)
0.1 **V10 verbatim (capture surrounding markdown markers too):** `score/page.tsx:9,11,20,27,39,42-43,99-101,102-108`; `ScanForm.tsx:84`; `AuditCheckoutForm.tsx:76`; `SixDimensions.tsx:30-35`; `layout.tsx:84,89`; `score.md:4,6,12-17,36-37`; `llms.txt:7`; `score-pdf-template.ts:5,249`; `score-email.ts:116,138,198,321`; `EmailGate.tsx:115`; both `gradeColor*` impls. Confirm A11 lands inside the :12-17 bullet list with the `- ` marker; confirm A19's sibling FAQ questions are bold. Capture A12 original value-prop wording (confirm locked A12 drops nothing material).
0.2 **V12 live scan** astrant.io → 6 dim scores + overall for A5 (inline; no byte-pin).
0.3 grep `free_tier_dim6_preview` BOTH producers (scanner READ-ONLY). 0.4 grep `sub_checks` 3 sites. 0.5 grep `SixDimensions` → exactly two consumers; third → HALT. 0.6 grep `results_json` writer in `score-scanner-client.ts` → none; writer → HALT. 0.7 confirm both `gradeColor*` use `startsWith("A")/("B")`+`==="C"/"D"`; `A-` real. 0.8 NO-OP: JetBrains Mono wired; tokens present.
0.9 **Honeypot baseline (stateless):** curl ONE honeypot-populated POST `{scan_id:<any>,email:<throwaway>,opt_in_rescan:false,referral_code:"x"}` to `/api/score/capture-email`; record status+body bytes — the only byte-baseline Step 13 diffs against.
0.10 **Stale Score-status check (SCOPED — EXACT strings, score.md + llms.txt ONLY):** grep for `Launching soon`, contiguous `join waitlist`, `When does the Score launch` — confirm only at score.md:4/36-37 + llms.txt:7. **Do NOT bare-grep `waitlist`/`Soon`/`launch` across `public/`** — `score.md:29` "no waitlist", `privacy.md`/`terms.md` "pre-launch waitlist" (CURRENT, legally-relevant), `audit.md` "not-yet-launched" are out of scope (do not touch). EXACT-string hit outside the A18/A19/A13 lines → HALT.

---

## Step 1 — Helper + tests
- Write `score-display.ts` per **A1**.
- **Test runner:** if no `test` script / vitest|jest dep, add **vitest** devDep + `"test": "vitest run"` — updates BOTH `package.json` + `package-lock.json` (both explicit `git add` paths, Step 14). Run `npm run test` from `marketing-site/`.
- `score-display.test.ts`: `dimensionCountPhrase` (incl. undefined `applicable` → `scored`), `applicableDimensionCount`, `gradeColorClass` (**incl. `("A-") === "text-emerald-400"`** + A,B,C,D,F), `isDim6DemoPreview` (true on real `{sub_checks:[{id:DIM6_DEMO_SUBCHECK_ID}]}`; false on a wrong shape whose key is built at RUNTIME as `"sub"+"checks"`). No placeholder assertions.

## Step 2 — `ScanResults.tsx`
Hero D7 + count via helper; D6 row mapping (demo card A2 before generic `na`; daily-cap + true-N/A → grey N/A); delete local `gradeColor`, import `gradeColorClass`; keep `ScanResultData` + $79 badge; EmailGate mount → `dimensionsLine`. Row comment per L1.

## Step 3 — `score/[id]/page.tsx`
Hero D7 + count swap :232 (copy :232-235 already reconciled — leave); **delete local `gradeColorClass` :49-55, import from `score-display` (M1)**; breakdown D6; CTA matrix :113-189 BYTE-PRESERVED; three-way narrative gate (arm1 unreachable → comment-only; arm2 → A3 + imported `freeTierPreview`; arm3 → suppress); no page-mode directives; EmailGate mounts :129/:188 → `dimensionsLine`.

## Step 4 — `EmailGate.tsx`
Delete :115 literal; add `dimensionsLine: string` prop; render **A4** (`&apos;`-safe). Form mechanics BYTE-PRESERVED (field names, honeypot `name="website_url_2"` hidden, POST `{scan_id,email,opt_in_rescan,referral_code?}` → `/api/score/capture-email`, server-side opt-in equality). Preserve every className.

## Step 5 — `score/page.tsx` (Beam V2 + Astrant Score whole-page rename)
Two-column hero + code block (label `example · astrant.io self-scan`, body A5 w/ V12) + 6-col strip (D1–D6 / 15·20·10·20·15·20). **A16a (H1 + descriptor), A16b (full title), A16c/d (JSON-LD names), A17 (hero body).** Metadata :11 → A6. FAQ#1 :39 → A8. FAQ Q&A :42-43 → A7. REMOVE `SixDimensions` import/usage (strip replaces it; component stays). Any other rendered text on /score not covered by A6/A7/A8/A16/A17 → HALT (C10).

## Step 6 — Forms
`ScanForm.tsx:84` → A9 (leave `:93 animate-pulse`). `AuditCheckoutForm.tsx:76` → A10.

## Step 7 — PDF + audit pipeline
`score-pdf-template.ts`: :249 phrase + comparison → helpers; suffix → A15; :5 comment mechanical; keep existing visual (no ASCII bars). `audit-pipeline.ts:781`: phrase + comparison → helpers.

## Step 8 — Email
`score-email.ts:116,138,198` count phrase → helper. `:321` "3 major-model APIs" → "4" (OQ-6). Only email rendered-text change; security wiring untouched.

## Step 9 — Public docs
`score.md`: :4 → A18 (full line, bold preserved), :6 → A12 (full literal), :17 → A11 (bullet `- ` preserved), :36-37 → A19 (replace, bold Q). `llms.txt:7` → A13 (preserve list+link). Audit-discipline check on A11/A12/A13/A18/A19 (no dated language, no causal speculation, neither narrower nor broader than truth, lift-in-isolation).

## Step 10 — SixDimensions + JSON-LD NO-OP
`SixDimensions.tsx:30-35` → A14 (name + description; weight untouched; classNames preserved; homepage untouched). `layout.tsx:89` → NO-OP (OQ-7). **`layout.tsx:84` root Offer `name` → NO-OP (deferred site-wide, Bruno-confirmed; do NOT rename).**

## Step 11 — Static verification (Phase 1–2)
- `npm run build` + `npm run typecheck` + `npm run test` (marketing-site/) clean.
- **ZERO-sweeps (source-only; ENUMERATE + classify, don't bare-fail; 0 unless noted):**
  - `"5 of 6 dimensions analyzed"` = 0 SOURCE. **GUARD: never a rendered-DOM/Phase-4 assertion.**
  - `"of 6 dimensions immediately"` = 0.
  - **`"upcoming release"` in the Dim-6/Score context = 0** (A15 + A17 remove the slice's occurrences). ENUMERATE hits and classify — legal/robots copy elsewhere legitimately contains "upcoming release" and is OUT of scope (do NOT fail on or touch it).
  - **Stale Score-status (EXACT, scoped to `score.md` + `llms.txt`):** `"Launching soon"` = 0; contiguous `"join waitlist"` = 0; `"When does the Score launch"` = 0 AND A19 Q/A present. Do NOT sweep bare `waitlist`/`Soon`/`launch` across `public/` (current legal/product copy out of scope).
  - `"Agent Discoverability Score"` = 0 **in `score/page.tsx`** (4 renamed). Legitimately persists in `layout.tsx:84` (deferred), `llms.txt:7` label, `score.md` title — OUT of scope; do NOT assert absence repo-wide or there.
  - raw `dimensions_applicable ??` = 0 OUTSIDE `score-display.ts`.
  - `subchecks` (no underscore) = 0 in `score-display.ts` + test.
  - `Citation Visibility & Monitoring` = 0 (A14).
  - `Beam|Survey|Pulse|Crew` = 0 in slice-touched files (case-sensitive; `animate-pulse` ok); `Bespoke`/`Build` context-scoped in slice files; `$99`/`$1,499` = 0 in slice files.
  - **Dup grade-def (M1, SCOPED):** 0 local `gradeColorClass`/`gradeColor` in `ScanResults.tsx` + `score/[id]/page.tsx`; `score-display.ts` owns the React Score result-surface helper. **Leave `audit-pipeline.ts:632`, `score-pdf-template.ts:77`, `AuditResultsPoller.tsx:33` untouched and uncounted.**
- A5 JSON: structural assert only (keys + `"demo_preview": true`); no byte-pin; no "6 of 6" anywhere (L2).
- **Markdown-structure check (NEW):** after A11/A13 edits, the score.md:12-17 list still renders as 6 bullets and the llms.txt service list is intact (no loose paragraphs / broken markers).
- grep-verify `DIM6_DEMO_SUBCHECK_ID = "free_tier_dim6_preview"` (C7).

## Step 12 — Deploy
`npm run cf:deploy` from `marketing-site/`. Record Worker version id.

## Step 13 — Endpoint verification (Phase 3–4)
Status+body (C5); Node regex for minified HTML.
- Render matrix: (a) free demo → demo card; (b) live-Dim-6 → scored row (SYNTHETIC/defensive); (c) v1.1.0-era → fallback count; (d) true-N/A non-Dim-6 → grey N/A, no false demo; (e) score/[id] happy/expired/missing token; (f) `dimensionsLine` at all THREE mounts; (g) daily-cap → grey N/A + cap note, no demo, narrative suppressed; (h) demo → arm-2; (i) **Dim-6-absent legacy → no measured-narrative, no demo card, count correct (B1/H2)**.
- Live curls: /score H1 = "Your Astrant Score" + descriptor (A16a); `<title>` = A16b (no double "Astrant"); **page-level JSON-LD Service+Offer `name` = "Astrant Score" — PAGE-level block ONLY; do NOT assert "Agent Discoverability Score" absent from whole DOM (global layout Offer carries it by design)**; hero body (A17); 6-col strip; demo string on a live free scan; A6/A7/A8 at /score; A11/A12/A18/A19 in score.md (6-bullet list intact, A19 Q/A present, no stale status); A13 in llms.txt (list+link intact); A14 on homepage; A4 on a result surface; PDF link token-gated; legacy Dim-6-absent token link → no measured-narrative; **`A-` scan grade badge emerald (NOT red) on BOTH surfaces**.
- **Email-gate (M3):** honeypot POST → status+body **byte-identical to Step-0.9 honeypot baseline** (security-critical). Happy-path POST with a **FRESH scan_id** → STRUCTURAL assert (status 200 + `{success, deferred, results_url, pdf_url}`); no byte-diff (stateful route).
- **Client POST-shape (hot rounds):** ONE real browser submit; confirm network tab shows the client POSTs `{scan_id,email,opt_in_rescan,referral_code?}` with the honeypot field intact.

## Step 14 — Ship-report + commit + archive
- Ship-report: V-read resolutions (V10/V12 + honeypot baseline + A12 value-prop confirm + A11/A19 marker confirm), Phase 1–5 PASS/FAIL, locked-content audit (A1–A19 verbatim incl. markers), deviations, sweep data points, convergence (**4 cold spec rounds + 7 deploy-prompt rounds v1→v2.5; every deploy defect was a literal-bytes / markdown-marker / sweep-scope mismatch at the reconciliation edge — NONE architectural; spec right at v4**), **memory-delta block** (proposed; Bruno greenlights):
  1. Hero "Your Astrant Score" whole-/score-page lock + DEFERRED site-wide metric pass (`layout.tsx:84` + `llms.txt` label + `score.md` title flip together there).
  2. **Candidate feedback memory:** "Copy-reconciliation slices: lock artifacts against V-READ LITERAL BYTES INCLUDING surrounding markdown markers (list `- `, bold `**`, links) — full-line replacements over substring swaps; and scope EVERY zero-sweep to exact strings + exclude known-legitimate occurrences from the start (over-broad-bare-term class: `Bespoke`, `waitlist`, `upcoming release`). The arc: spec right at v4; 7 deploy rounds were ALL byte/marker/sweep-scope. Carry into Home V2."
- `git add` EXPLICIT paths only (incl. `package.json` + `package-lock.json`); HARD HALT on anything outside the touched set. No `git add -A`. TODO.md + `.claude/settings.json` unstaged.
- Commit, Bruno author, NO attribution (C1). Suggested: `feat(score): Score V2 redesign — Your Astrant Score hero, count helper, Dim-6 demo-preview discriminator, Class-2 narrative reconcile`.
- No push (C2). Archive deploy prompt + spec v4 with the ship-report.
- HOT rounds (operator): both result surfaces + /score; watch arm-2 narrative vs demo-card repetition; tune hero eyebrow/slotting + A16a descriptor + A17 typography + A18 CTA; do the real client-submit network check.

---

## Folded from spec §9 + §C
L1 row comment (Step 2). L2 "5 of 6" cap, no "6 of 6" (A5/Step 11). Guard-note: 5-of-6 sweep source-only (Step 11). §3.4 value-leads (A4). Fixture (b) defensive both surfaces (Step 13). §C count-expression sites = 7 phrase + 3 comparison (Steps 2/3/7/8).
