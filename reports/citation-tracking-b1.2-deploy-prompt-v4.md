# B1.2 Citation-Tracking Polish (Claude Code Deploy Prompt) — v4 (trimmed)

**v3 → v4 changes (V-read drift halt 2026-05-12 mid-deploy):**
- **TRIMMED SCOPE:** 6 items → 3 items F:\-side. CLI's V-read at Step 0 surfaced material spec drift on items #2 (partial_coverage premise wrong; storage.ts proves no upstream writer exists for `partial_coverage` status; lines 91, 96 are dead for a different reason than v5 described) and #3 (observations vs error_count are different units — D3-a clause is semantically nonsense). Both items deferred to B1.2-followup micro-slice with Option A locked for #2's re-implementation.
- **Item #1 moved Cowork-side.** Spec doc at `pharos-citation-tracking-instrumentation-spec.md` lives Cowork-only (V2 confirmed no F:\-side doc). Bumped v5.1 → v6 Cowork-side; no F:\ deploy needed for item #1.
- **Item #6 D5 amended:** `status: 200` → `status: 202` preserved (drafting error in spec v5; current code uses 202 Accepted which is HTTP-semantically correct for `ctx.waitUntil`-deferred work; downgrading to 200 would lie about completion).
- **Item #7 Env interface location:** `src/index.ts:4-11` (no `src/types.ts` file exists; V7 confirmed).
- **Items #2 + #3 fully removed** from this deploy prompt's steps + verification + idempotency markers + ship-report. Re-spec and re-ship as B1.2-followup.

**v2 → v3 changes (CLI v2 review folded in 2026-05-12):**
- **LOW:** archive command destination filename `-v1.md` → `-v3.md` then **v3 → v4.md** at this round.
- **Sweep-discipline data point #4 added** to the ship-report queue-for-memory section: deploy-prompt review surfaces verification-layer bugs that spec review doesn't.
- **Sweep-discipline data point #5 added:** archive-filename round-number sweep miss demonstrates recursive-application pattern.
- **Sweep-discipline data point #6 added (NEW from V-read drift halt):** layered V-read pitfall — V-read discipline can produce false positives when reads stop at one layer. CLI's V3 read of digest.ts saw filter code referencing `partial_coverage` and INFERRED upstream behavior ("must be live, written somewhere"). storage.ts read disproved the inference. Generalization (CLI's sharper framing, binds spec author): specs that claim dead code 'becomes live' must trace from the dead-code-line back to the writers that would produce its referenced state — before locking the spec. Otherwise V-reads inherit a wrong premise.

