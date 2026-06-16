# Score V2 Redesign — Spec v4

**Date:** 2026-06-12
**Supersedes:** spec v3. Integrates round-3 review: CLI round-3 (`score-v2-spec-v3-review-2026-06-12.md`: 1 new MED — B1, scope-reducing) + Codex round-3 (no new spec implementation blocker; 1 NIT on test wording — NIT-4). All absorbed.
**Tier projection:** Hybrid visible-surface — 5-7 cold spec rounds + 1-2 deploy-prompt rounds; hot sub-rounds post-deploy (est. 3-5, not counted).
**Round tracker:** v1 → CLI (1H/8M) → v2 → CLI (1H/2N) + Codex (3H) → v3 → CLI round-3 (1 MED scope-reducing) + Codex round-3 (1 NIT) → **v4 (this document; round 4 — FINAL cold round)** → CLI + Codex final pass: BOTH CONVERGED, "no new blocker; ready for deploy-prompt drafting after Bruno locks." CLI final pass added 3 deploy-prompt-absorbable items (L2 + guard-note + §3.4 lock-consideration) — all in §9, no v5.
**Repo baseline:** main `84bd00c` working tree. V-reads remain current-branch-state at edit time.

---

## §0 Scope

Unchanged from v2 except the D6 (B1 reachability reduction) and D11 (SixDimensions survives) revisions — see below. One slice, four workstreams, primary surface `marketing-site/` (`scanner/` grep-only, READ-ONLY):

1. **Visual redesign to the Beam V2 pick** (`artboards-1.jsx:297-345`): pre-scan /score page + BOTH result surfaces co-equally (`ScanResults.tsx` inline "use client"; `score/[id]/page.tsx` server token link).
2. **Class-1 count-helper extraction** — 7 phrase sites + 3 comparison sites + EmailGate literal deletion.
3. **Class-2 Dim-6 narrative reconciliation** to D9, both staleness polarities.
4. **Demo-preview discriminator helper** — `sub_checks` id sniff → demo-preview card distinct from grey N/A. No scanner change.

Cold/hot split unchanged: this spec locks architecture/state-mapping/rendered-text; hot sub-rounds absorb aesthetics post-deploy.

---

## §1 Locked decisions

### D1 — Layout: Beam V2 artboard, tier names and prices translated
Unchanged. Two-column hero + labeled code block + 6-column dimension strip (codes/weights `artboards-1.jsx:242-249`, zero drift vs `scanner/src/scoring.ts:26-33`). Zero handoff names/prices; current ladder only: Score (free) / Audit ($79) / Implementation ($1,299) / Custom (from $4,999) / Standard ($149/mo) / Pro ($899/mo).

### D2 — Hero headline keeps the Bruno-adjudicated wording
Unchanged: artboard typography, existing "Is your site findable" wording.

### D3 — Class-1 helper: `score-display.ts`, two count primitives
Unchanged from v2: `applicableDimensionCount(applicable, scored)` + `dimensionCountPhrase(applicable, scored, total)`; 7 phrase sites (`ScanResults.tsx:173`, `score/[id]/page.tsx:232`, `score-pdf-template.ts:249`, `audit-pipeline.ts:781`, `score-email.ts:116/138/198`) + 3 comparison sites (`score/[id]/page.tsx:237`, `score-pdf-template.ts:249`, `audit-pipeline.ts:781`); raw `??` reaches zero outside the helper. EmailGate (`src/components/score/EmailGate.tsx`) :115 literal deleted → required `dimensionsLine` prop at THREE mounts (`score/[id]:129`, `:188`, `ScanResults.tsx:185`). Class 1/2 never unified.

### D4 — gradeColor consolidation
Unchanged: byte-identical maps confirmed; single export, both call sites migrate.

### D5 — Demo-preview discriminator (FIELD NAME CORRECTED — Codex H1)
The schema field is **`sub_checks`**, NOT `subchecks` — verified at `ScanResults.tsx:16`, `audit-types.ts:17`, `scanner/src/types.ts:34`. v2's illustrative type would, implemented literally, make every demo preview fall through to grey N/A (the sniff never matches). Corrected contract:

