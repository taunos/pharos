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
2026-05-01 scanner       07c8a973-90d9-4636-82f2-71934b8c2dfa  (Slice 3a — Dim 3 OpenAPI; SCORING_VERSION 1.1.0 → 1.2.0)
2026-05-01 marketing     30a9beec-1c34-44aa-b701-dbe202ad9885  (Slice 3a — N/A propagation, CURRENT_SCORING_VERSION 1.2.0)
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

---

## Slice 3a — Dim 3 (OpenAPI / API Catalog) (2026-05-01)

Adds the fifth scoring dimension and the whole-dimension N/A pattern. No new
secrets; no new external API integrations; no LLM calls in Dim 3 (pure HTTP +
structural validation). SCORING_VERSION 1.1.0 → 1.2.0; existing v1.1.0 scans
trigger the engine-version "re-run" banner on the results page.

### What shipped

- **runDim3** at `scanner/src/checks/dim3-openapi.ts`. Five sub-checks:
  discovery (25), spec_validity (25), info_completeness (15), security_schemes
  (15), operation_coverage (20). Bounded discovery probe — well-known →
  canonical → homepage-link, 5s per-request timeout, scheme allowlist (https:
  / http: only) as belt-and-suspenders to wrangler's
  `global_fetch_strictly_public` flag.
- **Whole-dimension N/A** when no API spec discovered. Sets `dim.na = true`,
  every sub-check `na: true`. Composite math drops the term and renormalizes
  SPEC_WEIGHTS over remaining applicable dimensions.
- **SPEC_WEIGHTS** (final-spec weights) replaces `SLICE2A_WEIGHTS` (the 4-of-6
  presentation transform). Compositing is now slice-aware: dimensions absent
  from the array contribute zero weight; dimensions present-but-NA drop and
  renormalize.
- **`dimensionScore(subs)` returns `number | null`** (Pattern A for new
  runners). Existing runners (Dim 1/2/4/5) call new `dimensionScoreOrThrow`
  helper (Pattern B) which throws if every sub-check is N/A — surfaces a
  regression loud rather than silently coercing to 0/100.
