# Slice B1.1 — Citation-Tracking Digest (Claude Code Deploy Prompt) — v1

**Companion to:**
- `pharos-citation-tracking-digest-b1.1-spec.md` (v4 FROZEN — all 9 OQs N-V LOCKED). Reference doc; this deploy prompt is mechanically self-contained per the inline-constraints discipline.

**v1 fixes applied (CLI prompt-review pass against original draft):**
- Step 7c snippet: `ctx.waitUntil(runProbeCycle(env))` → `await runProbeCycle(env)` (matches deployed B1 code at citation-tracking/src/index.ts:26; the original snippet would have regressed B1's Finding 1 fix)
- Step 0 `wrangler secret list --name X`: dropped `--name` (not a supported flag on `secret list`)
- Step 0: added Windows/wrangler-PATH note (wrangler is not globally installed on this env; must use `./node_modules/.bin/wrangler` from `citation-tracking/`)
- Step 2 grep escaping: `grep -F '0 14 1 \* \*'` → `grep -F '0 14 1 * *'`
- Month-indexing convention unified to 0-indexed throughout (matches `getUTCMonth()`); OQ-S `periodMonth - 1` snippet rewritten

**Purpose.** Add the digest aggregation layer over B1's already-deployed probe pipeline. Specifically: create greenfield `digest.ts` + `digest-template.ts` + `version.ts`; add `digests` D1 table via migration `0002`; wire scheduled-handler routing for monthly digest cron; add two auth-protected fetch endpoints (`/api/internal/digest-preview` read-only smoke + `/api/internal/digest-trigger` write); clean up B1's leftover debug-cron fallbacks. After deploy, set up Claude Code routine for commit-and-push pipeline.

**Scope is much smaller than B1.** No LLM-API verification cost (digest is SQL + Markdown + git push, ~$0). No multi-provider fan-out architecture. No probe-cycle wall-time concerns (digest is read-only over D1 data, well under any wall-time budget). Single monthly fire (no overlapping-cycle hazard). Estimated deploy effort: ~30-60 min.

**Pre-deploy gate.** Before running this prompt, Bruno should:

1. **Confirm B1 is operational** — daily probe data accumulating in `pharos-citation-tracking` D1 (`probe_runs` table); cycle 48ed50d6 (Phase 2 PASS 2026-05-06) plus subsequent daily fires.
2. **Confirm `F:\pharos\` working tree is clean** (or only contains WIP unrelated to this slice).
3. **(Optional)** Skim `pharos-citation-tracking-digest-b1.1-spec.md` v4 for full rationale on each OQ lock.

Once gate passes, paste the section below into a fresh Claude Code session pointed at `F:\pharos\`.

---

```
You are deploying Slice B1.1 — Citation-Tracking Digest. This adds the monthly digest aggregation + reporting layer over B1's already-deployed probe pipeline at `F:\pharos\citation-tracking/`. No new infrastructure beyond ONE new migration + new files in `src/`. No LLM-API spend.

ENVIRONMENT NOTE: on Windows + Git Bash, `wrangler` is NOT on global PATH. All wrangler commands in this prompt must be run from `F:\pharos\citation-tracking/` as `./node_modules/.bin/wrangler ...`. The local install was put in place by B1's `npm install`.

INLINE PROJECT CONSTRAINTS (treat as hard rules — they apply across this entire prompt):

(C1) **Digest is INTERNAL instrumentation, NOT customer-facing.** Same as B1 — auth-protected internal endpoints + cron triggers only. No marketing-site integration. Verification model is D1 row counts + manually inspected Markdown output via `/api/internal/digest-preview`, NOT live-endpoint curl on www.astrant.io.

(C2) **Verify-at-endpoint discipline applies to D1 + manual-trigger output.** After deploy, query D1's `digests` table directly via `wrangler d1 execute` and confirm row shape; hit `/api/internal/digest-preview` and inspect Markdown output. Exit code is necessary but not sufficient.

(C3) **Idempotency.** This prompt is safe to re-run. Each step has an "already shipped" branch. If the slice has fully shipped (digests table exists + digest.ts + digest-template.ts + version.ts + index.ts updates + wrangler.jsonc has the digest cron), halt with "ALREADY SHIPPED."

(C4) **No `git commit` until verification PASSES.** Phase 1 + Phase 2 stay in working tree; commit happens once at end after digest-preview smoke test confirms the pipeline produces correct Markdown.

(C5) **Phase 1 / Phase 2 discipline adapted for B1.1's read-only character.** Digest path runs synchronously in both scheduled and fetch contexts; well under either's wall-time budget. Phase 1 verification happens via `/api/internal/digest-preview` (returns inline Markdown for visual inspection); Phase 2 enables scheduled cron after Phase 1 verifies clean.

CRITICAL CONTENT BOUNDARY (carries from A3 + B1):

The digest output committed to `reports/citation-tracking/YYYY-MM.md` IS a committable artifact and could surface in DD. The audit-discipline rules apply there. Specifically forbidden in any digest text:

- Internal slice labels ("Slice B1.1", "Phase 1.5") in committed digest output (digest is for internal review + DD; slice labels are dev-process artifacts, not measurement output)
- Astrant-content-leakage that reveals technique-level methodology (digest reports cite-share NUMBERS and competitor distribution; not the SQL or detection regex)

Provider names ARE allowed throughout the digest because it's an internal report (per spec OQ-P). The boundary forbidding provider names applies only to public-facing surfaces (e.g., `/methodology/calibration`), which this slice does not touch.

AUDIT-DISCIPLINE CHECKLIST (mandatory pre-step for any text the digest emits):

Before committing any text the digest renders — section headers, prose templates, error messages, ship-report — run the four-question audit:

1. **Narrower-than-truth check** — does the text specify a brand, category, or tier narrower than what the data actually shows?
2. **Broader-than-truth check** — does the text imply granular distribution properties broader than what was measured?
3. **Jargon-survivability check** — does the text use Astrant-internal jargon that fails to survive lift-in-isolation by a future reader (DD reviewer)?
4. **Dated-language check** — does the text contain temporal references that age within months as instrumentation runs?

The locked OQ-P §Astrant=0 prose template below has been audit-tightened across v3-v4 spec rounds. Halt-and-report if any check fires on text not yet present in this prompt's locked artifacts.

---

LOCKED CONTENT ARTIFACTS (verbatim from v4 spec — DO NOT modify; inline below for self-containment):

### Locked: `digests` D1 schema (OQ-Q v3 + idx_digests_period per OQ-T)

```sql
-- pharos/citation-tracking/migrations/0002_digests.sql
CREATE TABLE digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_start INTEGER NOT NULL,        -- Unix epoch seconds, UTC-aligned month start (per OQ-S)
  period_end INTEGER NOT NULL,          -- Unix epoch seconds, exclusive upper bound
  generated_at INTEGER NOT NULL,        -- Unix epoch seconds; when this row was written
  markdown TEXT NOT NULL,               -- the full digest Markdown body
  digest_version TEXT NOT NULL          -- e.g., 'citation-tracking:v1' per OQ-O
);
CREATE UNIQUE INDEX idx_digests_period ON digests (period_start, period_end);
```

The unique index enforces OQ-T idempotency at the schema level — INSERT OR REPLACE on `(period_start, period_end)` collision; a re-run with the same period replaces, doesn't append.

### Locked: version constants (OQ-O v4 + OQ-N/OQ-H reconciliation v4)

```ts
// pharos/citation-tracking/src/version.ts
export const CITATION_TRACKING_VERSION = 'citation-tracking:v1';

// OQ-N reconciliation rule constant: start of month 3 post-Phase-2-deploy.
// Deploy 2026-05-06 → month 0=May, month 1=June, month 2=July, month 3=August.
// Used by digest.ts to decide between OQ-P §Astrant=0 prose template (baseline phase 0%)
// vs bare-numeric rendering (post-baseline 0% or any non-zero).
// JS Date.UTC months are 0-indexed: month index 7 = August.
export const OQ_H_BASELINE_END = Math.floor(Date.UTC(2026, 7, 1) / 1000);  // 2026-08-01T00:00:00Z

// SCHEMA-VERSION-BUMP TRIGGERS for CITATION_TRACKING_VERSION (per OQ-O v4):
// DOES bump version: aggregation methodology changes (OQ-I weighting, OQ-D axis additions,
//                    OQ-J majority-cite threshold); digest schema changes affecting output shape;
//                    report-template structural changes (e.g., splitting per-provider into
//                    per-provider-success + per-provider-cite-share — readers comparing across
//                    versions need to know).
// Does NOT bump:     schema changes that don't affect digest output (debug-only columns);
//                    bug fixes aligning code with previously-stated methodology;
//                    cosmetic Markdown formatting (section header capitalization, table layout);
//                    section reordering (content unchanged); section renaming (content identical).
```

### Locked: 9-section Markdown structure (OQ-N v3+v4)

The digest renders 9 sections in this order. Empty-section labeling discipline applies (NEVER silently omit; NEVER render as bare 0% when the meaning is "no data yet"):

1. **Top-of-document warnings** (if any) — OQ-M model-deprecation alerts (per-provider 404-rate ≥50% in any 24h window during the period); OQ-I single-provider-only signal flags; partial-coverage rate alerts.
2. **Headline KPI section** — cross-provider-equal-weighted cite share for the month, broken down by axis. Per OQ-I Mitigation 1: `headline_cite_share = mean(per_provider_cite_share)`.
3. **Per-provider section** — cite share per (OpenAI / Anthropic / Perplexity / Gemini), with single-provider-only-signal flag annotation per OQ-I Mitigation 2.
4. **Per-prompt section** — which specific prompts produced cites; useful for understanding which queries are surfacing Astrant.
5. **Vocabulary association section (D2)** — coined-term mentions without explicit cite (deeper-ingestion-but-incomplete-attribution signal).
6. **Competitive context section (D3)** — competitor cite distribution. HubSpot AEO Grader / Profound / Ahrefs Brand Radar (direct) + Cloudflare ARS (complementary, flagged separately per OQ-D).
7. **Trend section** — month-over-month deltas vs prior digest(s); only meaningful from second digest onward. First digest renders empty-section label (see below).
8. **Operational health** — total probes attempted vs validated; partial-coverage rate; per-provider error breakdown.
9. **Methodology footer** — `Engine version: citation-tracking:v1` (from `version.ts`); digest run timestamp; link to spec for context.

### Locked: empty-section label patterns (OQ-N v2)

```ts
// First digest's Trend section:
const TREND_FIRST_DIGEST = '*Insufficient data for trend analysis; this is the first digest. Comparisons against prior months will appear from the second digest onward.*';

// Vocabulary D2 when zero hits in period:
const D2_NO_HITS = '*No coined-term mentions detected this period. D2 axis fires only when an agent surfaces "citation-confabulation methodology" without explicit Astrant cite — a deeper-ingestion-but-incomplete-attribution signal that builds slowly.*';

// Per-prompt axis with zero cites:
const AXIS_NO_CITES = '*No cites detected in this axis this period.*';  // NOT "0%" — that's misleading at small sample sizes
```

### Locked: OQ-N/OQ-P firing-rule reconciliation (v3+v4)

```ts
// digest.ts headline-cite-share rendering pseudocode:
import { OQ_H_BASELINE_END } from './version';

function renderHeadlineCiteShare(headlineShare: number, periodStart: number): string {
  if (headlineShare === 0 && periodStart < OQ_H_BASELINE_END) {
    return ASTRANT_BASELINE_ZERO_TEMPLATE(periodStart);
  } else {
    return `Astrant cite-share this month: ${headlineShare.toFixed(1)}%`;
  }
}
```

OQ-P prose template fires ONLY during baseline phase (period_start < OQ_H_BASELINE_END) when headline=0%. All other cases render bare numeric. Methodology context for post-baseline 0% lives in digest intro/footer, NOT per-section prose.

### Locked: OQ-P §Astrant=0 prose template (v4 audit-tightened)

```ts
// digest-template.ts
export function ASTRANT_BASELINE_ZERO_TEMPLATE(periodStart: number): string {
  return `*Astrant cite-share this month: 0% (baseline phase; no model-side awareness of Astrant-the-brand yet, expected for a brand-new entity that hasn't been ingested into model training corpora yet). Per OQ-H methodology, success/failure determination doesn't begin until month 2-3 threshold lock — and if cite-share remains 0% through that window, the methodology has no Astrant-side distribution to anchor against and locks instead against competitor-cite distribution as the comparison baseline against which Astrant's eventual cite-share emergence is measured.*`;
}
```

The four audit-tightenings applied across v3-v4: "no model-side awareness of Astrant-the-brand yet" (narrower-than-truth fix vs v2's "no model-side awareness yet"); "hasn't been ingested into model training corpora yet" (jargon-survivability fix vs "pre-training-corpus state"); "has no Astrant-side distribution to anchor against" (clarity fix vs "threshold-lock degenerates"); "comparison baseline against which Astrant's eventual cite-share emergence is measured" (clarity fix vs "the floor"). Spec applies the audit-discipline to its own example template.

### Locked: OQ-S aggregation-period boundary semantics (v3+v4; v1-prompt month-indexing unified to 0-indexed)

```sql
-- Half-open UTC interval; no double-counting at boundaries; no gap days
WHERE timestamp >= ? AND timestamp < ?
-- ? values: period_start (Unix seconds) and period_end (start-of-NEXT-month Unix seconds)
```

```ts
// First-digest data-driven snap (always-on, not first-digest-only — defensive against
// future deploy-pause scenarios; never triggers from month 2 onward in continuous probe operation).
// Convention: monthIndex is 0-indexed (matches JS getUTCMonth() semantics).
// Caller passes (year, monthIndex) where monthIndex is the 0-indexed month the digest covers.
const nominalMonthStart = Math.floor(Date.UTC(year, monthIndex, 1) / 1000);
const periodEnd = Math.floor(Date.UTC(year, monthIndex + 1, 1) / 1000);  // start of NEXT month

const minTimestampRow = await env.DB.prepare(
  'SELECT MIN(timestamp) AS min_ts FROM probe_runs'
).first<{ min_ts: number | null }>();
const minTsTruncated = minTimestampRow?.min_ts
  ? Math.floor(minTimestampRow.min_ts / 86400) * 86400
  : nominalMonthStart;
const periodStart = Math.max(nominalMonthStart, minTsTruncated);
```

For first digest covering 2026-05 partial month: nominal=2026-05-01, MIN(timestamp) snap=2026-05-06 → periodStart=2026-05-06 (the snap wins). For all subsequent months: periodStart=nominal month-start (snap loses).

### Locked: OQ-T idempotency (v3+v4)

```sql
-- digest writes use INSERT OR REPLACE; unique index on (period_start, period_end) enforces
INSERT OR REPLACE INTO digests (period_start, period_end, generated_at, markdown, digest_version)
VALUES (?, ?, ?, ?, ?);
```

Re-fire produces same Markdown given same input; commit-pipeline routine handles dedupe-on-commit (don't push if file content unchanged).

### Locked: OQ-U `/api/internal/digest-preview` (v4)

- Method: GET (no body needed; period via query params)
- Auth: `Authorization: Bearer ${PROBE_AUTH_TOKEN}` constant-time-compare
- Query params: `?period_start=YYYY-MM-DD&period_end=YYYY-MM-DD` (optional; defaults to "current partial month per OQ-S boundary semantics")
- Response: HTTP 200; `Content-Type: text/markdown; charset=utf-8`; body = full digest Markdown
- Behavior: read-only; runs aggregation + render but does NOT write to `digests` table
- Use case: visual smoke-testing of template formatting against real numbers before scheduled cron fires

### Locked: OQ-V `/api/internal/digest-trigger` (v4)

- Method: POST
- Auth: same `Bearer ${PROBE_AUTH_TOKEN}` pattern as OQ-U
- Query params: same as OQ-U (`?period_start=YYYY-MM-DD&period_end=YYYY-MM-DD`)
- Response: HTTP **200 OK** (NOT 202 — work is synchronous via `await`); `Content-Type: application/json`; body = `{"row_id": <id>, "period_start": <unix>, "period_end": <unix>, "generated_at": <unix>}`
- Behavior: runs aggregation + render + INSERT OR REPLACE into `digests` table per OQ-T; returns row metadata
- Does NOT trigger the commit-pipeline routine — that's a separate scheduled trigger that polls `digests` table and commits any new rows it finds
- Operational caveat: ad-hoc historical fire OVERWRITES the previously-stored digests row for that period via INSERT OR REPLACE per OQ-T. If preserving the original digest matters, copy via `wrangler d1 export` first.

### Locked: `runMonthlyDigest` signature (v4)

```ts
// pharos/citation-tracking/src/digest.ts
export async function runMonthlyDigest(
  env: Env,
  periodStart: number,  // Unix epoch seconds, UTC-aligned month start (with MIN(timestamp) snap if first digest)
  periodEnd: number,    // Unix epoch seconds, start of NEXT month
): Promise<{ row_id: number, period_start: number, period_end: number, generated_at: number, markdown: string }>;

// Internal factoring (preview vs trigger paths):
export async function aggregateAndRender(
  env: Env,
  periodStart: number,
  periodEnd: number,
): Promise<string>;  // returns Markdown without writing — used by digest-preview
```

Pure functions over given period — caller (scheduled handler OR fetch handler) is responsible for time arithmetic. No implicit "now" semantics inside.

### Locked: scheduled-handler period arithmetic (v4; 0-indexed convention)

```ts
// index.ts scheduled handler routing for digest cron:
if (event.cron === '0 14 1 * *') {
  // Digest fires on day 1 of each month at 14:00 UTC, covering the PRIOR month.
  const fireTime = new Date(event.scheduledTime);
  // fireTime.getUTCMonth() is 0-indexed; the prior month is getUTCMonth() - 1.
  const periodMonthIndex = fireTime.getUTCMonth() - 1;  // 0-indexed; can be -1 (handled by Date.UTC wrap)
  const periodYear = fireTime.getUTCFullYear();
  const nominalPeriodStart = Math.floor(Date.UTC(periodYear, periodMonthIndex, 1) / 1000);
  const periodEnd = Math.floor(Date.UTC(periodYear, periodMonthIndex + 1, 1) / 1000);

  // Apply MIN(timestamp) snap per OQ-S (always-on; usually no-op from month 2 onward)
  const minTsRow = await env.DB.prepare('SELECT MIN(timestamp) AS min_ts FROM probe_runs').first<{ min_ts: number | null }>();
  const minTsTruncated = minTsRow?.min_ts ? Math.floor(minTsRow.min_ts / 86400) * 86400 : nominalPeriodStart;
  const periodStart = Math.max(nominalPeriodStart, minTsTruncated);

  await runMonthlyDigest(env, periodStart, periodEnd);
}
```

Note: `Date.UTC(2026, -1, 1)` correctly produces 2025-12-01 (December of prior year) because JS Date.UTC handles negative month indices by wrapping. So a digest firing 2027-01-01 covering Dec 2026 works without special-case logic.

---

STEPS:

# 0. Pre-flight verification

From `F:\pharos\`:

```bash
git status
# Working tree should be clean or show only WIP unrelated to this slice. If unrelated WIP exists, halt.

ls F:\pharos\citation-tracking
# Should exist (B1 deployed); halt if not.

ls F:\pharos\citation-tracking/src/digest.ts 2>/dev/null && echo "ALREADY EXISTS — likely already shipped"
# If exists: skip to Step 2 idempotency check.

# Confirm B1 is operational and accumulating data:
cd F:\pharos\citation-tracking
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*), MIN(timestamp), MAX(timestamp) FROM probe_runs;"
# Should show >= 180 rows (Phase 2 deploy 2026-05-06 + subsequent daily fires).