```ts
// Shape is now LOAD-BEARING (sweep #34: spec-time V-read of code shapes), not merely illustrative
export const DIM6_DEMO_SUBCHECK_ID = "free_tier_dim6_preview";

export function isDim6DemoPreview(
  dim: { sub_checks?: { id: string }[] }
): boolean {
  return dim.sub_checks?.some(sc => sc.id === DIM6_DEMO_SUBCHECK_ID) ?? false;
}
```

Two producers of the constant, both grep-verified at deploy time, scanner READ-ONLY: `scanner/src/checks/dim6-citation.ts:62` + `marketing-site/src/lib/dim6/runDim6.ts:162` (`buildFreeTierDim6()`); parity-by-convention, capability-separated.
Demo-card copy IMPORTS `DIM6_DISCLOSURE.freeTierPreview` (no paraphrase; MCP byte-mirror untouched — I11). Bruno-locked card line: "Demo preview — live with $79 Audit".

### D6 — State-to-UI mapping (REVISED: three-way narrative gate — CLI H2 / Codex H2 convergent)

**Per-dimension row mapping** (applies to dimensions PRESENT in the scan; an absent dimension renders no row — benign):

| State | Detection | UI |
|---|---|---|
| Scored (incl. live Dim 6) | `!na` | Bar row: mono code + name + ASCII bar + score + weight. No tier check (`tier` optional/absent from `ScanResultData`) |
| Dim-6 demo preview | `na === true` && `isDim6DemoPreview(dim)` | Demo-preview card + Bruno-locked line + imported disclosure constant |
| Dim-6 daily-cap exceeded † | `na === true`, sub-check `dim6_daily_cap_exceeded` (`runDim6.ts:187`) | Grey N/A row with its existing notes text |
| True N/A (any other) | `na === true`, no special sub-check | Grey N/A row, existing semantics |

† **Documentation row — no code branch** (N3): the cap state intentionally falls through the generic N/A branch; listed so the fall-through reads as designed, not accidental. Demo-preview check ordered BEFORE generic `na` (early-precedence).

**Narrative gate (THREE-WAY structure; TWO reachable arms on this surface — H2 + B1):** the transparency narrative (`score/[id]/page.tsx:308-416`) keys off `scan.dimensions.find(d => d.dimension_id === 6)`:

1. Dim 6 present && `!na` → measured narrative. **STRUCTURALLY UNREACHABLE on `score/[id]` (B1):** the page renders the scanner's persisted `results_json` via `getPublicScan` → scanner `/api/scan/:id`; the scanner's own `runDim6` ALWAYS returns `na:true` (no API keys, capability-separation invariant), and the scored/paid Dim 6 produced by `splicePaidDim6` in the marketing-site audit pipeline is NEVER written back into the scanner record. Empirically: 0/58 scored Dim 6 in `scans`. **Therefore arm 1 renders no copy this slice** → retained ONLY as an explicit defensive no-op with a one-line comment ("unreachable today; scanner public record never carries a scored Dim 6 — see capability-separation invariant; a future slice that persists paid Dim 6 to the public record lights this up"). **No measured-narrative copy is locked this slice.**
2. Dim 6 present && `isDim6DemoPreview(dim6)` → demo-state variant (imported disclosure constants + upsell; suppression-with-substitute). **Arm 2 — reachable; the only arm whose copy needs a Bruno lock (OQ-5).**
3. **Dim 6 ABSENT, or `na` without the demo sub-check (incl. daily-cap)** → narrative SUPPRESSED (OQ-5 arm-3 = suppress, CLI-endorsed). **Arm 3 — reachable, majority path.**

**Net rendered effect (B1):** the "How Dim 6 was measured for your domain" measured-narrative block is REMOVED from `score/[id]` rendered output for every reachable state — arm 1 dead-scaffolded, arm 2 substitutes the demo variant, arm 3 suppresses. The §3.3 task is therefore a DELETION + defensive-comment, not a copy reconciliation.

