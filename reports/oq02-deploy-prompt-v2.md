# OQ-02 Per-Client MCP Dispatcher (Claude Code Deploy Prompt) — v2

**v1 → v2 changes (CLI v1 review folded in 2026-05-10):**
- **Critical:** slug validator ASCII-check order bug fixed — was checking ASCII AFTER non-alphanumeric replacement, which silently mangled IDN domains (`münchen.de` → `m-nchen` slug) instead of rejecting per spec §3 D2. v2 checks ASCII against the pre-replacement stripped input.
- **Important:** dropped unused `itty-router` install; added `deploy` script to package.json for consistency with citation-tracking; reorganized internal-API curls to use `WORKER_URL` (workers.dev) instead of customer subdomains (semantically cleaner — internal APIs aren't customer-specific); pinned Customer interface alongside Env in src/types.ts file list.
- **Polish:** loosened pre-flight baseline thresholds (counts grow over time; capture current value as baseline rather than hard-coding ≥180); Phase 1 + Phase 3 + Phase 4 extract `customer_slug` from provision response JSON rather than assuming slug derivation; **new IDN rejection test in Phase 3** validates the slug-validator-order fix at deploy time.

**Companion to:**
- `pharos-oq02-per-client-mcp-spec.md` v5 FROZEN (all 5 rounds of CLI review folded in). Reference doc; this deploy prompt is mechanically self-contained per the inline-constraints discipline.

**Purpose.** Ship the per-client MCP infrastructure (Path A — shared Worker config-driven from D1) that F2 (Implementation), F3 (AutoPilot), F4 (Concierge) all depend on. Each paid-tier customer gets their own MCP at `<slug>.mcp.astrant.io` exposing 4 customer-specific tools (`get_capabilities`, `get_pricing`, `get_case_studies`, `get_contact_tools`) — all driven by per-customer D1 config. Provisioning happens automatically post-purchase via internal API; no human-in-loop.

**Scope is foundational greenfield.** New Worker (`customer-mcp`), new D1 (`pharos-customers`), new secret (`INTERNAL_PROVISION_KEY`), wildcard DNS (`*.mcp.astrant.io`), 4 internal auth-protected APIs + daily sweep cron. No LLM-API spend in this slice (~$0 cost). Estimated effort: ~8-10h CLI execution.

**Pre-deploy gate.** Before running this prompt, Bruno should:

1. **Confirm B1 + B1.1 + Phase 1.5 still operational** — citation-tracking daily probe `0 2 * * *` UTC, marketing-site at astrant.io, scanner at scanner.astrant.io, mcp.astrant.io serving Astrant's own MCP. All should be green; OQ-02 lives alongside without touching any of them.
2. **Confirm `F:\pharos\` working tree is clean** (or only contains WIP unrelated to this slice).
3. **(Optional)** Skim `pharos-oq02-per-client-mcp-spec.md` v5 for full rationale on each decision.

Once gate passes, paste the section below into a fresh Claude Code session pointed at `F:\pharos\`.

---

```
You are deploying OQ-02 — the per-client MCP dispatcher. This adds a NEW Worker at F:/pharos/customer-mcp/ that serves customer-specific MCP responses at <slug>.mcp.astrant.io, plus a new D1 database (pharos-customers), wildcard DNS, and 4 internal auth-protected APIs. No existing Worker is modified.

ENVIRONMENT NOTE: on Windows + Git Bash, `wrangler` is NOT on global PATH. From `F:\pharos\customer-mcp/` call `./node_modules/.bin/wrangler ...`. Use forward-slash paths in bash commands; backslash paths break Git Bash.

INLINE PROJECT CONSTRAINTS (treat as hard rules — they apply across this entire prompt):

(C1) **Path A architecture is locked.** Single shared customer-mcp Worker; per-customer config loaded from D1 at request time with KV caching (5-min TTL). NO Workers-for-Platforms; NO per-customer Worker scripts; NO dispatcher Worker. The `project_mcp_hosting.md`-locked WfP architecture is the v1.x migration target, not the v1.0 implementation.

(C2) **customer-mcp is a plain Worker, NOT OpenNext.** Use `./node_modules/.bin/wrangler deploy` for deploys. Do NOT use `npm run cf:deploy` — that's the OpenNext-only command used by marketing-site (Next.js + @opennextjs/cloudflare). The cf:deploy script does not exist in customer-mcp's package.json. Bare wrangler deploy is correct.

(C3) **Scheduled handlers must use `await runSweep(env)`, NOT `ctx.waitUntil(runSweep(env))`.** Fetch handlers (including ctx.waitUntil background promises) are bounded at ~30s wall-time even on Workers Paid; scheduled handlers get up to 15 min. The sweep is short (~1s) so wall-time isn't the concern — the concern is the await-discipline pattern: scheduled handlers always await their main work so future long-running additions don't regress to waitUntil and silently fail. Standard rule: scheduled = await.

(C4) **Commits MUST NOT include a `Co-Authored-By: Claude <noreply@anthropic.com>` footer or any equivalent Claude/Anthropic attribution.** This includes "🤖 Generated with Claude Code" lines, "Co-Authored-By: Claude" footers, or any other automated-author attribution. Use Bruno's standard git config author info only. The commit message body should be plain content.

(C5) **Don't touch B1/B1.1 citation-tracking or any other production worker.** customer-mcp is NEW; it lives alongside existing pharos-mcp (Astrant's own MCP at mcp.astrant.io), pharos-marketing (astrant.io), pharos-scanner (scanner.astrant.io), pharos-citation-tracking (internal-only). Step 0 sanity-checks B1.1 probe_runs + digests counts as a regression baseline. If you find yourself touching ANY of those Workers' source trees, STOP and re-read.

(C6) **Idempotency.** This prompt is safe to re-run. Step 1 idempotency check identifies the slice as already-shipped via 6 markers (customer-mcp directory exists, pharos-customers D1 exists, INTERNAL_PROVISION_KEY secret bound, wrangler.jsonc has *.mcp.astrant.io route, sweep cron declared, runSweep function exists). If all present, halt with "ALREADY SHIPPED."

(C7) **Verify-at-endpoint discipline.** After deploy, exercise the actual deployed endpoints via curl/POST tests for the 4 internal APIs + entitlement check + Host-routing. Code inspection is OK for the sweep cron logic (no calendar-wait-based runtime test); the manual /api/internal/sweep endpoint exists specifically to make Phase 3 testable without calendar dependency.

(C8) **No `git commit` until ALL verification phases (1-5) PASS.** Phase 1+2+3+4+5 must all be green before commit. Phase 3 specifically tests the entitlement-check end-of-period sunset semantics (the v3 bonus catch) and the Implementation-tier deprovision guard — these are correctness-critical, not just smoke.

(C9) **No scope creep.** v1.0 ships 4 MCP tools (get_capabilities, get_pricing, get_case_studies, get_contact_tools). Do NOT add a 5th tool (check_url was explicitly dropped at spec v2 per audit). Do NOT add per-customer custom tools (deferred to v1.1). Do NOT add a customer-facing dashboard (deferred to v1.1). Do NOT add OAuth/PR-automation for llms.txt/JSON-LD (that's F2's deferred-to-v1.1 work). If you discover NEW scope opportunities, report at end-of-run; do NOT auto-implement.

