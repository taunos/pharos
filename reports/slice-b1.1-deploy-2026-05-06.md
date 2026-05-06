# Slice B1.1 — Citation-Tracking Digest — 2026-05-06

## Files created
- pharos/citation-tracking/src/version.ts
- pharos/citation-tracking/src/digest.ts
- pharos/citation-tracking/src/digest-template.ts
- pharos/citation-tracking/migrations/0002_digests.sql
- reports/slice-b1.1-deploy-prompt-v1.md (deploy prompt artifact, with 5 CLI-review fixes folded in pre-execution)

## Files modified
- pharos/citation-tracking/src/index.ts — added scheduled-handler digest routing (`0 14 1 * *`); two new auth-protected endpoints (`/api/internal/digest-preview`, `/api/internal/digest-trigger`); cleaned up B1's debug-cron fallbacks (`*/5 * * * *`, `12 22 * * *`, `35 22 * * *`); preserved Finding 1 `await runProbeCycle(env)` for the production probe cron.
- pharos/citation-tracking/wrangler.jsonc — added `0 14 1 * *` to `triggers.crons` array.

## D1 migration
- Migration `0002_digests.sql` applied to `pharos-citation-tracking` (db `2fff74f3-857b-47c9-917f-d03cfb93f063`)
- `digests` table + `idx_digests_period` UNIQUE INDEX verified post-apply (3 commands executed: CREATE TABLE + CREATE UNIQUE INDEX + d1_migrations row)

## Phase 1 deploy
- Worker version ID: `18043745-d2b1-4323-9e55-1bb8d0e81a9f`
- Both crons confirmed in deploy output:
  - `schedule: 0 2 * * *` (existing B1 probe)
  - `schedule: 0 14 1 * *` (NEW B1.1 digest)
- Total upload: 59.50 KiB / gzip 14.15 KiB; worker startup 19 ms

## Phase 1 verification (digest-preview smoke test)
- Endpoint hit: `GET /api/internal/digest-preview` (auth: Bearer PROBE_AUTH_TOKEN constant-time-compare)
- Returned: HTTP 200 OK, `Content-Type: text/markdown; charset=utf-8`, 3193-byte Markdown body
- All 9 sections render: **PASS**
- Engine version footer present (`citation-tracking:v1`): **PASS**
- Empty sections labeled correctly:
  - Trend section → `*Insufficient data for trend analysis; this is the first digest...*` **PASS**
  - Vocabulary D2 → `*No coined-term mentions detected this period...*` **PASS**
  - Per-prompt with no cites → `*No cites detected in this axis this period.*` **PASS** (NOT bare `0%`)
- OQ-P §Astrant=0 prose template fires (headline=0% in baseline phase): **PASS** (renders the audit-tightened v3-v4 template, not bare numeric)
- Per-provider section lists 4 providers (OpenAI / Anthropic / Perplexity / Gemini): **PASS** — each with 15 day-level observations, 0% cite share, 1 OpenAI error matching cycle 48ed50d6
- D3 Profound competitor cite captured: **PASS** — 5 day-level cite-firing observations
- Period header correctly labeled "May 2026 (partial — 2026-05-06 through 2026-05-31 = 26 days; subsequent digests cover full calendar months)" per OQ-R + OQ-S: **PASS**

## Phase 2 verification (digest-trigger write path + idempotency)
- First fire: `POST /api/internal/digest-trigger` returned HTTP 200 OK, body `{"row_id":1,"period_start":1778025600,"period_end":1780272000,"generated_at":1778102951}`
- D1 row verified: `id=1`, `period_start=1778025600` (=2026-05-06T00:00:00Z, MIN(timestamp) snap to UTC midnight per OQ-S), `period_end=1780272000` (=2026-06-01T00:00:00Z), `length(markdown)=3193`, `digest_version='citation-tracking:v1'`: **PASS**
- Re-fire idempotency check: second POST returned `row_id=2` (SQLite INSERT OR REPLACE creates new AUTOINCREMENT id on REPLACE — DELETE-then-INSERT semantics); D1 verified `count=1`, `max_id=2`, `max_gen` advanced from `1778102951` to `1778102958`: **PASS** (single row preserved at unique-index level)

## Locked content audit
- OQ-N 9-section structure ingested verbatim: **PASS**
- OQ-N empty-section discipline (Trend / D2 / per-prompt-no-cites): **PASS**
- OQ-N/OQ-P firing-rule reconciliation (baseline-phase 0% → prose template; else bare numeric): **PASS** — verified via headline render in digest-preview
- OQ-O `citation-tracking:v1` engine version + version-bump trigger conditions: **PASS** — stamped in `version.ts` + footer
- OQ-P §Astrant=0 prose template (audit-tightened v3-v4 final form): **PASS** — verbatim in `digest-template.ts`
- OQ-Q two-stage commit pipeline + `digests` D1 schema: **PASS** — Worker-side complete; commit-pipeline routine is post-deploy Bruno-side work
- OQ-R first-month partial-month annotation (26 days, NOT 25 — v1→v2 spec arithmetic fix): **PASS**
- OQ-S half-open UTC interval + MAX(month_start, MIN(timestamp)) snap (always-on): **PASS**
- OQ-T INSERT OR REPLACE on unique index (idempotency at schema level): **PASS** — verified via re-fire
- OQ-U `/api/internal/digest-preview` GET, inline Markdown response: **PASS**
- OQ-V `/api/internal/digest-trigger` POST, 200 OK + row-id JSON: **PASS**