**Architectural confirm (B1 caveat answered):** Cowork confirms no marketing-site path writes a re-scored `results_json` back to the scanner record — checked `captureEmail`, `markPdfGenerated`, `getScanState`, `getPublicScan` in `score-scanner-client.ts` (none mutate `results_json`); `splicePaidDim6` output flows only to audit PDF / corpus / audit-fulfill response. Arm-1 unreachability holds against current architecture. Deploy-prompt Phase 1 re-greps `results_json` writers as belt-and-braces; if one surfaces, arm 1 returns and its copy lock reopens.

Production reality makes arm 3 the MAJORITY path (CLI empirical, scanner D1 2026-06-12): 58 scans total; 18 carry `free_tier_dim6_preview`; ~40 (69%) predate Slice 3b and have NO Dim-6 entry; 34 lack `dimensions_applicable`; 0 live-Dim-6 rows. A two-way gate defaulting to "measured" would have rendered "How Dim 6 was measured for your domain" falsely on the majority of existing token links.

### D7 — Result-surface visual vocabulary
Unchanged: ASCII bars, mono captions, radius-free, CSS-var tokens; `score/[id]` large-numeral hero; sizes hot-class. ScanResults hero :161-176.

### D8 — Self-scan example JSON must not contradict Dim-6 truth
Unchanged; shape per OQ-1 (real values + `"view": "abridged"` display projection — CLI endorses lock as proposed).

### D9 — Class-2 narrative formula (Bruno-locked anchor)
> "6 dimensions; Dim 6 (Citation Visibility) static demo preview on free Score; live 4-model audit with $79 Audit."

Both polarities reconciled (narrower: "5 of 6"/"upcoming release"/"Launching soon"; broader: unqualified "live audit" as free capability).

### D10 — EmailGate redesign is presentational-only
Unchanged; form mechanics byte-preserved (I1).

### D11 — SixDimensions.tsx: NOT an orphan — REVISED (Codex H3; V11 gate fired early)
Codex grep found a second consumer: **homepage imports and renders it (`src/app/page.tsx:5`)**. v2's delete-after-grep gate worked as designed — the HALT clause triggers, disposition goes to Bruno (OQ-8). The /score usage is still replaced by the D1 dimension strip regardless of OQ-8's outcome.

**Recommended disposition (OQ-8a):** KEEP the component; apply the Class-2 copy fix INSIDE the shared component in-slice (one locked artifact: ":31-35" unqualified "Live audit of where you're cited…" + "Citation Visibility & Monitoring" name drift → D9-reconciled "Citation Visibility"); homepage inherits the corrected copy with zero homepage layout changes; component deletion deferred to the Home V2 slice (next in the V2 queue — short window). This keeps the broader-than-truth claim from surviving on the homepage while respecting the scope wall on homepage layout.
**Alternative (OQ-8b):** leave component byte-untouched (homepage keeps stale copy until Home V2); /score drops the import. Cheaper, but ships a slice that knowingly leaves a Class-2 falsehood live on the highest-traffic page.

---

## §2 V-reads — resolutions + residuals

**Resolved rounds 1-2:** V2/V3/V5/V6/V7/V8/V9, L5 (weights), §C verbatim captures, H2 empirical priors (N4), Codex field-name V-read (`sub_checks`), Codex consumer-grep (V11 → CLOSED: consumers = /score + homepage, no others reported; deploy prompt re-greps as belt-and-braces).

**Residual for deploy prompt:**
- **V10 — Verbatim current-copy capture:** `score/page.tsx:11/:39/:42-43/:105`; `ScanForm.tsx:84`; `AuditCheckoutForm.tsx:76`; `SixDimensions.tsx:31-35`; `layout.tsx:89`; `score.md` lines 6+17; `llms.txt:7`; `score-pdf-template.ts:5/:249` suffix; `score-email.ts:321`.
- **V12 — Live astrant.io scan pull** for §3.5 values (deploy-prompt-time; time-varying, no byte-pin).

