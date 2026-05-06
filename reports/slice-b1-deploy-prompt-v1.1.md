# Slice B1 — Citation-Tracking Instrumentation (Claude Code Deploy Prompt) — v1.1

**Companion to:**
- `pharos-citation-tracking-instrumentation-spec.md` (v5.1 — all 13 OQs LOCKED, deploy-prompt-derivable)
- `pharos-citation-tracking-oq-a-prompts-draft.md` (v5.1 LOCKED — 15-prompt set with `prompt_id` mappings)

**v1.0 → v1.1 changelog (CLI review fixes; Cowork endorsed):**
- **B1:** dropped non-existent `wrangler triggers list` subcommand; verify cron via deploy-output parse instead
- **B2:** restructured `runProbeCycle` — parallel-with-`Promise.allSettled` across 4 providers per (prompt × replicate); 4-way concurrency stays under the documented ~6-fetch isolate cap from `marketing-site/src/lib/dim6/orchestrator.ts:131` with 2 slots headroom
- **B3:** `Retry-After` now read via `response.headers.get('retry-after')` (was incorrectly reading from parsed JSON body)
- **S2:** full provider implementations for OpenAI/Anthropic/Perplexity/Gemini (no stubs)
- **S4:** `tsconfig.json` added to file inventory + Step 5 authoring
- **S5:** `storage.ts` wires all 4 providers (Phase 1 verification expects 180 rows, not 90)
- **S7:** `constantTimeEqual` auth check on `/api/internal/*` endpoints; `PROBE_AUTH_TOKEN` added to `Env` interface
- **S8:** Phase 1 ships with `"crons": []` empty array (idempotency-safe re-runs); Phase 2 sets actual schedule
- **Scope split:** digest aggregation deferred to **Slice B1.1** (separate slice). B1 ships probe pipeline + storage + auth-protected manual probe trigger only. No `digest.ts`, no `digest-trigger` endpoint, no monthly-digest cron in Phase 2.

**Purpose.** Deploy a new Cloudflare Worker (`pharos-citation-tracking`) at `F:\pharos\citation-tracking/` that probes 4 LLM providers (OpenAI, Anthropic, Perplexity, Gemini) with 15 locked prompts on a daily cron, records probe outcomes (citation detection across 3 orthogonal axes) into a dedicated D1 database. Two-phase deploy: Phase 1 ships cron-disabled with auth-protected manual-trigger endpoint for verification; Phase 2 enables the daily probe cron after Phase 1 verifies. **Digest pipeline is out of scope for this slice — see Slice B1.1.**

**Strategic context.** Citation-tracking is the falsifiability instrumentation for Astrant's agent-first distribution strategy. Without it, "agents will surface astrant.io organically" is unfalsifiable on a 2-year acquisition timeline. With it, monthly digests (B1.1) produce trigger conditions for downstream slices currently in "wait for trigger" deferral.

**Pre-deploy gate.** Before running this prompt, Bruno should:

1. **Provision 4 fresh dedicated provider accounts** per OQ-I:
   - OpenAI Tier 1 (citation-tracking-only alias)
   - Anthropic Tier 1 (separate from audit-pipeline account)
   - Perplexity Pro+API
   - Gemini paid Tier 1 (NOT free tier — `gemini-2.5-flash` access)
2. **Capture API keys** from each account; have them ready for `wrangler secret put`.
3. **Choose a `PROBE_AUTH_TOKEN` value** (random ≥32-char string; share via secure channel for verification curl).
4. **Confirm `F:\pharos\` working tree is clean** (or only WIP unrelated to this slice).

Once gate passes, paste the section below into a fresh Claude Code session pointed at `F:\pharos\`.

---

```
You are deploying Slice B1 — Citation-Tracking Instrumentation. This creates a NEW top-level Cloudflare Worker at `F:\pharos\citation-tracking/` with its own D1 database, daily probe cron (Phase 2), and auth-protected manual-trigger endpoint. Two-phase deploy: Phase 1 cron-disabled + manual-trigger endpoint for verification; Phase 2 enables daily probe cron after Phase 1 verifies.

Digest aggregation is OUT OF SCOPE — that ships in Slice B1.1.

INLINE PROJECT CONSTRAINTS (treat as hard rules):

(C1) Citation-tracking is INTERNAL instrumentation, NOT customer-facing. No public-facing URL, no marketing-site integration. Worker has only auth-protected internal endpoints + cron triggers. Verification is D1 row counts, NOT live-endpoint curl on www.astrant.io.

(C2) Verify-at-endpoint discipline applies to D1 + manual-trigger output. After each phase deploy, query D1 via `wrangler d1 execute` and confirm expected row shapes/counts. Exit code is necessary but not sufficient.

(C3) Idempotency. This prompt is safe to re-run. Each step has an "already shipped" branch. If slice has fully shipped (D1 exists + Worker deployed + Phase 2 cron enabled), halt with "ALREADY SHIPPED."

(C4) No `git commit` until Phase 2 verification PASSES. Bruno commits the full bundle.

(C5) Phase 1 failure path: cron-disabled state STAYS IN PLACE. If Phase 1 verification fails, do NOT roll back. Iterate on the manual-trigger endpoint until verification passes; THEN proceed to Phase 2.

(C6) Per OQ-I — fresh dedicated provider accounts ONLY. API keys for citation-tracking SEPARATE from audit-pipeline keys.

