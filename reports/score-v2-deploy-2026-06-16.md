# Score V2 Redesign — Ship Report (2026-06-16)

**Slice:** Score V2 redesign (Beam V2 visual + Class-1 count-helper + Class-2 Dim-6 narrative reconciliation + demo-preview discriminator + whole-/score "Astrant Score" rename).
**Executed from:** deploy prompt v2.5 (EXECUTION-READY). Frozen source spec: Score V2 spec v4.
**Deploy:** `npm run cf:deploy` (marketing-site). **Worker Version ID: `a48131ac-2e7b-49cf-9186-a80c6161c450`.** Live on astrant.io.
**Author:** Bruno. No push (C2). No schema migration. No scanner edits.

---

## V-read resolutions (Step 0)
- **V10** — all target lines captured verbatim incl. surrounding markdown markers (list `- `, bold `**`, links). A11 confirmed inside the score.md:12-17 bullet list (`- ` prefix mandatory); A19 sibling FAQ questions confirmed bold; A12 original value-prop confirmed (locked A12 drops nothing material — rewords + adds the Dim-6 truth clause).
- **V12 live scan** — astrant.io self-scan pulled 2026-06-16: composite **89 / A-**; D1=93, D2=100, D3=0 (OpenAPI N/A — content-only), D4=73, D5=93; Dim 6 = free-tier demo (`free_tier_dim6_preview`). Inlined into A5 (no byte-pin).
- **Greps:** `free_tier_dim6_preview` present in both producers (marketing `runDim6.ts` + scanner `dim6-citation.ts`). `sub_checks` decl at the 3 cited sites. `SixDimensions` exactly two consumers (homepage `page.tsx:138`, `score/page.tsx:138`) — no third, no HALT. No `results_json` writer in `score-scanner-client.ts` → B1 arm-1 unreachability confirmed. Both `gradeColor*` impls use `startsWith("A")/("B")` + `==="C"/"D"` (A- → emerald). Stale-status exact-string scoped grep: only score.md:4/:36 + llms.txt:7.
- **Idempotency:** slice NOT previously shipped (no `score-display.ts`, no "Your Astrant Score" / `isDim6DemoPreview` in page files; the score-email "Your Astrant Score gap report" hit is pre-existing email copy).
- **Honeypot (Step 13, post-deploy):** `referral_code`-bearing POST to `/api/score/capture-email` returns benign fake-success (HTTP 200, dummy `v1.X.X.deadbeef…` token + dummy URLs) — tarpit intact, no leak.

## Phase verification
- **Phase 1 (code inspection):** all A1–A19 applied verbatim incl. markers (see audit below). A10 reconciled (see deviations).
- **Phase 2 (static):** `tsc --noEmit` clean; `vitest run` 12/12 pass; `next build` clean (all routes; `/score` static, `/score/[id]` dynamic).
- **Phase 3–4 (deploy + endpoint):** cf:deploy success. Live curls verified — /score `<title>` = "Astrant Score — Free AI Discoverability Check" (no double "Astrant"); H1 "Your Astrant Score" + descriptor; A17 hero body; A6 meta; A7 FAQ; page-level JSON-LD Service+Offer `name` = "Astrant Score" (×2); self-scan label + escaped live values (89/A-/weights); 6-col strip (all 6 names). score.md A18/A12/A8/A19 + 6-bullet list intact, no stale status. llms.txt A13 (list+link intact). Homepage A14 description live, old "Citation Visibility & Monitoring" gone. "Agent Discoverability Score" persists ONLY in the global-layout JSON-LD Offer (deferred layout.tsx:84 NO-OP — by design).
- **Phase 5 (idempotency/cleanup):** no orphaned imports (build-verified); `git add` explicit paths only.

## Locked-content audit (A1–A19)
A1 helper ✓ · A2 demo card (both React surfaces) ✓ · A3 arm-2 narrative ✓ · A4 EmailGate value-leads + `dimensionsLine` (3 mounts) ✓ · A5 self-scan JSON (real V12) ✓ · A6 meta ✓ · A7 FAQ ✓ · A8 FAQ#1 phrase ✓ · A9 ScanForm ✓ · **A10 reconciled (deviation)** · A11/A12/A13 docs (markers preserved) ✓ · A14 SixDimensions ✓ · A15 PDF suffix ✓ · A16a–d /score rename ✓ · A17 hero body ✓ · A18/A19 docs (markers preserved) ✓. Count helper at 7 phrase + 3 comparison sites; OQ-6 `3→4`; layout.tsx:84/:89 NO-OPs left intact.

