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