(C7) Concurrency cap: ~6 in-flight fetch() per Workers isolate (documented at marketing-site/src/lib/dim6/orchestrator.ts:131 — runtime safety, not lifted by paid plan). Probe execution fans out 4 providers in parallel per (prompt × replicate); stays under cap with 2 slots headroom for retries.

CONTENT BOUNDARY:

Citation-tracking has no customer-facing surface. The ship-report committed under reports/ is the only artifact that lands in repo from this slice. Apply the audit-discipline checklist (narrower-than-truth / broader-than-truth / jargon-survivability / dated-language) to the ship-report text before committing.

DO NOT:
- Modify the audit pipeline (`marketing-site/src/lib/dim6/*`) or any non-citation-tracking surface
- Modify methodology-content.ts or other publishing-bundle surfaces
- Bump any engine version
- Skip Phase 1 verification or enable cron before Phase 1 verifies clean (per C5)
- Use audit-pipeline-shared API keys (per C6)
- Probe with system prompts (per OQ-L; Anthropic gets empty-string per provider compat)
- Modify the locked prompt set, locked competitor table, or locked schema
- `git commit` until Phase 2 PASS (per C4)
- Add a digest-trigger endpoint, digest.ts file, or monthly-digest cron — those belong to Slice B1.1
- Treat *.workers.dev URL as customer-facing (per C1)

---

LOCKED CONTENT ARTIFACTS (verbatim from spec v5.1):

### Locked: 15-prompt set (OQ-A v5.1)

```ts
// pharos/citation-tracking/src/prompts.ts
export type PromptAxis = 'aeo_category' | 'methodology' | 'seo_transition' | 'mcp_infra' | 'prospect_intent';

export interface Prompt {
  id: string;
  axis: PromptAxis;
  text: string;
}

export const LOCKED_PROMPTS: Prompt[] = [
  // Axis 1 — AEO category (3 prompts)
  { id: 'aeo_acronym_b2b_saas',           axis: 'aeo_category',    text: 'Is there an AEO tool for B2B SaaS?' },
  { id: 'aeo_spelled_out_best',           axis: 'aeo_category',    text: 'What are the best agent-engine-optimization tools?' },
  { id: 'aeo_plain_english_discoverable', axis: 'aeo_category',    text: 'What tools help me make my website discoverable to AI agents?' },

  // Axis 2 — Methodology-specific (4 prompts)
  { id: 'meth_measure_accuracy',          axis: 'methodology',     text: 'How do I measure AI citation accuracy for my brand?' },
  { id: 'meth_tools_test_cite',           axis: 'methodology',     text: 'Tools for testing how LLMs cite my SaaS brand' },
  { id: 'meth_audit_descriptions',        axis: 'methodology',     text: 'How do I audit AI-generated descriptions of my brand?' },
  { id: 'meth_rigor_validated',           axis: 'methodology',     text: 'Which AEO tools have empirically validated their citation methodology?' },

  // Axis 3 — SEO-transition (2 prompts)
  { id: 'seo_changing_for_ai',            axis: 'seo_transition',  text: 'How is SEO changing for AI search?' },
  { id: 'seo_traditional_still_needed',   axis: 'seo_transition',  text: 'Do I still need traditional SEO if my traffic shifts to AI agents?' },

  // Axis 4 — MCP/agent-infrastructure (2 prompts)
  { id: 'mcp_marketing_analytics',        axis: 'mcp_infra',       text: 'What tools expose MCP servers for marketing analytics?' },
  { id: 'mcp_data_access',                axis: 'mcp_infra',       text: 'Tools that let AI agents access marketing data via MCP' },

  // Axis 5 — Prospect-intent (4 prompts)
  { id: 'intent_improve_visibility',      axis: 'prospect_intent', text: "How do I improve my site's AI visibility?" },
  { id: 'intent_lament_not_finding',      axis: 'prospect_intent', text: "Why aren't AI agents finding my product?" },
  { id: 'intent_set_up_for_ai',           axis: 'prospect_intent', text: 'Is my website set up so AI assistants will recommend it to prospects?' },
  { id: 'intent_compare_competitors',     axis: 'prospect_intent', text: "What's the best way to make sure AI assistants recommend my SaaS over competitors?" },
];
```

### Locked: D1 schema (OQ-E v5.1 + http_status column for B1.1's OQ-M)

```sql
-- pharos/citation-tracking/migrations/0001_initial.sql
CREATE TABLE probe_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'perplexity', 'gemini')),
  prompt_id TEXT NOT NULL,
  prompt_axis TEXT NOT NULL CHECK (prompt_axis IN ('aeo_category', 'methodology', 'seo_transition', 'mcp_infra', 'prospect_intent')),
  response_excerpt TEXT,
  d1a_url_cite INTEGER NOT NULL CHECK (d1a_url_cite IN (0, 1)),
  d1b_brand_mention INTEGER NOT NULL CHECK (d1b_brand_mention IN (0, 1)),
  d2_term_of_art INTEGER NOT NULL CHECK (d2_term_of_art IN (0, 1)),
  d3_competitors_cited TEXT,
  probe_run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'rate_limit', 'timeout', 'error', 'partial_coverage')),
  error_message TEXT,
  http_status INTEGER
);
CREATE INDEX idx_provider_prompt_time ON probe_runs (provider, prompt_id, timestamp);
CREATE INDEX idx_axis_time ON probe_runs (prompt_axis, timestamp);
CREATE INDEX idx_probe_run_id ON probe_runs (probe_run_id);
```