---

## §3 Per-file change spec

Rendered-text artifacts **AWAITING LOCK** unless marked Bruno-locked.

### §3.1 `src/lib/score-display.ts` — NEW
`DIM6_DEMO_SUBCHECK_ID`, `applicableDimensionCount`, `dimensionCountPhrase`, `gradeColorClass`, `isDim6DemoPreview` (on `sub_checks` — D5). Pure, zero imports, client-safe; per-branch + cross-contamination unit tests, production enum values, **including a real-schema-shape regression test (Codex NIT-4):** assert `isDim6DemoPreview` returns true on a real-shaped `{ sub_checks: [{ id: DIM6_DEMO_SUBCHECK_ID }] }` fixture and false on a wrong-shaped object whose key is built at runtime as `"sub" + "checks"` — so the literal misspelling token never appears in source and does NOT trip the Phase-2 `subchecks`=0 sweep. (The earlier "`subchecks`-misspelling regression guard" wording contradicted that sweep; this phrasing resolves it.)

### §3.2 `src/components/ScanResults.tsx`
Unchanged from v2: hero :161-176 → D7; D6 row mapping; $79 badge retained; local `gradeColor` → import; `ScanResultData` stays; EmailGate :185 gets `dimensionsLine`. (Local type at :16 already declares `sub_checks` — no type edit needed.)

### §3.3 `src/app/score/[id]/page.tsx`
- Hero :231-240 → D7; count swap at :232 (narrative at :232-235 already D9-reconciled — copy untouched there).
- Dimension breakdown :245-294 → D6 row mapping.
- CTA matrix :113-189 logic byte-preserved; restyle only.
- Transparency narrative :308-416 → **gate per D6; net effect is DELETION of the measured-narrative block (arm 1 unreachable — B1), NOT reconciliation.** Arm 1 kept as a commented defensive no-op; arm 2 renders the demo-state variant (only copy lock needed — OQ-5); arm 3 suppresses. No "measured" copy locked or reconciled this slice.
- No page-mode directives added. EmailGate :129/:188 get `dimensionsLine`.

### §3.4 `src/components/score/EmailGate.tsx`
Current :115: `5 of 6 dimensions analyzed. Predicted lift per gap. Remediation paths.`
**Proposed (AWAITING LOCK):** `{dimensionsLine} dimensions analyzed. Predicted lift per gap. Remediation paths.`
Form mechanics byte-preserved.

### §3.5 `src/app/score/page.tsx`
- Layout per D1/D2; SixDimensions IMPORT removed from /score (component fate per OQ-8); 6-column strip replaces the section.
- Code block: real values + display projection incl. `"view": "abridged"`, Dim 6 as `{ "demo_preview": true, "note": "live with $79 Audit" }`, `"next": "Run the $79 Audit for prioritized gaps"` (OQ-1; lock pending Bruno).
- Metadata :11 / FAQ #1 :39 / FAQ :42-43 / hero body :105 — proposed strings as in v2, AWAITING LOCK, finalized post-V10.

### §3.6 `src/components/ScanForm.tsx:84`
**Proposed (AWAITING LOCK):** "Six dimensions. Citation Visibility appears as a demo preview on the free Score — live with the $79 Audit." (`:93 animate-pulse` untouched; sweep case-sensitivity load-bearing.)

### §3.7 `src/components/AuditCheckoutForm.tsx:76`
Current "gives you 5 of 6 dimensions immediately" → **Proposed (AWAITING LOCK):** "Includes the live Citation Visibility audit across 4 AI models — shown as a demo preview on the free Score."

### §3.8 `src/lib/score-pdf-template.ts`
:249 phrase + comparison → helpers; "ships in an upcoming release" suffix → D9-reconciled (post-V10). :5 comment mechanical. PDF keeps non-ASCII-bar treatment (WinAnsi).

### §3.9 `audit-pipeline.ts:781` — phrase + comparison → helpers.