# Confirm secrets are bound (we'll reuse PROBE_AUTH_TOKEN for the new endpoints):
./node_modules/.bin/wrangler secret list
# Should list at least PROBE_AUTH_TOKEN.
```

If any check fails, halt and report.

# 1. Audit-discipline checklist (defensive)

Run the 4-question audit on the locked content artifacts above (OQ-P §Astrant=0 prose template, OQ-N empty-section labels, 9-section Markdown structure, version constants). Each must produce zero violations — if any check fires, the locked text in this prompt has been modified relative to v4 spec → halt and report.

# 2. Idempotency check

```bash
ls F:\pharos\citation-tracking/src/digest.ts 2>/dev/null && echo "DIGEST.TS EXISTS"
ls F:\pharos\citation-tracking/src/digest-template.ts 2>/dev/null && echo "DIGEST-TEMPLATE.TS EXISTS"
ls F:\pharos\citation-tracking/src/version.ts 2>/dev/null && echo "VERSION.TS EXISTS"
ls F:\pharos\citation-tracking/migrations/0002_digests.sql 2>/dev/null && echo "MIGRATION 0002 EXISTS"

cd F:\pharos\citation-tracking
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='digests';"

# Has wrangler.jsonc been updated with the digest cron?
grep -F '0 14 1 * *' F:\pharos\citation-tracking/wrangler.jsonc 2>/dev/null && echo "DIGEST CRON IN WRANGLER"
```

Branch resolution:

- All present → ALREADY SHIPPED. Skip to Step 9 verification only.
- Some present → resume from the appropriate step.
- None present → GREENFIELD; proceed from Step 3.

# 3. Apply migration `0002_digests.sql`

Create the file at `pharos/citation-tracking/migrations/0002_digests.sql` with the locked schema verbatim from LOCKED CONTENT ARTIFACTS.

Apply:

```bash
cd F:\pharos\citation-tracking
./node_modules/.bin/wrangler d1 migrations apply pharos-citation-tracking --remote
```

Verify:

```bash
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
# Should output: probe_runs, digests, sqlite_sequence, _cf_KV, d1_migrations