### Locked: Provider call shape (OQ-L v4 + OQ-K-1 v5.1)

- Temperature: 0
- Max tokens: 1500
- No system prompt (provider-by-provider compat below)
- 60s timeout
- Retry once on 429/5xx with `Retry-After` header parse when present, flat 30s when absent

Locked model identifiers (NOT aliases):
- OpenAI: `gpt-4o-2024-08-06`
- Anthropic: `claude-sonnet-4-5`
- Perplexity: `sonar`
- Gemini: `gemini-2.5-flash`

System-prompt provider-by-provider:
- OpenAI: omit `system` field
- Anthropic: pass `system: ""` (API requires field)
- Perplexity: omit
- Gemini: omit `system_instruction`

### Locked: Three-axis detection (OQ-D v5)

D1.a (URL): `astrant.io` case-insensitive anywhere in response.
D1.b (Brand): `Astrant` case-insensitive word boundary.
D2 (Vocabulary): `citation-confabulation methodology` or close variants present AND D1.a/D1.b BOTH false.
D3 (Competitive context): list of competitor names cited where Astrant is absent.

Competitor table (verified 2026-05-04):
- HubSpot AEO Grader: URL `hubspot.com/aeo-grader`; brand `AEO Grader` or legacy `AI Search Grader`. No disambiguation.
- Profound: URL `tryprofound.com`; brand `Profound`. ±200-char context disambiguation required.
- Ahrefs Brand Radar: URL `ahrefs.com/brand-radar`; brand `Brand Radar`. ±200-char context disambiguation required.
- Cloudflare Agent Readiness Score: URL `isitagentready.com` OR `blog.cloudflare.com/agent-readiness`; brand `Agent Readiness Score`. No disambiguation. **Complementary, flag separately** (`d3_complementary_cited` JSON key).

Disambiguation context vocabulary (within ±200 chars of brand match): `AEO`, `agent-engine-optimization`, `AI search`, `AI visibility`, `agent-discoverability`, `LLM citation`, `AI assistant`.

Salesforce DROPPED — Agentforce is agent-building infrastructure, not AEO.

### Locked: Variance handling (OQ-J v2)

Per probe cycle: each (provider × prompt) tuple runs N=3 replicates at temperature 0. Each replicate is a separate `probe_runs` row sharing `probe_run_id`. Detection runs per-replicate. Majority-cite collapse happens at digest time (B1.1), NOT at probe time.

### Locked: Auth token validation pattern

Internal endpoints validate `Authorization: Bearer <token>` against `env.PROBE_AUTH_TOKEN` via constant-time comparison. Mirrors audit-fulfill's `INTERNAL_FULFILL_KEY` pattern.

```ts
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
```

---

STEPS:

# 0. Pre-flight verification

```bash
git status
# Working tree should be clean or only contain WIP unrelated to this slice. If unrelated WIP, halt.

ls F:\pharos\citation-tracking 2>/dev/null && echo "ALREADY EXISTS" || echo "GREENFIELD"

# Confirm 4 fresh dedicated provider API keys + PROBE_AUTH_TOKEN are available (Bruno-side admin work):
# - OPENAI_API_KEY (citation-tracking-only)
# - ANTHROPIC_API_KEY (citation-tracking-only, separate from audit-pipeline)
# - PERPLEXITY_API_KEY
# - GEMINI_API_KEY (paid Tier 1 with gemini-2.5-flash)
# - PROBE_AUTH_TOKEN (≥32-char random string of Bruno's choosing)
# Halt if any not available.

wrangler whoami
```

# 1. Audit-discipline checklist (defensive)

Run the 4-question audit on the locked content artifacts. Expected: PASS on all four. If any check fires, the locked text has been modified relative to v5.1 — halt and report. Do NOT auto-rewrite.

# 2. Idempotency check

```bash
ls F:\pharos\citation-tracking/wrangler.jsonc 2>/dev/null
ls F:\pharos\citation-tracking/src/index.ts 2>/dev/null
ls F:\pharos\citation-tracking/migrations/0001_initial.sql 2>/dev/null
wrangler d1 list 2>/dev/null | grep "pharos-citation-tracking" || echo "D1 NOT YET CREATED"
wrangler deployments list --name pharos-citation-tracking 2>/dev/null | head -5 || echo "WORKER NOT YET DEPLOYED"

# Check if Phase 2 cron is live by reading wrangler.jsonc:
grep -E '"crons"\s*:\s*\[\s*"' F:\pharos\citation-tracking/wrangler.jsonc 2>/dev/null && echo "PHASE 2 CRON CONFIGURED" || echo "PHASE 1 STATE"
```

Branch resolution:
- All present + Phase 2 cron configured → ALREADY SHIPPED. Skip to Step 11 verification only.
- Worker deployed + D1 exists + Phase 1 state → resume from Step 9.
- None present → GREENFIELD; proceed from Step 3.
- Mixed/unauthored → halt and report.

# 3. Provision D1 database

```bash
wrangler d1 create pharos-citation-tracking
```

Capture `database_id` from output. Save as `B1_DB_ID` shell variable.

# 4. Create Worker file structure

Create directory + files at `F:\pharos\citation-tracking/`:

```
pharos/citation-tracking/
  wrangler.jsonc
  package.json
  tsconfig.json
  src/
    index.ts
    prompts.ts
    detect.ts
    storage.ts
    providers/
      openai.ts
      anthropic.ts
      perplexity.ts
      gemini.ts
  migrations/
    0001_initial.sql
```

