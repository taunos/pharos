# Pharos Marketing Site

Public-facing landing page for Pharos — Agent Discoverability as a Service.

This is a sibling package to `../mcp-server/`. The MCP server is the agent-facing
surface (tools, discovery); this site is the human-facing surface (landing,
pricing, waitlist, llms.txt dogfood).

## Stack

- Next.js 15 (App Router) + React 19, TypeScript strict
- Tailwind CSS v4 (via `@tailwindcss/postcss`)
- `@opennextjs/cloudflare` adapter → deploys as a Cloudflare Worker with
  static-assets binding (Cloudflare's current-recommended path; Pages deploys
  have been superseded in 2025+)
- `public/llms.txt` served as a static asset with `text/plain`

## Layout

```
marketing-site/
├── public/llms.txt               # dogfood llms.txt served at /llms.txt
├── src/
│   ├── app/
│   │   ├── layout.tsx            # root layout, JSON-LD in <head>
│   │   ├── page.tsx              # SSR landing page
│   │   ├── globals.css           # Tailwind v4 + CSS vars
│   │   └── api/waitlist/route.ts # POST { url, email } → logs, returns {ok:true}
│   └── components/
│       └── WaitlistForm.tsx      # client form (the only "use client" boundary)
├── open-next.config.ts
├── wrangler.jsonc
├── next.config.ts
└── postcss.config.mjs
```

## Dev

```bash
npm install
npm run dev
# → http://localhost:3000
```

Quick verification:

```bash
curl -s http://localhost:3000/ | grep -c 'Six dimensions'
curl -sI http://localhost:3000/llms.txt
curl -X POST http://localhost:3000/api/waitlist \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","email":"test@test.com"}'
```

## Typecheck

```bash
npm run typecheck
```

## Deploy (Cloudflare Workers, via OpenNext)

```bash
npm run cf:build       # produces .open-next/{worker.js,assets/}
npm run cf:deploy      # wrangler deploy
```

Preview locally against the actual Workers runtime:

```bash
npm run cf:preview
```

The Worker entry point is `.open-next/worker.js`; static assets (including
`public/llms.txt`) are served by the `ASSETS` binding from `.open-next/assets/`.

## Notes

- `url: "https://pharos.dev"` in the Organization JSON-LD is a placeholder —
  the real domain isn't registered yet. Update when brand/domain is finalized.
- No middleware; `/llms.txt` passes through as a static asset with
  `Content-Type: text/plain`.
- The waitlist route just `console.log`s the submission. D1 + Resend wiring
  comes in the next iteration.