## Cron status (post-deploy)
- Probe cron `0 2 * * *` still operational (B1 — Finding 1 `await runProbeCycle(env)` preserved): **PASS** (visible in deploy output)
- Digest cron `0 14 1 * *` deployed (next fire 2026-06-01 14:00 UTC): **PASS**
- Debug-cron fallbacks removed (`*/5 * * * *`, `12 22 * * *`, `35 22 * * *`): **PASS** — scheduled handler now strict 2-cron routing with default-case `console.warn`

## Deploy-prompt CLI-review fixes folded in pre-execution
1. Step 7c snippet: `ctx.waitUntil(runProbeCycle(env))` → `await runProbeCycle(env)` — would have regressed B1's Finding 1 wall-time fix
2. Step 0 `wrangler secret list --name X` → `wrangler secret list` (no `--name` flag on `secret list`)
3. Added Windows/Git-Bash `wrangler` not-on-PATH note (must use `./node_modules/.bin/wrangler` from `citation-tracking/`)
4. Step 2 `grep -F` escaping: `'0 14 1 \* \*'` → `'0 14 1 * *'`
5. Month-indexing convention unified to 0-indexed throughout (matching `getUTCMonth()`); OQ-S snippet rewritten

## Out-of-scope (deferred to post-deploy Bruno-side work)
- Claude Code routine for commit-and-push pipeline (Q1 two-stage). Pattern mirrors existing checkpoint routines `trig_011xEUas6bb44kHHFzxw1Hr1` + `trig_01KS2t9MgAyqAgfgiJrJvWiT`. Scheduled monthly day 1 at 14:30 UTC (30 min after digest cron fires for D1 row reliability). Reads latest `digests` row → writes `reports/citation-tracking/YYYY-MM.md` → git commit + push.
- First scheduled digest fires 2026-06-01 14:00 UTC. Verify via `digests` table check at ~14:05 UTC + repo commit at ~14:30 UTC.
- Wipe Phase 2 test row from D1 if its content becomes stale relative to what the 2026-06-01 fire produces — OR leave it and let scheduled fire INSERT OR REPLACE the same period_start/period_end row.

## Cost
- Deploy: ~$0 (no LLM-API calls; B1.1 is SQL aggregation + Markdown emit + D1 write only)
- Recurring: ~$0 added on top of B1's ~$30-40/mo at production cadence

## Notes / open follow-ups
- **Design choice (sub-spec-level): D3 competitor detection at digest level uses any-replicate semantics** (any replicate in a `(provider, prompt, day)` group citing a competitor → competitor counted as 1 day-level observation), not majority-vote like D1.a/D1.b/D2. Spec is silent on this. For sparse competitor signals, any-replicate is more sensitive (better for "is the detection wired correctly?" verification); majority-vote would be more conservative. Worth a future spec amendment if false-positive D3 noise becomes a digest-readability concern. Current behavior: Profound rendered as 5 day-level cite-firing observations from cycle 48ed50d6's 10 underlying replicate-level detections.
- **Today's 2026-05-07 02:00 UTC probe cron has not yet fired** (current UTC 21:30 at deploy time, ~4.5h before next probe cron fire). The deploy is non-disruptive — probe cron path is unchanged. Tomorrow's verification: confirm a new probe_run_id appears in `probe_runs` (180 rows expected) and that re-firing `digest-trigger` then produces a digest reflecting both days of data.
- **Single-cycle quirk:** `probe_runs.timestamp` captures cycle-start (per B1 Finding 4), not per-row write time. So all 180 rows of cycle 48ed50d6 share `timestamp=1778032827`. The day-level grouping in `digest.ts` (`Math.floor(timestamp / 86400)`) collapses them all to 2026-05-06. Correct for a single-day cycle; will work cleanly when the second day of data arrives tomorrow.

## Next milestones
- 2026-06-01 14:00 UTC: first scheduled digest fires. Verify via D1 + commit-pipeline routine.
- Bruno: set up commit-and-push routine via /schedule before 2026-06-01 14:30 UTC.
- Months 0-2 (May/June/July 2026): baseline measurement phase. No success/failure declarations.
- Month 2-3 (~mid-July to early-August 2026): OQ-H threshold-lock amendment; if cite-share remains 0% baseline, lock against competitor-cite distribution per the prose template's stated path.
- Month 3+ (August 2026+): thresholds in force; downstream "wait for trigger" slices (Phase 1.5 parser canonicalization, V2 redesigns, Pass 4 calibration) become triggerable on observed cite-share signals.

## Spec convergence summary
B1.1 specced in 4 rounds (v1 → v4 deploy-prompt-derivable), executed in ~30 min as projected. Deploy-prompt v1 with 5 inline CLI-review fixes shipped clean on first execution — no iteration cycles. Total dev cycle: ~3-4 hours of spec rounds + ~30 min execution + ship-report. Compare to B1's 11+ spec rounds + 5h iteration. The narrower B1.1 surface (no LLM-API; no multi-provider concurrency; no wall-time risk; 9 OQs vs 13) plus B1's locked architecture made the converged-discipline pattern empirically applicable here.