### `pharos/citation-tracking/wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "pharos-citation-tracking",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-04",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "pharos-citation-tracking",
      "database_id": "<REPLACE WITH B1_DB_ID FROM STEP 3>"
    }
  ],
  "triggers": {
    "crons": []
  }
}
```

Note the empty `crons: []` array — Phase 1 ships with no cron schedule. Phase 2 (Step 9) sets `["0 2 * * *"]`. Empty-array form is idempotency-safe; a re-run of this prompt won't toggle commented-out lines.

### `pharos/citation-tracking/package.json`

```json
{
  "name": "pharos-citation-tracking",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev",
    "migrate": "wrangler d1 migrations apply pharos-citation-tracking --remote"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240620.0",
    "typescript": "^5.5.0",
    "wrangler": "^3.65.0"
  }
}
```

### `pharos/citation-tracking/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

### `pharos/citation-tracking/src/prompts.ts`

[Use the LOCKED_PROMPTS export verbatim from the LOCKED CONTENT ARTIFACTS section above.]

### `pharos/citation-tracking/src/index.ts`

```ts
import { runProbeCycle } from './storage';

export interface Env {
  DB: D1Database;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  GEMINI_API_KEY: string;
  PROBE_AUTH_TOKEN: string;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 2 * * *') {
      ctx.waitUntil(runProbeCycle(env));
    } else {
      console.warn(`Unrecognized cron expression: ${event.cron}`);
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/internal/')) {
      const auth = request.headers.get('Authorization') ?? '';
      const expected = `Bearer ${env.PROBE_AUTH_TOKEN}`;
      if (!constantTimeEqual(auth, expected)) {
        return new Response('Unauthorized', { status: 401 });
      }

      if (url.pathname === '/api/internal/probe-trigger' && request.method === 'POST') {
        ctx.waitUntil(runProbeCycle(env));
        return new Response('Probe cycle triggered. Check D1 for results.', { status: 202 });
      }
      return new Response('Unknown internal endpoint', { status: 404 });
    }

    return new Response('pharos-citation-tracking — internal instrumentation Worker. No public endpoints.', { status: 200 });
  },
};
```

### `pharos/citation-tracking/src/providers/openai.ts`

```ts
const MODEL = 'gpt-4o-2024-08-06';

export interface ProbeResult {
  status: 'success' | 'rate_limit' | 'timeout' | 'error';
  http_status?: number;
  response_text?: string;
  error_message?: string;
}

interface CallResult {
  status: number;
  body: any;
  retryAfterSeconds: number | null;
}

async function callOpenAI(promptText: string, apiKey: string): Promise<CallResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: promptText }],
        temperature: 0,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
    const body = await response.json();
    return { status: response.status, body, retryAfterSeconds };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function probeOpenAI(promptText: string, apiKey: string): Promise<ProbeResult> {
  try {
    const first = await callOpenAI(promptText, apiKey);
    if (first.status === 200) {
      return {
        status: 'success',
        http_status: 200,
        response_text: first.body.choices?.[0]?.message?.content ?? '',
      };
    }
    if (first.status === 429 || first.status >= 500) {
      const delayMs = (first.retryAfterSeconds && !isNaN(first.retryAfterSeconds))
        ? Math.min(first.retryAfterSeconds * 1000, 60000)
        : 30000;
      await new Promise(r => setTimeout(r, delayMs));
      const second = await callOpenAI(promptText, apiKey);
      if (second.status === 200) {
        return {
          status: 'success',
          http_status: 200,
          response_text: second.body.choices?.[0]?.message?.content ?? '',
        };
      }
      return {
        status: second.status === 429 ? 'rate_limit' : 'error',
        http_status: second.status,
        error_message: JSON.stringify(second.body).substring(0, 500),
      };
    }
    return {
      status: 'error',
      http_status: first.status,
      error_message: JSON.stringify(first.body).substring(0, 500),
    };
  } catch (e: any) {
    if (e.name === 'AbortError') return { status: 'timeout', error_message: 'Request timed out after 60s' };
    return { status: 'error', error_message: e.message };
  }
}
```

### `pharos/citation-tracking/src/providers/anthropic.ts`

```ts
const MODEL = 'claude-sonnet-4-5';

export interface ProbeResult {
  status: 'success' | 'rate_limit' | 'timeout' | 'error';
  http_status?: number;
  response_text?: string;
  error_message?: string;
}

interface CallResult {
  status: number;
  body: any;
  retryAfterSeconds: number | null;
}

async function callAnthropic(promptText: string, apiKey: string): Promise<CallResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        system: '',
        messages: [{ role: 'user', content: promptText }],
        temperature: 0,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
    const body = await response.json();
    return { status: response.status, body, retryAfterSeconds };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function probeAnthropic(promptText: string, apiKey: string): Promise<ProbeResult> {
  try {
    const first = await callAnthropic(promptText, apiKey);
    if (first.status === 200) {
      return {
        status: 'success',
        http_status: 200,
        response_text: first.body.content?.[0]?.text ?? '',
      };
    }
    if (first.status === 429 || first.status >= 500) {
      const delayMs = (first.retryAfterSeconds && !isNaN(first.retryAfterSeconds))
        ? Math.min(first.retryAfterSeconds * 1000, 60000)
        : 30000;
      await new Promise(r => setTimeout(r, delayMs));
      const second = await callAnthropic(promptText, apiKey);
      if (second.status === 200) {
        return {
          status: 'success',
          http_status: 200,
          response_text: second.body.content?.[0]?.text ?? '',
        };
      }
      return {
        status: second.status === 429 ? 'rate_limit' : 'error',
        http_status: second.status,
        error_message: JSON.stringify(second.body).substring(0, 500),
      };
    }
    return {
      status: 'error',
      http_status: first.status,
      error_message: JSON.stringify(first.body).substring(0, 500),
    };
  } catch (e: any) {
    if (e.name === 'AbortError') return { status: 'timeout', error_message: 'Request timed out after 60s' };
    return { status: 'error', error_message: e.message };
  }
}
```