- **`dimensions_applicable`** new wire field on `ScanResult`. Non-optional on
  scanner side, optional with fallback to `dimensions_scored` on marketing-
  site side (older v1.1.0 scans don't carry it).
- **N/A propagation** across four consumer surfaces: results page, score PDF,
  audit PDF, score-email gap iteration (defense-in-depth `if (dim.na)
  continue;`). Six "Scored on X of Y" copy strings updated to read
  `dimensions_applicable ?? dimensions_scored`.
- **Composite parity invariant** preserved: a content-only site like
  astrant.io scores 89/A- under both v1.1.0 (Dim 3 not attempted) and v1.2.0
  (Dim 3 N/A). Dimensions {1,2,4,5} sum to weight 70 in both, renormalized
  identically.

### Verification at endpoint (2026-05-01)

- `GET https://scanner.astrant.io/health` → `scoring_version: 1.2.0`.
- Pharos dogfood scan v1.2.0 (id `f265f712-f658-49a3-a41d-33d991477445`): 89/A-
  composite, applicable=4/6, scored=5, dim3 na:true. Parity matches v1.1.0
  baseline (id `774d4c0e-a1fb-4a56-96be-8c2a03c9aec8`).
- Engine-version banner live on `https://astrant.io/score/<v1.1.0-id>`.
- `dimensions_applicable` is a number (not undefined) on fresh scans.
- Dim 3 positive path (twiml.com, id `f25c4667-4705-4058-9ede-0a6be47c22f1`):
  discovery=100, spec_validity=0 (Twilio redirects HTML, not a real spec) →
  na:false, score=25.

### Out of scope for 3a

- Corpus-write changes (audit-fulfill still records `dimensions_scored` /
  `dimensions_total`; no new corpus columns).
- Dim 6 Citation Visibility (Slice 3b).
- YAML deep-parse for Dim 3 (Slice 3a's static parser scores YAML specs at
  partial-credit reachability only; full structural checks need a YAML parser).
- Phase 1.5 pentest hardening (F-05–F-12, F-14) — separate prompt at
  `PHASE_1_5_HARDENING_PROMPT_STAGING_INSTRUCTIONS.md`.

### Slice 3a hotfix v1.2.1 — SPEC_WEIGHTS drift (2026-04-30)

Same-day hotfix: v1.2.0 shipped with `SPEC_WEIGHTS` drifted from the OQ-04 §1
canonical values (Dim 3 inflated 10→15, Dim 6 deflated 20→15). Composite
parity for content-only sites was preserved (renormalization still hits 70
either way), but API-active scans diverged from spec, and Dim 6's strategic-
differentiator weight had been pre-emptively reduced before Slice 3b ships.

**Fix:** restored canonical weights in `scanner/src/scoring.ts`:

```ts
SPEC_WEIGHTS = { 1: 15, 2: 20, 3: 10, 4: 20, 5: 15, 6: 20 }; // sum 100
```

Bumped `SCORING_VERSION` to `"1.2.1"` and `CURRENT_SCORING_VERSION` on
marketing-site to match. Cache invalidates cleanly via the version-prefixed
key. SixDimensions copy on `/score` reverted to spec values.

Deployed:
- scanner: `5419d723-0f21-4070-8744-314b54584fbf`
- marketing-site: `7468b3c2-e476-4afd-8d4b-56edd6f3fbfe`

Drifted v1.2.0 records continue to load (engine-version banner activates per
the existing version-mismatch path); they re-score correctly on user
re-scan.

## Slice: Logo + Foundation — design-system substrate (2026-05-01)

Closes Phase 0.1 of the OQ-01 rebrand cascade. Marketing-site-only — no
scanner / corpus / scoring touches. SCORING_VERSION stays at `1.2.1`.

### Locked decisions executed

1. **PNG-only mark**, no SVG generation. Source PNGs copied from the
   `design_handoff_astrant_logo_initial/assets/` handoff under
   `OneDrive/Documents/Claude/Projects/Solo Startup SaaS/` to
   `marketing-site/public/brand/{astrant-mark-dark,astrant-mark-light}.png`
   (1254×1254 each).
2. **Surface-token split.** Renamed every `var(--color-surface)` →
   `var(--color-surface-2)` (the existing `#18181b` card surface), then
   added a NEW deeper `--color-surface: #0f0f10` reserved for code-block
   panels (currently used by the prose-code rule on legal pages). Also
   added `--color-dim: #71717a` (footer caption) and
   `--color-rule: #1c1c1f` (faintest divider, used on the new sticky-
   header bottom rule and the footer top rule).
3. **Tier names + prices preserved**: Score / Audit ($79) / Implementation
   ($1,299) / Custom (from $4,999) / AutoPilot ($149/mo) / Concierge
   ($899/mo). No design-handoff-README pricing or Beam/Survey/etc names
   leaked through.
4. **Radius-free aesthetic.** Stripped every `rounded-md|lg|xl` from
   in-house components (initial count 94 occurrences across 19 files).
   `rounded-full` retained on circle/dot indicators, status pills, and
   the progress-bar cap — each annotated inline as a functional shape on
   the radius-free allowlist.
5. **Amber demotion.** `--color-accent (#f59e0b)` reserved for primary-CTA
   fill ONLY (initial count 86 occurrences across 22 files). Demotion
   classifications, all annotated inline with `Logo + Foundation slice:`
   comments:
   - Prices → `text-[var(--color-fg)]` (already bold).
   - Inline link colors → `text-[var(--color-fg)]`, underline-on-hover
     preserved.
   - Checkmarks / arrow bullets → `text-[var(--color-muted)]`.
   - Card border-hover → `hover:border-[var(--color-fg)]`.
   - Form-control accents (`accent-[var(--color-accent)]`) →
     `accent-[var(--color-fg)]`.
   - Pricing-card highlight (subscription "Concierge" tier amber border)
     → dropped entirely. Differentiates via copy + ordering only.
   - `prose-a` color in legal pages → demoted accent → fg.
   - **Exception preserved:** 503-gated CTAs and the pre-launch waitlist
     banner in `AuditCheckoutForm` keep amber. Disabled state lives in
     the form handler — visual treatment unchanged. This covers
     `WaitlistForm`, `AuditCheckoutForm`, the subscriptions CTAs (both
     route to `/audit#waitlist` in pre-launch mode), the implementation
     CTA, and inline upsells linking to /audit.
   - **Status amber retained:** `amber-400` queue-state borders/text in
     `ScorePdfPoller` and `score/[id]/page.tsx`, plus the `amber-500`
     textarea-counter approaching-limit indicator in `TriageForm`, are
     functional warning hues distinct from `--color-accent`. Each is
     annotated.
6. **Chrome only.** SiteHeader and SiteFooter were the only components
   semantically rewritten:
   - **SiteHeader**: text-only "Astrant" link replaced with mark+wordmark
     lockup (24px `Image` + wordmark, gap-2.5, `priority` set, header
     bottom rule moved to `--color-rule`).
   - **SiteFooter**: 32px padding (py-8), left cluster is mark + © 2026
     Astrant in body text, right cluster is the link row in
     `font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-dim)]`.
     Top rule moved to `--color-rule`.
   Page bodies were untouched semantically; only mechanical token rename,
   radius strip, and amber demotion sweeps ran across them.

### Typography substrate (Tailwind v4 + next/font/google)

`marketing-site/src/app/layout.tsx` newly imports `Inter` and
`JetBrains_Mono` from `next/font/google`, both with `display: "swap"`,
exposed as the CSS variables `--font-inter` / `--font-jetbrains-mono` on
the `<html>` element. `globals.css` wires those into `--font-sans` /
`--font-mono` (with appropriate fallback stacks) and surfaces every color
+ font variable through a Tailwind v4 `@theme inline {}` block — `inline`
is required so the runtime CSS-var theming keeps working (a bare `@theme`
inlines the values at compile time).

Existing arbitrary-value forms like `bg-[var(--color-surface-2)]` were
left as-is; per-page slices can opt into utility forms (e.g.
`bg-surface-2`) on the next pass.

### Favicon ladder

`marketing-site/scripts/gen-favicon.mjs` (new) reads
`public/brand/astrant-mark-dark.png` via `sharp` (transitive dep of
Next.js — no extra `npm install` needed) and emits:

- `public/favicon.ico` (multi-res ICO with 16/32/48 frames, PNG-encoded)
- `public/favicon-16.png`, `-32.png`, `-48.png`
- `public/apple-touch-icon.png` (180×180)
- `public/icon-192.png`, `icon-512.png` (PWA / Android)

Run with `node scripts/gen-favicon.mjs` from `marketing-site/`. Wired in
`metadata.icons` in `layout.tsx`.

### Production 404 fix (Organization JSON-LD logo)

`layout.tsx` previously declared
`Organization.logo = "https://astrant.io/brand/astrant-wordmark-dark.svg"` —
which 404'd in production (the `public/brand/` directory didn't exist
before this slice). Replaced with an `ImageObject` form pointing at the
new live PNG with explicit dimensions:

```json
{
  "@type": "ImageObject",
  "url": "https://astrant.io/brand/astrant-mark-dark.png",
  "width": 1254,
  "height": 1254
}
```

Verified via `curl -I https://astrant.io/brand/astrant-mark-dark.png`
(200, 496093 bytes) and the now-correct 404 on the legacy
`/brand/astrant-wordmark-dark.svg` path.

### Verified live (https://astrant.io)

- `GET /` → 200, ~67 kB HTML.
- `GET /brand/astrant-mark-dark.png` → 200, 496 093 bytes (the live PNG).
- `GET /favicon.ico` → 200, 3 029 bytes (multi-res frames).
- `GET /favicon-16.png|-32.png|-48.png|apple-touch-icon.png|icon-192.png|icon-512.png`
  → all 200.
- `GET /brand/astrant-wordmark-dark.svg` → 404 (the prior production bug
  is closed; nothing references this path anymore).
- Inter + JetBrains Mono CSS variables (`__variable_*`) live on `<html>`.
- Mark+wordmark lockup renders in header and footer (Image src points at
  the Next image optimizer URL `?url=%2Fbrand%2Fastrant-mark-dark.png`).
- Organization JSON-LD `logo` now `ImageObject` with `width: 1254,
  height: 1254`.
- All six tier prices ($79, $1,299, $4,999, $149, $899) present on `/`.

### Deployed

- marketing-site: `acc3a366-0783-4d4e-84b8-3aee55d09573`
- scanner: unchanged (Slice 3a v1.2.1 hotfix `5419d723-0f21-4070-8744-314b54584fbf`).

