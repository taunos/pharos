## Pharos MCP Server — local-verify task

I have a Cloudflare Workers MCP server scaffolded at:
`F:\pharos\mcp-server\`

It's the dogfood reference MCP for an Agentic Discoverability Service. Six tools exposed (`get_capabilities`, `get_pricing`, `get_case_studies`, `book_audit`, `check_llms_txt`, `score_url`), plus discovery endpoints at `/.well-known/mcp.json` and `/.well-known/mcp/server-card.json`. Built with `@modelcontextprotocol/sdk` + `agents` (Cloudflare wrapper) + Durable Objects for session state. Full context lives in `F:\pharos\README.md` and `F:\pharos\DEPLOY.md`.

### Your job

Get this from "files exist on disk" to "running locally on `http://localhost:8787` with all 6 tools callable and verified." **Do not deploy to production** — that requires my Cloudflare login which you can't do. Stop at that step and report.

### Steps

1. `cd` to `F:\pharos\mcp-server`.
2. Run `npm install`. If it fails, diagnose first — don't blindly retry. Common causes: Node version too old (need 20+), corporate proxy, peer-dep conflicts. Use `--legacy-peer-deps` only as a last resort and explain why.
3. Run `npx tsc --noEmit` to typecheck. If errors, **diagnose them** — they likely reveal an SDK API mismatch. The code was written against my best guess of `@modelcontextprotocol/sdk` ^1.0 and `agents` ^0.0.50; if the actually-installed API is different, fix the code to match the installed versions. Do not downgrade dependencies.
4. Start the dev server: `npm run dev`. Wrangler should boot on `localhost:8787` (or another port if 8787 is taken — note the actual one). `wrangler dev` works without `wrangler login`; if it prompts you to authenticate, skip / cancel — local dev does not require it.
5. Verify endpoints respond correctly:
   - `GET /` → plain-text landing mentioning the transport endpoints
   - `GET /.well-known/mcp.json` → JSON server card with `name: "Pharos"` and a `transports` array containing `streamable-http` and `sse`
   - `GET /.well-known/mcp/server-card.json` → same JSON as above
6. Test the MCP plumbing. Use one of:
   - `npx @modelcontextprotocol/inspector http://localhost:8787/mcp` (interactive UI in browser)
   - Or hit `/mcp` directly with a JSON-RPC `tools/list` request and confirm exactly 6 tools come back: `get_capabilities`, `get_pricing`, `get_case_studies`, `book_audit`, `check_llms_txt`, `score_url`.
7. Invoke `check_llms_txt` with `url: "https://anthropic.com"`. Confirm the response includes `exists: true` and a non-null `h1` field. (This is the real working tool, so this is the end-to-end smoke test.)
8. Stop the dev server. Write your report.

### Constraints

- **Do not run `wrangler login` or `npm run deploy`.** Stop before those steps.
- **Do not touch files outside `F:\pharos\mcp-server\`.**
- If you change source code to fix an SDK API drift, keep changes minimal and explain each one in the report.
- If something is broken in a way you can't fix without my input, stop and ask in the report — don't ship something half-working.

### Report format (when done)

- **Status:** working / partial / blocked
- **Local URL verified:** the exact `http://localhost:<port>` it ran on
- **`check_llms_txt` against anthropic.com — actual response payload** (paste the JSON so I can sanity-check the shape)
- **Code changes made**, with file paths and one-line reasoning each
- **Next steps for me** (I expect: `wrangler login`, then `npm run deploy`, then verify the live URL — but tell me if anything else is needed)

---