### `pharos/citation-tracking/src/providers/perplexity.ts`

```ts
const MODEL = 'sonar';

export interface ProbeResult {
  status: 'success' | 'rate_limit' | 'timeout' | 'error';
  http_status?: number;
  response_text?: string;
  error_message?: string;
}

interface CallResult {
  status: number;
  body: any;
  retryAfterSeconds: number | null;
}

async function callPerplexity(promptText: string, apiKey: string): Promise<CallResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: promptText }],
        temperature: 0,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
    const body = await response.json();
    return { status: response.status, body, retryAfterSeconds };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function probePerplexity(promptText: string, apiKey: string): Promise<ProbeResult> {
  try {
    const first = await callPerplexity(promptText, apiKey);
    if (first.status === 200) {
      return {
        status: 'success',
        http_status: 200,
        response_text: first.body.choices?.[0]?.message?.content ?? '',
      };
    }
    if (first.status === 429 || first.status >= 500) {
      const delayMs = (first.retryAfterSeconds && !isNaN(first.retryAfterSeconds))
        ? Math.min(first.retryAfterSeconds * 1000, 60000)
        : 30000;
      await new Promise(r => setTimeout(r, delayMs));
      const second = await callPerplexity(promptText, apiKey);
      if (second.status === 200) {
        return {
          status: 'success',
          http_status: 200,
          response_text: second.body.choices?.[0]?.message?.content ?? '',
        };
      }
      return {
        status: second.status === 429 ? 'rate_limit' : 'error',
        http_status: second.status,
        error_message: JSON.stringify(second.body).substring(0, 500),
      };
    }
    return {
      status: 'error',
      http_status: first.status,
      error_message: JSON.stringify(first.body).substring(0, 500),
    };
  } catch (e: any) {
    if (e.name === 'AbortError') return { status: 'timeout', error_message: 'Request timed out after 60s' };
    return { status: 'error', error_message: e.message };
  }
}
```

### `pharos/citation-tracking/src/providers/gemini.ts`

```ts
const MODEL = 'gemini-2.5-flash';

export interface ProbeResult {
  status: 'success' | 'rate_limit' | 'timeout' | 'error';
  http_status?: number;
  response_text?: string;
  error_message?: string;
}

interface CallResult {
  status: number;
  body: any;
  retryAfterSeconds: number | null;
}

async function callGemini(promptText: string, apiKey: string): Promise<CallResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1500 },
      }),
      signal: controller.signal,
    });
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
    const body = await response.json();
    return { status: response.status, body, retryAfterSeconds };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function probeGemini(promptText: string, apiKey: string): Promise<ProbeResult> {
  try {
    const first = await callGemini(promptText, apiKey);
    if (first.status === 200) {
      const text = first.body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return { status: 'success', http_status: 200, response_text: text };
    }
    if (first.status === 429 || first.status >= 500) {
      const delayMs = (first.retryAfterSeconds && !isNaN(first.retryAfterSeconds))
        ? Math.min(first.retryAfterSeconds * 1000, 60000)
        : 30000;
      await new Promise(r => setTimeout(r, delayMs));
      const second = await callGemini(promptText, apiKey);
      if (second.status === 200) {
        const text = second.body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        return { status: 'success', http_status: 200, response_text: text };
      }
      return {
        status: second.status === 429 ? 'rate_limit' : 'error',
        http_status: second.status,
        error_message: JSON.stringify(second.body).substring(0, 500),
      };
    }
    return {
      status: 'error',
      http_status: first.status,
      error_message: JSON.stringify(first.body).substring(0, 500),
    };
  } catch (e: any) {
    if (e.name === 'AbortError') return { status: 'timeout', error_message: 'Request timed out after 60s' };
    return { status: 'error', error_message: e.message };
  }
}
```

### `pharos/citation-tracking/src/detect.ts`