## Deviations & operator-handoff items
1. **A10 reconciled (Bruno-approved at checkpoint).** A10's locked text would have made AuditCheckoutForm:76 false + ungrammatical against the V-read subject ("the free Score scan at astrant.io/score …"). Per "V-read wins on conflict," replaced with a truthful predicate keeping the subject: *"gives you all six dimensions — five scored live, with a Citation Visibility demo preview."*
2. **Narrative gate arm-1** = commented defensive no-op (measured "How Dim 6 was measured" block DELETED from render — recoverable from git history); arm-2 = A3 + `freeTierPreview`; arm-3 = suppress. Net effect per B1: measured narrative removed from rendered output on all reachable states.
3. **LOG-only (out of §LOCKED, left byte-intact — same family as audit-pipeline:781):**
   - ScanResults hero trailing clause "full report when remaining dimensions ship" (stale Class-2; count swapped to helper, no locked replacement for the clause).
   - score/page.tsx "Built the way we build for clients": "When the score ships, we'll score ourselves first and publish the result here" — now stale + self-contradicting (score live, self-scan published above). Needs a Bruno copy lock.
   - A5 example shows `"openapi": { "score": 0 }` (astrant.io OpenAPI genuinely N/A). Faithful to locked template + live value; reads slightly oddly against the 89/A- composite. Tunable at hot rounds.
4. **Operator remaining (Step 13 hot rounds):** real-browser submit + network-tab POST-shape check; visual tuning of the two-column hero / eyebrow / typography (hot-class); demo-card vs arm-2 repetition watch; A- grade-badge emerald visual confirm; optional A5 V12 refresh.

## Sweep data points
`5 of 6 dimensions analyzed`=0 · `of 6 dimensions immediately`=0 (after A10 fix) · `upcoming release` Dim-6/Score context=0 (2 legitimate legal/robots hits out of scope: terms.md:38, legal-content.ts:138) · stale Score-status (scoped)=0, A19 Q/A present · `Agent Discoverability Score` in score/page.tsx=0 (persists by design in global layout JSON-LD, llms.txt label, score.md title) · raw `dimensions_applicable ??` outside score-display.ts=0 · `subchecks`=0 · `Citation Visibility & Monitoring`=0 · Beam/Survey/Pulse/Crew=0 in slice files (comment refs reworded) · dup grade-def=0 in the two React Score surfaces (3 PDF/hex `gradeColor` helpers left untouched: audit-pipeline.ts:633, score-pdf-template.ts:79, AuditResultsPoller.tsx:33) · `DIM6_DEMO_SUBCHECK_ID = "free_tier_dim6_preview"` ✓.

## Convergence
4 cold spec rounds + 7 deploy-prompt rounds (v1→v2.5). Every deploy-prompt defect was a literal-bytes / markdown-marker / sweep-scope mismatch at the reconciliation edge — NONE architectural; spec right at v4. **One execution-time deviation (A10) was a deploy-prompt-artifact-vs-V-read drift, resolved at checkpoint** — reinforces the "V-read wins on conflict" discipline.

## Memory-delta (proposed; awaiting Bruno greenlight)
1. **Hero "Your Astrant Score" whole-/score-page lock + DEFERRED site-wide metric pass** — `layout.tsx:84` root Offer + `llms.txt` label + `score.md` title flip together in a later site-wide pass.
2. **Candidate feedback memory:** Copy-reconciliation slices — lock artifacts against V-READ LITERAL BYTES INCLUDING surrounding markdown markers (list `- `, bold `**`, links); prefer full-line replacements over substring swaps; scope EVERY zero-sweep to exact strings + exclude known-legitimate occurrences from the start (over-broad-bare-term class: `Bespoke`, `waitlist`, `upcoming release`). And: a locked rendered-text artifact can still mis-fit the actual V-read sentence (A10) — V-read/truth wins; surface as a checkpoint decision, don't ship a false/ungrammatical line. Carry into Home V2.

## Files changed (this slice)
NEW: `src/lib/score-display.ts`, `src/lib/score-display.test.ts`.
MOD: `src/components/ScanResults.tsx`, `src/app/score/[id]/page.tsx`, `src/components/score/EmailGate.tsx`, `src/app/score/page.tsx`, `src/components/ScanForm.tsx`, `src/components/AuditCheckoutForm.tsx`, `src/lib/score-pdf-template.ts`, `src/lib/audit-pipeline.ts`, `src/lib/score-email.ts`, `src/components/SixDimensions.tsx`, `public/score.md`, `public/llms.txt`, `package.json`, `package-lock.json`.
EXCLUDED from commit: `src/app/page.tsx` (pre-existing working-tree modification, not this slice), TODO.md, .claude/settings.json.