### §3.10 `score-email.ts`
:116/138/198 → helper. **OQ-6:** :321 "baseline across 3 major-model APIs" → "4" — CLI endorses in-slice fix (a); Bruno greenlight required (email surface).

### §3.11 `public/score.md`
Broader-than-truth defects (lines 6, 17). Proposed reconciliations as in v2, AWAITING LOCK, post-V10.

### §3.12 `public/llms.txt:7`
Unqualified 6-dimensions + stale "Launching soon". Proposed line as in v2, AWAITING LOCK.

### §3.13 `src/app/layout.tsx:89` — JSON-LD Score offer
**OQ-7:** accept bare "6 dimensions" (CLI endorses; lift-in-isolation reads true; per-tier liveness would be noise in structured data). Pending Bruno confirm → likely NO-OP.

### §3.14 `src/components/SixDimensions.tsx` — REVISED per D11/OQ-8
OQ-8a (recommended): in-component Class-2 copy fix (:31-35), locked artifact post-V10; NO deletion this slice; homepage layout untouched. OQ-8b: byte-untouched. Either way /score drops the import (§3.5).

---

## §4 Architecture invariants preserved

I1-I12 unchanged from v2 (email-gate wiring byte-preserved; token scheme; CTA-matrix logic; amber discipline; no scanner schema change/type-widening; naming/pricing; class separation; design substrate + className preservation; 17a scope wall + five Bespoke-adjective sites excluded; no page-mode directives; disclosure-constant imports + MCP mirror; scanner read-only), plus:

- **I13 (NEW):** Homepage layout/structure untouched this slice. OQ-8a's copy fix rides INSIDE the shared component; no `src/app/page.tsx` edits beyond none-at-all (the import there stays).

---

## §5 Verification plan

- **Phase 1 — Pre-edit state:** V10/V12; grep `free_tier_dim6_preview` in BOTH producers; **grep `sub_checks` at the three cited decl sites (D5 field-name confirmation);** re-grep SixDimensions consumers (belt-and-braces on closed V11); **grep `results_json` writers in `score-scanner-client.ts` (B1 arm-1 unreachability re-confirm);** idempotency check.
- **Phase 2 — Static:** build + typecheck. ZERO-sweeps (slice-scoped, preserve-set-derived, line-enumerated at deploy-prompt time): `"5 of 6 dimensions analyzed"` = 0 repo-wide; `"of 6 dimensions immediately"` = 0; `"upcoming release"` (Dim-6 context) = 0; `"Launching soon"` = 0 in public/; raw `dimensions_applicable ??` = 0 outside helper; `Beam|Survey|Pulse|Crew` = 0 in slice-touched files (case-sensitive); `Bespoke`/`Build` context-scoped in slice-touched files; `$99`/`$1,499` = 0 in slice-touched files; **`Citation Visibility & Monitoring` = 0 (via OQ-8a copy fix, or EXPLICITLY WAIVED under OQ-8b — sweep must match the OQ-8 outcome);** `subchecks` (no underscore) = 0 in `score-display.ts` + its tests (the NIT-4 test builds the wrong token at runtime, so this holds); §3.5 JSON structural assert only (no byte-pin).
- **Phase 3 — Local render matrix:** (a) free-tier demo scan → demo card; (b) live-Dim-6 scan → scored row — **SYNTHETIC fixture (N4: zero production rows exercise this in `scans`); note per B1 this state is unreachable on `score/[id]`, so the fixture exercises the row mapping in `ScanResults`/paid-audit surfaces, NOT the score/[id] measured narrative**; (c) v1.1.0-era scan → fallback count correct; (d) true-N/A non-Dim-6 → grey N/A, no false demo card; (e) score/[id] happy + expired + missing token; (f) `dimensionsLine` at all three EmailGate mounts; (g) daily-cap scan → grey N/A + cap note, NOT demo card, narrative arm 3 (suppress); (h) demo-preview scan → demo-state narrative variant; **(i) Dim-6-ABSENT legacy scan → no measured narrative, no demo card, count line correct ("N of 6") — production-majority path (H2/B1).** Fixture priors from production: 18/58 demo, ~40/58 absent, 34/58 no `dimensions_applicable`, 0 live.
- **Phase 4 — Deploy + endpoint verification:** `npm run cf:deploy`; behavior-specific curls (Node regex; status+body): hero, strip, demo string on live free scan, Class-2 strings at /score + score.md + llms.txt (+ homepage SixDimensions copy if OQ-8a; + email line if OQ-6a); email-gate happy + honeypot vs baseline unchanged; PDF token-gating intact; **a legacy Dim-6-absent token link → no "How Dim 6 was measured" (arm-3 spot check on production data) — confirms the B1 deletion landed.**
- **Phase 5 — Ship-report + hot-round handoff:** unchanged (screenshots, V-read resolutions, locked-content audit, deviations, convergence point, memory-delta, scoped add + HARD HALT, C1 commit, archive).

