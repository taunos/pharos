# Pharos MCP Server — Deploy Guide

From a fresh machine to a live MCP at `https://pharos-mcp.<your-account>.workers.dev/mcp` in about 20 minutes.

> **You'll do this yourself** — I (Claude) can't sign into your Cloudflare account or enter any credentials. The commands below are copy-paste ready.

## 1. Prerequisites

You need:

- **Node.js 20+** ([nodejs.org](https://nodejs.org)). Check: `node --version`
- **A Cloudflare account** (free tier is enough for the deploy itself; Workers Paid + Workers for Platforms come later when you onboard real clients per OQ-02). Sign up at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) if you don't have one.
- **Git** (you'll create the repo on GitHub or wherever after this works locally)

## 2. Install dependencies

From the `Solo Startup SaaS/pharos/mcp-server/` folder:

```bash
cd "Solo Startup SaaS/pharos/mcp-server"
npm install
```

This installs `@modelcontextprotocol/sdk`, `agents` (Cloudflare's MCP wrapper), `zod`, and the dev tooling (`wrangler`, `typescript`, `@cloudflare/workers-types`).

## 3. Sign into Cloudflare

```bash
npx wrangler login
```

This pops a browser window. Sign in, authorize Wrangler. Done in ~30 seconds.

## 4. Run locally first (optional but recommended)

```bash
npm run dev
```

Wrangler boots a local server, usually at `http://localhost:8787`. Open it — you should see the plain-text landing page. Then check:

- `http://localhost:8787/.well-known/mcp.json` should return JSON server-card metadata
- `http://localhost:8787/mcp` is the MCP endpoint (won't render in a browser; needs an MCP client)

To test the MCP itself locally, install [`@modelcontextprotocol/inspector`](https://modelcontextprotocol.io/docs/tools/inspector) and point it at `http://localhost:8787/mcp`. You should see all 6 tools (`get_capabilities`, `get_pricing`, `get_case_studies`, `book_audit`, `check_llms_txt`, `score_url`) and be able to invoke them.

`Ctrl+C` to stop the local server.

## 5. Deploy

```bash
npm run deploy
```

Wrangler uploads the Worker, registers the `PharosMCP` Durable Object class, and prints the deployed URL. It'll look something like:

```
Published pharos-mcp (1.23 sec)
  https://pharos-mcp.<your-account>.workers.dev
```

That's a live MCP server.

## 6. Verify

In a browser, visit:
- `https://pharos-mcp.<your-account>.workers.dev/` — landing page
- `https://pharos-mcp.<your-account>.workers.dev/.well-known/mcp.json` — server card

Then add it to Claude Desktop:

1. Open Claude Desktop → Settings → Connectors → "Add custom connector"
2. Paste `https://pharos-mcp.<your-account>.workers.dev/mcp`
3. Claude Desktop probes the discovery endpoint, lists the 6 tools

In any chat, try:

> "Call check_llms_txt on https://anthropic.com"

Claude should call your MCP, fetch anthropic.com/llms.txt, and return the parsed result. **That moment — Claude Desktop calling your own deployed MCP — is the proof point.**

## 7. Live logs

```bash
npm run tail
```

Streams real-time invocation logs. Useful while testing.

## 8. (Later) Custom domain

When the public brand is decided and the domain is purchased:

1. In Cloudflare dashboard → Workers & Pages → `pharos-mcp` → Settings → Triggers → Custom Domains → Add Custom Domain → `mcp.<your-domain>`
2. Or uncomment the `routes` block in `wrangler.jsonc` and `npm run deploy` again.

The custom domain gets a free TLS cert automatically.

## 9. Common gotchas

- **`wrangler login` fails on a headless machine** — use `wrangler login --browser=false` and copy the URL into a browser on another machine.
- **`npm install` warns about peer dependencies** — usually fine; Workers don't enforce them at runtime.
- **`Durable Object class not found`** — make sure `wrangler.jsonc` `migrations` block is present and the deploy uses `--keep-vars` if you've set secrets.
- **MCP client says "no tools found"** — check the URL ends in `/mcp` (not the bare deploy URL). Discovery endpoint is `/.well-known/mcp.json`.

## 10. What's next

After this is live:

- Push the repo to GitHub (`git init`, etc.)
- Move on to the marketing site (`marketing-site/`) so `pharos.dev` resolves
- Build the scanner Worker (`scanner/`) per `OQ-04_score_tool_spec.md`
- Wire `score_url` from a stub to a real proxy of the scanner

When you've got the Worker live, ping me with the URL — I can sanity-check the MCP responses and walk through the next build.

---

## Slice 2b — email-gated PDF gap report (2026-04-30)

Adds email-capture + Resend transactional delivery + per-email PDF watermarking
to the free Score flow. Public results page at `/score/[id]?t=<token>` and
deletion endpoint at `/score/delete-me`.

### New secrets

**On marketing-site Worker** (`astrant-marketing-prod`):

```bash
cd marketing-site
wrangler secret put RESEND_API_KEY              # astrant-marketing-prod key from Resend
wrangler secret put UNSUBSCRIBE_SECRET          # 64+ byte random hex; HMAC root for scan-bound tokens
wrangler secret put INTERNAL_SCANNER_ADMIN_KEY  # 32+ byte random hex; same value as scanner side
```

**On scanner Worker** (`pharos-scanner`):

```bash
cd scanner
wrangler secret put INTERNAL_SCANNER_ADMIN_KEY  # same value as marketing-site
```

`INTERNAL_SCANNER_ADMIN_KEY` is **distinct** from `INTERNAL_FULFILL_KEY` —
different trust domain (admin endpoints vs paid-tier audit fulfillment).
Do not reuse the same value.

### Resend DNS

Configured under `astrant.io` per Resend Auto-configure (subdomain pattern):

- **SPF** TXT at `send.astrant.io` — `v=spf1 include:amazonses.com ~all`
- **DKIM** TXT at `resend._domainkey.astrant.io` — value from Resend dashboard
- **DMARC** still pending (deferrable). Once added: TXT at `_dmarc.astrant.io`
  with `v=DMARC1; p=none; rua=mailto:dmarc@astrant.io` to start in monitoring
  mode, then ramp to `p=quarantine` after a week of clean reports.

A Cloudflare Email Routing rule forwards `reports@astrant.io` and friends to
the personal inbox so bounces and replies are visible.

### Rotation runbook for `UNSUBSCRIBE_SECRET`

Token format embeds a `v1.` version prefix specifically to enable dual-secret
rotation without invalidating in-flight tokens:

1. Generate new secret: `openssl rand -hex 64` → `UNSUBSCRIBE_SECRET_NEXT`.
2. Bind both secrets on marketing-site Worker; modify `verifyScanToken` /
   `verifyDeletionToken` to try `UNSUBSCRIBE_SECRET_NEXT` first, then fall
   back to `UNSUBSCRIBE_SECRET`. New tokens issue under `_NEXT`.
3. Wait for the longer of: PDF token TTL (30 days) or unsubscribe token TTL
   (365 days, but the unsubscribe link is rarely clicked years later — 30
   days is a reasonable cutover for that path too).
4. Promote `UNSUBSCRIBE_SECRET_NEXT` → `UNSUBSCRIBE_SECRET`. Drop the old
   binding and the fallback branch.
5. Bump `TOKEN_VERSION` in `score-tokens.ts` to `v2` if the rotation reason
   was a suspected leak; otherwise leave as `v1`.

### KV consistency caveat

The deletion-rate-limit and email-readback rate-limit counters live in KV.
KV is eventually consistent across edges (~60s convergence under load), so
two near-simultaneous requests from different edges can both pass a "1/hr"
check. Acceptable for v1 anti-abuse posture; if rate-limit precision becomes
load-bearing, migrate to D1 with a unique-index trick or to Cloudflare's
Rate Limiting binding.

### Resend free-tier limits

Free tier: 3,000 emails/month, 100/day. The deferred-PDF flow (BR daily-cap
miss) does **not** retry — Phase 2's cron sweep handles re-attempt the next
UTC midnight. If volume crosses 100/day before Phase 2, upgrade Resend
before the launch ramp.

### Deployed version hashes

After each deploy, capture the wrangler-printed deployment ID for both
Workers and append below. Useful for incident response (which version was
live when X happened):

```
2026-04-30 scanner       999939cf-04c4-4778-a67e-367f9c686193
2026-04-30 marketing     927038bb-4991-492c-8241-80eeb6b9bb2f  (re-deploy after legal-content inline fix)
```

### Slice 2b pre-deploy refinements (2026-04-30)

Four fixes applied between Slice 2b implementation and first deploy, surfaced
by static security review (`pharos-pentest-findings-static-pass-1.md`):

- **F-01 Email normalization** — new shared helper `normalizeEmail()` in
  `marketing-site/src/lib/email-normalize.ts` + scanner mirror at
  `scanner/src/email-normalize.ts`. Applied at every email entry point
  (capture-email, delete-me, audit-create, triage, waitlist, scanner /api/scan,
  scanner score-admin). Prevents user-visible breakage in unsubscribe,
  deletion, and PDF download flows when the user enters the same address with
  different casing across submissions. R2 keys, HMAC payloads, and log hashes
  all derive from the normalized form.
- **F-02 PHAROS → Astrant** in audit PDF header (`audit-pipeline.ts:571`) —
  customer-trust fix. Internal env-binding type names (`PHAROS_CORPUS`)
  preserved per `project_naming_status.md`.
- **F-03 Constant-time auth** — `INTERNAL_FULFILL_KEY` and
  `INTERNAL_SCANNER_ADMIN_KEY` header comparisons now use `constantTimeEqual`.
  Helper exported from `marketing-site/src/lib/dodo.ts` (was previously
  internal); scanner-side mirror lives at `scanner/src/auth.ts`.
- **F-04 Hashed email in logs** — `triage` and `waitlist` routes now log
  `email_hash` (salted with `UNSUBSCRIBE_SECRET`) instead of raw email,
  matching the Slice 2b log-redaction pattern. Triage route's worker bindings
  must expose `UNSUBSCRIBE_SECRET` for the hash to be salted; otherwise the
  fallback marker `[unsalted]` makes a missing binding loud.

Deferred to Phase 1.5 hardening: F-05 through F-12, F-14, plus waitlist
persistence (functional bug — currently `console.log` only, no D1/KV write).