./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT sql FROM sqlite_master WHERE name='digests';"
# Should match the locked schema verbatim, including unique index
```

# 4. Create `pharos/citation-tracking/src/version.ts`

Use the verbatim content from LOCKED CONTENT ARTIFACTS — both `CITATION_TRACKING_VERSION` and `OQ_H_BASELINE_END` exported.

# 5. Create `pharos/citation-tracking/src/digest-template.ts`

Locked Markdown templates (verbatim from LOCKED CONTENT ARTIFACTS):
- 9-section structure layout
- OQ-N empty-section labels (TREND_FIRST_DIGEST, D2_NO_HITS, AXIS_NO_CITES)
- OQ-P §Astrant=0 prose template (audit-tightened final form)
- Methodology footer using `CITATION_TRACKING_VERSION`

The file is pure template strings + small render helpers. NO aggregation logic, NO SQL — that lives in `digest.ts`. Separating template from logic keeps audit-discipline checkable copy isolated.

# 6. Create `pharos/citation-tracking/src/digest.ts`

Implement `runMonthlyDigest(env, periodStart, periodEnd)` + `aggregateAndRender(env, periodStart, periodEnd)` per the locked signatures. Includes:

1. **Aggregation queries** against `probe_runs` for the period (half-open UTC interval per OQ-S)
2. **OQ-J majority-cite collapse** — `cite_present = "≥2 of 3 replicates of (provider, prompt_id, day) fired the cite axis"`
3. **OQ-K-2 validity filter** — exclude `status='partial_coverage'` from cross-provider headline; per-provider trends remain analyzable
4. **OQ-I Mitigation 1** — `headline_cite_share = mean(per_provider_cite_share)` (NOT total_cites/total_probes)
5. **OQ-I Mitigation 2** — detect single-provider-only signals; flag in digest
6. **OQ-M model-deprecation detection** — daily-aligned aggregation:
   ```sql
   SELECT provider, DATE(timestamp, 'unixepoch') AS day,
     SUM(CASE WHEN status = 'error' AND http_status = 404 THEN 1 ELSE 0 END) AS error_404_count,
     COUNT(*) AS total_count,
     CAST(SUM(CASE WHEN status = 'error' AND http_status = 404 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) AS error_404_rate
   FROM probe_runs
   WHERE timestamp >= ? AND timestamp < ?
   GROUP BY provider, day
   HAVING error_404_rate >= 0.5;
   ```
7. **Markdown render** via `digest-template.ts` with OQ-N empty-section discipline + OQ-N/OQ-P firing rule for headline cite share
8. **`runMonthlyDigest`** = `aggregateAndRender` + INSERT OR REPLACE into `digests` table per OQ-T idempotency; returns `{ row_id, period_start, period_end, generated_at, markdown }`
9. **`aggregateAndRender`** = same aggregation + render WITHOUT the write — for digest-preview path

# 7. Update `pharos/citation-tracking/src/index.ts`

Three edits:

**(7a) Scheduled-handler routing for `0 14 1 * *` cron expression.** Use the period-arithmetic snippet from LOCKED CONTENT ARTIFACTS.

**(7b) Two new fetch endpoints under `/api/internal/`:**

- `GET /api/internal/digest-preview` — auth-protected; parses `?period_start=YYYY-MM-DD&period_end=YYYY-MM-DD` (or computes default current-partial-month per OQ-S); calls `aggregateAndRender`; returns inline Markdown body with `Content-Type: text/markdown; charset=utf-8`.
- `POST /api/internal/digest-trigger` — auth-protected; same param parsing; calls `runMonthlyDigest` (write path); returns 200 OK with `{"row_id", "period_start", "period_end", "generated_at"}` JSON.

Both endpoints reuse the existing `constantTimeEqual` helper and `Authorization: Bearer ${env.PROBE_AUTH_TOKEN}` check.

**(7c) Cleanup B1's debug-cron fallbacks.** Current scheduled handler routes (verbatim from deployed code at index.ts:25-26):

```ts
if (event.cron === '0 2 * * *' || event.cron === '*/5 * * * *' || event.cron === '12 22 * * *' || event.cron === '35 22 * * *') {
  await runProbeCycle(env);
}
```

Replace with:

```ts
if (event.cron === '0 2 * * *') {
  await runProbeCycle(env);  // existing B1 probe path — Finding 1 fix preserves await (not waitUntil)
} else if (event.cron === '0 14 1 * *') {
  // [paste the period-arithmetic snippet from LOCKED CONTENT ARTIFACTS]
  await runMonthlyDigest(env, periodStart, periodEnd);
} else {
  console.warn(`Unrecognized cron expression: ${event.cron}`);
}
```

The `*/5 * * * *`, `12 22 * * *`, `35 22 * * *` fallbacks are dead code (production wrangler.jsonc only declared `0 2 * * *`) but would silently re-activate if those crons were ever reintroduced. B1.1 cleans them up since we're touching index.ts anyway.

The scheduled handler signature stays `_ctx: ExecutionContext` (underscored — unused) since neither branch needs ctx after Finding 1's `await` switch.

# 8. Update `pharos/citation-tracking/wrangler.jsonc`

Add the digest cron to `triggers.crons`:

```jsonc
"triggers": {
  "crons": [
    "0 2 * * *",        // existing B1 probe cron
    "0 14 1 * *"        // NEW: monthly digest fires 1st of month at 14:00 UTC
  ]
}
```

# 9. Phase 1 deploy + smoke test

```bash
cd F:\pharos\citation-tracking
./node_modules/.bin/wrangler deploy
```

Capture deploy output: worker version ID, both crons listed in deploy output.

After deploy, hit the digest-preview endpoint to smoke-test the pipeline against current B1 probe data:

```bash
WORKER_URL="https://pharos-citation-tracking.pharos-dev.workers.dev"
AUTH_TOKEN="<the value from Bruno's PROBE_AUTH_TOKEN secret>"

# No query params → defaults to current partial month per OQ-S
curl -s -H "Authorization: Bearer ${AUTH_TOKEN}" "${WORKER_URL}/api/internal/digest-preview"
# Expected: 200 OK with inline Markdown body matching the 9-section structure
```

**Verification checks on the returned Markdown:**

1. **Engine version footer** present — should contain `citation-tracking:v1`
2. **All 9 sections render** (warnings/headline/per-provider/per-prompt/D2/D3/trend/operational/footer)
3. **Empty sections labeled correctly** — Trend section should say `*Insufficient data for trend analysis; this is the first digest...*`; D2 likely says `*No coined-term mentions detected this period...*`
4. **Headline cite share for 0%-everywhere case** — should render the OQ-P §Astrant=0 prose template (NOT bare `0%`) because we're in baseline phase (period_start < OQ_H_BASELINE_END=2026-08-01)
5. **Per-provider section** lists OpenAI / Anthropic / Perplexity / Gemini with their respective cite shares
6. **Competitive context (D3)** lists detected competitor cites — Profound was captured in cycle 48ed50d6 per ship-report; should appear here

If any check fails, iterate on `digest.ts` / `digest-template.ts` until output matches expectations. The deploy stays in place during iteration — Phase 1 doesn't roll back per C5.

# 10. Phase 2 verification — digest-trigger writes to D1

Once digest-preview Markdown looks right, exercise the write path:

```bash
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" "${WORKER_URL}/api/internal/digest-trigger"
# Expected: 200 OK with JSON body {"row_id": <int>, "period_start": <unix>, "period_end": <unix>, "generated_at": <unix>}
```

Verify D1:

```bash
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT id, period_start, period_end, length(markdown), digest_version FROM digests;"
# Expected: 1 row; period_start matches the 2026-05-06 snap (first-digest data-driven start);
#           period_end = 2026-06-01 00:00:00 UTC (=1780531200);
#           length(markdown) > 1000 (real digest content);
#           digest_version = 'citation-tracking:v1'

# Idempotency check — re-fire and verify INSERT OR REPLACE worked (still 1 row, generated_at updated):
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" "${WORKER_URL}/api/internal/digest-trigger"
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*), MAX(generated_at) FROM digests;"
# Expected: still 1 row; generated_at advanced
```

If row count goes to 2 (duplicate row instead of replace), the unique index isn't firing — halt and inspect schema.

# 11. Output ship-report

Write `F:\pharos\reports\slice-b1.1-deploy-<YYYY-MM-DD>.md` with:

```
# Slice B1.1 — Citation-Tracking Digest — <YYYY-MM-DD>

