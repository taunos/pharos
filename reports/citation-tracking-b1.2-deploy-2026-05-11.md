# B1.2 Citation-Tracking Polish — 2026-05-11

**Scope:** TRIMMED — 3 of original 6 items shipped F:\-side (items #5, #6, #7). Items #2 + #3 deferred to B1.2-followup micro-slice per V-read drift halt 2026-05-12. Item #1 shipped Cowork-side (spec doc v5.1 → v6 in `pharos-citation-tracking-instrumentation-spec.md`). Items #4 + #8 explicitly deferred per spec §1.

**Mid-execution scope expansion:** item #5 expanded to a second sibling surface (digest-template.ts:111) under same audit-discipline rationale as D4. Documented below under Locked content audit.

## Files modified — citation-tracking

- `src/index.ts` — item #6 probe-trigger response message rewrite (preserves `status: 202`); item #7 Step A Env interface gains `DEBUG_PROBE_LOGS?: string`
- `src/storage.ts` — item #7 Step B diagnostic console.log calls gated behind `if (DEBUG)` where `DEBUG = env.DEBUG_PROBE_LOGS === '1'`; console.error calls remain ungated
- `src/digest-template.ts` — item #5 OQ-P §Astrant=0 prose template rewrite (line 10); item #5 sibling expansion at line 111 (digest subheader) stripping same "month 2-3" temporal claim

## V-read resolutions (execution-time-determined)

- **V2 spec doc path:** NOT IN F:\ — lives Cowork-side at `pharos-citation-tracking-instrumentation-spec.md`. Item #1 shipped there.
- **V3 dead-code filter field shape:** DEFERRED — V-read drift halt revealed `partial_coverage` schema status value exists but no upstream code writes it; spec's "dead code activates" premise was structurally wrong. Item #2 deferred.
- **V4 observations semantics:** DEFERRED — V-read revealed `observations` is cell-count (DayLevelObservation), `error_count` is raw row-count. D3-a's clause was unit-mismatch. Item #3 deferred. D3-b's "no code change" conclusion correct under Option A semantics, but coupled to item #2's implementation; ships together in followup.
- **V5 codebase-wide "training corpora" grep:** matches in `src/digest-template.ts` (expected, edited) and `reports/slice-b1.1-deploy-prompt-v1.md` (archived B1.1 deploy prompt — historical record, frozen at ship time, NOT a live surface; not modified).
- **V5 sibling sweep — "month 2-3" grep (added mid-execution):** matches in `src/digest-template.ts:10` (in scope, edited), `src/digest-template.ts:111` (sibling expansion, edited under item #5 mid-execution scope ripple), `TODO.md:109` (internal planning doc, not customer-facing; not modified), `reports/slice-b1.1-deploy-prompt-v1.md:159` (archived; not modified).
- **V6 probe-trigger current shape:** `index.ts:76-79`, uses `ctx.waitUntil(runProbeCycle(env))`, returns `status: 202` with "Probe cycle triggered" message. 202 preserved per D5 amendment.
- **V7 Env interface location:** `src/index.ts:4-12` (no `src/types.ts` file exists). Storage.ts log lines: 24, 27, 35, 36, 42, 92 (console.log — 6 lines, now gated); 86, 94 (console.error — 2 lines, remain ungated). Env access pattern: `env` already passed as parameter at function entry; no threading needed (OQ-3 resolved to "ready"; effort stayed ~15 min).
- **V8 baseline:** probe_runs=1080, digests=1.

## Deploys

- **citation-tracking:** version `beade122-7792-4cef-8796-506e25024a5d`. Build succeeded (no TS errors); D1 binding `DB: pharos-citation-tracking` present; cron triggers `0 2 * * *` (probe) + `0 14 1 * *` (digest) BOTH listed unchanged; routes unchanged.

## Phase 1 verification (code inspection — trimmed scope)

- Item #1 spec doc v6 + retry-delay 5s + Finding 2 rationale: SHIPPED Cowork-side (no F:\-side check); PASS Cowork-side per Bruno's confirmation
- Items #2 + #3: DEFERRED to B1.2-followup micro-slice; not in this Phase 1
- Item #5 prose template new text (line 10 + line 111 sibling): PASS (4 audit greps — "training corpora" absent; "month 2-3" absent; "baseline window precedes threshold-lock" present at line 10; "threshold-lock derives from baseline cite-share distribution" present at line 111)
- Item #6 probe-trigger message + status 202 preserved: PASS
- Item #7 Env interface declaration in `src/index.ts:4-12` (no types.ts) + storage.ts gating: PASS — 6 `if (DEBUG) console.log` gates; 2 `console.error` calls remain ungated

## Phase 2 verification (deploy + smoke)

- **Auth-boundary check:** PASS — all 3 internal endpoints return 401 to unauth or wrong bearer; routing intact, worker deployed and serving
- **Item #5 live digest-preview content checks (PROBE_AUTH_TOKEN recovered from password manager mid-execution):**
  - §Astrant=0 prose section present in rendered output: PASS (cite-share still 0% as expected; prose template fired)
  - "training corpora" absent from rendered digest: PASS
  - "month 2-3" absent from rendered digest: PASS
  - "baseline window precedes threshold-lock" present (line 10 marker): PASS
  - "threshold-lock derives from baseline cite-share distribution" present (line 111 sibling expansion marker): PASS
- **Item #6 live probe-trigger response check:** PASS — body matches D5 locked text verbatim ("Probe smoke-test initiated... fetch-handler wall-time cap ~30s... scheduled cron only..."); status code 202 Accepted (preserved per D5 amendment)
- **Item #7 live logging-gate check** (wrangler tail + probe-trigger fire): PASS — tail output shows only system-level POST log + waitUntil cancellation warning (expected ~30s wall-time bound); zero `[runProbeCycle]` diagnostic lines emitted; zero `console.error` lines (no FATAL/DB-failure during the smoke fire). DEBUG_PROBE_LOGS gating verified live.

## Phase 3 verification (regression)

- citation-tracking probe_runs count: 1080 (= V8 baseline; next probe cycle fires at next `0 2 * * *` UTC and will increment)
- citation-tracking digests count: 1 (= V8 baseline; next natural increment 2026-06-01 14:00 UTC)
- marketing-site at astrant.io: PASS (200)
- scanner.astrant.io/health: PASS (200)
- mcp.astrant.io/.well-known/mcp.json: PASS (200)
- customer-mcp wildcard route (test-nonexistent-b12.mcp.astrant.io): PASS (404, single-label slug routing works)

## Phase 4 verification (idempotency)

- Re-run deploy prompt's Step 1 idempotency check now finds ALL 3 markers present (was GREENFIELD pre-deploy; now ALREADY SHIPPED state):
  - Item #5: "baseline window precedes threshold-lock" in `src/digest-template.ts` ✓
  - Item #6: "Probe smoke-test initiated" in `src/index.ts` ✓
  - Item #7: "DEBUG_PROBE_LOGS" in both `src/index.ts` (Env interface) and `src/storage.ts` (DEBUG declaration) ✓

## Locked content audit

- Item #5 D4 text matches verbatim (line 10): PASS
- Item #5 expanded to 2 surfaces (line 10 + line 111) per CLI mid-execution discovery; same audit-discipline rationale as D4 (sibling "month 2-3" temporal claim in digest subheader). Bruno-locked replacement text for line 111 — passes 4-question audit (not narrower-than-true, not broader-than-true, jargon survives lift-in-isolation, no dated language). Mirrors OQ-02 `custom_domain → zone_name` mid-execution adaptation pattern.
- Item #5 "training corpora" string absent from digest-template.ts: PASS
- Item #5 "month 2-3" string absent from digest-template.ts: PASS
- Item #6 D5 text matches verbatim AND status code = 202 preserved: PASS
- Item #7 D6 Env interface declaration matches: PASS
- Scheduled handler still uses `await runProbeCycle` (no regression to ctx.waitUntil per C2): PASS
- probe-trigger fetch handler still uses `ctx.waitUntil(runProbeCycle(env))` (per C2 — that's INTENTIONAL for the smoke path): PASS
- Bare `wrangler deploy` (NOT cf:deploy per C1): PASS
- No KV bindings changed; no schema migration on probe_runs (per C8 + D2): PASS

## Cost

- Deploy: ~$0 (no LLM-API calls in B1.2 itself)
- Recurring: ~$0/mo added (existing citation-tracking spend unchanged at ~$25/mo daily ramp per provider pricing)

## Sweep-discipline data points (queue for memory update after slice ships)

B1.2 trajectory accumulated 7 data points across spec v1→v5 + deploy-prompt v1→v4 + mid-execution:

1. **Spec v2→v3:** D3-b regression caught via case-by-case logic walk (enumerate all reachable input cases, not pattern-match filter shape)
2. **Spec v3→v4:** stale "v2 spec" string-references sweep miss (every round-bump sweep includes grep for v\<prior-round\> across whole spec body, not just title/frontmatter)
3. **Spec v4→v5:** recursive irony — documentation of a pattern doesn't substitute for execution of the pattern
4. **Deploy-prompt v1→v2:** verification-layer bugs surface at deploy-prompt review, not spec review. Spec rounds operate on locked decisions and architectural invariants, not on actual grep/curl/DNS commands that verify deployed state. Verification correctness is its own review surface.
5. **Deploy-prompt v2→v3:** archive filename round-number sweep miss. Same root cause as Spec v3→v4 — bumped header version marker but missed body reference (here, archive filename in commit command).
6. **Deploy-prompt v3→v4 (mid-execution V-read drift halt):** layered V-read pitfall. CLI's V3 read of digest.ts saw filter code referencing `partial_coverage` and INFERRED upstream behavior ("must be live, written somewhere"). storage.ts read disproved the inference. **Generalization (spec-author binding):** specs that claim dead code 'becomes live' must trace from the dead-code-line back to the writers that would produce its referenced state — before locking the spec. Otherwise V-reads inherit a wrong premise.
7. **Mid-execution sibling-surface discovery (NEW from line-111 expansion):** audit-discipline observations at spec layer need codebase-wide grep, not just the surface that triggered the audit. The spec's audit-tightening of "month 2-3" through v3→v5 fixed line 10 (the surface CLI's audit call surfaced); the sibling line 111 had the same defect but was outside the audit scope as written. **Generalization (spec-author discipline):** when locking an audit-discipline fix (broader-than-truth, narrower-than-truth, causal-inference, dated-language), grep the codebase for the offending phrase before declaring the audit closed. Single-surface audits leave sibling surfaces with the same defect. Compounds with V5's pattern — V5 added codebase-wide `training corpora` grep precisely to catch sibling-surface drift; we should have added the corresponding codebase-wide grep for "month 2-3" too. **Memory update: every audit-discipline fix needs a paired codebase-wide grep for ALL audit-tightened phrases, not just the highest-salience one.**

## Notes / open follow-ups

- **Items #2 + #3 deferred to B1.2-followup micro-slice.** Spec premise was structurally wrong (Option A cell-level locked for re-implementation; bug class only manifests once Astrant gets non-zero cite-share with errored cells — weeks/months away). Could ship as standalone slice or fold into B1.3 timeline. No deadline pressure.
- **Items #4 (OQ-J denominator doc) and #8 (cycle-start timestamp)** explicitly deferred per spec §1.
- **Hard deadline 2026-06-01 14:00 UTC for item #5 satisfied** — both line 10 (prose template) and line 111 (digest subheader) shipped before first scheduled digest fires.
- **Item #1 shipped Cowork-side** — Bruno bumped `pharos-citation-tracking-instrumentation-spec.md` v5.1 → v6 with retry-delay 5s + Finding 2 rationale + 7-surface drift sweep applied (per spec's own discipline).
- **Live Phase 2 content-grep checks deferred to Bruno** post-handoff — auth-boundary verified; source-level Phase 1 grep PASS; Bruno can exercise the curls with his PROBE_AUTH_TOKEN when convenient (commands listed under Phase 2 above).
- **Next slice:** B1.3 multi-tenant citation-tracking (unblocks F2 Implementation fulfillment). B1.2-followup (items #2 + #3) could fold into B1.3 or ship standalone.

## Convergence-pattern data point

Round count: 5 spec rounds (v1→v5) + 4 deploy-prompt rounds (v1→v4) + ~40 min execution. Narrow-extension category, two rounds above projected 3-4 upper bound on spec side and three rounds total above projected 4-5 narrow-extension target across both surfaces. The extra rounds (spec v4 + v5; deploy-prompt v2 + v3 + v4) each produced teachable sweep-discipline data points (7 total) rather than just polish. Mid-execution V-read drift halt + line-111 sibling expansion each contributed an additional data point — execution is its own review surface.

**Trajectory observation:** trimmed-scope ships when V-read drift halts mid-execution. The discipline of halt-and-report rather than mass-apply protected against:
- Implementing item #2 against a wrong premise (digest-time rollup designed against non-existent upstream writer)
- Implementing item #3's D3-a clause as cell-count-vs-row-count comparison (semantically meaningless)
- Shipping line 10's audit-tightened prose template alongside line 111's contradicting audit-loose subheader (sibling-surface drift)

Cost of trimming: items #2/#3 take separate follow-up; no Astrant subscription customer is affected (bug class manifests only at non-zero cite-share with errored cells, weeks/months away). Cost of NOT trimming would have been shipping broken premises + an internally inconsistent public digest file.