```ts
const ASTRANT_URL_PATTERN = /astrant\.io/i;
const ASTRANT_BRAND_PATTERN = /\bAstrant\b/i;
const COINED_TERM_PATTERNS = [
  /citation[-\s]confabulation\s+methodology/i,
  /citation[-\s]confabulation/i,
];

interface CompetitorPattern {
  name: string;
  urlPattern: RegExp;
  brandPattern: RegExp;
  requiresContextDisambiguation: boolean;
  isComplementary?: boolean;
}

const COMPETITORS: CompetitorPattern[] = [
  {
    name: 'HubSpot AEO Grader',
    urlPattern: /hubspot\.com\/aeo-grader/i,
    brandPattern: /\bAEO Grader\b|\bAI Search Grader\b/i,
    requiresContextDisambiguation: false,
  },
  {
    name: 'Profound',
    urlPattern: /tryprofound\.com/i,
    brandPattern: /\bProfound\b/i,
    requiresContextDisambiguation: true,
  },
  {
    name: 'Ahrefs Brand Radar',
    urlPattern: /ahrefs\.com\/brand-radar/i,
    brandPattern: /\bBrand Radar\b/i,
    requiresContextDisambiguation: true,
  },
  {
    name: 'Cloudflare Agent Readiness Score',
    urlPattern: /isitagentready\.com|blog\.cloudflare\.com\/agent-readiness/i,
    brandPattern: /\bAgent Readiness Score\b/i,
    requiresContextDisambiguation: false,
    isComplementary: true,
  },
];

const AEO_VOCABULARY_PATTERNS = [
  /\bAEO\b/i,
  /agent[-\s]engine[-\s]optimization/i,
  /\bAI search\b/i,
  /\bAI visibility\b/i,
  /agent[-\s]discoverability/i,
  /\bLLM citation\b/i,
  /\bAI assistant\b/i,
];

export interface DetectionResult {
  d1a_url_cite: 0 | 1;
  d1b_brand_mention: 0 | 1;
  d2_term_of_art: 0 | 1;
  d3_competitors_cited: string[];
  d3_complementary_cited: string[];
}

export function detectAxes(responseText: string): DetectionResult {
  const text = responseText ?? '';

  const d1a = ASTRANT_URL_PATTERN.test(text) ? 1 : 0;
  const d1b = ASTRANT_BRAND_PATTERN.test(text) ? 1 : 0;
  const astrantPresent = d1a || d1b;

  const d2 = (!astrantPresent && COINED_TERM_PATTERNS.some(p => p.test(text))) ? 1 : 0;

  const competitorsCited: string[] = [];
  const complementaryCited: string[] = [];

  for (const comp of COMPETITORS) {
    let cited = false;
    if (comp.urlPattern.test(text)) {
      cited = true;
    } else {
      const brandMatch = comp.brandPattern.exec(text);
      if (brandMatch) {
        if (comp.requiresContextDisambiguation) {
          const start = Math.max(0, brandMatch.index - 200);
          const end = Math.min(text.length, brandMatch.index + brandMatch[0].length + 200);
          const window = text.substring(start, end);
          if (AEO_VOCABULARY_PATTERNS.some(p => p.test(window))) {
            cited = true;
          }
        } else {
          cited = true;
        }
      }
    }
    if (cited && !astrantPresent) {
      if (comp.isComplementary) {
        complementaryCited.push(comp.name);
      } else {
        competitorsCited.push(comp.name);
      }
    }
  }

  return {
    d1a_url_cite: d1a as 0 | 1,
    d1b_brand_mention: d1b as 0 | 1,
    d2_term_of_art: d2 as 0 | 1,
    d3_competitors_cited: competitorsCited,
    d3_complementary_cited: complementaryCited,
  };
}
```

### `pharos/citation-tracking/src/storage.ts`

```ts
import type { Env } from './index';
import { LOCKED_PROMPTS, type Prompt } from './prompts';
import { detectAxes } from './detect';
import { probeOpenAI } from './providers/openai';
import { probeAnthropic } from './providers/anthropic';
import { probePerplexity } from './providers/perplexity';
import { probeGemini } from './providers/gemini';

const N_REPLICATES = 3;

interface ProviderSpec {
  name: 'openai' | 'anthropic' | 'perplexity' | 'gemini';
  apiKey: string;
  fn: (text: string, key: string) => Promise<{
    status: 'success' | 'rate_limit' | 'timeout' | 'error';
    http_status?: number;
    response_text?: string;
    error_message?: string;
  }>;
}

export async function runProbeCycle(env: Env): Promise<void> {
  const probeRunId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const providers: ProviderSpec[] = [
    { name: 'openai',     apiKey: env.OPENAI_API_KEY,     fn: probeOpenAI },
    { name: 'anthropic',  apiKey: env.ANTHROPIC_API_KEY,  fn: probeAnthropic },
    { name: 'perplexity', apiKey: env.PERPLEXITY_API_KEY, fn: probePerplexity },
    { name: 'gemini',     apiKey: env.GEMINI_API_KEY,     fn: probeGemini },
  ];

  // For each (prompt × replicate), fan out 4 providers in parallel via Promise.allSettled.
  // Concurrency=4 stays under the documented ~6-fetch isolate cap (orchestrator.ts:131)
  // with 2 slots headroom for retries within a provider.
  // One provider rejecting MUST NOT short-circuit the cycle — Promise.allSettled is load-bearing.
  for (const prompt of LOCKED_PROMPTS) {
    for (let replicate = 0; replicate < N_REPLICATES; replicate++) {
      const settled = await Promise.allSettled(
        providers.map(p => p.fn(prompt.text, p.apiKey))
      );

      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        const s = settled[i];
        let result;
        if (s.status === 'fulfilled') {
          result = s.value;
        } else {
          // Defensive fallback — record as error row, real provider name + prompt_id
          // (mirrors orchestrator.ts:50 synthesizeFallbackCell pattern).
          const reasonStr = s.reason instanceof Error ? s.reason.message : String(s.reason);
          result = { status: 'error' as const, error_message: `Probe rejection: ${reasonStr.slice(0, 240)}` };
        }

        const detection = detectAxes(result.response_text ?? '');

        await env.DB.prepare(`
          INSERT INTO probe_runs (
            timestamp, provider, prompt_id, prompt_axis, response_excerpt,
            d1a_url_cite, d1b_brand_mention, d2_term_of_art,
            d3_competitors_cited, probe_run_id, status, error_message, http_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          now,
          provider.name,
          prompt.id,
          prompt.axis,
          (result.response_text ?? '').substring(0, 2000),
          detection.d1a_url_cite,
          detection.d1b_brand_mention,
          detection.d2_term_of_art,
          JSON.stringify({
            direct: detection.d3_competitors_cited,
            complementary: detection.d3_complementary_cited,
          }),
          probeRunId,
          result.status,
          result.error_message ?? null,
          result.http_status ?? null,
        ).run();
      }
    }
  }
}
```

### `pharos/citation-tracking/migrations/0001_initial.sql`

[Use the schema verbatim from the LOCKED CONTENT ARTIFACTS section above.]

# 5. Apply migration

```bash
cd F:\pharos\citation-tracking
wrangler d1 migrations apply pharos-citation-tracking --remote
```

Verify:

```bash
wrangler d1 execute pharos-citation-tracking --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
# Expected: probe_runs (and any system tables)

