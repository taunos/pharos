# Pharos

Working codename for the Agentic Discoverability Service.
*The lighthouse for agents.*

> **Codename only.** The public brand will be decided at launch — see `OQ-01_naming_progress.md` in the parent folder. Until then, internal references use `pharos`.

## What this is

The product makes businesses structurally discoverable and invokable by AI agents — llms.txt, MCP servers, OpenAPI specs, machine-readable capability and pricing descriptions, agent-parsable content. See `business_plan.html` and the `OQ-*.md` decision docs in the parent folder for the full picture.

## Repo structure

```
pharos/
├── README.md                (you are here)
├── DEPLOY.md                (step-by-step deployment instructions)
├── .gitignore
└── mcp-server/              The Pharos brand's own dogfood MCP server
    ├── package.json
    ├── tsconfig.json
    ├── wrangler.jsonc
    └── src/
        └── index.ts         Worker + MCP tool definitions + discovery endpoints
```

This is a single-repo monorepo. As more components come online (`scanner/`, `marketing-site/`, `dispatcher/` for per-client deploys), they get sibling folders under `pharos/`.

## What's live in v0.0.1

`mcp-server/` — the dogfood reference MCP. Exposes:

| Tool | What it does |
|---|---|
| `get_capabilities` | Returns Pharos service offerings as JSON for agents to consume |
| `get_pricing` | Returns pricing tiers |
| `get_case_studies` | Returns reference implementations (empty in v0.0.1; pre-launch) |
| `book_audit` | Returns the booking URL for a paid AEO audit |
| `check_llms_txt` | **Real working tool.** Fetches a target site's `/llms.txt`, returns presence + first H1 + blockquote summary + link count |
| `score_url` | Stub for v0; will proxy the Score tool scanner once that's built |

Also serves `/.well-known/mcp.json` and `/.well-known/mcp/server-card.json` per SEP-1649 / SEP-1960 so MCP clients (Claude Desktop, Claude Code, etc.) auto-discover capabilities.

## Why MCP first

Per the two-audiences strategy: the Pharos brand must be its own first reference implementation. Agents asking "how do I make my client's site agent-discoverable?" need to find Pharos as the canonical answer — and the most direct way to be that answer is to expose a working MCP from day one. Every client deployment will be a clone of this template.

## Next up

- `marketing-site/` — Next.js on Cloudflare Pages, with llms.txt and JSON-LD schema for the site itself
- `scanner/` — the Score tool scanner (per `OQ-04_score_tool_spec.md`)
- `dispatcher/` — Workers for Platforms control plane for per-client MCP deployments