CRITICAL CONTENT BOUNDARY:

OQ-02 doesn't ship customer-facing copy in v1.0 — there's no marketing surface in this slice. The MCP responses (well-known + tools) return customer-config-driven content; the customer's brand_name/description/capabilities/etc. comes from D1 config provided by F2 at provision time. OQ-02's responsibility is the routing + entitlement + config-loading infrastructure, not the content itself.

That said: the entitlement check 404 message ("MCP not found or no longer active") and the four internal API error codes (DEPROVISION_NOT_APPLICABLE_TO_IMPLEMENTATION, CUSTOMER_NOT_FOUND, SLUG_NON_ASCII, SLUG_RESERVED, SLUG_TOO_LONG, SLUG_COLLISION_EXHAUSTED) ARE Astrant-emitted strings. Audit-discipline (the 4-question check from Phase 1.5) does NOT apply since these are internal API responses, not customer-facing copy.

LOCKED CONTENT ARTIFACTS (verbatim from spec v5 — DO NOT modify; inline below for self-containment):

### Locked: wrangler.jsonc structure

```jsonc
{
  "name": "pharos-customer-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [
    {
      "pattern": "*.mcp.astrant.io/*",
      "custom_domain": true
    }
  ],
  "d1_databases": [
    {
      "binding": "CUSTOMER_DB",
      "database_name": "pharos-customers",
      "database_id": "<from-wrangler-d1-create-step-4>"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "CONFIG_CACHE",
      "id": "<from-wrangler-kv-namespace-create-step-3>"
    }
  ],
  "triggers": {
    "crons": ["0 3 * * *"]
  }
}
```

### Locked: `customers` D1 schema (per §4.3 v5)

```sql
-- pharos/customer-mcp/migrations/0001_initial_schema.sql
CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL UNIQUE,           -- Astrant-internal id from Dodo customer record (cus_xyz)
  domain TEXT NOT NULL,
  paid_tier TEXT NOT NULL CHECK (paid_tier IN ('implementation', 'autopilot', 'concierge')),
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'expired')),
  period_end INTEGER,                          -- Unix epoch seconds; NULL for Implementation (permanent per D3)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  config_json TEXT NOT NULL                    -- JSON blob: {_schema_version, brand_name, description, capabilities, pricing, case_studies, contact_tools}
);
CREATE INDEX idx_customers_slug ON customers (slug);
CREATE INDEX idx_customers_customer_id ON customers (customer_id);
CREATE INDEX idx_customers_status_period_end ON customers (status, period_end);
```

### Locked: slug validator algorithm (per §3 D2 v5)

```ts
// src/slug.ts

const RESERVED_SLUGS = new Set([
  'www', 'api', 'mcp', 'astrant', 'admin', 'auth', 'login', 'signup',
  'account', 'app', 'staging', 'dev', 'test', 'support', 'help', 'docs',
  'blog', 'mail', 'email', 'status', 'health',
]);

export type SlugError =
  | { kind: 'SLUG_NON_ASCII' }
  | { kind: 'SLUG_RESERVED' }
  | { kind: 'SLUG_TOO_LONG' }
  | { kind: 'SLUG_COLLISION_EXHAUSTED' };

export type SlugResult =
  | { ok: true; slug: string }
  | { ok: false; error: SlugError };

export async function generateSlug(
  domain: string,
  db: D1Database,
): Promise<SlugResult> {
  // 1. Strip protocol / path / query
  let d = domain.toLowerCase().trim();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/[\/?#].*$/, '');
  // 2. Strip last dotted segment (TLD)
  const parts = d.split('.');
  if (parts.length >= 2) parts.pop();
  // 3. ASCII-only check on the PRE-replacement stripped input.
  //    CRITICAL: must run BEFORE step 4's non-alphanumeric replacement,
  //    otherwise non-ASCII chars (e.g., `ü` in `münchen`) get silently
  //    replaced with `-` and the check on the post-replacement value
  //    passes — leaving `m-nchen` as a valid-looking slug instead of
  //    rejecting per spec §3 D2.
  const stripped = parts.join('.');
  if (!/^[\x00-\x7F]*$/.test(stripped)) {
    return { ok: false, error: { kind: 'SLUG_NON_ASCII' } };
  }
  // 4. Now-known-ASCII: replace dots and non-alphanumeric (except `-`) with `-`
  let base = stripped.replace(/\./g, '-').replace(/[^a-z0-9-]/g, '-');
  // 5. Defensive belt-and-suspenders check (should be redundant given step 3)
  if (!/^[a-z0-9-]+$/.test(base)) {
    return { ok: false, error: { kind: 'SLUG_NON_ASCII' } };
  }
  // 6. Reserved-slug check
  if (RESERVED_SLUGS.has(base)) {
    return { ok: false, error: { kind: 'SLUG_RESERVED' } };
  }
  // 7. Length check (DNS label limit 63)
  if (base.length > 63) {
    return { ok: false, error: { kind: 'SLUG_TOO_LONG' } };
  }
  // 8. Collision check — try base, then base-2 through base-99
  let candidate = base;
  for (let i = 1; i <= 99; i++) {
    if (i > 1) candidate = `${base}-${i}`;
    if (candidate.length > 63) {
      return { ok: false, error: { kind: 'SLUG_TOO_LONG' } };
    }
    const existing = await db
      .prepare('SELECT slug FROM customers WHERE slug = ? LIMIT 1')
      .bind(candidate)
      .first();
    if (!existing) return { ok: true, slug: candidate };
  }
  return { ok: false, error: { kind: 'SLUG_COLLISION_EXHAUSTED' } };
}
```

### Locked: canonical entitlement check (per §4.2 v5)

```ts
// src/index.ts — in the routing logic before delegating to MCP handler:

const customer = await getCustomerFromCacheOrD1(slug, env);
if (!customer) return mcpNotFound();
if (customer.status === 'expired') return mcpNotFound();
// status='cancelled' still serves while period_end > now (end-of-period sunset per D4).
// The sweep cron flips cancelled → expired post-period_end; the period_end check below
// handles the window between period_end and the next sweep run.
if (customer.period_end !== null && customer.period_end < Math.floor(Date.now() / 1000)) {
  return mcpNotFound();
}
// else: serve MCP with customer.config
// — status='active' with period_end > now OR period_end IS NULL (Implementation-permanent)
// — status='cancelled' with period_end > now (cancellation pending sunset; access remains)

function mcpNotFound(): Response {
  return new Response(
    JSON.stringify({ error: 'MCP not found or no longer active' }),
    {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  );
}
```

### Locked: provisioning API UPSERT semantics (per §4.4 v5)

`POST /api/internal/provision-customer` — Auth: Bearer INTERNAL_PROVISION_KEY (constantTimeEqual).