wrangler d1 execute pharos-citation-tracking --remote --command "SELECT sql FROM sqlite_master WHERE name='probe_runs';"
# Expected: CREATE TABLE matching locked schema verbatim, including all CHECK constraints + http_status column
```

If schema doesn't match locked spec verbatim, halt and report.

# 6. Phase 1 deploy (cron disabled)

```bash
cd F:\pharos\citation-tracking
npm install
DEPLOY_OUT=$(wrangler deploy 2>&1)
echo "$DEPLOY_OUT"
```

Capture worker URL + version ID from `$DEPLOY_OUT`. Worker URL is *.workers.dev (internal only per C1).

After deploy succeeds, set secret bindings:

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put PERPLEXITY_API_KEY
wrangler secret put GEMINI_API_KEY
wrangler secret put PROBE_AUTH_TOKEN
```

Confirm secrets:

```bash
wrangler secret list
# Expected: OPENAI_API_KEY, ANTHROPIC_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY, PROBE_AUTH_TOKEN
```

Per C6: confirm each provider key was generated for a citation-tracking-dedicated account (not shared with audit-pipeline). If shared, halt and provision fresh.

# 7. Phase 1 verification — auth check + probe trigger + D1 inspection

```bash
WORKER_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[^ ]+\.workers\.dev' | head -1)
AUTH_TOKEN="<the value Bruno set in Step 6's PROBE_AUTH_TOKEN>"

# Auth-failure smoke test (must return 401):
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${WORKER_URL}/api/internal/probe-trigger" \
  -H "Authorization: Bearer wrong-token")
if [ "$HTTP_CODE" != "401" ]; then
  echo "AUTH CHECK FAILED — expected 401, got $HTTP_CODE. Halt."
  exit 1
fi
echo "Auth-failure smoke test PASS (401 on bad token)"

# Auth-success probe trigger:
curl -s -X POST "${WORKER_URL}/api/internal/probe-trigger" \
  -H "Authorization: Bearer ${AUTH_TOKEN}"
# Expected: 202 Accepted with "Probe cycle triggered" message

# Wait for probe cycle to complete.
# 15 prompts × 3 replicates = 45 sequential batches; each batch fans out 4 providers in parallel.
# Per-batch wall time: ~3-5s (max provider response time). Total: ~135-225s.
# Buffer to 300s to allow for retry windows.
sleep 300

# Verify expected row count:
wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM probe_runs;"
# Expected: 180 rows (15 prompts × 4 providers × 3 replicates)
# < 135 (75% completion) → systematic provider failure; investigate per-provider table below.

# Per-provider success/error distribution:
wrangler d1 execute pharos-citation-tracking --remote --command "SELECT provider, status, COUNT(*) as count FROM probe_runs GROUP BY provider, status ORDER BY provider, status;"
# Expected: each provider has ~45 rows status='success'. Few or none 'error'/'rate_limit'/'timeout'.
# Any provider all-error → API key or model identifier misconfigured. Verify against OQ-L locked identifiers.

# Per-axis cite distribution (D1.a or D1.b):
wrangler d1 execute pharos-citation-tracking --remote --command "SELECT prompt_axis, COUNT(*) as total, SUM(d1a_url_cite + d1b_brand_mention) as cites FROM probe_runs GROUP BY prompt_axis;"
# Expected: some non-zero cite rate, varying by axis (real baseline TBD).
# All-zero everywhere = either Astrant is genuinely never cited yet (possible) OR detection regex broken (debug detect.ts).
# All-100% everywhere = detection over-matching (debug detect.ts).

# Sample responses to confirm provider responses look like real LLM outputs:
wrangler d1 execute pharos-citation-tracking --remote --command "SELECT provider, prompt_id, substr(response_excerpt, 1, 200) FROM probe_runs WHERE status='success' ORDER BY RANDOM() LIMIT 5;"
# Each excerpt should look like coherent natural-language response.
# JSON error blobs / auth failures / safety-filter rejections → halt and investigate.
```

**If Phase 1 verification PASSES** (row count = 180 ±5%, per-provider success ≥75%, response excerpts look real): proceed to Step 8.

**If Phase 1 verification FAILS** (per C5): cron-disabled state STAYS IN PLACE. Iterate on the manual-trigger endpoint until verification passes. Do NOT roll back.

# 8. Phase 2 deploy (enable daily probe cron)

