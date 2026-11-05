# Pharos Scanner

The Pharos Agent Discoverability Score scanner — a Cloudflare Worker that scans a URL across the six dimensions of agent discoverability and returns a composite score.

All six dimensions ship (scoring version in `src/version.ts`; weights in `src/scoring.ts`):

- **Dim 1 — llms.txt Quality** (presence, spec compliance, linked-page quality, curation, blockquote LLM eval)
- **Dim 2 — MCP Server Discoverability** (well-known card, tool coverage, OAuth metadata, live tools/list, DNS TXT)
- **Dim 3 — OpenAPI / API Catalog** (whole-dimension N/A for content-only sites)
- **Dim 4 — Structured Capability Data** (JSON-LD presence, Organization, Service/Offer, FAQPage + LLM eval, Review)
- **Dim 5 — Agent-Parsable Content** (static fetch)
- **Dim 6 — Citation Visibility** (free tier: N/A preview; measured in the paid Audit)

## Stack

- Cloudflare Workers (TypeScript) + Hono routing
- Cloudflare D1 — scan history
- Cloudflare KV — result cache (1h) + rate limiter
- Cloudflare Workers AI — `@cf/meta/llama-3.1-8b-instruct-fp8` for the blockquote and FAQ-conversational evals

## First-time setup

```bash
npm install
npx wrangler d1 create pharos-scanner
# paste database_id into wrangler.jsonc
npx wrangler kv namespace create CACHE
# paste id into wrangler.jsonc
npm run db:migrate:remote
# db:migrate* applies only schema.sql; the Worker also needs every file in
# migrations/ (0001–0005, in order) — INSERT_SCAN_SQL writes columns they add.
npm run deploy
```

## Local dev

```bash
npm run dev
# POST /api/scan
curl -X POST http://localhost:8787/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://pharos-marketing.pharos-dev.workers.dev"}'
```

## Endpoints

- `POST /api/scan` — body `{url, email?}` → composite + per-dimension breakdown
- `GET /api/scan/:id` — fetch a previously-run scan by ID
- `GET /health` — `{ok:true, version}`

Rate limits: 5 scans / IP / day, 3 scans / URL / day. Results cached 1h per URL.