Request body:
```json
{
  "customer_id": "cus_xyz",
  "domain": "customer.com",
  "paid_tier": "implementation | autopilot | concierge",
  "period_end": 1733000000,
  "config": {
    "_schema_version": "1.0",
    "brand_name": "Acme",
    "description": "Acme makes widgets for B2B SaaS.",
    "capabilities": ["widget design", "widget testing"],
    "pricing": [{"tier": "Starter", "price": "$99/mo"}],
    "case_studies": [{"title": "...", "url": "..."}],
    "contact_tools": [{"name": "book_demo", "url": "..."}]
  }
}
```

`period_end` is required for autopilot/concierge; null/omitted for implementation (permanent).

Response:
```json
{
  "customer_slug": "acme",
  "mcp_url": "https://acme.mcp.astrant.io/mcp",
  "well_known_url": "https://acme.mcp.astrant.io/.well-known/mcp.json",
  "operation": "inserted | updated_renewal | updated_reactivated",
  "provisioned_at": 1733000000
}
```

UPSERT behavior:
1. Auth check (constantTimeEqual).
2. Lookup `customers` row by `customer_id`:
   - **Not found** → run slug validator → INSERT with status='active' → return `operation: "inserted"`.
   - **Found, status='active'** → UPDATE period_end + config_json + updated_at, keep slug+domain → return `operation: "updated_renewal"`.
   - **Found, status='cancelled'** → UPDATE status='active' + period_end + config_json + updated_at → return `operation: "updated_reactivated"`.
   - **Found, status='expired'** → same as cancelled → return `operation: "updated_reactivated"`.
3. Invalidate KV cache (key `customer-config:v1:<slug>`).

Domain-change: if existing row's `domain` differs from request body's `domain`, keep existing slug+domain (v1.0 limitation).

### Locked: deprovision API (per §4.5 v5)

`POST /api/internal/deprovision-customer` — Auth: same.

Body: `{"customer_id": "string"}` — NO `period_end` field; deprovision takes period_end from the stored row (per B2 lock).

Response: `{"deprovisioned_at": <unix>, "slug": "<slug>"}`

Behavior:
1. SELECT `paid_tier` from customers WHERE customer_id=?. **If row not found: HTTP 404 + `CUSTOMER_NOT_FOUND`.** **If `paid_tier === 'implementation'`: HTTP 400 + `DEPROVISION_NOT_APPLICABLE_TO_IMPLEMENTATION`.** (Implementation is permanent; refund/ban is manual ops via direct D1 commands.)
2. UPDATE `customers` SET status='cancelled', updated_at=now WHERE customer_id=?. **period_end NOT modified.**
3. Customer's MCP continues serving (per §4.2 entitlement check) until period_end is reached — end-of-period sunset per D4.
4. Invalidate KV cache.

Idempotency: if customer is already status='cancelled', UPDATE is no-op (updated_at refreshes). Returns 200, no error.

### Locked: update-config API (per §4.6 v5)

`POST /api/internal/update-customer-config` — Auth: same.

Body: `{"customer_id": "string", "config": {...}}` (full or partial config).

Response: `{"updated_at": <unix>}`

Merge semantics: **shallow merge at top level.** Provided top-level keys replace stored values wholesale; omitted keys preserved. Arrays/objects replace as a unit, NOT deep-merged.

Behavior:
1. SELECT existing `config_json` from customers WHERE customer_id=?. **If row not found: HTTP 404 + `CUSTOMER_NOT_FOUND`.**
2. Parse, apply shallow merge.
3. Validate `_schema_version` is `"1.0"`.
4. UPDATE customers SET config_json=<merged JSON>, updated_at=now.
5. Invalidate KV cache.

### Locked: runSweep function + sweep API + cron (per §4.7 v5)

```ts
// src/sweep.ts
export async function runSweep(env: Env): Promise<{ hard_deleted: number; expired: number; swept_at: number }> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 30 * 86400;

  const deleteResult = await env.CUSTOMER_DB.prepare(
    `DELETE FROM customers WHERE status='cancelled' AND period_end < ?`
  ).bind(cutoff).run();

  const expireResult = await env.CUSTOMER_DB.prepare(
    `UPDATE customers SET status='expired', updated_at=? WHERE status='active' AND period_end < ? AND paid_tier IN ('autopilot', 'concierge')`
  ).bind(now, now).run();

  return {
    hard_deleted: deleteResult.meta.changes ?? 0,
    expired: expireResult.meta.changes ?? 0,
    swept_at: now,
  };
}
```

Scheduled handler:
```ts
async scheduled(event, env, _ctx) {
  if (event.cron === '0 3 * * *') {
    await runSweep(env);  // await, NOT ctx.waitUntil (per C3)
  }
}
```

Manual-trigger endpoint:
`POST /api/internal/sweep` — Auth: same Bearer. Body: none. Response: `{"hard_deleted": N, "expired": M, "swept_at": <unix>}`. Calls runSweep synchronously.

### Locked: 4 MCP tools (per §3 D7 v5)

All config-driven; all return customer's stored config slices via the standard MCP tools/call response shape.

```ts
// src/tools.ts
export const CUSTOMER_TOOLS = [
  {
    name: 'get_capabilities',
    description: 'What this product does. Returns the customer\'s capabilities array.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_pricing',
    description: 'Pricing for this product. Returns the customer\'s pricing array.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_case_studies',
    description: 'Customer case studies and proof points. Returns the customer\'s case_studies array.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_contact_tools',
    description: 'Ways to engage with this product further (book a demo, contact sales, signup). Returns the customer\'s contact_tools array.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];
```

`check_url` is explicitly NOT in this list — dropped at spec v2 per audit (no customer-product value; was SSRF surface). Do NOT add it back.

### Locked: well-known endpoint shapes (per §4.2 routing)

`GET /.well-known/mcp.json`:
```json
{
  "name": "<config.brand_name>",
  "description": "<config.description>",
  "mcp": "https://<slug>.mcp.astrant.io/mcp",
  "version": "1.0"
}
```

`GET /.well-known/mcp/server-card.json`:
```json
{
  "name": "<config.brand_name>",
  "description": "<config.description>",
  "version": "1.0",
  "tools": [
    {"name": "get_capabilities", "summary": "<config-capabilities summary>"},
    {"name": "get_pricing", "summary": "..."},
    {"name": "get_case_studies", "summary": "..."},
    {"name": "get_contact_tools", "summary": "..."}
  ]
}
```

Both endpoints go through the entitlement check first (404 if not entitled).

### Locked: Bearer auth pattern (per D8)

```ts
// src/auth.ts
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function requireInternalAuth(req: Request, env: Env): Response | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return new Response('Unauthorized', { status: 401 });
  if (!constantTimeEqual(match[1], env.INTERNAL_PROVISION_KEY)) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null; // auth passed
}
```

---

STEPS:

# 0. Pre-flight verification

