# B1.3 Multi-Tenant Citation-Tracking (Claude Code Deploy Prompt) — v2.1

**v1 → v2 changelog:**
- MED 1: Dropped the Symbol-as-any pattern for `resolveCustomerId` helper (type-laundered Symbol violated declared `string | null` signature and didn't match index.ts's existing `return new Response(..., {status: 4xx})` convention from B1.1/B1.2). All 3 endpoints (probe-target-add, digest-preview, digest-trigger) now use inline NUL-byte validation with direct early-return. No helper.
- MED 2: C9 hex-grep target moved from deploy-prompt-source (wrong surface — Cowork-side hygiene; doesn't affect runtime correctness) to worker source AFTER edits, BEFORE deploy: `grep -P '\x00' F:/pharos/citation-tracking/src/`. This catches literal-NUL leakage into deployed code, which is the actual runtime risk.
- NIT: D1 migration fallback path explicitly halts-and-reports if expression-index CREATE fails after ALTER + DROP INDEX have succeeded — partial-mutation recovery is not auto-attempted.

**v2 → v2.1 changelog:**
- Cosmetic: C9 wording aligned with execution flow — "as the first action of Step 8 before the `wrangler deploy` invocation" (was "BEFORE Step 8" — technically inconsistent now that the hex-grep IS Step 8's first action).


**Companion to:**
- `pharos-citation-tracking-b1.3-spec.md` v7 FROZEN (7 spec rounds: v1 → v7; hybrid-category trajectory crossed upper bound at v7 due to recurring sentinel-collision refinement through 4-class staircase — representation / coverage / empirical / transport).

**Purpose.** Extend the citation-tracking Worker to probe per-customer domains (in addition to Astrant) and produce per-customer monthly digests. Enables F3 AutoPilot fulfillment's monthly customer-digest pipeline.

**Scope.** Schema migration on `probe_runs` + `digests` (both get `customer_id` column) + new `customer_probe_targets` table + storage.ts per-customer iteration + digest.ts per-customer scoping via approach (A) SQL-filter + 3 new internal APIs (probe-target-add/remove/list) + existing digest-preview/digest-trigger get `customer_id` query param + endpoint-layer NUL-byte validation via `String.fromCharCode(0)`. Estimated effort: ~6-10h CLI execution.

**Pre-deploy gate.** Before running this prompt, Bruno should:

1. **Confirm B1 + B1.1 + B1.2 + production workers still operational.** Citation-tracking daily probe `0 2 * * *` UTC running; B1.1 digest pipeline intact; B1.2 polish in place. Marketing-site at astrant.io, scanner.astrant.io, mcp.astrant.io, customer-mcp wildcard all serving.
2. **Confirm `F:\pharos\` working tree is clean.**
3. **(Optional)** Skim `pharos-citation-tracking-b1.3-spec.md` v7 for full rationale on each decision.

Once gate passes, paste the section below into a fresh Claude Code session pointed at `F:\pharos\`.

---

```
You are deploying B1.3 — multi-tenant citation-tracking. Extends the existing citation-tracking Worker at F:/pharos/citation-tracking/ to probe per-customer domains in addition to Astrant and produce per-customer monthly digests. No new Workers; no changes to other production Workers (marketing-site, scanner, mcp-server, customer-mcp).

ENVIRONMENT NOTE: on Windows + Git Bash, `wrangler` is NOT on global PATH. From `F:/pharos/citation-tracking/` call `./node_modules/.bin/wrangler ...`. Use forward-slash paths in bash; backslash paths break Git Bash.

INLINE PROJECT CONSTRAINTS (treat as hard rules):

(C1) **citation-tracking is a PLAIN Worker, NOT OpenNext.** Use `./node_modules/.bin/wrangler deploy` for deploys. Do NOT use `npm run cf:deploy`.

(C2) **Scheduled handler uses `await runProbeCycle(env)` per B1's Finding 1 fix.** Do NOT regress to `ctx.waitUntil`. The probe-trigger fetch handler (intentionally) keeps `ctx.waitUntil` for the ~30s smoke path per B1.2 item #6 lock. New B1.3 scheduled-handler additions (per-customer digest iteration) follow the same `await` pattern; iterating N+1 tenants stays within 15-min scheduled-handler wall-time at the v1.0 ceiling of 3 active customers per spec D8.

(C3) **Commits MUST NOT include a `Co-Authored-By: Claude <noreply@anthropic.com>` footer or any equivalent Claude/Anthropic attribution.** Plain commit message body only.

(C4) **Don't touch any other production Worker.** B1.3 is ONLY in `F:/pharos/citation-tracking/`. If you find yourself touching `F:/pharos/customer-mcp/`, `F:/pharos/marketing-site/`, `F:/pharos/scanner/`, `F:/pharos/mcp-server/`, STOP.

(C5) **Idempotency.** This prompt is safe to re-run. Step 1 idempotency check identifies the slice as already-shipped via 5 markers (one per shipped surface). If all present, halt with "ALREADY SHIPPED."

(C6) **Verify-at-endpoint discipline.** After deploy, exercise the actual deployed endpoints via curl for the 3 new internal APIs + the modified digest-preview/digest-trigger + the modified probe pipeline.

(C7) **No `git commit` until ALL verification phases (1-5) PASS.** Phase 5 includes test-data cleanup; commit happens after cleanup.

(C8) **No scope creep.** B1.2-followup items #2 + #3 are EXPLICITLY DEFERRED (OQ-5 RESOLVED at spec v2 — approach A SQL-filter has zero surface overlap with their DayLevelObservation aggregation logic). Do NOT auto-apply items #2/#3 changes even if you find aggregation patterns that would seem to fit. F3-side AutoPilot fulfillment implementation is NOT in B1.3 — B1.3 only ships the internal APIs that F3 will call; F3 itself is a separate slice. If you discover NEW issues during execution that don't fit B1.3's locked scope, report at end-of-run; do NOT auto-implement.

(C9) **HEX-GREP VERIFICATION on worker source BEFORE deploy.** After Steps 4-7 (edits applied to storage.ts / digest.ts / prompts.ts / index.ts), as the first action of Step 8 before the `wrangler deploy` invocation, run `grep -P '\x00' F:/pharos/citation-tracking/src/` — must return ZERO matches. This catches any literal NUL byte that leaked from the deploy-prompt's markdown→clipboard→Edit-tool pipeline into the deployed TypeScript source. Literal NUL bytes silently render as spaces in most text views, defeating any code that depends on them. All locked code uses `String.fromCharCode(0)` exclusively — a 23-char ASCII-only expression that produces the NUL byte at RUNTIME without embedding any non-printable char in source. If hex-grep finds NULs in the worker source, halt and report; do NOT deploy. (Note: deploy-prompt-source hygiene is a Cowork-side concern that doesn't affect runtime correctness; the load-bearing surface is the worker source post-edit.)

CRITICAL CONTENT BOUNDARY:

- Customer digests (customer_id IS NOT NULL) are stored in D1 ONLY — NEVER committed to the pharos repo. Astrant digest (customer_id IS NULL) continues to commit to `reports/citation-tracking/YYYY-MM.md` per B1.1's locked path. The artifact-surface split is enforced at the commit-and-push Claude Code routine level (Bruno-side update post-deploy; see "After Claude Code finishes" below).
- Internal API error codes (`SLUG_NON_ASCII`, `CUSTOMER_NOT_FOUND`, `DEPROVISION_NOT_APPLICABLE_TO_IMPLEMENTATION`, etc. from OQ-02; new in B1.3: `CUSTOMER_CEILING_REACHED`, `CUSTOMER_ID_NUL_BYTE`, `CUSTOMER_ID_REQUIRED`) are internal-ops-facing only; audit-discipline applies less strictly than DD-surfacing copy.

LOCKED CONTENT ARTIFACTS (verbatim from spec v7 — DO NOT modify; inline below for self-containment):

### Locked: D1 migration

Migration filename per V5 result (likely `0003_multi_tenant.sql`; verify next available number via `ls F:/pharos/citation-tracking/migrations/`):

```sql
-- (1) probe_runs: add customer_id (NULL for Astrant; non-NULL for customers)
ALTER TABLE probe_runs ADD COLUMN customer_id TEXT;
CREATE INDEX idx_probe_runs_customer_id ON probe_runs (customer_id);

-- (2) digests: parallel multi-tenancy extension
ALTER TABLE digests ADD COLUMN customer_id TEXT;
DROP INDEX idx_digests_period;
CREATE UNIQUE INDEX idx_digests_period_customer
  ON digests (period_start, period_end, COALESCE(customer_id, CHAR(0) || 'ASTRANT' || CHAR(0)));
CREATE INDEX idx_digests_customer_id ON digests (customer_id);

-- (3) New table customer_probe_targets:
CREATE TABLE customer_probe_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  category TEXT NOT NULL,
  competitors TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_customer_probe_targets_status ON customer_probe_targets (status);
```

**Note on COALESCE sentinel:** the unique index uses `COALESCE(customer_id, CHAR(0) || 'ASTRANT' || CHAR(0))` to make NULL distinct from non-NULL for INSERT OR REPLACE correctness. CHAR(0) is the SQL function call that produces a NUL byte AT QUERY TIME — the source SQL itself contains no literal NUL bytes (transport-safe). The sentinel is structurally narrow (only collides with values containing NUL bytes); combined with endpoint-layer validation (locked below), it's safe across the runtime stack.

**Fallback if D1 rejects expression indexes:** migrate to `customer_id NOT NULL DEFAULT 'astrant'` (literal-string sentinel) with one data migration UPDATE + add CHECK constraint to customer_probe_targets rejecting the literal sentinel. Functional-index is preferred; fallback documented for the unlikely case D1's SQLite version doesn't support expression indexes.

### Locked: endpoint customer_id NUL-byte validation (inline in all 3 endpoints)

**No helper function.** All 3 endpoints that accept `customer_id` (probe-target-add via JSON body; digest-preview + digest-trigger via URL query param) use inline validation matching index.ts's existing convention of direct `return new Response(...)` from handlers. No `HttpError` class, no Symbol markers, no type-laundered any-casts. Three independent inline blocks, each ~5 lines.

**In probe-target-add handler (JSON body):**

```ts
const body = await request.json();
if (typeof body.customer_id !== 'string' || body.customer_id === '') {
  return jsonError(400, 'CUSTOMER_ID_REQUIRED', 'customer_id must be a non-empty string');
}
if (body.customer_id.includes(String.fromCharCode(0))) {
  return jsonError(400, 'CUSTOMER_ID_NUL_BYTE', 'customer_id must not contain NUL bytes');
}
```

**In digest-preview + digest-trigger handlers (URL query param) — same inline pattern in each:**

```ts
const customerIdRaw = url.searchParams.get('customer_id');
let customerId: string | null;
if (customerIdRaw === null || customerIdRaw === '') {
  customerId = null;  // Astrant case
} else {
  if (customerIdRaw.includes(String.fromCharCode(0))) {
    return jsonError(400, 'CUSTOMER_ID_NUL_BYTE', 'customer_id must not contain NUL bytes');
  }
  customerId = customerIdRaw;
}
```

**Rationale for inline-over-helper (per v2 review):** A helper returning `string | null` cannot cleanly signal NUL-byte rejection without polluting the return type (tagged union) or laundering through `as any`. For 3 narrow handler surfaces, three ~5-line inline blocks is simpler, type-clean, and matches index.ts convention from B1.1/B1.2.

**CRITICAL — transport-safe NUL representation.** All `.includes()` calls use `String.fromCharCode(0)` — a 23-character TypeScript expression that produces the NUL byte at RUNTIME without embedding any non-printable characters in source code. Do NOT replace with `' '` or any other escape sequence in the deployed TypeScript file: while TS would interpret either form correctly, `String.fromCharCode(0)` is transport-safe across markdown rendering, JSON encoding, clipboard transfers, and tool-call serialization. Verify post-edit via `grep -c "String.fromCharCode(0)" src/index.ts` — should return ≥3 (one per endpoint: probe-target-add, digest-preview, digest-trigger).

### Locked: storage.ts per-customer iteration

Modify `runProbeCycle` to outer-loop over Astrant + active customer targets:

```ts
export async function runProbeCycle(env: Env): Promise<void> {
  try {
    console.log('[runProbeCycle] ENTER');  // gated post-B1.2 if DEBUG flag in scope
    const probeRunId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    const providers: ProviderSpec[] = [
      { name: 'openai',     apiKey: env.OPENAI_API_KEY,     fn: probeOpenAI },
      { name: 'anthropic',  apiKey: env.ANTHROPIC_API_KEY,  fn: probeAnthropic },
      { name: 'perplexity', apiKey: env.PERPLEXITY_API_KEY, fn: probePerplexity },
      { name: 'gemini',     apiKey: env.GEMINI_API_KEY,     fn: probeGemini },
    ];

    // Existing Astrant probe (customer_id=NULL)
    await probeOneTarget(env, providers, probeRunId, now, null, "Astrant", "AEO tools", undefined);

    // NEW: iterate active customer probe targets
    const activeTargets = await env.DB.prepare(
      `SELECT customer_id, domain, category, competitors FROM customer_probe_targets WHERE status='active'`
    ).all();

    for (const target of activeTargets.results) {
      const competitors = target.competitors ? JSON.parse(target.competitors as string) : undefined;
      await probeOneTarget(
        env,
        providers,
        probeRunId,
        now,
        target.customer_id as string,
        target.domain as string,
        target.category as string,
        competitors,
      );
    }
  } catch (e: any) {
    console.error(`[runProbeCycle] FATAL: ${e?.message ?? e}\n${e?.stack ?? ''}`);
    throw e;
  }
}

async function probeOneTarget(
  env: Env,
  providers: ProviderSpec[],
  probeRunId: string,
  now: number,
  customerId: string | null,
  brand: string,
  category: string,
  competitors: string[] | undefined,
): Promise<void> {
  // Existing loop body — substitute brand + category into LOCKED_PROMPTS at probe time;
  // pass competitors to detectAxes for D3 customization;
  // INSERT into probe_runs with customer_id from parameter (NULL for Astrant)
}
```

The existing INSERT statement gains a `customer_id` column:

```ts
await env.DB.prepare(`
  INSERT INTO probe_runs (
    timestamp, provider, prompt_id, prompt_axis, response_excerpt,
    d1a_url_cite, d1b_brand_mention, d2_term_of_art,
    d3_competitors_cited, probe_run_id, status, error_message, http_status,
    customer_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(
  now, provider.name, prompt.id, prompt.axis,
  (result.response_text ?? '').substring(0, 2000),
  detection.d1a_url_cite, detection.d1b_brand_mention, detection.d2_term_of_art,
  JSON.stringify({ direct: detection.d3_competitors_cited, complementary: detection.d3_complementary_cited }),
  probeRunId, result.status, result.error_message ?? null, result.http_status ?? null,
  customerId  // NEW
).run();
```

### Locked: prompts.ts template substitution (per V2 result)

V2 read of `src/prompts.ts` determines the parameterization mechanism:

- **If V2 reveals LOCKED_PROMPTS already parameterized** with `{category}` / `{brand}` placeholders: trivial — `probeOneTarget` substitutes at probe time via `renderPrompt(template, brand, category)`.
- **If V2 reveals LOCKED_PROMPTS are hard-coded for Astrant**: redesign LOCKED_PROMPTS to use placeholders. Add a `renderPrompt(template: string, brand: string, category: string): string` helper.

Locked prompt-substitution helper signature:

```ts
export function renderPrompt(template: string, brand: string, category: string): string {
  return template
    .replace(/\{brand\}/g, brand)
    .replace(/\{category\}/g, category);
}
```

Audit-discipline: any prompt template containing `{brand}` or `{category}` placeholders must remain audit-tight after substitution (no causal claims, no temporal claims per B1.2 D4 audit-discipline patterns).

### Locked: digest.ts per-customer SQL-filter scoping (approach A)

Extend `runMonthlyDigest` with optional `customer_id` parameter. The existing SELECT at `digest.ts:30` (or near it per V3) adds a WHERE clause; the DayLevelObservation aggregation block stays UNCHANGED:

```ts
export async function runMonthlyDigest(
  env: Env,
  periodStart: number,
  periodEnd: number,
  customerId: string | null = null,  // NEW
): Promise<{ row_id: number; period_start: number; period_end: number; generated_at: number; markdown: string }> {
  // Existing SELECT — add customer_id filter clause:
  const rows = await env.DB.prepare(
    customerId === null
      ? `SELECT * FROM probe_runs WHERE timestamp >= ? AND timestamp < ? AND customer_id IS NULL`
      : `SELECT * FROM probe_runs WHERE timestamp >= ? AND timestamp < ? AND customer_id = ?`
  ).bind(
    ...(customerId === null ? [periodStart, periodEnd] : [periodStart, periodEnd, customerId])
  ).all();
  // Existing aggregation logic — UNCHANGED.
  // ...
  // Existing INSERT OR REPLACE INTO digests — include customer_id in the column list:
  await env.DB.prepare(`
    INSERT OR REPLACE INTO digests (period_start, period_end, generated_at, markdown, digest_version, customer_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(periodStart, periodEnd, now, markdown, CITATION_TRACKING_VERSION, customerId).run();
  // Return same shape as B1.1.
}
```

The B1.1 OQ-N 9-section Markdown structure, OQ-T idempotency (INSERT OR REPLACE on the unique index), OQ-S period boundary semantics, OQ-P §Astrant=0 prose template (post-B1.2 audit-tight version) all preserved unchanged.

### Locked: 3 new internal APIs

**`POST /api/internal/probe-target-add`** — INSERT into `customer_probe_targets` with status='active'.

Auth: Bearer `PROBE_AUTH_TOKEN` (constant-time-compare).

Body: `{"customer_id": "<string>", "domain": "<string>", "category": "<string>", "competitors": ["<brand>", ...] (optional)}`.

Response:
- 200 with `{"added_at": <unix>, "customer_id": "<id>"}` on success
- 400 `CUSTOMER_ID_REQUIRED` if missing
- 400 `CUSTOMER_ID_NUL_BYTE` if string contains NUL byte (per locked endpoint validation above)
- 409 `CUSTOMER_ID_COLLISION` if customer_id already exists
- 503 `CUSTOMER_CEILING_REACHED` if active customer count >= 3 (per spec D8 v1.0 ceiling)

Pseudocode:

```ts
// Auth check first
const auth = req.headers.get('Authorization');
if (!auth || !constantTimeEqual(auth, `Bearer ${env.PROBE_AUTH_TOKEN}`)) {
  return new Response('Unauthorized', { status: 401 });
}

const body = await req.json();

// CUSTOMER_ID_REQUIRED check
if (typeof body.customer_id !== 'string' || body.customer_id === '') {
  return jsonError(400, 'CUSTOMER_ID_REQUIRED', 'customer_id must be a non-empty string');
}

// CUSTOMER_ID_NUL_BYTE check (transport-safe NUL detection)
if (body.customer_id.includes(String.fromCharCode(0))) {
  return jsonError(400, 'CUSTOMER_ID_NUL_BYTE', 'customer_id must not contain NUL bytes');
}

// CUSTOMER_CEILING_REACHED check
const countRow = await env.DB.prepare(
  `SELECT COUNT(*) as c FROM customer_probe_targets WHERE status='active'`
).first();
if ((countRow?.c as number ?? 0) >= 3) {
  return jsonError(503, 'CUSTOMER_CEILING_REACHED',
    'Customer ceiling reached (3 active customers under v1.0 single-cron). Provision blocked until cron-split or cadence-reduction ships in v1.1+. Contact ops to bypass via direct D1 INSERT if business case is urgent.');
}

// CUSTOMER_ID_COLLISION check + INSERT
try {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO customer_probe_targets (customer_id, domain, category, competitors, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).bind(
    body.customer_id, body.domain, body.category,
    body.competitors ? JSON.stringify(body.competitors) : null,
    now, now
  ).run();
  return Response.json({ added_at: now, customer_id: body.customer_id });
} catch (e: any) {
  if (e?.message?.includes('UNIQUE constraint failed')) {
    return jsonError(409, 'CUSTOMER_ID_COLLISION', `customer_id ${body.customer_id} already exists`);
  }
  throw e;
}
```

Note: race condition on the COUNT+INSERT pair is documented as v1.0 limitation per spec D8 (pre-launch onboarding cadence <1/day makes the race theoretical).

**`POST /api/internal/probe-target-remove`** — UPDATE status='paused' WHERE customer_id=?

Auth: same. Body: `{"customer_id": "<string>"}`. Response: 200 with `{"removed_at": <unix>, "status": "paused"}`; 404 `CUSTOMER_NOT_FOUND` if not present.

**`POST /api/internal/probe-target-list`** — SELECT all from `customer_probe_targets`.

Auth: same. Body: none. Response: 200 with `{"targets": [{customer_id, domain, category, status, created_at}, ...]}` ordered by created_at.

### Locked: digest-preview + digest-trigger endpoint customer_id threading

Extend existing endpoints in `src/index.ts:81-102` (post-B1.2). The NUL-byte validation pattern is the URL-query-param inline block from "Locked: endpoint customer_id NUL-byte validation" above. After the validation block, thread `customerId` into `runMonthlyDigest`:

```ts
// After the URL-query-param inline validation block from the consolidated lock above:
const url = new URL(req.url);
const period = resolvePeriod(url);  // existing helper

// [inline NUL-byte validation block here — see "Locked: endpoint customer_id NUL-byte validation"]
// Produces: customerId: string | null

// Pass to runMonthlyDigest (digest-trigger) or aggregateAndRender (digest-preview):
await runMonthlyDigest(env, period.start, period.end, customerId);
```

### Locked: scheduled-handler iteration over Astrant + active customers

In `src/index.ts` scheduled handler:

```ts
async scheduled(event, env, _ctx) {
  if (event.cron === '0 14 1 * *') {
    // Monthly digest cron — iterate Astrant + active customers
    const fireTime = new Date(event.scheduledTime);
    const periodEndDate = new Date(Date.UTC(fireTime.getUTCFullYear(), fireTime.getUTCMonth(), 1));
    const periodStartDate = new Date(Date.UTC(fireTime.getUTCFullYear(), fireTime.getUTCMonth() - 1, 1));
    const periodEnd = Math.floor(periodEndDate.getTime() / 1000);
    const periodStart = Math.floor(periodStartDate.getTime() / 1000);

    // OQ-S MIN(timestamp) snap (always-on per B1.1) — applies to Astrant case only
    // (customer probe runs are recent; first-customer-digest period_start snaps to first probe)
    // ... existing snap logic ...

    // Astrant digest
    await runMonthlyDigest(env, periodStart, periodEnd, null);

    // Per-customer digests
    const activeTargets = await env.DB.prepare(
      `SELECT customer_id FROM customer_probe_targets WHERE status='active'`
    ).all();
    for (const target of activeTargets.results) {
      await runMonthlyDigest(env, periodStart, periodEnd, target.customer_id as string);
    }
  } else if (event.cron === '0 2 * * *') {
    await runProbeCycle(env);  // existing B1 probe cron; runProbeCycle modified to iterate per-customer per §4.2
  }
}
```

Both crons stay using `await` per C2. The probe cron's per-customer iteration happens INSIDE `runProbeCycle` per the storage.ts modifications above; the digest cron's per-customer iteration happens in the scheduled handler itself per the snippet here.

---

STEPS:

# 0. Pre-flight verification + V-reads

```bash
git status
# Working tree clean or only WIP unrelated to this slice.

cd F:/pharos/citation-tracking

# V6: Regression baselines (capture BEFORE any changes):
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM probe_runs;"
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM digests;"
# Expected: probe_runs >1080 (B1.2 V8 baseline + daily growth); digests=1.

# V1: probe_runs schema — confirm no customer_id column yet:
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='probe_runs';"
# Look for 'customer_id' column absence.

# V5: customer_probe_targets doesn't exist + next migration filename:
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
ls F:/pharos/citation-tracking/migrations/
# Expected: probe_runs, digests, sqlite_sequence; next migration likely 0003_multi_tenant.sql

# V2: prompts.ts current shape — captures parameterization approach:
cat F:/pharos/citation-tracking/src/prompts.ts | head -50

# V3: digest.ts line-number drift confirmation (SELECT at ~line 30, aggregation at ~98):
sed -n '20,100p' F:/pharos/citation-tracking/src/digest.ts

# V4: storage.ts runProbeCycle current shape:
sed -n '22,100p' F:/pharos/citation-tracking/src/storage.ts

# V7: OQ-02 customer_id format confirmation (format-agnostic):
grep -n "customer_id" F:/pharos/customer-mcp/src/api-provision.ts | head -10
# Confirms OQ-02 accepts any string; B1.3 matches contract.

# Production-worker regression baseline:
curl -sI https://astrant.io | head -3
curl -sI https://scanner.astrant.io/health | head -3
curl -sI https://mcp.astrant.io/.well-known/mcp.json | head -3
curl -sI https://test-nonexistent-b13.mcp.astrant.io | head -3

# Note: C9 hex-grep discipline runs at the worker-source surface AFTER Steps 4-7 edits
# and BEFORE Step 8 deploy — not here at Step 0. The load-bearing surface is the deployed
# TypeScript source, not deploy-prompt-source-hygiene. See the pre-Step-8 block.
```

If any check fails, halt and report. Capture V2 result (LOCKED_PROMPTS parameterization shape) — determines Step 5 implementation.

# 1. Idempotency check

```bash
cd F:/pharos/citation-tracking

# 5 markers covering the 5 surfaces B1.3 modifies:

# Marker 1 — probe_runs.customer_id column exists:
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT name FROM pragma_table_info('probe_runs') WHERE name='customer_id';"

# Marker 2 — customer_probe_targets table exists:
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='customer_probe_targets';"

# Marker 3 — runProbeCycle iterates customer_probe_targets:
grep -F "customer_probe_targets WHERE status='active'" src/storage.ts

# Marker 4 — endpoint validation uses String.fromCharCode(0):
grep -F "String.fromCharCode(0)" src/index.ts

# Marker 5 — probe-target-add endpoint exists:
grep -F "probe-target-add" src/index.ts
```

Branch:
- All 5 present → ALREADY SHIPPED. Skip to Step 9 verification only.
- Some present → resume at the appropriate step.
- None present → GREENFIELD; proceed from Step 2.

# 2. Apply D1 migration

Create `F:/pharos/citation-tracking/migrations/<N>_multi_tenant.sql` (use the next-available number per V5; likely 0003) with the LOCKED migration SQL above verbatim.

Apply:

```bash
cd F:/pharos/citation-tracking
./node_modules/.bin/wrangler d1 migrations apply pharos-citation-tracking --remote
```

Verify:

```bash
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
# Expected: probe_runs, digests, customer_probe_targets, sqlite_sequence

./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT sql FROM sqlite_master WHERE name='digests';"
# Should show the new schema with customer_id column

./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT sql FROM sqlite_master WHERE name='idx_digests_period_customer';"
# Should show the COALESCE expression index
```

**Migration failure recovery (explicit decision rules):**

- **If `wrangler d1 migrations apply` returns success on first try:** proceed to verify (the three SELECTs above). Expected path; D1's SQLite is modern enough that expression indexes work in practice.
- **If migration fails BEFORE any DDL has applied** (e.g., parse error, auth error, network): wrangler tracks the migration as failed but schema is untouched. Edit migration filename to use the literal-string fallback (`customer_id TEXT NOT NULL DEFAULT 'astrant'` + data migration UPDATE + CHECK constraint on customer_probe_targets rejecting literal `'astrant'` per spec §4.1), then re-apply. Safe to iterate.
- **If migration fails PARTWAY** (ALTER TABLE probe_runs succeeded → ALTER TABLE digests succeeded → DROP INDEX idx_digests_period succeeded → CREATE UNIQUE INDEX on COALESCE expression FAILED, OR analogous): schema is half-mutated. **HALT and REPORT to Bruno.** Do NOT auto-attempt rollback (DROP COLUMN is not supported on SQLite without table rebuild; re-creating the dropped index requires knowing its exact original definition). Capture:
  - Output of `./node_modules/.bin/wrangler d1 migrations list pharos-citation-tracking --remote`
  - Output of `./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name LIKE 'probe_runs%' OR name LIKE 'digests%' OR name LIKE 'customer_probe_targets%' OR name LIKE 'idx_digests%';"`
  - Exact failure message from wrangler
  - Bruno will decide the recovery path (manual D1 SQL to either complete the migration or roll back, then edit migration file accordingly, then re-apply). Probability of firing is low but the recovery is high-stakes — don't improvise.

# 3. Update Env interface (if NUL-byte detection helpers need access to anything new)

V7 already established that the Env interface in `src/index.ts:4-12` carries `DEBUG_PROBE_LOGS?: string` post-B1.2. B1.3 adds nothing to Env — all internal APIs use the existing `PROBE_AUTH_TOKEN` and `DB` bindings.

No-op step; proceed to Step 4.

# 4. Modify storage.ts — runProbeCycle per-customer iteration

Edit `F:/pharos/citation-tracking/src/storage.ts` per the LOCKED storage.ts modifications above. Key changes:

1. Refactor existing loop body into a new `probeOneTarget(env, providers, probeRunId, now, customerId, brand, category, competitors)` helper
2. Top-level `runProbeCycle` calls `probeOneTarget(env, providers, probeRunId, now, null, "Astrant", "AEO tools", undefined)` first
3. Top-level then SELECTs active customer_probe_targets and iterates them via `probeOneTarget`
4. INSERT statement adds `customer_id` column (and the bind parameter for it)

The existing `console.log` gating from B1.2 (`if (DEBUG)`) stays in place. Apply the gating to any NEW console.log lines added in `probeOneTarget`.

# 5. Modify prompts.ts — template substitution (per V2 result)

**Branch on V2 result:**

**V2 → LOCKED_PROMPTS already parameterized:** add the `renderPrompt(template, brand, category)` helper if not present; `probeOneTarget` calls it for each prompt. Done.

**V2 → LOCKED_PROMPTS hard-coded for Astrant:** redesign each prompt to use `{brand}` and `{category}` placeholders. Each prompt's text becomes a template; `probeOneTarget` substitutes at probe time.

Audit-discipline check (mandatory): for each prompt template, verify that substituting both Astrant's brand+category AND a hypothetical customer's brand+category produces audit-tight output (no causal claims, no temporal claims).

# 6. Modify digest.ts — per-customer SQL-filter scoping (approach A)

Edit `F:/pharos/citation-tracking/src/digest.ts` per the LOCKED digest.ts modifications. Key changes:

1. Add `customerId: string | null = null` parameter to `runMonthlyDigest`
2. Modify the SELECT at line ~30 (per V3) to add the WHERE clause for `customer_id IS NULL` (when customerId === null) or `customer_id = ?` (otherwise)
3. Aggregation logic stays UNCHANGED (approach A)
4. INSERT OR REPLACE INTO digests adds `customer_id` to the column list

# 7. Modify index.ts — endpoint customer_id threading + 3 new internal APIs + scheduled handler iteration

Edit `F:/pharos/citation-tracking/src/index.ts` per the LOCKED endpoint validation + new API + scheduled handler snippets above. Key changes:

1. Inline NUL-byte validation in `/api/internal/probe-target-add` (JSON body pattern from consolidated lock) — NO helper
2. Inline NUL-byte validation + customer_id threading in `/api/internal/digest-preview` and `/api/internal/digest-trigger` (URL query param pattern from consolidated lock) — NO helper
3. Add 3 new internal APIs: `probe-target-add`, `probe-target-remove`, `probe-target-list`
4. Modify scheduled handler `0 14 1 * *` branch to iterate Astrant + active customers

# 8. Pre-deploy hex-grep (C9) + deploy

```bash
cd F:/pharos/citation-tracking

# C9 HEX-GREP — worker source must be NUL-free after Steps 4-7 edits.
# A literal NUL byte in deployed TypeScript would render as a space in most viewers
# but match `String.fromCharCode(0)` at runtime; an Edit-tool transport corruption
# of the locked validation code is the load-bearing risk this catches.
grep -P '\x00' src/
# Expected: ZERO matches (no output). If ANY match, HALT — do NOT deploy.
# Re-apply the affected Edit using larger surrounding context anchors to avoid the
# ambiguous-character region, re-run hex-grep, then resume.

# Belt-and-suspenders: confirm the 3 inline NUL-byte guards are present in source.
grep -c "String.fromCharCode(0)" src/index.ts
# Expected: ≥3 (one per endpoint: probe-target-add, digest-preview, digest-trigger).

./node_modules/.bin/wrangler deploy 2>&1 | tail -20
```

Capture worker version ID. Verify:
- Build succeeds (no TS errors)
- D1 binding present
- Cron triggers `0 2 * * *` (probe) + `0 14 1 * *` (digest) BOTH unchanged
- Routes unchanged

# 9. Phase 1 verification — code inspection

```bash
# All 5 idempotency markers (from Step 1) present
# Plus:
grep -F "renderPrompt" src/prompts.ts  # if V2 added template substitution
grep -F "customer_id IS NULL" src/digest.ts  # SQL filter for Astrant case
grep -F "customer_id = ?" src/digest.ts      # SQL filter for customer case
grep -F "CUSTOMER_CEILING_REACHED" src/index.ts
grep -F "CUSTOMER_ID_NUL_BYTE" src/index.ts
grep -F "probe-target-list" src/index.ts
```

# 10. Phase 2 verification — deploy + smoke

```bash
AUTH_TOKEN="<the-existing-PROBE_AUTH_TOKEN-secret-value>"
WORKER_URL="https://pharos-citation-tracking.pharos-dev.workers.dev"

# Add a test probe target
TEST_CUSTOMER="cus_test_b13"
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"customer_id\":\"${TEST_CUSTOMER}\",\"domain\":\"test-b13.example.com\",\"category\":\"test CRM\"}" \
  "${WORKER_URL}/api/internal/probe-target-add"
# Expected: 200 with {"added_at": <unix>, "customer_id": "cus_test_b13"}

# List targets — confirms persistence
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  "${WORKER_URL}/api/internal/probe-target-list"
# Expected: target list including cus_test_b13

# NUL-byte validation test — should be rejected with 400 CUSTOMER_ID_NUL_BYTE.
# Use jq or python to construct the body to ensure the NUL byte survives transport.
# If your shell can't send NUL bytes reliably, this is acceptable to skip with the
# code-inspection grep above as the validation proof.
python3 -c "
import json, urllib.request
body = json.dumps({'customer_id': 'cus' + chr(0) + 'test', 'domain': 'x.com', 'category': 'x'}).encode()
req = urllib.request.Request('${WORKER_URL}/api/internal/probe-target-add', data=body, method='POST',
  headers={'Authorization': 'Bearer ${AUTH_TOKEN}', 'Content-Type': 'application/json'})
try:
    urllib.request.urlopen(req)
except urllib.error.HTTPError as e:
    print('Status:', e.code, 'Body:', e.read().decode())
"
# Expected: Status: 400, Body contains CUSTOMER_ID_NUL_BYTE

# Manually trigger probe cycle (smoke path, ~3 batches per fetch-handler wall-time)
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  "${WORKER_URL}/api/internal/probe-trigger"

# Wait ~30s, then verify probe_runs has new rows with customer_id='cus_test_b13'
sleep 30
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote \
  --command "SELECT COUNT(*) FROM probe_runs WHERE customer_id='cus_test_b13';"
# Expected: >0 rows

# Verify Astrant probes still landing (customer_id IS NULL):
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote \
  --command "SELECT COUNT(*) FROM probe_runs WHERE customer_id IS NULL AND timestamp > (strftime('%s','now') - 600);"
# Expected: >0 rows from the smoke probe

# Per-customer digest preview
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  "${WORKER_URL}/api/internal/digest-preview?customer_id=${TEST_CUSTOMER}"
# Expected: Markdown digest scoped to cus_test_b13 (likely sparse since only a few probes ran)

# Astrant digest preview (no customer_id param) — confirms Astrant case still works
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  "${WORKER_URL}/api/internal/digest-preview"
# Expected: Markdown digest scoped to customer_id IS NULL (Astrant)

# Customer ceiling test (only if you want to verify):
# Add 2 more targets to bring count to 3, then attempt a 4th → expect 503 CUSTOMER_CEILING_REACHED
# (skip if Phase 5 cleanup would be more complex than the test's value)

# Pause + remove flow
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"customer_id\":\"${TEST_CUSTOMER}\"}" \
  "${WORKER_URL}/api/internal/probe-target-remove"
# Expected: 200 with {"removed_at": <unix>, "status": "paused"}

# Verify status='paused' in D1
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote \
  --command "SELECT status FROM customer_probe_targets WHERE customer_id='${TEST_CUSTOMER}';"
# Expected: paused
```

# 11. Phase 3 verification — regression on B1/B1.1/B1.2 + production workers

```bash
# Counts vs V6 baseline
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM probe_runs WHERE customer_id IS NULL;"
# Expected: baseline + recent Astrant probes

./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM digests WHERE customer_id IS NULL;"
# Expected: 1 (B1.1 Phase 2 test row) + possibly the Astrant digest if Phase 2 wrote one

# Production-worker regression
curl -sI https://astrant.io | head -3
curl -sI https://scanner.astrant.io/health | head -3
curl -sI https://mcp.astrant.io/.well-known/mcp.json | head -3
curl -sI https://test-nonexistent-b13.mcp.astrant.io | head -3
# All should serve as before
```

# 12. Phase 4 verification — idempotency

Re-run this deploy prompt; Step 1 should detect all 5 markers present and halt with "ALREADY SHIPPED."

# 13. Phase 5 verification — test data cleanup

```sql
DELETE FROM customer_probe_targets WHERE customer_id LIKE 'cus_test_%';
DELETE FROM probe_runs WHERE customer_id LIKE 'cus_test_%';
DELETE FROM digests WHERE customer_id LIKE 'cus_test_%';
```

Run via `./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "<each delete>"`.

Verify cleanup:
```bash
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM customer_probe_targets WHERE customer_id LIKE 'cus_test_%';"
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM probe_runs WHERE customer_id LIKE 'cus_test_%';"
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM digests WHERE customer_id LIKE 'cus_test_%';"
# All should return 0
```

# 14. Output ship-report + commit + archive deploy prompt

Write `F:/pharos/reports/citation-tracking-b1.3-deploy-<YYYY-MM-DD>.md` with:

```
# B1.3 Multi-Tenant Citation-Tracking — <YYYY-MM-DD>

## Files created
- pharos/citation-tracking/migrations/<NNNN>_multi_tenant.sql

## Files modified
- src/storage.ts (per-customer iteration via probeOneTarget refactor)
- src/digest.ts (per-customer SQL-filter scoping; INSERT OR REPLACE adds customer_id)
- src/prompts.ts (template substitution if V2 required redesign)
- src/index.ts (3 new internal APIs + endpoint customer_id threading + scheduled-handler per-customer iteration)

## V-read resolutions (execution-time)
- V1 probe_runs schema: <captured>
- V2 prompts.ts parameterization: <already-parameterized | hard-coded-redesigned>
- V3 digest.ts SELECT + aggregation line numbers: <captured>
- V4 storage.ts runProbeCycle structure: <captured>
- V5 customer_probe_targets greenfield + migration filename: <NNNN>
- V6 D1 baselines: probe_runs=<N>, digests=<N>
- V7 customer_id format confirmed format-agnostic

## Deploy
- worker version: <captured>
- Migration <NNNN>_multi_tenant.sql applied: PASS|FAIL
- COALESCE expression index supported (or fallback applied): PASS|FAIL

## Phase 1 verification
- All 5 idempotency markers present: PASS|FAIL
- renderPrompt helper present (if V2 required): PASS|N/A
- digest.ts SQL filter clauses present: PASS|FAIL
- Endpoint error codes (CUSTOMER_CEILING_REACHED, CUSTOMER_ID_NUL_BYTE): PASS|FAIL

## Phase 2 verification
- probe-target-add 200 on valid input: PASS|FAIL
- probe-target-add 400 CUSTOMER_ID_NUL_BYTE on NUL-containing input: PASS|FAIL
- probe-target-list returns added target: PASS|FAIL
- probe cycle produces customer_id rows in probe_runs: PASS|FAIL
- Astrant probes still landing in probe_runs (customer_id IS NULL): PASS|FAIL
- digest-preview?customer_id=X returns customer-scoped Markdown: PASS|FAIL
- digest-preview (no customer_id) returns Astrant Markdown: PASS|FAIL
- probe-target-remove flips status to paused: PASS|FAIL

## Phase 3 regression
- citation-tracking probe_runs (Astrant) ≥ baseline: PASS|FAIL
- citation-tracking digests (Astrant) ≥ baseline: PASS|FAIL
- marketing-site at astrant.io: PASS
- scanner.astrant.io/health: PASS
- mcp.astrant.io/.well-known/mcp.json: PASS
- customer-mcp wildcard route: PASS

## Phase 4 idempotency
- Re-run halts at Step 1 with ALREADY SHIPPED: PASS

## Phase 5 cleanup
- Test data deleted from all 3 tables: PASS

## Locked content audit
- D1 migration matches LOCKED SQL: PASS
- COALESCE expression index uses CHAR(0) || 'ASTRANT' || CHAR(0): PASS
- Endpoint validation uses String.fromCharCode(0): PASS (transport-safe NUL detection, ≥3 occurrences in src/index.ts — one per endpoint)
- No resolveCustomerId helper / no Symbol-as-any pattern (per v2 inline-only lock): PASS — 3 independent inline validation blocks
- C9 hex-grep on src/ AFTER Steps 4-7, BEFORE Step 8 deploy: PASS — zero literal NUL bytes in deployed source
- Approach (A) SQL-filter (NOT in-memory groupBy with customer_id): PASS — aggregation block untouched
- B1.2-followup items #2/#3 NOT auto-applied (per C8): PASS
- F3-side AutoPilot fulfillment NOT in scope (per C8): PASS

## Cost
- Deploy: ~$0 (LLM probe spend on the smoke cycle for test customer ~$0.01)
- Recurring: ~$0/mo added until first real AutoPilot/Concierge customer is provisioned (which would add ~$25-30/mo per active customer per spec D8)

## Notes / open follow-ups
- B1.2-followup items #2 + #3 — ships as standalone after B1.3 (OQ-5 RESOLVED at v2; no fold).
- Bruno-side commit-and-push routine (trig_01TY8zhZGrMNgckBd6oQg2JP, scheduled 30 14 1 * * UTC) MUST be updated to filter `digests` query to `customer_id IS NULL` BEFORE first AutoPilot customer is provisioned. Without this filter, the routine could commit customer digests to the public-ish pharos repo, defeating D5's privacy hygiene. Update before F3 ships.
- F3 AutoPilot subscription fulfillment — next slice (week 3); depends on B1.3 (now shipped) + OQ-02 (shipped).
- v1.1 customer-mcp config-update auto-propagation to probe-target metadata (D7) — deferred.
- v1.1 cron-split when 3rd customer is about to onboard (D8 ceiling) — deferred until signal demands.

## Sweep-discipline data points queue (5 new from B1.3 trajectory; queue for memory update after slice ships)
- #8 cross-table multi-tenancy schema audit (probe_runs AND digests both needed migration)
- #9a sentinel-value collision audit when bridging NULL semantics
- #9b/c structural-impossibility direction is correct BUT requires empirical verification against specific runtime stack (V8 + CF Workers JSON.parse / WHATWG URL accept escape sequences that produce NUL)
- #10 documenting + executing remain separate acts within same revision pass (recursive-irony in B1.2 + B1.3 trajectories)
- #11 runtime-stack-specific impossibility audit (companion to #9c)
- #12 transport-encoding audit for locked content artifacts (literal non-printable chars degrade across markdown / JSON / clipboard / tool-call pipeline; use String.fromCharCode(0) or explicit escape sequences as ASCII text)

## Convergence-pattern data point
- Round count: 7 spec rounds (v1→v7) + 1-2 deploy-prompt rounds + ~6-10h execution. Hybrid narrow-extension/foundational category. Crossed projected upper bound (4-6 expected) at v7 — first slice in B1.2+B1.3 trajectory to do so. Cost paid back by 5-data-point sweep-discipline contribution (#8 through #12). The recurring sentinel-collision refinement was driven by a Class-of-Issue staircase: representation → coverage → empirical → transport. Each round caught a sharper class of issue than the prior round missed.
```

Print "DONE" and the path to the report file.

Then commit (NO Co-Authored-By per C3):

```bash
cd F:/pharos
git add citation-tracking/ reports/citation-tracking-b1.3-deploy-<YYYY-MM-DD>.md
git commit -m "B1.3: multi-tenant citation-tracking

Extends citation-tracking Worker to probe per-customer domains in addition
to Astrant. Adds customer_id column to probe_runs + digests; new
customer_probe_targets table; 3 internal APIs (probe-target-add/remove/list);
endpoint customer_id query-param threading on existing digest-preview/trigger;
scheduled-handler iteration over Astrant + active customers.

Approach A SQL-filter scoping (no in-memory groupBy changes; aggregation
block untouched — zero overlap with B1.2-followup items #2/#3 which ship
standalone). v1.0 single-cron ceiling at 3 active customers per D8.

Endpoint validation uses String.fromCharCode(0) for transport-safe NUL
detection per spec v7 (sentinel collision iterative refinement: literal
sentinel → coverage hole → empirical-impossibility → transport-encoding).

Customer digests stored in D1 only (NOT committed to pharos repo per D5
artifact-surface split); Astrant digest still commits to
reports/citation-tracking/YYYY-MM.md per B1.1 lock."
```

Then archive the deploy prompt per the OQ-02 convention:

```bash
cp "C:/Users/dembo/OneDrive/Documents/Claude/Projects/Solo Startup SaaS/pharos-citation-tracking-b1.3-deploy-prompt.md" \
   "F:/pharos/reports/citation-tracking-b1.3-deploy-prompt-v2.1.md"
git add reports/citation-tracking-b1.3-deploy-prompt-v2.1.md
git commit -m "B1.3: archive deploy prompt alongside ship-report

Per the convention established by OQ-02 archive commit 0bbad8e."
```

DO NOT:
- Touch other production Worker source trees (F:/pharos/marketing-site/, F:/pharos/scanner/, F:/pharos/mcp-server/, F:/pharos/customer-mcp/) — B1.3 is citation-tracking ONLY (per C4)
- Use `npm run cf:deploy` for citation-tracking (plain Worker, NOT OpenNext — per C1)
- Regress the scheduled handler to `ctx.waitUntil(runProbeCycle(env))` (B1 Finding 1 fix preserved — per C2)
- Replace `String.fromCharCode(0)` in the deployed TypeScript with `' '` or any other escape sequence (per LOCKED endpoint validation rationale — transport safety is the discipline, not runtime equivalence)
- Include any Co-Authored-By, 🤖 Generated with Claude Code, or equivalent attribution in commits (per C3)
- Auto-apply B1.2-followup items #2 (cell-level partial_coverage rollup) or #3 (headline filter — D3-b no-code-change) even if you find aggregation patterns that look like they'd fit (per C8 — OQ-5 RESOLVED at spec v2; ships standalone)
- Implement F3-side AutoPilot subscription fulfillment (per C8 — separate slice)
- Use the literal-string `'__astrant__'` sentinel in the COALESCE expression (v3-v4 era; superseded by CHAR(0)-based sentinel + endpoint validation per v6-v7 lock)
- Modify B1.1's existing path `reports/citation-tracking/YYYY-MM.md` for the Astrant digest (locked path; only customer digests are NEW and they stay in D1 only)
- Add CHECK constraint on customer_probe_targets rejecting any specific customer_id value (NOT needed under v7 endpoint-validation discipline; v4-era CHECK approach was superseded)
- Auto-fix any NEW issues discovered during execution — report at end-of-run only
- Skip Phase 1-5 verification or commit before all PASS (per C7)
- Forget to update the Bruno-side commit-and-push routine (`trig_01TY8zhZGrMNgckBd6oQg2JP`) to filter `digests` query to `customer_id IS NULL` BEFORE first AutoPilot customer is provisioned (post-deploy follow-up; flagged in ship-report Notes)
```

---

## After Claude Code finishes

Bring the ship-report back to chat. Verify:

1. All 5 phases PASS.
2. Locked content audit PASS lines — especially LOCKED `String.fromCharCode(0)` endpoint validation, COALESCE expression index, approach (A) SQL-filter (no aggregation block changes).
3. Production-Worker regression check PASS.
4. V-read resolutions captured (especially V2's parameterization branch result).

**Post-ship Cowork-side memory updates queued:**

- `project_live_services.md` — add B1.3 ship state to citation-tracking section (worker version, commit, schema migration, new APIs)
- `feedback_locked_decision_propagation_sweep_discipline.md` — fold 5 new sweep-discipline data points (#8 cross-table audit, #9 sentinel-collision iterative refinement, #10 recursive-application, #11 runtime-stack-specific, #12 transport-encoding) — and structural reorganization into sub-categories (trace patterns, sweep patterns, recursive patterns, layered patterns, runtime-stack/transport patterns) per the trajectory observation
- `feedback_locked_architecture_narrower_surface_convergence.md` — add B1.3 as 6th data point; first hybrid-category slice to cross upper bound; Class-of-Issue staircase observation for security/correctness primitives

**Post-deploy Bruno-side follow-ups:**

1. **Update commit-and-push Claude Code routine** (`trig_01TY8zhZGrMNgckBd6oQg2JP`) to filter `digests` query to `customer_id IS NULL` BEFORE first AutoPilot customer is provisioned. Without this, the routine could commit customer digests to the pharos repo, defeating D5's privacy hygiene. ~10 min routine edit.
2. **B1.2-followup (items #2 + #3)** — ships as standalone micro-slice when convenient. No deadline (bug class only manifests at non-zero cite-share + errored cells; weeks/months away).
3. **F3 AutoPilot subscription fulfillment** — next slice. Depends on B1.3 (shipped) + OQ-02 (shipped). Calls B1.3's `probe-target-add` on `subscription.active`; calls `probe-target-remove` on `subscription.cancelled` at period_end.
4. **F4 Concierge** — extends F3.
5. **Privacy policy 5th-bullet + E2E across 5 paid tiers + /security-review + gate-revert at commit `9320082`** — week 3-4 closing sequence.

After step 5, the pre-launch readiness sequence is complete; first organic-discovery customer window opens.