## Files created
- pharos/citation-tracking/src/version.ts
- pharos/citation-tracking/src/digest.ts
- pharos/citation-tracking/src/digest-template.ts
- pharos/citation-tracking/migrations/0002_digests.sql

## Files modified
- pharos/citation-tracking/src/index.ts (added scheduled-handler digest routing + 2 new endpoints + debug-cron cleanup)
- pharos/citation-tracking/wrangler.jsonc (added 0 14 1 * * digest cron)

## Migration
- 0002_digests.sql applied to pharos-citation-tracking D1
- digests table + idx_digests_period unique index verified

## Phase 1 verification (digest-preview smoke test)
- All 9 sections render: PASS|FAIL
- Engine version footer present (citation-tracking:v1): PASS|FAIL
- Empty sections labeled correctly (Trend / D2): PASS|FAIL
- OQ-P §Astrant=0 prose template fires (headline=0% in baseline phase): PASS|FAIL
- Per-provider section lists 4 providers: PASS|FAIL
- D3 Profound competitor cite captured: PASS|FAIL

## Phase 2 verification (digest-trigger write path)
- 200 OK with row-id JSON: PASS|FAIL
- digests table row inserted with correct period: PASS|FAIL
- INSERT OR REPLACE idempotency confirmed (re-fire = same row count, updated generated_at): PASS|FAIL