```bash
git status
# Working tree clean or only WIP unrelated to this slice. If unrelated WIP exists, halt.

# Confirm citation-tracking B1/B1.1 still operational (regression baseline):
cd F:/pharos/citation-tracking
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM probe_runs;"
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM digests;"
# Capture these counts as the "pre-deploy baseline" — Phase 5 regression check confirms
# they grow or stay equal (probe_runs grows daily; digests grows monthly per cron schedule).
# Hard floor: probe_runs ≥ 180 (B1.1 deploy cycle 48ed50d6); digests ≥ 1 (B1.1 Phase 2 row).
# Expected at OQ-02 deploy time (Week 1 of product-build): probe_runs ~360+ (cumulative daily fires
# since B1 ship 2026-05-04); digests count depends on whether monthly cron fired yet (2026-06-01).

# Confirm marketing-site operational (no regression from Phase 1.5):
curl -sI https://astrant.io | head -5

# Confirm scanner operational:
curl -sI https://scanner.astrant.io/health | head -5

# Confirm mcp.astrant.io operational (Astrant's own MCP, untouched by this slice):
curl -s https://mcp.astrant.io/.well-known/mcp.json | head -20

# Existing CF account state:
cd F:/pharos/citation-tracking  # any worker dir for wrangler auth
./node_modules/.bin/wrangler whoami 2>&1 | head -10
```

If any pre-flight check fails, halt and report.

# 1. Idempotency check

```bash
ls F:/pharos/customer-mcp 2>&1 && echo "DIRECTORY EXISTS"
cd F:/pharos/citation-tracking  # for wrangler context (any worker works)
./node_modules/.bin/wrangler d1 list 2>&1 | grep -i "pharos-customers" && echo "D1 EXISTS"
# Check if a *.mcp.astrant.io route is bound to any Worker:
./node_modules/.bin/wrangler deployments list --name pharos-customer-mcp 2>&1 | head -10
```

Branch resolution:
- All 3 markers present → ALREADY SHIPPED. Skip to Step 12 verification only.
- Some present → resume from appropriate step.
- None present → GREENFIELD; proceed from Step 2.

# 2. Wildcard DNS provisioning (BRUNO-SIDE ACTION — PAUSE HERE)

This step requires Bruno to take action in the Cloudflare dashboard. Do NOT proceed to Step 3 until Bruno confirms the DNS record is provisioned.

Bruno: in Cloudflare dashboard → Zones → astrant.io → DNS → Records, add:

- Type: AAAA (or A — both work since Cloudflare proxies; AAAA preferred)
- Name: `*.mcp` (Cloudflare will resolve to `*.mcp.astrant.io`)
- IPv6: `100::` (RFC 6666 discard prefix; placeholder since the route fires via Worker custom domain, not origin)
  - OR IPv4: `192.0.2.1` (TEST-NET-1 placeholder, RFC 5737)
- Proxy status: Proxied (orange cloud)
- TTL: Auto

Save the record. Verify via `dig *.mcp.astrant.io` from any shell — should resolve via Cloudflare's edge.

When confirmed by Bruno, proceed to Step 3.

# 3. Worker scaffold

```bash
mkdir F:/pharos/customer-mcp
cd F:/pharos/customer-mcp
mkdir src migrations
npm init -y
```

Create `package.json` deps + a `deploy` script for consistency with citation-tracking and other workers:

```bash
npm install --save-dev wrangler typescript @cloudflare/workers-types
```

In `package.json`, add a `scripts` block:

```jsonc
"scripts": {
  "deploy": "wrangler deploy"
}
```

No `itty-router` or other router library — the index.ts router is hand-written (path-based dispatch in ~20 lines, see §9). Adding a router dep would be over-engineering for this scope.