Edit `wrangler.jsonc` — change `"crons": []` to:

```jsonc
  "triggers": {
    "crons": ["0 2 * * *"]
  }
```

(Daily probe cron at 02:00 UTC. Monthly digest cron is NOT added in this slice — that ships in B1.1.)

Re-deploy:

```bash
DEPLOY_OUT_P2=$(wrangler deploy 2>&1)
echo "$DEPLOY_OUT_P2"
```

# 9. Phase 2 verification

```bash
# Verify cron schedule by parsing the deploy output (wrangler echoes configured triggers on deploy):
echo "$DEPLOY_OUT_P2" | grep -E "(cron|0 2 \* \* \*)" || echo "WARNING: cron schedule not visible in deploy output; cross-check wrangler.jsonc"

# Cross-check via wrangler.jsonc (source of truth):
grep -A 2 '"crons"' F:\pharos\citation-tracking/wrangler.jsonc
# Expected: "crons": ["0 2 * * *"]

# Wait for next 02:00 UTC fire OR trigger manually one more time to verify post-Phase-2 cycle still works:
PRE_P2_COUNT=$(wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM probe_runs;" --json | grep -oE '[0-9]+' | head -1)
curl -s -X POST "${WORKER_URL}/api/internal/probe-trigger" -H "Authorization: Bearer ${AUTH_TOKEN}"
sleep 300
POST_P2_COUNT=$(wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM probe_runs;" --json | grep -oE '[0-9]+' | head -1)
GROWTH=$((POST_P2_COUNT - PRE_P2_COUNT))
echo "Row growth post-Phase-2 manual trigger: $GROWTH (expected ~180)"
```

# 10. Output ship-report

Write `F:\pharos\reports\slice-b1-deploy-2026-05-04.md` with:

```
# Slice B1 — Citation-Tracking Instrumentation — 2026-05-04

## Files created
- pharos/citation-tracking/wrangler.jsonc
- pharos/citation-tracking/package.json
- pharos/citation-tracking/tsconfig.json
- pharos/citation-tracking/src/index.ts
- pharos/citation-tracking/src/prompts.ts
- pharos/citation-tracking/src/detect.ts
- pharos/citation-tracking/src/storage.ts
- pharos/citation-tracking/src/providers/openai.ts
- pharos/citation-tracking/src/providers/anthropic.ts
- pharos/citation-tracking/src/providers/perplexity.ts
- pharos/citation-tracking/src/providers/gemini.ts
- pharos/citation-tracking/migrations/0001_initial.sql

## D1 database
- Name: pharos-citation-tracking
- Database ID: <UUID from Step 3>

## Phase 1 deploy
- Worker URL: <https://*.workers.dev>
- Worker version ID: <id>
- Cron triggers: DISABLED (crons: [])

## Phase 1 verification
- Auth-failure smoke test (401 on bad token): PASS|FAIL
- Manual probe trigger fired: PASS|FAIL
- Total rows in probe_runs after probe cycle: <count> (expected: 180)
- Per-provider success rate: openai <%>, anthropic <%>, perplexity <%>, gemini <%>
- Sample response excerpts inspected: <PASS — coherent LLM output | FAIL — describe>
- Axis cite distribution non-degenerate: PASS|FAIL

## Phase 2 deploy
- Cron triggers enabled: ["0 2 * * *"]
- Worker version ID (post Phase 2): <id>
- Cron schedule visible in deploy output: PASS|FAIL
- Cross-check via wrangler.jsonc: PASS
- Manual post-P2 trigger row growth: +<count> (expected ~180)

## OQ-A locked prompt set ingested
- 15 prompts across 5 axes (3+4+2+2+4) — confirmed in src/prompts.ts

## OQ-D verified competitor list ingested
- HubSpot AEO Grader (direct) — detect.ts pattern present
- Profound (direct) — detect.ts pattern present + context-window disambiguation
- Ahrefs Brand Radar (direct) — detect.ts pattern present + context-window disambiguation
- Cloudflare Agent Readiness Score (complementary) — detect.ts pattern present + complementary flag
- Salesforce DROPPED per OQ-D verification — confirmed absent from detect.ts

## Out-of-scope (deferred to Slice B1.1)
- digest.ts aggregation (cross-provider equal-weighted KPI per OQ-I Mitigation 1)
- Monthly digest cron ("0 14 1 * *")
- Single-provider-only-signal flagging per OQ-I Mitigation 2
- OQ-M model-deprecation 404-rate detection
- Markdown digest template + audit-discipline pass

## Notes / open follow-ups
- <anything noticed during integration that didn't block deploy>

## Next milestones
- Slice B1.1: digest aggregation + monthly cron + reporting (must ship within 30 days before first monthly digest fire)
- Month 0-2: baseline measurement phase. No success/failure declarations.
- Month 2-3: OQ-H threshold-lock amendment to spec.
- Month 3+: thresholds in force; downstream slice triggers active.
```

Print "DONE" and the path to the report file.
```

---

## After Claude Code finishes

Bring ship-report (or its contents) back to chat. Verify Phase 1 + Phase 2 PASS, secrets bound to citation-tracking-dedicated accounts, OQ-A locked prompt set + OQ-D verified competitor list in source verbatim, no digest artifacts present (those belong to B1.1).

Once shipped: 60-90 days baseline measurement. **Slice B1.1 must land within 30 days** to ensure the first monthly digest has aggregation infrastructure ready when the first calendar month of probe data is complete.