**v1 → v2 changes (CLI v1 review folded in 2026-05-12):**
- **MED-1:** dotted hostname `test-nonexistent-b1.2.mcp.astrant.io` → single-label `test-nonexistent-b12.mcp.astrant.io` in Step 0 + Step 12 regression checks. Wildcard `*.mcp.astrant.io` matches single-label only; the dotted form would have NXDOMAIN'd before hitting customer-mcp's routing layer.
- **MED-2:** Step 1 item #2 idempotency marker `grep "partial_coverage"` → `grep "errored_replicates >= 2"`. The bare `partial_coverage` marker false-positives on pre-B1.2 dead-code filters at lines 91/96; the threshold comparison `errored_replicates >= 2` is locked at D2 and only appears in B1.2's new aggregation logic.
- **MED-LOW:** Step 1 item #1 idempotency marker tightened with paired check — (a) word-boundary regex on `v6` + (b) literal "retry delay locked at 5s" Finding 2 rationale string. The v6-alone marker risked false-positive on incidental "6" text.
- **LOW / NIT** (qualitative Phase 1 item #2 check + missing C10 about TS build failure): skipped per CLI recommendation; narrow-extension scope keeps these polish-only.

**Companion to:**
- `pharos-citation-tracking-b1.2-spec.md` v5 FROZEN (5 spec rounds: v1 → v5; convergence-pattern trajectory at narrow-extension category, one round above projected 3-4 upper bound but within 6-round re-scope boundary).

**Purpose.** Ship 6 mechanical fixes to the already-shipped citation-tracking Worker at `F:/pharos/citation-tracking/`. Bug-fix sweep + copy boundary + operational hygiene. No new infrastructure; no schema migrations; no new providers; no LLM-API spend.

**Scope is narrow.** All 6 items land in a single deploy. Estimated effort: ~1.5-2h CLI execution. Hard deadline 2026-06-01 14:00 UTC on item #5 (prose template) — first scheduled digest commits the rendered text to `reports/citation-tracking/2026-05.md` at that time.

**Pre-deploy gate.** Before running this prompt, Bruno should:

1. **Confirm B1/B1.1 + production workers still operational** — citation-tracking daily probe `0 2 * * *` UTC running, marketing-site at astrant.io, scanner.astrant.io, mcp.astrant.io, customer-mcp at `*.mcp.astrant.io`. All green; B1.2 lives only in citation-tracking source tree.
2. **Confirm `F:\pharos\` working tree is clean** (or only contains WIP unrelated to this slice).
3. **(Optional)** Skim `pharos-citation-tracking-b1.2-spec.md` v5 for full rationale on each item.

Once gate passes, paste the section below into a fresh Claude Code session pointed at `F:\pharos\`.

---

```
You are deploying B1.2 — citation-tracking instrumentation polish (TRIMMED 4-item scope; items #2 and #3 deferred to follow-up per V-read drift halt 2026-05-12). 3 mechanical fixes to the already-shipped citation-tracking Worker at F:/pharos/citation-tracking/. Item #1 (spec doc) already shipped Cowork-side. No new infrastructure; no schema migrations; no new providers.

TRIMMED SCOPE — only items #5, #6, #7 in this deploy prompt. Items #2 (partial_coverage rollup) and #3 (headline filter) are EXPLICITLY DEFERRED. Do NOT auto-apply changes for items #2 or #3 even if you find code patterns that would seem to fit — those items need fresh implementation against actual code (Option A cell-level locked when re-shipped). If V-reads suggest item #2 or #3 changes would land cleanly, halt and report rather than implementing.

ENVIRONMENT NOTE: on Windows + Git Bash, `wrangler` is NOT on global PATH. From `F:/pharos/citation-tracking/` call `./node_modules/.bin/wrangler ...`. Use forward-slash paths in bash; backslash paths break Git Bash.

INLINE PROJECT CONSTRAINTS (treat as hard rules — they apply across this entire prompt):

(C1) **citation-tracking is a PLAIN Worker, NOT OpenNext.** Use `./node_modules/.bin/wrangler deploy` for deploys. Do NOT use `npm run cf:deploy` — that's the OpenNext-only command used by marketing-site (Next.js + @opennextjs/cloudflare). The cf:deploy script does not exist in citation-tracking's package.json. Bare wrangler deploy is correct.

(C2) **Scheduled handler in citation-tracking already uses `await runProbeCycle(env)` (B1 Finding 1 fix).** Do NOT regress to `ctx.waitUntil(runProbeCycle(env))`. The probe-trigger fetch handler at `index.ts:76-79` still uses `ctx.waitUntil(runProbeCycle(env))` and that's INTENTIONAL — fetch handlers bound at ~30s wall-time per the Workers Paid platform constraint; the probe-trigger endpoint is the smoke path that exercises the first ~few batches before cancellation. Item #6 only rewrites the response MESSAGE to be honest about this; do NOT change the ctx.waitUntil behavior itself. Full probe cycles run via the scheduled handler with `await`, not via probe-trigger.

(C3) **Commits MUST NOT include a `Co-Authored-By: Claude <noreply@anthropic.com>` footer or any equivalent Claude/Anthropic attribution.** This includes `🤖 Generated with Claude Code` lines, `Co-Authored-By: Claude` footers, or any other automated-author attribution. Use Bruno's standard git config author info only. The commit message body should be plain content.

(C4) **Don't touch any other production Worker.** customer-mcp at `F:/pharos/customer-mcp/`, marketing-site at `F:/pharos/marketing-site/`, scanner at `F:/pharos/scanner/`, mcp-server at `F:/pharos/mcp-server/` — all are independent of B1.2. If you find yourself touching any of those source trees, STOP and re-read. B1.2 is ONLY in `F:/pharos/citation-tracking/` plus optionally the citation-tracking spec doc location (V2 confirms).

(C5) **Idempotency.** This prompt is safe to re-run. Step 1 idempotency check identifies the slice as already-shipped via 6 markers (one per item). If all 6 present, halt with "ALREADY SHIPPED."

(C6) **Verify-at-endpoint discipline.** After deploy, exercise the actual deployed endpoints — `/api/internal/digest-preview` for items #2/#3/#5, `/api/internal/probe-trigger` for items #6/#7. Code inspection IS the verification for items #1 (spec doc) and structural parts of #7 (Env interface declaration); but behavior changes require endpoint exercise.

(C7) **No `git commit` until ALL verification phases (1-4) PASS.** Phase 1 (code inspection per item), Phase 2 (deploy + smoke per item), Phase 3 (regression — B1/B1.1 baselines + production Workers), Phase 4 (idempotency). All must be green before commit.

(C8) **No scope creep.** Items #4 (OQ-J denominator doc) and #8 (cycle-start timestamp) are explicitly deferred per spec §1. Do NOT auto-fix them. If you discover NEW issues during execution that don't fit any of the 6 items, report at end-of-run; do NOT auto-implement. The spec's deferral rationale is load-bearing — adding items mid-execution defeats the narrow-extension scope discipline.

(C9) **V3 + V4 are execution-time reads that determine implementation branch for items #2 and #3.** Step 0 reads `digest.ts` and captures the dead-code filter field shape (V3) and the `observations` field semantics (V4). Item #2's aggregation output MUST match V3's captured field name (otherwise the dead-code filters stay dead). Item #3's filter branches between D3-a (modify filter) and D3-b (code comment only) based on V4 semantics. If V3 reveals an unexpected field shape OR V4 reveals an unexpected semantic, halt and re-scope rather than guess.

CRITICAL CONTENT BOUNDARY:

Item #5's prose template text lands in committed repo file `reports/citation-tracking/2026-05.md` on 2026-06-01 14:00 UTC (the first scheduled monthly digest). The text WILL be on GitHub publicly and could surface in due-diligence review. Audit-discipline applies to this text specifically — the locked D4 text below has been audit-tightened across v3 → v5 of the spec to strip two unsupported claims (causal "training corpora" claim and temporal "month 2-3" claim). DO NOT paraphrase or "improve" the D4 text during execution. Inline it verbatim.

The other emitted strings (item #6 probe-trigger response message, item #1 spec doc text) are also Astrant-emitted but are internal-ops-facing rather than DD-surfacing. Audit-discipline applies less strictly there; still inline the D5 / D1 locked texts verbatim rather than rewriting.

LOCKED CONTENT ARTIFACTS (verbatim from spec v5 — DO NOT modify; inline below for self-containment):

### Locked: Item #5 OQ-P §Astrant=0 prose template (D4)

```ts
// In digest-template.ts:10 (or wherever ASTRANT_BASELINE_ZERO_TEMPLATE is defined):
export function ASTRANT_BASELINE_ZERO_TEMPLATE(periodStart: number): string {
  return `*Astrant cite-share this month: 0%. Baseline phase — model-side cite-share signal not yet detected. Per the methodology, the baseline window precedes threshold-lock; once baseline cite-share patterns are established, subsequent cite-share emergence is measured against them.*`;
}
```

Strips two unsupported claims from the prior v3-locked text:
- "hasn't been ingested into model training corpora yet" — causal inference unsupported by cite-share data alone
- "threshold-lock at month 2-3" — temporal specificity that OQ-H methodology doesn't lock

Function signature stays the same (period_start param retained for forward-extensibility even though new text doesn't reference it).

### Locked: Item #6 probe-trigger response message (D5)

```ts
// In index.ts:76-79 (replace the existing Response with this verbatim):
return new Response(
  'Probe smoke-test initiated. Note: fetch-handler wall-time cap ~30s means only the first few batches will complete; full cycles run via scheduled cron only (daily 0 2 * * * UTC). Check D1 probe_runs for partial results.',
  { status: 200 }
);
```

No behavior change. Honest framing of what the endpoint does + pointer to where full cycles actually run.

### Locked: Item #7 Env interface declaration (D6 Step A)

```ts
// In src/types.ts (or wherever Env interface lives — V7 captures actual location):
interface Env {
  // ... existing bindings (D1, KV, PROBE_AUTH_TOKEN, etc.)
  DEBUG_PROBE_LOGS?: string;  // unset by default; set to "1" to enable diagnostic logs
}
```

### Locked: Item #7 storage.ts logging gate pattern (D6 Step B)

```ts
// At the top of storage.ts (or each function entry; whichever matches existing pattern):
const DEBUG = env.DEBUG_PROBE_LOGS === '1';

// Diagnostic logs (gated):
if (DEBUG) console.log('[storage] inserting batch', ...);

// FATAL / DB-failure logs (UNgated — real ops signal):
console.error('[storage] D1 write failed:', err);
```

Lines to gate per V7 grep (CLI's earlier capture: 24, 27, 35, 36, 42, 86, 92, 94). Line numbers may have drifted; V7 captures actual lines at execution time.

### Locked: Item #2 partial_coverage rollup (D2)

Mechanism: digest-time per-cell aggregation in SQL. NO schema migration on `probe_runs`. The threshold is `errored_replicates >= 2` (aligned with OQ-J's 2/3 majority-vote — with 2 errored, only 1 successful replicate remains and no majority is reachable either direction).

Field shape: provisional `status: 'success' | 'partial_coverage'` per spec §4.2 pseudocode. V3 captures the EXACT field shape the dead-code filters at `digest.ts:91, 96` read. Match the field name to the filter expression — do NOT introduce a new field name and leave the dead-code filters still dead.

Aggregation pseudocode (adapts to V3-captured field shape at execution):

```ts
// In the per-cell aggregation in digest.ts:
type CellAggregation = {
  provider: string;
  prompt_id: string;
  day: string;
  total_replicates: number;
  errored_replicates: number;
  cite_present: boolean;  // existing OQ-J majority-vote
  status: 'success' | 'partial_coverage';  // NEW — field name matches V3 capture
};

// Compute status:
const cellStatus = cell.errored_replicates >= 2 ? 'partial_coverage' : 'success';
```

The dead-code partial_coverage filters at `digest.ts:91, 96` become live by virtue of the upstream aggregation now producing partial_coverage cells. No code-removal needed; the filters were correctly anticipating this rollup but the rollup was never implemented.

**Cross-provider headline impact:** partial_coverage cells excluded from the cross-provider headline cite-share mean. Per-provider sections of the digest may still show partial_coverage cells (with a label) so the operational signal isn't lost.

### Locked: Item #3 headline filter branches (D3-a / D3-b)

**Action depends on V4 field-semantics resolution.**

**If V4 → observations includes errored probes (D3-a):** modify the filter at `digest.ts:167-170`:

```ts
// Current:
const providersWithData = providerAggregations.filter((p) => p.observations > 0);

// New:
const providersWithData = providerAggregations.filter(
  (p) => p.observations > 0 && !(p.cite_share === 0 && p.error_count === p.observations)
);
```

**If V4 → observations is successful-only (D3-b):** NO CODE CHANGE. The existing `observations > 0` filter is already correct under that semantics. ADD a code comment per D3-b to document why no change is needed:

```ts
// The existing observations > 0 filter is sufficient: under "observations =
// successful-only" semantics, any provider that was 100% errored has
// observations=0 and is already excluded. Adding a separate error-rate check
// would be redundant AND would risk dropping the never-queried-edge-case
// safety. Verified at B1.2 v3 review.
const providersWithData = providerAggregations.filter((p) => p.observations > 0);
```

**Disposition for per-provider section under D3-b:** confirm during execution that the per-provider section uses an unfiltered aggregation source (not the filtered `providersWithData` array). If the per-provider section IS using the filtered `providersWithData` array as its source: halt and report. This indicates a pre-existing scope question out of B1.2's bug-fix scope; escalate as a future micro-slice rather than expanding B1.2 to fix it.

### Locked: Item #1 spec doc bump (D1)

Edit the citation-tracking base spec (V2 confirms path — likely `F:/pharos/citation-tracking/SPEC.md` or `F:/pharos/citation-tracking/pharos-citation-tracking-spec.md` or similar):

1. Update title/header version marker: `v5.1` → `v6`
2. Update the retry-delay value: `30s` → `5s`
3. Add Finding 2 rationale verbatim from B1 ship-report (retry delay locked at 5s after B1 deploy round; spec doc lagged at 30s pending this update)
4. (Optional per D7 disposition) Add OQ-J denominator-semantics paragraph if a natural section exists. 1-2 sentences max: "Under intermittent failures, the OQ-J ≥2/3 denominator counts all replicates including errored ones; once #2's partial_coverage rollup lands, errored cells are excluded from the cross-provider headline so the denominator-error sensitivity is bounded to per-provider sections only."

---

STEPS:

# 0. Pre-flight verification + V-reads (V1-V8)

```bash
cd F:/pharos
git status
# Working tree clean or only WIP unrelated to this slice (V1).

cd F:/pharos/citation-tracking

# V8 regression baselines (capture BEFORE any changes):
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM probe_runs;"
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM digests;"
# Expected: probe_runs growing daily since B1 ship 2026-05-04 (~324-360+ at deploy time;
#            hard floor ≥180 baseline from B1.1 cycle 48ed50d6).
#          digests=1 (unchanged since B1.1 Phase 2 ship 2026-05-06; next natural increment is
#            2026-06-01 14:00 UTC when first scheduled monthly cron fires).

# V2 spec doc location for item #1:
ls F:/pharos/citation-tracking/SPEC.md 2>&1
ls F:/pharos/citation-tracking/pharos-citation-tracking-spec.md 2>&1
ls F:/pharos/citation-tracking/README.md 2>&1
# Capture which exists; that's where item #1's edits land.

# Production-worker regression baseline (B1/B1.1 + others operational):
curl -sI https://astrant.io | head -5
curl -sI https://scanner.astrant.io/health | head -5
curl -sI https://mcp.astrant.io/.well-known/mcp.json | head -5
# customer-mcp wildcard route — single-label slug to exercise wildcard DNS + routing (404 is correct):
# NOTE: must be single-label (no dots) because wildcard *.mcp.astrant.io matches single-label only.
# Slug validator regex [a-z0-9-]+ also doesn't allow dots, so dotted forms couldn't be real customers anyway.
curl -sI https://test-nonexistent-b12.mcp.astrant.io | head -5
```

**V3 (item #2 digest.ts surface):**

Read `F:/pharos/citation-tracking/src/digest.ts` lines 80-100 + 167-180 (per CLI's earlier capture; line numbers may have drifted). Specifically capture:

1. **The exact dead-code filter expression at lines 91 + 96.** Possible field shapes the filters might read:
   - `cell.status === 'partial_coverage'`
   - `cell.coverage === 'partial'`
   - `cell.partial_coverage === true`
   - Something else
   Capture verbatim. Item #2's aggregation output MUST match this exact field shape.
2. The per-cell aggregation point (where rows from probe_runs are grouped by (provider, prompt_id, day))
3. The OQ-J majority-vote logic at line 111

If line numbers have shifted significantly (more than ~20 lines off), confirm by content (search for `partial_coverage` string in digest.ts) and re-anchor.

**V4 (item #3 observations field semantics):**

Read `F:/pharos/citation-tracking/src/digest.ts` near the provider-aggregation point. Determine:
- Does `observations` count (a) total probes attempted INCLUDING errored, or (b) successful probes only?

The answer determines item #3's branch:
- (a) → D3-a applies (modify filter to add the 100%-errored exclusion clause)
- (b) → D3-b applies (NO code change required; add comment per locked text above)

If the answer is ambiguous (e.g., observations is computed but the source rows could be either interpretation depending on a prior filter), halt and re-scope.

**V5 (item #5 codebase-wide grep — confirm single-point edit suffices):**

```bash
grep -rn "training corpora" F:/pharos/
```

Expected: matches ONLY in `F:/pharos/citation-tracking/src/digest-template.ts` (the single location item #5 modifies).

If matches appear elsewhere — marketing-site preview, email templates, README, llms.txt, methodology page, anywhere else — HALT AND REPORT. Expand item #5's scope to cover all sites with per-context audit (the locked D4 text is digest-specific; other contexts may need their own audit-tightened replacements). DO NOT copy-paste D4 text to non-digest sites without re-auditing.

**V6 (item #6 probe-trigger current shape):**

Read `F:/pharos/citation-tracking/src/index.ts` lines 70-85 to confirm the `/api/internal/probe-trigger` handler currently uses `ctx.waitUntil(runProbeCycle(env))` and returns a Response with a misleading "full cycle initiated" message. The behavior stays (ctx.waitUntil is correct for smoke path); only the message changes per item #6.

**V7 (item #7 Env interface location + storage.ts logging shape):**

```bash
# Find Env interface declaration:
grep -rn "interface Env" F:/pharos/citation-tracking/src/
# Confirms whether Env lives in types.ts, index.ts, or elsewhere.

# Find storage.ts console.log calls (capture exact lines):
grep -n "console\.log\|console\.error" F:/pharos/citation-tracking/src/storage.ts
```

Capture:
- Env interface file path (where Step A edits land)
- Exact `console.log` line numbers (Step B targets these; CLI's earlier capture was lines 24, 27, 35, 36, 42, 86, 92, 94 — may have drifted)
- Exact `console.error` line numbers (these stay UNgated per D6)
- Whether `storage.ts` already reads from `env` parameter at function entry, or if `env` needs to be threaded through (OQ-3 effort estimate)

If V7 reveals env needs threading through helper functions (vs. already-available pattern), note effort grows from ~15 min to ~30 min for item #7. Proceed.

# 1. Idempotency check (3 markers — trimmed scope)

```bash
cd F:/pharos/citation-tracking

# Item #1 — SHIPPED Cowork-side 2026-05-12; no F:\-side marker check.
# (Items #2 and #3 are deferred to B1.2-followup — no markers checked here.)

# Item #5 prose template marker:
grep -F "baseline window precedes threshold-lock" src/digest-template.ts

# Item #6 probe-trigger message marker:
grep -F "Probe smoke-test initiated" src/index.ts

# Item #7 Env interface + storage.ts gate markers (Env in index.ts per V7, no types.ts):
grep -F "DEBUG_PROBE_LOGS" src/index.ts src/storage.ts 2>&1 | head -10
```

Branch resolution:
- All 3 markers present → ALREADY SHIPPED. Skip to Step 10 verification only.
- Some present → resume at the appropriate item step.
- None present → GREENFIELD; proceed from Step 2.

# 2. Item #1 — SHIPPED Cowork-side; no F:\-side action

Item #1 (spec doc v5.1 → v6) ships in OneDrive workspace at `pharos-citation-tracking-instrumentation-spec.md`, not F:\. Already completed 2026-05-12 by Cowork. Skip to Step 3.

# 3. Item #6 — `/api/internal/probe-trigger` response message

Edit `F:/pharos/citation-tracking/src/index.ts` lines ~76-79 (V6 confirmed location):

Replace the existing Response body text with the LOCKED CONTENT verbatim. **Preserve `status: 202`** (HTTP-semantically correct for ctx.waitUntil-deferred work; downgrading to 200 would lie about completion — spec D5 amended in v6):

```ts
return new Response(
  'Probe smoke-test initiated. Note: fetch-handler wall-time cap ~30s means only the first few batches will complete; full cycles run via scheduled cron only (daily 0 2 * * * UTC). Check D1 probe_runs for partial results.',
  { status: 202 }
);
```

No behavior change. `ctx.waitUntil(runProbeCycle(env))` stays as-is.

# 4. Item #7 — Step A: Env interface declaration

Edit the Env interface in `src/index.ts:4-11` (V7 confirmed no `src/types.ts` file exists; Env lives inline in index.ts):

Add the optional binding to the Env interface per LOCKED CONTENT:

```ts
DEBUG_PROBE_LOGS?: string;
```

This MUST land before Step 5 (storage.ts changes) — otherwise the storage.ts code reads `env.DEBUG_PROBE_LOGS` against an unrecognized field and TypeScript flags it.

# 5. Item #7 — Step B: storage.ts logging gate

Edit `F:/pharos/citation-tracking/src/storage.ts` at the lines V7 captured (CLI's earlier capture: 24, 27, 35, 36, 42, 86, 92, 94; may have drifted — use V7's actual lines):

For EACH diagnostic `console.log` call:
- Wrap behind `if (DEBUG) { ... }` where `DEBUG = env.DEBUG_PROBE_LOGS === '1'`

For EACH FATAL / DB-failure `console.error` call:
- Leave UNgated. These are ops-signal.

If V7 revealed env needs threading through helper functions (vs. already-available at function entry), thread `env` as an explicit parameter. Pattern:

```ts
function insertBatch(env: Env, ...) {
  const DEBUG = env.DEBUG_PROBE_LOGS === '1';
  if (DEBUG) console.log('[storage] inserting batch', ...);
  // ... existing logic with console.error calls remaining UNgated
}
```

Default state: `DEBUG_PROBE_LOGS` unset → all diagnostic logs suppressed. Opt-in via `wrangler secret put` when actively debugging.

# 6. Item #5 — OQ-P §Astrant=0 prose template rewrite

Edit `F:/pharos/citation-tracking/src/digest-template.ts:10` (or wherever `ASTRANT_BASELINE_ZERO_TEMPLATE` is defined per V5):

Replace the existing template text with the LOCKED CONTENT D4 text verbatim:

```ts
export function ASTRANT_BASELINE_ZERO_TEMPLATE(periodStart: number): string {
  return `*Astrant cite-share this month: 0%. Baseline phase — model-side cite-share signal not yet detected. Per the methodology, the baseline window precedes threshold-lock; once baseline cite-share patterns are established, subsequent cite-share emergence is measured against them.*`;
}
```

**CRITICAL — pre-share audit before commit (CRITICAL CONTENT BOUNDARY):**

The new text MUST be verified to NOT contain:
- "training corpora" (the v3 causal claim being stripped)
- "month 2-3" (the v3 temporal claim being stripped)
- Any other unverified causal or temporal claims

Run these greps post-edit:

```bash
grep -F "training corpora" src/digest-template.ts && echo "FAIL: training corpora still present" || echo "PASS: training corpora absent"
grep -F "month 2-3" src/digest-template.ts && echo "FAIL: month 2-3 still present" || echo "PASS: month 2-3 absent"
grep -F "baseline window precedes threshold-lock" src/digest-template.ts && echo "PASS: new text present" || echo "FAIL: new text absent"
```

All three must pass.

# 7-8. Items #2 and #3 — DEFERRED to B1.2-followup micro-slice

V-read drift halted these items 2026-05-12 mid-deploy:
- **Item #2:** spec premise was structurally wrong (storage.ts has no upstream writer for `partial_coverage`; lines 91, 96 in digest.ts are dead code for a different reason than v5 described). Option A (cell-level rollup in DayLevelObservation aggregation loop) locked for when re-shipped. Skip in this deploy.
- **Item #3:** D3-a's `error_count === observations` clause compares cell-count vs row-count (different units) — semantically meaningless. D3-b's "no code change + comment" is correct conclusion under Option A's cell-level skip semantics, but comment text depends on item #2 landing first. Skip in this deploy.

**Do NOT auto-apply item #2 or item #3 changes even if V-reads suggest patterns that fit.** Halt and report if you find yourself considering edits to `digest.ts` aggregation logic or filter clauses.

# 9. Deploy

```bash
cd F:/pharos/citation-tracking
./node_modules/.bin/wrangler deploy 2>&1 | tail -20
```

Capture worker version ID from output. Confirm:
- Build succeeds (no TS errors)
- D1 binding pharos-citation-tracking present
- KV bindings (if any) present
- Cron `0 2 * * *` (probe) + `0 14 1 * *` (digest) BOTH listed unchanged
- Routes unchanged

# 10. Phase 1 verification — code inspection per item

Confirm via grep (without re-running endpoints):

- **Item #1:** SHIPPED Cowork-side (`pharos-citation-tracking-instrumentation-spec.md` v5.1 → v6) — no F:\-side check.
- **Items #2 + #3:** DEFERRED to B1.2-followup — no F:\-side check.
- **Item #5:** `digest-template.ts` returns the new prose template text (greps in Step 6 already verified)
- **Item #6:** `index.ts` returns the new probe-trigger message AND `status: 202` preserved (grep `Probe smoke-test initiated` + verify the status arg is 202 not 200)
- **Item #7 (two surfaces):**
  - `src/index.ts:4-11`: Env interface declares `DEBUG_PROBE_LOGS?: string` (V7 confirmed Env lives inline in index.ts; no `src/types.ts` file)
  - `storage.ts`: diagnostic console.log calls gated behind `DEBUG_PROBE_LOGS`; console.error calls ungated

# 11. Phase 2 verification — deploy + smoke

Set up auth token (B1's existing PROBE_AUTH_TOKEN; should already be in your shell env or password manager):

```bash
AUTH_TOKEN="<the-existing-PROBE_AUTH_TOKEN-secret-value>"
WORKER_URL="https://pharos-citation-tracking.pharos-dev.workers.dev"
```

**Item #5 prose template (two-step with precondition guard):**

Step A — call `/api/internal/digest-preview` and check whether the §Astrant=0 prose section is present:

```bash
curl -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  "${WORKER_URL}/api/internal/digest-preview" > /tmp/digest-preview.md
grep -iE "baseline phase|astrant cite-share this month" /tmp/digest-preview.md
```

Step B — branch on result:
- **If §Astrant=0 section present** (Astrant cite-share still 0% — expected at deploy time): verify content matches D4's locked text:
  ```bash
  ! grep -q "training corpora" /tmp/digest-preview.md  # MUST be true (string absent)
  ! grep -q "month 2-3" /tmp/digest-preview.md         # MUST be true (string absent)
  grep -q "baseline window precedes threshold-lock" /tmp/digest-preview.md  # MUST be true (string present)
  ```
- **If §Astrant=0 section absent** (cite-share went non-zero by deploy time — unexpected but possible): the firing rule correctly suppressed the §Astrant=0 prose. Fall back to source-grep verification:
  ```bash
  grep -F "baseline window precedes threshold-lock" F:/pharos/citation-tracking/src/digest-template.ts
  ! grep -F "training corpora" F:/pharos/citation-tracking/src/digest-template.ts
  ! grep -F "month 2-3" F:/pharos/citation-tracking/src/digest-template.ts
  ```

Document which branch applied in the ship-report.

**Item #6 probe-trigger:**

```bash
curl -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  "${WORKER_URL}/api/internal/probe-trigger"
# Expected response body: "Probe smoke-test initiated. Note: fetch-handler wall-time cap ~30s
# means only the first few batches will complete; full cycles run via scheduled cron only
# (daily 0 2 * * * UTC). Check D1 probe_runs for partial results."
```

Verify the response matches the locked D5 text.

**Item #7 logging (manual probe-trigger to exercise storage logging code paths):**

In one terminal:
```bash
./node_modules/.bin/wrangler tail pharos-citation-tracking
```

In another terminal:
```bash
curl -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  "${WORKER_URL}/api/internal/probe-trigger"
```

Expected in `wrangler tail`:
- NO `[storage]` diagnostic lines (DEBUG_PROBE_LOGS is unset by default)
- Only `console.error` lines IF any FATAL/DB-failure occurs during the smoke cycle (unlikely)

If diagnostic lines appear: item #7 didn't gate correctly. Re-inspect storage.ts.

**Items #2, #3 partial_coverage + headline filter:**

These are latent until errored cells exist (item #2) or until a 100%-errored provider exists (item #3). Verify via code inspection of digest-preview Markdown:

```bash
# If digest-preview Markdown shows any partial_coverage cells: confirm they're excluded from headline math.
# If no partial_coverage cells exist (clean B1 operation): code inspection of digest.ts suffices.
grep -i "partial_coverage\|partial coverage" /tmp/digest-preview.md | head -10
```

Either path produces a PASS for item #2 (code inspection verified) and item #3 (code inspection verified or branch-D3-b comment verified).

# 12. Phase 3 verification — regression on B1/B1.1 + production Workers

```bash
# B1/B1.1 baselines from V8 — counts should match or grow:
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM probe_runs;"
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM digests;"
# probe_runs ≥ V8-captured baseline (grows by next probe cycle).
# digests = 1 (unchanged until 2026-06-01 14:00 UTC).

# Production-Worker regression — all five Workers' health endpoints:
curl -sI https://astrant.io | head -3
curl -sI https://scanner.astrant.io/health | head -3
curl -sI https://mcp.astrant.io/.well-known/mcp.json | head -3
curl -sI https://test-nonexistent-b12.mcp.astrant.io | head -3
# customer-mcp wildcard route should still 404 (no such customer)
```

All should match Step 0 baselines. If any production Worker has regressed, halt and investigate — should be impossible since B1.2 only touched citation-tracking source.

# 13. Phase 4 verification — idempotency

Re-run this entire deploy prompt. Step 1 idempotency check should identify all 6 markers and halt cleanly with "ALREADY SHIPPED."

# 14. Output ship-report + commit

Write `F:/pharos/reports/citation-tracking-b1.2-deploy-<YYYY-MM-DD>.md` with:

```
# B1.2 Citation-Tracking Polish — <YYYY-MM-DD>

## Files modified — citation-tracking
- src/digest.ts (item #2 partial_coverage rollup + item #3 D3-a OR D3-b branch)
- src/digest-template.ts (item #5 prose template rewrite)
- src/index.ts (item #6 probe-trigger response message)
- src/storage.ts (item #7 console.log gating behind DEBUG_PROBE_LOGS)
- src/types.ts (item #7 Env interface DEBUG_PROBE_LOGS declaration — path may differ per V7)

## Files modified — spec/docs
- <spec-doc-path-per-V2> (item #1 v5.1 → v6 + retry-delay 5s + Finding 2 rationale)

## V-read resolutions (execution-time-determined)
- V2 spec doc path: <path>
- V3 dead-code filter field shape: <captured-shape>
- V4 observations semantics: <(a) includes errored | (b) successful-only>
- V5 codebase-wide "training corpora" grep: <single-point edit OR list of additional sites>
- V6 probe-trigger current shape: <captured>
- V7 Env interface location: <path>; storage.ts log lines: <captured>; env access pattern: <ready | needs-threading>
- V8 baseline: probe_runs=<N>, digests=<N>

## Item #3 branch
- D3-a OR D3-b (per V4)

## Phase 1 verification (code inspection — trimmed scope)
- Item #1: SHIPPED Cowork-side (`pharos-citation-tracking-instrumentation-spec.md` v5.1 → v6); no F:\-side check
- Items #2 + #3: DEFERRED to B1.2-followup; not in this Phase 1
- Item #5 prose template new text: PASS|FAIL
- Item #6 probe-trigger message + status 202 preserved: PASS|FAIL
- Item #7 Env interface declaration in index.ts (no types.ts) + storage.ts gating: PASS|FAIL

## Phase 2 verification (deploy + smoke — trimmed scope)
- Item #5 §Astrant=0 prose section present in digest-preview (or fallback to source-grep): PASS|FAIL
  - Branch applied: <preview-content-check OR source-grep-fallback>
- Item #6 probe-trigger response body text matches D5 AND status code = 202: PASS|FAIL
- Item #7 wrangler tail shows no [storage] diagnostic lines during manual probe-trigger: PASS|FAIL
- Items #2 + #3: not exercised (deferred)

## Phase 3 verification (regression)
- citation-tracking probe_runs count ≥ baseline: PASS|FAIL
- citation-tracking digests count = 1: PASS|FAIL
- marketing-site at astrant.io: PASS|FAIL
- scanner.astrant.io: PASS|FAIL
- mcp.astrant.io: PASS|FAIL
- customer-mcp wildcard route: PASS|FAIL

## Phase 4 verification (idempotency)
- Re-run halts at Step 1 with ALREADY SHIPPED: PASS|FAIL

## Locked content audit
- Item #5 D4 text matches verbatim: PASS
- Item #5 "training corpora" string absent from digest-template.ts: PASS
- Item #5 "month 2-3" string absent from digest-template.ts: PASS
- Item #6 D5 text matches verbatim: PASS
- Item #7 D6 Env interface declaration matches: PASS
- Scheduled handler still uses await runProbeCycle (no regression to ctx.waitUntil): PASS
- Bare wrangler deploy (NOT cf:deploy): PASS

## Cost
- Deploy: ~$0 (no LLM-API calls in B1.2 itself)
- Recurring: ~$0/mo added (existing citation-tracking spend unchanged at ~$30-40/mo at production cadence)

## Sweep-discipline data points (spec v1→v5 + deploy-prompt v1→v3 trajectory; queue for memory update after slice ships)
- Spec v2→v3: D3-b regression caught via case-by-case logic walk (enumerate all reachable input cases, not pattern-match filter shape)
- Spec v3→v4: stale "v2 spec" string-references sweep miss (every round-bump sweep includes grep for v<prior-round> across whole spec body)
- Spec v4→v5: recursive irony — documentation of a pattern doesn't substitute for execution of the pattern
- **Deploy-prompt v1→v2: verification-layer bugs surface at deploy-prompt review, not spec review.** Dotted hostname (DNS resolution semantics) + non-discriminating grep marker (pre/post state distinguishability) — both are verification-correctness bugs that the spec didn't flag because spec rounds operate on locked decisions and architectural invariants, not on the actual grep/curl/DNS commands that verify the deployed state. **Generalization:** deploy-prompt review is its own review surface with its own bug class (verification-layer correctness). Spec rounds verify what gets shipped; deploy-prompt rounds verify HOW it gets verified. The two surfaces don't substitute for each other.
- **Deploy-prompt v2→v3: archive filename round-number sweep miss.** Same root cause as Spec v3→v4 (round-number body-references sweep miss) — bumped header version marker but missed the body reference (here, the archive filename in the commit command). The recursive-application meta-pattern from Spec v4→v5 also applies: the sweep-discipline memory documents this exact class of miss, and yet the deploy prompt reproduces it. Confirms: documentation describes the pattern, execution applies it, separate acts even within the same conversation.

## Notes / open follow-ups
- Items #4 (OQ-J denominator doc) and #8 (cycle-start timestamp) explicitly deferred per spec §1.
- Hard deadline 2026-06-01 14:00 UTC for item #5 satisfied (text shipped before first scheduled digest).
- Next slice: B1.3 multi-tenant citation-tracking (unblocks F2 Implementation fulfillment).

## Convergence-pattern data point
- Round count: 5 spec rounds (v1→v5) + 1 deploy-prompt round (v1) + ~1.5-2h execution. Narrow-extension category, one round above projected 3-4 upper bound (sweep-discipline polish in v4 + v5), well within 6-round re-scope boundary. Trajectory holding.
```

Print "DONE" and the path to the report file.

Then commit with the message body only (NO Co-Authored-By footer, NO 🤖 Generated with Claude Code, NO any equivalent attribution per C3):

```bash
cd F:/pharos
git add citation-tracking/ reports/citation-tracking-b1.2-deploy-<YYYY-MM-DD>.md <spec-doc-path>
git commit -m "B1.2: citation-tracking instrumentation polish

Closes 6 items from the B1/B1.1 instrumentation review:
- #1 spec doc v5.1 → v6 (retry-delay 5s + Finding 2 rationale)
- #2 partial_coverage rollup at digest-time (dead-code filters now live)
- #3 headline filter excludes 100%-errored providers (D3-a or D3-b per V4)
- #5 OQ-P prose template rewrite (strips causal/temporal unsupported claims)
- #6 probe-trigger response message honest about ~30s wall-time cap
- #7 storage.ts diagnostic logs gated behind DEBUG_PROBE_LOGS

Items #4 and #8 explicitly deferred per spec §1. Hard deadline 2026-06-01 14:00 UTC
on item #5 met."
```

Then archive the deploy prompt itself per the OQ-02 convention (`oq02-deploy-prompt-v2.md` archived the version that actually shipped; same pattern here):

```bash
cp "C:/Users/dembo/OneDrive/Documents/Claude/Projects/Solo Startup SaaS/pharos-citation-tracking-b1.2-deploy-prompt.md" \
   "F:/pharos/reports/citation-tracking-b1.2-deploy-prompt-v4.md"
git add reports/citation-tracking-b1.2-deploy-prompt-v4.md
git commit -m "B1.2: archive deploy prompt alongside ship-report

Per the convention established by OQ-02 archive commit 0bbad8e. Archived
deploy prompt is the v4 version (v1 had 2 MEDs + 1 MED-LOW caught by CLI
review; v2 had a LOW filename sweep miss; v3 had no review issues; v4 is
the trimmed scope after V-read drift halt — items #2 and #3 deferred to
B1.2-followup; v4 is what executed)."
```

DO NOT:
- Touch any other production Worker source tree (`F:/pharos/marketing-site/`, `F:/pharos/scanner/`, `F:/pharos/mcp-server/`, `F:/pharos/customer-mcp/`) — B1.2 is citation-tracking only (per C4)
- Use `npm run cf:deploy` for citation-tracking (it's a plain Worker, not OpenNext — per C1)
- Regress the scheduled handler to `ctx.waitUntil(runProbeCycle(env))` (B1 Finding 1 fix preserved — per C2)
- Change probe-trigger's `ctx.waitUntil` behavior (only the response MESSAGE changes per item #6; the wall-time-bounded smoke behavior IS the intended pattern)
- Include any Co-Authored-By, 🤖 Generated with Claude Code, or equivalent attribution in commits (per C3)
- Add items #4 (OQ-J denominator doc) or #8 (cycle-start timestamp) — explicitly deferred per spec §1 and C8
- Paraphrase or "improve" the locked D4 prose template text in item #5 (CRITICAL CONTENT BOUNDARY — audit-tightened across v3 → v5 spec rounds; inline verbatim)
- Add a partial_coverage column to the `probe_runs` schema (D2 explicitly avoids schema migration — digest-time rollup only)
- Guess at V3 field shape or V4 semantic if the actual code differs from spec assumptions — halt and re-scope (per C9)
- Skip any of Phase 1-4 verifications or commit before all PASS (per C7)
- Skip the codebase-wide "training corpora" grep in V5 (single-point edit assumption — fails silently if there's drift)
- Auto-fix any NEW issues discovered during execution — report at end-of-run only (per C8)
```

---

## After Claude Code finishes

Bring the ship-report (or its contents) back to chat. Verify:

1. All 4 phases PASS (code inspection / deploy+smoke / regression / idempotency).
2. Locked content audit PASS lines — especially item #5 verbatim D4 text + scheduled-handler-still-uses-await + no-cf:deploy.
3. Production-Worker regression check PASS (no marketing-site / scanner / mcp / customer-mcp regression).
4. Item #3 branch documented (D3-a or D3-b).
5. V-read resolutions captured for memory update.

**Post-ship Cowork-side memory updates queued:**

- `project_live_services.md` — add B1.2 ship state to citation-tracking section (worker version, commit, item disposition list, deferred items #4/#8)
- `feedback_locked_decision_propagation_sweep_discipline.md` — fold 3 new sweep-discipline data points (case-by-case logic walk; round-number body-references sweep; recursive-application: documentation ≠ execution) as items #12-#14 in the checklist + the 3 data point narratives
- `feedback_locked_architecture_narrower_surface_convergence.md` — add B1.2 as 5th data point (narrow-extension category; 5 spec rounds — one above projected upper bound but within re-scope boundary)

**Post-deploy follow-ups (NOT part of B1.2):**

1. **B1.3 multi-tenant citation-tracking** — ships next. Schema extension + per-customer prompt support. Unblocks F2 Implementation fulfillment's "monitoring wired" deliverable.
2. **F2 Implementation fulfillment** — depends on B1.3 + OQ-02 (already shipped).
3. **F3 AutoPilot + F4 Concierge** — week 3.
4. **Privacy 5th-bullet + E2E + /security-review + gate-revert** — week 3-4.
5. **First organic-discovery customer window opens** — after gate-revert lands.
