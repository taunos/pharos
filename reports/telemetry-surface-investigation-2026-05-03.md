# Telemetry Surface Investigation — 2026-05-03

**Purpose:** Pre-spec investigation for `pharos-citation-tracking-instrumentation-spec.md` v1 (Cowork-side authoring). Documents what telemetry is **already collectable for free** versus what requires net-new infrastructure. Findings flow into the spec's "tractable signals" decision.

**Investigated surfaces:** marketing-site Worker, mcp-server Worker, scanner Worker, all three D1/KV/R2 bindings. Bruno may have additional Cloudflare-dashboard-side visibility this investigation can't access from F:\ alone.

---

## Already-collectable telemetry (zero net-new infrastructure)

### 1. Cloudflare Workers Logs — ALL THREE workers

All three Workers have `observability: { enabled: true }` in their wrangler.jsonc:

- [marketing-site/wrangler.jsonc:47-49](../marketing-site/wrangler.jsonc#L47-L49)
- [mcp-server/wrangler.jsonc:9-11](../mcp-server/wrangler.jsonc#L9-L11)
- [scanner/wrangler.jsonc:15](../scanner/wrangler.jsonc#L15)

This means Cloudflare Workers Logs (the new aggregation layer, not classic tail) is on for every request. Each request emits structured log records: timestamp, URL, method, status, response-time, User-Agent (when sent), CF-Ray, country (from CF-IPCountry header). 7-day retention by default; queryable via CF dashboard's Logs tab.

**Leading indicators directly available:**

- **llms.txt fetch User-Agents** (marketing-site Worker) → identifies which crawlers are pulling the dogfood manifest. Filter: `request.url ENDS WITH "/llms.txt"`. User-Agent reveals OpenAI/Anthropic/Perplexity/Google bot signatures.
- **MCP server invocation patterns** (mcp-server Worker) → every `/mcp` and `/sse` request logs. Filter: `request.url CONTAINS "/mcp"` AND `request.method = "POST"`. Invocation count by User-Agent gives a leading indicator of "agents are using Astrant's MCP tools."
- **astrant.io traffic patterns by User-Agent** (marketing-site Worker) → distinguishes browser traffic from crawler traffic. Filter: `request.headers.user-agent CONTAINS "GPTBot|ClaudeBot|PerplexityBot|Google-Extended"`.
- **Static-asset crawl patterns** (any Worker serving `/.well-known/*`, `/methodology/*`, `/score/*`) → signals which surfaces agents are crawling vs ignoring.

**Cost:** zero. Already accruing.

**Limitation:** 7-day retention. For longer-term aggregation, either (a) export via Logpush to R2/external sink, or (b) write structured events to Analytics Engine (see "net-new" below).

### 2. Scanner D1 (`pharos-scanner` database, ID `56dd16f8-...`)

The scanner Worker writes scan history to its own D1 ([scanner/wrangler.jsonc:20-26](../scanner/wrangler.jsonc#L20-L26)). This persists every free-tier scan event with URL, score, dimensions, timestamp.

**Useful for:** scan-volume baseline (a downstream proxy for "agents are sending traffic to /score" if scan volume rises in the absence of marketing pull).

**Schema:** see `scanner/schema.sql` if you need to know the exact columns.

### 3. Marketing-site KV namespaces

- `TRIAGE_CACHE` — Slice 2b form-triage state
- `SESSIONS` — Score email-capture session tokens + Dim 6 cell cache
- `CORPUS_DEAD_LETTER` — failed corpus writes for retry

**Useful for instrumentation:** indirect — `SESSIONS` activity reflects email-capture conversion (a proxy for "scans → email submission" funnel rate). Not a direct citation signal.

### 4. Marketing-site D1 (`pharos_corpus`)

Paid-tier audit corpus + Dim 6 cells. Reflects PAID activity, not agent crawl/citation. Not directly useful for citation tracking — current state is mostly Astrant's own dogfood + the four known-positive calibration anchors.

---

## Net-new infrastructure required for direct citation measurement

The leading indicators above tell you "agents are reaching Astrant's surfaces." None of them tell you "agents are recommending Astrant in answers to prospect-shaped queries." That's the gating signal per the strategic conversation, and there's no existing surface that captures it.

### Direct-citation-probe corpus (NEW)

**Shape:** scheduled job that periodically asks ChatGPT/Claude/Perplexity prompts like:

- "Is there an AEO tool for B2B SaaS?"
- "What tools measure AI citation accuracy?"
- "Which services help my site get cited by ChatGPT?"
- (... a curated prompt set per acquirer-profile + customer-profile thesis)

For each (prompt × model) combination, record:

- Whether `astrant.io` appears in the response (binary cite/not-cite)
- Citation context (full quoted span, if cited)
- Whether competitors appear (Otterly.AI, Profound, Goodie, etc. — TBD by spec)
- Response timestamp + model version

Persist to a new D1 table or R2 bucket — schema decision deferred to spec.

**Cost estimate:** $0.01-0.05 per probe × N prompts × M models × frequency. For daily probing of ~20 prompts × 3 models = 60 probes/day, ~$0.60-3.00/day, ~$20-90/month. Per `feedback_cost_discipline_pre_revenue` — this is revenue-enabling spend (gates the entire agent-first distribution thesis), not discretionary.

**Implementation surface candidates:**

- (a) New scheduled Worker (`probe-runner`) using Cloudflare Cron Triggers
- (b) Extend scanner Worker with a cron handler
- (c) GitHub Actions cron + writes back to a CF endpoint

(a) is cleanest — same operational surface as existing Workers, native cron support, observability already wired.

### Cloudflare Analytics Engine (optional but recommended)

For structured time-series aggregation of leading indicators (instead of querying CF Logs every time), add an Analytics Engine binding to each Worker:

```jsonc
"analytics_engine_datasets": [
  { "binding": "AGENT_TELEMETRY", "dataset": "agent_crawl_events" }
]
```

Then `env.AGENT_TELEMETRY.writeDataPoint({ blobs: [...], indexes: [...] })` per relevant request.

**Cost:** Analytics Engine billing is per-write; effectively free at the volumes Astrant is operating at. CF dashboard's Analytics tab + the Workers Analytics Engine SQL API let you query aggregations directly.

**Status check:** zero `writeDataPoint` calls in the current codebase (verified via repo-wide grep). Greenfield — adding it is a 5-line change per Worker plus a wrangler.jsonc binding.

---

## Summary table for the spec's "tractable signals" decision

| Signal | Class | Status | Cost | Latency to enable |
|---|---|---|---|---|
| llms.txt fetch User-Agents | Leading | Already collecting (CF Logs) | $0 | 0 (just query) |
| MCP invocation patterns | Leading | Already collecting (CF Logs) | $0 | 0 |
| astrant.io traffic by User-Agent | Leading | Already collecting (CF Logs) | $0 | 0 |
| Scan-volume baseline | Indirect | Already collecting (D1) | $0 | 0 |
| Referrer headers | Leading (weak) | Already collecting (CF Logs) | $0 | 0 |
| **Direct citation probe corpus** | **DIRECT** | **Greenfield** | **~$20-90/mo** | **Spec-bounded slice (~half-day)** |
| Analytics Engine aggregation | Cross-cutting | Greenfield | ~$0 | ~30-min config |

---

## Spec-input recommendations

When Cowork drafts `pharos-citation-tracking-instrumentation-spec.md` v1:

1. **Commit to direct-citation probe as the primary track.** That's the empirical claim the agent-first strategy lives on. Leading indicators are supporting telemetry, not substitutes.
2. **Lean on existing CF Workers Logs for leading indicators.** Don't build a custom logging layer; query the existing one.
3. **Analytics Engine as a Phase 2 enhancement, not Phase 1.** First slice ships the probe corpus; if leading-indicator querying becomes friction, add Analytics Engine in a follow-up.
4. **Cron trigger Worker (option (a) above) is the right implementation surface** — matches existing Worker operational discipline, same observability story, same deploy chain via wrangler.

---

## Open questions for the spec to resolve

1. **Prompt set composition** — how many, which categories, how often refreshed? (Initial draft: ~20-30 prompts, refreshed quarterly, organized by acquirer-profile thesis.)
2. **Competitor citation tracking** — track which other tools surface? Provides relative-position signal but adds curation work. Spec's call.
3. **Probe schedule** — daily / weekly / monthly? Daily costs ~$20-90/mo and gives next-day signal; weekly costs ~$3-12/mo and gives 7-day-trailing signal. Recommend daily for the first 90 days, then re-evaluate based on signal stability.
4. **Citation-context capture** — store full response text (high signal, higher storage cost) or just cited/not-cited bool + first-100-chars? Spec's call.
5. **Acquirer-profile coupling** — do prompts split by acquirer profile (infra/martech/SEO-incumbent) and produce separate cite-share signals per profile? Or unified? Affects how (b) acquirer-profile decision is informed by (a) instrumentation.

These are spec-cycle items, not investigation items — flagging for Cowork's v1 draft.