Create `tsconfig.json` (mirror citation-tracking's tsconfig.json structure for consistency).

Create `wrangler.jsonc` per LOCKED CONTENT (with placeholder IDs for `database_id` and `kv_namespaces[0].id`).

Create src/ skeleton files (all empty initially, populated in subsequent steps):
- src/index.ts
- src/auth.ts
- src/config.ts
- src/slug.ts
- src/mcp-handler.ts
- src/tools.ts
- src/well-known.ts
- src/api-provision.ts
- src/api-deprovision.ts
- src/api-update-config.ts
- src/api-sweep.ts
- src/sweep.ts
- src/types.ts (Env interface **+ Customer interface matching D1 row schema**; `Customer` is used by §9's router for the entitlement check on `customer.status`, `customer.period_end`, `customer.config_json`)

Provision the CONFIG_CACHE KV namespace and capture the returned id:

```bash
cd F:/pharos/customer-mcp
./node_modules/.bin/wrangler kv namespace create CONFIG_CACHE 2>&1
# Capture id and paste into wrangler.jsonc kv_namespaces[0].id
```

# 4. D1 migration (pharos-customers)

```bash
cd F:/pharos/customer-mcp
./node_modules/.bin/wrangler d1 create pharos-customers 2>&1
# Capture database_id, paste into wrangler.jsonc d1_databases[0].database_id
```

Create `migrations/0001_initial_schema.sql` with the LOCKED schema content (customers table + 3 indexes).

```bash
./node_modules/.bin/wrangler d1 migrations apply pharos-customers --remote
./node_modules/.bin/wrangler d1 execute pharos-customers --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
# Expected: customers, sqlite_sequence
./node_modules/.bin/wrangler d1 execute pharos-customers --remote --command "SELECT sql FROM sqlite_master WHERE name='customers';"
# Should match the locked schema verbatim including CHECK constraints + indexes
```

# 5. Secrets — `INTERNAL_PROVISION_KEY`

Generate a random 32-byte hex key:

```bash
# From any shell:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Capture the output; this is the INTERNAL_PROVISION_KEY value.
```

Set the secret:

```bash
cd F:/pharos/customer-mcp
echo "<the-key-from-above>" | ./node_modules/.bin/wrangler secret put INTERNAL_PROVISION_KEY
./node_modules/.bin/wrangler secret list
# Should show INTERNAL_PROVISION_KEY in the list.
```

Save the key in Bruno's password manager — it's needed for F2 (and any future caller of OQ-02's internal APIs) and isn't recoverable from CF.

# 6. Slug validator implementation

Create `src/slug.ts` with the LOCKED algorithm verbatim. Export `generateSlug(domain, db)` returning `SlugResult`.

# 7. 4 internal API endpoints + entitlement helpers

Create the following modules per LOCKED CONTENT:

**`src/auth.ts`** — `constantTimeEqual` + `requireInternalAuth(req, env)` returning null (auth passed) or Response 401.

**`src/config.ts`** — `getCustomerFromCacheOrD1(slug, env)`:
- Read from `env.CONFIG_CACHE.get(\`customer-config:v1:${slug}\`)` first
- On miss: query D1 `SELECT * FROM customers WHERE slug = ? LIMIT 1`
- On hit: parse JSON, return Customer object
- Write D1 result back to cache with `expirationTtl: 300` (5-min TTL)
- Cache key includes the 'v1' version prefix per D6
- Also export `invalidateCustomerCache(slug, env)` for write-side use

**`src/api-provision.ts`** — POST `/api/internal/provision-customer`:
- Auth check first
- Parse body, validate required fields
- Lookup by customer_id (SELECT FROM customers WHERE customer_id = ?)
- 4-branch UPSERT per LOCKED behavior (inserted / updated_renewal / updated_reactivated)
- Validate paid_tier matches CHECK constraint values
- For NEW row: run slug validator → INSERT
- For EXISTING row: UPDATE all fields, keep slug+domain
- Invalidate cache
- Return JSON response with operation field

**`src/api-deprovision.ts`** — POST `/api/internal/deprovision-customer`:
- Auth check
- Parse body (customer_id only; ignore any period_end if F3 erroneously sends one)
- SELECT paid_tier WHERE customer_id = ?
- **If not found: 404 + CUSTOMER_NOT_FOUND**
- **If paid_tier='implementation': 400 + DEPROVISION_NOT_APPLICABLE_TO_IMPLEMENTATION**
- Else: UPDATE status='cancelled', updated_at=now (period_end UNTOUCHED)
- Invalidate cache
- Return 200 with `{deprovisioned_at, slug}`

**`src/api-update-config.ts`** — POST `/api/internal/update-customer-config`:
- Auth check
- Parse body (customer_id, config)
- SELECT config_json WHERE customer_id = ?
- **If not found: 404 + CUSTOMER_NOT_FOUND**
- Parse existing config; apply shallow merge (top-level keys from body replace existing keys; omitted preserved)
- Validate merged config has `_schema_version: "1.0"`
- UPDATE config_json, updated_at=now
- Invalidate cache
- Return 200 with `{updated_at}`

**`src/api-sweep.ts`** — POST `/api/internal/sweep`:
- Auth check
- Call `runSweep(env)` (from src/sweep.ts)
- Return JSON with hard_deleted, expired, swept_at

# 8. Sweep cron + scheduled handler

Create `src/sweep.ts` with the LOCKED `runSweep` function.

In `src/index.ts`, export a `scheduled` handler:
```ts
async scheduled(event, env, _ctx) {
  if (event.cron === '0 3 * * *') {
    await runSweep(env);
  }
}
```

Confirm `wrangler.jsonc` has `triggers.crons = ["0 3 * * *"]`.

# 9. 4 MCP tools + entitlement check + Host-header routing

**`src/index.ts`** main router:

```ts
export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Internal API routes (any subdomain — auth-gated):
    if (url.pathname.startsWith('/api/internal/')) {
      if (url.pathname === '/api/internal/provision-customer') {
        return handleProvision(req, env);
      }
      if (url.pathname === '/api/internal/deprovision-customer') {
        return handleDeprovision(req, env);
      }
      if (url.pathname === '/api/internal/update-customer-config') {
        return handleUpdateConfig(req, env);
      }
      if (url.pathname === '/api/internal/sweep') {
        return handleSweep(req, env);
      }
      return new Response('Not Found', { status: 404 });
    }

    // Customer MCP routes (per-subdomain):
    const host = req.headers.get('Host') ?? '';
    const slugMatch = host.match(/^([a-z0-9-]+)\.mcp\.astrant\.io$/);
    if (!slugMatch) return new Response('Not Found', { status: 404 });
    const slug = slugMatch[1];

    // Entitlement check (LOCKED):
    const customer = await getCustomerFromCacheOrD1(slug, env);
    if (!customer) return mcpNotFound();
    if (customer.status === 'expired') return mcpNotFound();
    if (customer.period_end !== null && customer.period_end < Math.floor(Date.now() / 1000)) {
      return mcpNotFound();
    }

    // Route to handlers:
    if (url.pathname === '/.well-known/mcp.json') return wellKnownMcp(customer);
    if (url.pathname === '/.well-known/mcp/server-card.json') return wellKnownServerCard(customer);
    if (url.pathname === '/mcp' || url.pathname === '/sse') return handleMcp(req, customer);
    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event, env, _ctx) {
    if (event.cron === '0 3 * * *') {
      await runSweep(env);
    }
  },
};
```

**`src/tools.ts`** — export CUSTOMER_TOOLS array per LOCKED, plus tool implementations:

```ts
export function executeTool(name: string, customer: Customer): unknown {
  const config = JSON.parse(customer.config_json);
  switch (name) {
    case 'get_capabilities': return { capabilities: config.capabilities ?? [] };
    case 'get_pricing': return { pricing: config.pricing ?? [] };
    case 'get_case_studies': return { case_studies: config.case_studies ?? [] };
    case 'get_contact_tools': return { contact_tools: config.contact_tools ?? [] };
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
```

**`src/mcp-handler.ts`** — Streamable HTTP MCP protocol (mirror pharos-mcp's implementation; reference at F:/pharos/mcp-server/src/mcp-handler.ts). Implement tools/list (returns CUSTOMER_TOOLS) + tools/call (delegates to executeTool).

# 10. Well-known endpoints

**`src/well-known.ts`**:

```ts
import { Customer } from './types';

export function wellKnownMcp(customer: Customer): Response {
  const config = JSON.parse(customer.config_json);
  return Response.json({
    name: config.brand_name,
    description: config.description,
    mcp: `https://${customer.slug}.mcp.astrant.io/mcp`,
    version: '1.0',
  });
}

export function wellKnownServerCard(customer: Customer): Response {
  const config = JSON.parse(customer.config_json);
  return Response.json({
    name: config.brand_name,
    description: config.description,
    version: '1.0',
    tools: [
      { name: 'get_capabilities', summary: `What ${config.brand_name} does.` },
      { name: 'get_pricing', summary: `${config.brand_name} pricing.` },
      { name: 'get_case_studies', summary: `${config.brand_name} case studies.` },
      { name: 'get_contact_tools', summary: `How to engage with ${config.brand_name}.` },
    ],
  });
}
```

# 11. Deploy

```bash
cd F:/pharos/customer-mcp
./node_modules/.bin/wrangler deploy 2>&1 | tail -20
```

Capture worker version ID from output. Confirm:
- Build succeeds (no TS errors)
- D1 binding CUSTOMER_DB present in deploy output
- KV binding CONFIG_CACHE present
- Route `*.mcp.astrant.io/*` present
- Cron `0 3 * * *` present

# 12. Phase 1 verification — deploy + smoke

```bash
# Use workers.dev URL for internal-API calls (semantically correct — internal APIs are
# not customer-specific; they live on the Worker itself, not on per-customer subdomains).
# Customer subdomains (<slug>.mcp.astrant.io) are used ONLY for MCP-protocol calls that
# need the Host header for slug extraction.
WORKER_URL="https://pharos-customer-mcp.pharos-dev.workers.dev"
AUTH_TOKEN="<the-INTERNAL_PROVISION_KEY-from-step-5>"

# DNS smoke (customer subdomain — slug parsing fires):
curl -sI https://test-nonexistent-customer.mcp.astrant.io 2>&1 | head -10
# Expected: 404 from Worker (correct — no test-nonexistent-customer row exists yet, entitlement check rejects)

# Provision a test customer via internal API (workers.dev URL):
PROVISION_RESPONSE=$(curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"test-001","domain":"acme.com","paid_tier":"implementation","config":{"_schema_version":"1.0","brand_name":"Acme","description":"Acme makes widgets for B2B SaaS.","capabilities":["widget design","widget testing"],"pricing":[{"tier":"Starter","price":"$99/mo"}],"case_studies":[],"contact_tools":[{"name":"book_demo","url":"https://acme.com/demo"}]}}' \
  "${WORKER_URL}/api/internal/provision-customer")
echo "${PROVISION_RESPONSE}"
# Expected: 200 with {"customer_slug":"acme","mcp_url":"https://acme.mcp.astrant.io/mcp","operation":"inserted",...}

# Extract the actual slug from the response (per CLI v1 polish #6 — don't assume slug derivation):
ACME_SLUG=$(echo "${PROVISION_RESPONSE}" | grep -oE '"customer_slug":"[^"]+"' | sed -E 's/.*:"(.*)"/\1/')
echo "Provisioned slug: ${ACME_SLUG}"
# Expected: acme (or acme-2/etc. if collision; subsequent curls use ${ACME_SLUG}, not hardcoded "acme")

# Customer's well-known endpoint (uses customer subdomain — slug routing fires):
curl -s "https://${ACME_SLUG}.mcp.astrant.io/.well-known/mcp.json"
# Expected: {"name":"Acme","description":"Acme makes widgets...","mcp":"https://acme.mcp.astrant.io/mcp","version":"1.0"}

# Customer's server card:
curl -s "https://${ACME_SLUG}.mcp.astrant.io/.well-known/mcp/server-card.json"
# Expected: brand info + 4 tools (NOT 5; check_url must be absent)

# tools/list (MCP protocol — customer subdomain):
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  "https://${ACME_SLUG}.mcp.astrant.io/mcp"
# Expected: 4 tools (get_capabilities, get_pricing, get_case_studies, get_contact_tools)

# tools/call get_capabilities:
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_capabilities","arguments":{}}}' \
  "https://${ACME_SLUG}.mcp.astrant.io/mcp"
# Expected: {"capabilities":["widget design","widget testing"]} (Acme-specific from config)
```

# 13. Phase 2 verification — config update + cache invalidation

```bash
# Update Acme's capabilities (internal API via workers.dev URL):
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"test-001","config":{"capabilities":["widget design","widget testing","widget deployment"]}}' \
  "${WORKER_URL}/api/internal/update-customer-config"
# Expected: 200 with {"updated_at":<unix>}

# Verify config updated (cache should be invalidated, so this should hit D1 immediately):
sleep 2
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_capabilities","arguments":{}}}' \
  "https://${ACME_SLUG}.mcp.astrant.io/mcp"
# Expected: 3 capabilities including "widget deployment"
```

# 14. Phase 3 verification — deprovision + sunset + Implementation guard + sweep + not-found

**End-of-period sunset test:**
```bash
# Provision a test autopilot customer with short period_end:
NOW=$(date +%s)
SUNSET=$((NOW + 60))  # 60s from now
SUNSET_PROVISION=$(curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"customer_id\":\"test-sunset\",\"domain\":\"sunset-test.com\",\"paid_tier\":\"autopilot\",\"period_end\":${SUNSET},\"config\":{\"_schema_version\":\"1.0\",\"brand_name\":\"Sunset Test\",\"description\":\"Test\",\"capabilities\":[],\"pricing\":[],\"case_studies\":[],\"contact_tools\":[]}}" \
  "${WORKER_URL}/api/internal/provision-customer")
SUNSET_SLUG=$(echo "${SUNSET_PROVISION}" | grep -oE '"customer_slug":"[^"]+"' | sed -E 's/.*:"(.*)"/\1/')
# Expected: SUNSET_PROVISION includes operation="inserted"; SUNSET_SLUG="sunset-test"

# Immediately deprovision (body has customer_id ONLY, no period_end per B2):
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"test-sunset"}' \
  "${WORKER_URL}/api/internal/deprovision-customer"
# Expected: 200 with {"deprovisioned_at":<unix>,"slug":"sunset-test"}

# Within the 60s window: MCP should still serve (status='cancelled' + period_end>now):
curl -sI "https://${SUNSET_SLUG}.mcp.astrant.io/.well-known/mcp.json"
# Expected: HTTP 200 (entitlement check at §4.2 allows cancelled-pending-sunset)

# Wait 65s for period_end to pass:
sleep 65
curl -sI "https://${SUNSET_SLUG}.mcp.astrant.io/.well-known/mcp.json"
# Expected: HTTP 404 (period_end now in past)
```

**Implementation-tier deprovision guard test:**
```bash
# test-001 (Acme) is implementation tier from Phase 1
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"test-001"}' \
  "${WORKER_URL}/api/internal/deprovision-customer"
# Expected: HTTP 400 with body like {"error":"DEPROVISION_NOT_APPLICABLE_TO_IMPLEMENTATION"} (or equivalent shape per implementation)
# Verify Acme MCP still serves:
curl -sI "https://${ACME_SLUG}.mcp.astrant.io/.well-known/mcp.json"
# Expected: HTTP 200 (Implementation still active)
```

**IDN rejection test (slug validator ASCII check — added at v2 after the order-of-operations bug catch):**
```bash
# Provision attempt with non-ASCII domain — should reject at slug validator:
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"customer_id\":\"test-idn\",\"domain\":\"münchen.de\",\"paid_tier\":\"autopilot\",\"period_end\":${SUNSET},\"config\":{\"_schema_version\":\"1.0\",\"brand_name\":\"München Test\",\"description\":\"Test\",\"capabilities\":[],\"pricing\":[],\"case_studies\":[],\"contact_tools\":[]}}" \
  "${WORKER_URL}/api/internal/provision-customer"
# Expected: HTTP 400 with error code SLUG_NON_ASCII.
# CRITICAL: if this returns 200 with a slug like "m-nchen", the slug validator has
# the order-of-operations bug from deploy-prompt v1 (ASCII check ran AFTER non-alphanumeric
# replacement). v2 fixed this by checking ASCII on the pre-replacement stripped input.
# Verify no row was inserted:
./node_modules/.bin/wrangler d1 execute pharos-customers --remote --command "SELECT COUNT(*) FROM customers WHERE customer_id='test-idn';"
# Expected: 0
```

**Hard-delete sweep test:**
```bash
# Set test-sunset's period_end to 31 days ago to trigger hard-delete:
NOW=$(date +%s)
CUTOFF=$((NOW - 31 * 86400))
./node_modules/.bin/wrangler d1 execute pharos-customers --remote --command "UPDATE customers SET period_end = ${CUTOFF} WHERE customer_id='test-sunset'"

# Manual sweep:
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  "${WORKER_URL}/api/internal/sweep"
# Expected: {"hard_deleted":1,"expired":0,"swept_at":<unix>}

# Verify row is gone:
./node_modules/.bin/wrangler d1 execute pharos-customers --remote --command "SELECT COUNT(*) FROM customers WHERE customer_id='test-sunset';"
# Expected: 0
```

**Active-to-expired sunset test:**
```bash
# Provision another autopilot customer with already-past period_end:
NOW=$(date +%s)
PAST=$((NOW - 60))
EXPIRED_PROVISION=$(curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"customer_id\":\"test-expired\",\"domain\":\"expired-test.com\",\"paid_tier\":\"autopilot\",\"period_end\":${PAST},\"config\":{\"_schema_version\":\"1.0\",\"brand_name\":\"Expired Test\",\"description\":\"Test\",\"capabilities\":[],\"pricing\":[],\"case_studies\":[],\"contact_tools\":[]}}" \
  "${WORKER_URL}/api/internal/provision-customer")
EXPIRED_SLUG=$(echo "${EXPIRED_PROVISION}" | grep -oE '"customer_slug":"[^"]+"' | sed -E 's/.*:"(.*)"/\1/')

curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  "${WORKER_URL}/api/internal/sweep"
# Expected: {"hard_deleted":0,"expired":1,"swept_at":<unix>}

# Verify status flipped:
./node_modules/.bin/wrangler d1 execute pharos-customers --remote --command "SELECT status FROM customers WHERE customer_id='test-expired';"
# Expected: status='expired'

# MCP returns 404:
curl -sI "https://${EXPIRED_SLUG}.mcp.astrant.io/.well-known/mcp.json"
# Expected: HTTP 404
```

**Not-found error semantics test:**
```bash
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"does-not-exist-xyz"}' \
  "${WORKER_URL}/api/internal/deprovision-customer"
# Expected: HTTP 404 with CUSTOMER_NOT_FOUND

curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"does-not-exist-xyz","config":{"_schema_version":"1.0"}}' \
  "${WORKER_URL}/api/internal/update-customer-config"
# Expected: HTTP 404 with CUSTOMER_NOT_FOUND
```

# 15. Phase 4 verification — upsert renewal + reactivation

```bash
# Provision a fresh autopilot customer:
NOW=$(date +%s)
FUTURE=$((NOW + 86400 * 30))  # 30 days from now
RENEW_PROVISION=$(curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"customer_id\":\"test-renew\",\"domain\":\"renew-test.com\",\"paid_tier\":\"autopilot\",\"period_end\":${FUTURE},\"config\":{\"_schema_version\":\"1.0\",\"brand_name\":\"Renew Test\",\"description\":\"Test\",\"capabilities\":[],\"pricing\":[],\"case_studies\":[],\"contact_tools\":[]}}" \
  "${WORKER_URL}/api/internal/provision-customer")
RENEW_SLUG=$(echo "${RENEW_PROVISION}" | grep -oE '"customer_slug":"[^"]+"' | sed -E 's/.*:"(.*)"/\1/')
echo "Renew provision slug: ${RENEW_SLUG}"
# Expected: RENEW_PROVISION contains operation="inserted"

# Re-provision with new period_end (renewal):
FUTURE2=$((FUTURE + 86400 * 30))
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"customer_id\":\"test-renew\",\"domain\":\"renew-test.com\",\"paid_tier\":\"autopilot\",\"period_end\":${FUTURE2},\"config\":{\"_schema_version\":\"1.0\",\"brand_name\":\"Renew Test\",\"description\":\"Test\",\"capabilities\":[],\"pricing\":[],\"case_studies\":[],\"contact_tools\":[]}}" \
  "${WORKER_URL}/api/internal/provision-customer"
# Expected: operation="updated_renewal"

# Deprovision:
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"test-renew"}' \
  "${WORKER_URL}/api/internal/deprovision-customer"
# Expected: 200

# Within window: MCP still serves
curl -sI "https://${RENEW_SLUG}.mcp.astrant.io/.well-known/mcp.json"
# Expected: HTTP 200

# Re-provision (reactivation):
FUTURE3=$((NOW + 86400 * 90))
curl -s -X POST -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"customer_id\":\"test-renew\",\"domain\":\"renew-test.com\",\"paid_tier\":\"autopilot\",\"period_end\":${FUTURE3},\"config\":{\"_schema_version\":\"1.0\",\"brand_name\":\"Renew Test\",\"description\":\"Test\",\"capabilities\":[],\"pricing\":[],\"case_studies\":[],\"contact_tools\":[]}}" \
  "${WORKER_URL}/api/internal/provision-customer"
# Expected: operation="updated_reactivated", status flipped back to active
```

# 16. Phase 5 verification — idempotency

Re-run this entire deploy prompt. Step 1 idempotency check should identify the slice as already-shipped and halt cleanly with "ALREADY SHIPPED."

# 17. Output ship-report + commit

Write `F:/pharos/reports/oq02-deploy-2026-05-XX.md` (use today's UTC date) with:

```
# OQ-02 Per-Client MCP Dispatcher — <YYYY-MM-DD>

## Files created
- pharos/customer-mcp/ (NEW Worker)
  - src/index.ts (router + entitlement check + scheduled handler)
  - src/auth.ts (constantTimeEqual + requireInternalAuth)
  - src/config.ts (D1 + KV cache)
  - src/slug.ts (9-step validator + 4 error codes + 21-name reserved list)
  - src/mcp-handler.ts (MCP protocol implementation)
  - src/tools.ts (4 tool definitions + executeTool)
  - src/well-known.ts (2 well-known endpoints)
  - src/api-provision.ts (UPSERT)
  - src/api-deprovision.ts (Implementation guard + not-found)
  - src/api-update-config.ts (shallow merge + not-found)
  - src/api-sweep.ts (manual trigger)
  - src/sweep.ts (runSweep shared function)
  - src/types.ts (Env + Customer types)
  - migrations/0001_initial_schema.sql (customers table + 3 indexes)
  - wrangler.jsonc
  - package.json + tsconfig.json

## Infrastructure
- pharos-customers D1 database: id=<uuid>
- CONFIG_CACHE KV namespace: id=<uuid>
- INTERNAL_PROVISION_KEY secret bound
- Wildcard DNS *.mcp.astrant.io → Worker custom domain

## Deploys
- customer-mcp: version <id from step 11>

## Phase 1 verification (deploy + smoke)
- DNS routing works: PASS|FAIL
- Provision test-001 (Acme, implementation): PASS|FAIL — operation="inserted"
- /.well-known/mcp.json returns Acme brand info: PASS|FAIL
- /.well-known/mcp/server-card.json returns 4 tools (NOT 5): PASS|FAIL
- tools/list returns 4 tools: PASS|FAIL
- get_capabilities returns Acme config: PASS|FAIL

## Phase 2 verification (config update + cache invalidation)
- update-customer-config: PASS|FAIL
- Cache invalidated; new config served: PASS|FAIL

## Phase 3 verification (deprovision + sunset + Implementation guard + IDN rejection + sweep + not-found)
- End-of-period sunset (cancellation within window serves; post-period_end 404): PASS|FAIL
- Implementation guard (deprovision returns 400 + DEPROVISION_NOT_APPLICABLE_TO_IMPLEMENTATION): PASS|FAIL
- **IDN rejection (`münchen.de` provision returns 400 + SLUG_NON_ASCII; no row inserted)**: PASS|FAIL
- Hard-delete sweep via /api/internal/sweep: PASS|FAIL
- Active-to-expired sunset via sweep: PASS|FAIL
- deprovision returns 404 + CUSTOMER_NOT_FOUND on nonexistent customer_id: PASS|FAIL
- update-customer-config returns 404 + CUSTOMER_NOT_FOUND on nonexistent customer_id: PASS|FAIL

## Phase 4 verification (upsert renewal + reactivation)
- Initial provision: operation="inserted": PASS|FAIL
- Re-provision with new period_end: operation="updated_renewal": PASS|FAIL
- Deprovision: status='cancelled', period_end unchanged: PASS|FAIL
- Re-provision after deprovision: operation="updated_reactivated", status='active': PASS|FAIL

## Phase 5 verification (idempotency)
- Re-run halts at Step 1 with ALREADY SHIPPED: PASS|FAIL

## Locked content audit
- Path A architecture (shared Worker, no WfP): PASS
- 4 MCP tools (check_url NOT present): PASS
- Slug validator algorithm (9 steps + 4 error codes + 21-name reserved list): PASS
- **Slug validator ASCII-check order (check on pre-replacement input; `münchen.de` rejects)**: PASS
- UPSERT 4-branch semantics with operation field: PASS
- Deprovision Implementation guard: PASS
- §4.2 entitlement check honors end-of-period sunset (cancelled+period_end>now serves): PASS
- Shallow merge in update-config: PASS
- Sweep cron 0 3 * * *: PASS
- Bare wrangler deploy (NOT cf:deploy): PASS
- No `itty-router` or other unused deps: PASS
- `Customer` interface defined in src/types.ts alongside Env: PASS

## B1/B1.1/Phase 1.5 regression check
- citation-tracking probe_runs count ≥ baseline: PASS|FAIL
- citation-tracking digests count ≥ baseline: PASS|FAIL
- marketing-site at astrant.io serves: PASS|FAIL
- scanner.astrant.io serves: PASS|FAIL
- mcp.astrant.io (Astrant's own MCP) serves: PASS|FAIL

## Cost
- Deploy: ~$0 (no LLM-API calls in OQ-02 itself)
- Recurring: ~$0/mo added (D1/KV well within free tier; cron is daily)

## Notes / open follow-ups
- F2 (Implementation fulfillment) — next slice; depends on OQ-02. Will call /api/internal/provision-customer at fulfillment time.
- F3 (AutoPilot) — week 3 slice; depends on OQ-02 + B1.2 + B1.3.
- F4 (Concierge) — extends F3.
- B1.3 multi-tenant citation-tracking — orthogonal slice (separate Worker), ships in week 2 alongside F2.
- B1.2 instrumentation polish — hard deadline 2026-06-01 14:00 UTC; ships in week 2.
- INTERNAL_PROVISION_KEY value saved in Bruno's password manager.

## v1.1+ deferred items
- Workers-for-Platforms migration (Path B) if per-customer Worker isolation needs justify it.
- Customer-defined custom tools beyond the 4 base.
- Customer-facing dashboard route.
- Self-service slug change UX.
- IDN/punycode + public-suffix-list integration.
- GitHub PR automation for llms.txt + JSON-LD (F2's deferred work).
```

Print "DONE" and the path to the report file.

Then commit with the message body only (NO Co-Authored-By footer, NO 🤖 Generated with Claude Code lines, NO any equivalent attribution per C4):

```bash
cd F:/pharos
git add customer-mcp/ reports/oq02-deploy-2026-05-XX.md
git commit -m "OQ-02: per-client MCP dispatcher

Adds customer-mcp Worker at *.mcp.astrant.io serving per-customer
MCP responses driven by D1 config (pharos-customers table). Foundation
for F2/F3/F4 paid-tier fulfillment.

4 MCP tools (get_capabilities, get_pricing, get_case_studies,
get_contact_tools), 4 internal auth-protected APIs (provision UPSERT,
deprovision with Implementation guard, update-config shallow merge,
sweep manual trigger), daily sweep cron 0 3 * * * UTC."
```

DO NOT:
- Touch B1/B1.1 citation-tracking code (`F:\pharos\citation-tracking/`)
- Touch pharos-marketing, pharos-scanner, or pharos-mcp source trees
- Use `npm run cf:deploy` (this is a plain Worker, not OpenNext — per C2)
- Use `ctx.waitUntil(runSweep(env))` in the scheduled handler (per C3)
- Include any Co-Authored-By, 🤖 Generated with Claude Code, or equivalent Claude/Anthropic attribution in commits (per C4)
- Add a 5th MCP tool (check_url was dropped at spec v2 per audit — per C9)
- Add per-customer custom tools (deferred to v1.1 per C9)
- Add a customer-facing dashboard (deferred to v1.1 per C9)
- Enable Workers for Platforms — Path A architecture is locked (per C1)
- Modify the entitlement check to reject cancelled-pending-sunset (it correctly serves until period_end per D4 — this was the v3 bonus catch)
- Modify the deprovision API to accept period_end in body (B2 lock — period_end stays in stored row)
- Skip Phase 1-5 verifications or commit before all PASS (per C8)
- Auto-fix any NEW security findings discovered during execution — report at end-of-run only
- Forget to save INTERNAL_PROVISION_KEY in Bruno's password manager (it's not recoverable from CF)
```

---

## After Claude Code finishes

Bring the ship-report (or its contents) back to chat. Verify:

1. All 5 phases PASS (Phase 1-5).
2. Locked content audit PASS lines.
3. B1/B1.1/Phase 1.5 regression check PASS (no production-Worker regression).
4. INTERNAL_PROVISION_KEY saved in Bruno's password manager.

**Post-deploy follow-ups (NOT part of OQ-02):**

1. **F2 Implementation fulfillment slice** — depends on OQ-02. F2 will:
   - Generate llms.txt + JSON-LD content via LLM with TP-7 trust ladder
   - Apply URL scheme allowlist (http/https only) on customer-provided contact URLs before calling OQ-02 provisioning
   - Call `POST /api/internal/provision-customer` with `paid_tier="implementation"` and customer config blob
   - Email customer with download links + install instructions + MCP URL + monitoring info
   - "Monitoring wired" deliverable = one-shot snapshot model (per OQ-02 spec §10 carry-forward)

2. **B1.3 multi-tenant citation-tracking + B1.2 instrumentation polish** — week 2, orthogonal to OQ-02 (separate Worker).

3. **F3 AutoPilot fulfillment** — depends on OQ-02 + B1.2 + B1.3.

4. **F4 Concierge fulfillment** — extends F3.

5. **Privacy policy 5th-bullet doc slice + E2E + /security-review + gate-revert** — week 3-4 sequence.

After all of those land clean, paid CTAs at astrant.io reopen and the first organic-discovery customer window is open.