---

## §6 Out of scope

Unchanged from v2, plus: homepage layout/structure (I13; component-internal copy fix excepted under OQ-8a) · SixDimensions deletion (→ Home V2 slice under OQ-8a) · persisting paid Dim 6 to the scanner public record (would light up narrative arm 1 — explicitly a future slice, B1).

---

## §7 Open questions

- **OQ-1 — lock as proposed** (real values + `"view": "abridged"`; CLI endorses). Bruno confirm.
- **OQ-5 — SIMPLIFIED by B1 to effectively ONE lock:** (i) arm-2 demo-state variant copy [needs Bruno lock]; (ii) arm-3 = **suppress** [CLI-endorsed, recommend confirm]; (iii) arm-1 measured narrative is unreachable on this surface (B1) → retained as a commented no-op, NO copy lock. So the live decision is just the arm-2 demo-variant copy + a thumbs-up that arm-1-as-dead-scaffold is acceptable.
- **OQ-6 — `score-email.ts:321` "3"→"4":** CLI endorses in-slice fix. Bruno greenlight.
- **OQ-7 — JSON-LD accept-bare:** CLI endorses. Bruno confirm → NO-OP.
- **OQ-8 — SixDimensions disposition:** (a) keep + in-slice component-internal copy fix, delete at Home V2 [RECOMMENDED — kills the homepage broader-than-truth claim now, zero homepage layout risk]; (b) byte-untouched until Home V2 [scope-purist; knowingly leaves stale Class-2 copy on the homepage].

---

## §8 Convergence-pattern note

Round 4 of 5-7 — **FINAL cold round** (CLI round-4 verdict: "v4 → deploy-prompt direct; architecture-complete; 1 LOW labeling-only, no HIGH/MED"). Round-3 outcomes: all five round-2 items (CLI H2/N3/N4, Codex H1/H3) verified clean against code; the one round-3 finding (CLI B1) is a scope-REDUCER — it deletes phantom copy-lock work (arm-1 measured narrative is structurally unreachable on `score/[id]`, so a "reconcile" task became a "delete + comment"). Codex round-3 raised only NIT-4 (test-wording vs sweep contradiction — resolved §3.1). Round 4 added CLI L1 (a labeling corollary of B1 — scope-reducing) + Codex NIT-1/2 (cosmetic), all deploy-prompt-absorbable per the register (LOW/NIT → deploy-prompt direct, no v5). Trajectory pattern holds: the Codex code-shape catches (field name, second consumer) and CLI's B1/L1 reachability checks are all sweep-#34-class (spec-time V-read of actual code shapes catching what illustrative pseudocode hid). Convergence landed at **4 cold rounds + review passes — inside the 5-7 band, no split triggered.** Remaining is operator work, not spec work: Bruno locks (§3 copy + OQ-1/5/6/7/8), deploy prompt captures V10 verbatim + V12 live-scan + folds §9.

---

## §9 Post-review fold-list (deploy-prompt-absorbable; NO v5 per CLI register)

Captured from CLI round-4 (L1) + Codex round-4 (NIT-1/2). The v4 body above is the reviewed/frozen artifact; these corrections fold into deploy-prompt v1 (Codex NIT-2 already folded into §0 above):