## Locked content audit
- OQ-N 9-section structure ingested: PASS
- OQ-P §Astrant=0 prose template (audit-tightened): PASS
- OQ-S MIN(timestamp) snap logic: PASS
- OQ-T INSERT OR REPLACE on unique index: PASS
- OQ-O version constants in version.ts: PASS

## Cron status
- Probe cron 0 2 * * * still operational (B1): PASS|FAIL
- Digest cron 0 14 1 * * deployed (fires next 2026-06-01 14:00 UTC): PASS|FAIL
- Debug-cron fallbacks removed (*/5, 12 22, 35 22): PASS|FAIL

## Notes / open follow-ups
- Claude Code routine for commit-and-push pipeline (Q1 two-stage) — Bruno-side setup via /schedule, mirrors existing trig_011xEUas6... + trig_01KS2t9M... checkpoint patterns. Routine reads latest digests row, writes Markdown to reports/citation-tracking/YYYY-MM.md, commits, pushes. NOT part of this Worker deploy.
- First scheduled digest fires 2026-06-01 14:00 UTC. Verify cron operational by checking digests table for new row at ~14:05 UTC.

## Cost
- Deploy: ~$0 (no LLM-API calls; digest is SQL + Markdown + git push)
- Recurring: ~$0 added on top of B1's ~$30-40/mo at production cadence
```

Print "DONE" and the path to the report file.

DO NOT:
- Modify B1's probe pipeline (`runProbeCycle`, providers/*, detect.ts, storage.ts, prompts.ts) — those are LOCKED post-B1
- Modify the audit pipeline (`marketing-site/src/lib/dim6/*`)
- Bump `CITATION_TRACKING_VERSION` (this is v1 first deploy; future bumps follow OQ-O trigger conditions)
- Skip Phase 1 verification (digest-preview smoke test catches template/aggregation bugs before they pollute the digests table)
- Ship without OQ-N empty-section discipline applied (silent omission or bare 0% renders are explicit DO-NOT per spec)
- Add internal slice labels ("Slice B1.1", "Phase 1.5") to digest output (per CRITICAL CONTENT BOUNDARY)
- `git commit` until Phase 2 PASS (per C4)
- Set up the commit-and-push Claude Code routine in this slice — that's a separate Bruno-driven /schedule operation post-deploy
- Regress B1's Finding 1 fix — scheduled handler MUST use `await runProbeCycle(env)` (not `ctx.waitUntil`); fetch handler probe-trigger keeps `ctx.waitUntil` (boot/auth smoke-test only)
```

---

## After Claude Code finishes

Bring the ship-report (or its contents) back to chat. Verification: confirm Phase 1 + Phase 2 verifications all PASS, confirm OQ-P §Astrant=0 prose template renders correctly for the baseline-phase 0% case, confirm INSERT OR REPLACE idempotency works on re-fire.

**Post-deploy Bruno-side work (NOT part of this slice):**

1. **Set up commit-and-push Claude Code routine via `/schedule`** — pattern mirrors existing checkpoint routines `trig_011xEUas6bb44kHHFzxw1Hr1` (2026-05-16 A2 regression) and `trig_01KS2t9MgAyqAgfgiJrJvWiT` (2026-06-02 Phase 1.5 review). Routine schedule: monthly on day 1 at 14:30 UTC (30 min after the digest cron fires, so the row is reliably present). Routine logic:
   - Query `pharos-citation-tracking` D1 for the latest `digests` row (highest `generated_at`)
   - Format Markdown filename per `reports/citation-tracking/YYYY-MM.md` (use `period_start` for YYYY-MM)
   - Write file (overwrite if already exists — idempotent at the file level too)
   - `git add`, `git commit -m "feat(B1.1): citation-tracking digest YYYY-MM"`, `git push`
   - If file content unchanged from prior commit (re-fire scenario), skip the commit (don't pollute git history with no-ops)

2. **Verify first scheduled digest fires correctly on 2026-06-01 14:00 UTC** — check `digests` table for new row at ~14:05 UTC; check `reports/citation-tracking/2026-05.md` committed at ~14:30 UTC.

3. **Wipe the test row from `digest-trigger` Phase 2 verification** if the row's content is stale relative to what the scheduled fire will produce on 2026-06-01:
   ```bash
   ./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "DELETE FROM digests WHERE id = <test_row_id>;"
   ```
   Or leave it — the scheduled fire will INSERT OR REPLACE per OQ-T idempotency; same period_start/period_end → same row updated.

After 2026-06-01 lands a clean first digest committed to repo, the citation-tracking measurement loop is complete and B1.1 is operationally retired into baseline-measurement mode.