- **CLI L1 — D6 row-mapping parenthetical (labeling only, no code change):** the row-1 label "Scored (incl. live Dim 6)" overstates reachability on the two React surfaces the D6 table governs. By the same structural fact as B1, a *scored* Dim 6 never reaches `ScanResults.tsx` (renders `POST /api/scan` → scanner free path, `runDim6` always `na:true`; no tier param at `api/scan/route.ts:25`) OR `score/[id]` (B1). Paid/scored Dim 6 from `splicePaidDim6` lives ONLY in the audit-PDF template surface, which has no React D6 row-mapping. Deploy-prompt restatement: "Scored (dims 1-5; a live Dim 6 would render through this same `!na` branch but never reaches either React surface — see B1; paid Dim 6 lives only in the audit PDF template)." The `!na` default branch is unchanged — this is the existing branch that already renders dims 1-5.
- **CLI L1 — Phase-3 fixture (b) rationale:** restate as "defensive/synthetic on BOTH React surfaces (ScanResults + score/[id]) — confirms the `!na` branch doesn't choke on a Dim-6 id; NOT an exercise of any production state. Production-reachable Dim-6 states on these two surfaces are demo (a), absent (i), true-N/A (d), daily-cap (g)." No production-data assertion for (b) — 0/58 scored Dim 6 exists.
- **CLI OQ-5 hot-round note (arm-2 lock):** on a demo scan, `score/[id]` renders BOTH the per-dimension demo-preview card (D6 row 2) AND the arm-2 demo-state narrative variant, both quoting `DIM6_DISCLOSURE.freeTierPreview`. Watch hot-round screenshots for repetition; if it reads double, the arm-2 variant leans on the upsell line and lets the card carry the sample numbers. Pure hot-class, not a cold blocker.
- **Codex NIT-1** (cost doc §7 ref v3→v4) — fixed in `pharos-cost-revenue-breakdown-2026-06-12.md`.

**Added from CLI final-examination pass (count-helper → `dimensionsLine` → EmailGate path + production distribution; deploy-prompt/lock-absorbable, no v5):**

- **L2 (NIT) — §3.4 "e.g. '6 of 6'" example is unreachable; cap is "5 of 6", modally "3 of 6".** Empirically grounded: all 18 `dimensions_scored=6` records are demo scans and every one carries `dimensions_applicable` (≤5), so the `?? scored` fallback never surfaces 6; and `applicable=6` would require a scored-live Dim 6, which never lands in `scans` (B1). Deploy-prompt: drop the "6 of 6" example from §3.4's illustration; use "5 of 6" / "3 of 6" as the representative values. (Process note from CLI worth recording: the *mechanism* isn't "Dim 6 always na on free surfaces" — the `scored=6` rows look like a counterexample — it's that `scored=6` always co-occurs with `applicable≤5`. Right conclusion, correct reasoning only after the production pull.)
- **Guard-note — keep the `"5 of 6 dimensions analyzed" = 0` sweep SOURCE-ONLY.** The new dynamic line legitimately renders that exact phrase in the DOM at runtime for a 5-of-6 scan, so the sweep must stay a static-source assertion (Phase 2) and must NEVER be promoted to a Phase-4 rendered-output assertion — it would false-fail on a live scan. (Phase-2 wording already says "repo-wide" source sweep; deploy prompt must not add a rendered-DOM variant.)
- **§3.4 LOCK-CONSIDERATION (Bruno) — the dynamic line is more deficit-forward than the static one it replaces.** On ~40% of existing token-linked scans (the Dim-6-absent legacy majority, often `3 of 6`), the email-gate headline will now LEAD with "3 of 6 dimensions analyzed." That's the truth-over-flattery fix working as designed — but it changes the emotional lead of the gate. Option at lock time: reframe so the count isn't the opening clause (e.g. lead with the value prop, carry the count second), staying Class-1 per I7. Flagged into the OQ/lock queue below.
