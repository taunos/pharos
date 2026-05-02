# Foundation Deploy — 2026-05-02

**Worker version:** `c658fc0e-c70d-417b-82be-c8937c8a74d0`
**Bundled CSS:** `/_next/static/css/18e44f7bbdd824bf.css`
**Slice:** A1 of two-slice initiative; A2 (publishing bundle) gated on this verifying clean.

## Files modified

- `marketing-site/src/app/globals.css` — added `--color-paper`, type-scale tokens (display-xl/lg/md/sm, h2, body-lg, body, body-sm, mono-md, mono-sm with companion `*-lh` line-heights), spacing tokens (page-pad-x, page-hero-pad-y, section-pad-y, cluster-gap), and exposed `--color-paper` through `@theme inline`.

No other source files modified — Steps 4-11 either reduced to verify-only no-ops (foundation already 70% shipped at commit `0df931f`) or surfaced documented exceptions retained from that prior slice.

## Idempotency state at start

Per Step 2 Foundation Gap Report:

- ✓ already shipped: color-dim, color-rule, color-surface-2 tokens; JetBrains Mono via next/font; logo PNGs at `/brand/astrant-mark-{dark,light}.png`; SiteHeader horizontal lockup; favicon ladder + `metadata.icons` in layout.tsx; JSON-LD `Organization.logo` updated to ImageObject form
- ⚠ partial / needs gap-fill: `--color-paper` missing; type-scale tokens not present; spacing tokens not present
- Sweep state already complete from prior commit `0df931f`: amber-demotion, radius-strip, Pharos→Astrant translation — all zero-violation against the foundation rules, with Bruno-authorized exceptions explicitly code-commented

This contextualizes the ship-report's "0 changes" sweep numbers — zero updates with all checks passing means the slice was already complete and only the genuine token gaps + verification were needed.

## Foundation deltas

- **Tokens added:** `--color-paper` (#fafaf7); `--display-xl/lg/md/sm` + `*-lh` companions; `--h2` + `--h2-lh`; `--body-lg/body/body-sm` + `*-lh`; `--mono-md/mono-sm` + `*-lh`; `--page-pad-x` (56px); `--page-hero-pad-y` (88px); `--section-pad-y` (56px); `--cluster-gap` (32px)
- **Tokens renamed:** none this slice (rename `--color-surface` → `--color-surface-2` already shipped at `0df931f`; all 5 callsites for `var(--color-surface)` are code-block backgrounds and semantically correct under the repurposed token)
- **Fonts added:** none this slice (JetBrains Mono via `next/font/google` already shipped)
- **Logo assets:** none copied this slice (both PNGs already present at `/brand/`)
- **SiteHeader:** none this slice (horizontal lockup already integrated)
- **metadata.icons:** none this slice (full favicon ladder already populated; `scripts/gen-favicon.mjs` is the existing generator — favicon NOT deferred to Phase 1.5)
- **JSON-LD Organization.logo:** none this slice (already updated to `https://astrant.io/brand/astrant-mark-dark.png` ImageObject form)

## Sweep results

- **Amber-demotion:** 0 call sites updated, 15 kept as primary CTA fill, 6 retained as documented exceptions (3 decision-5 EXCEPTIONS for 503-gated pre-launch surfaces from prior commit `0df931f` — Pre-launch banner in AuditCheckoutForm, upsell CTA in ScanResults, Concierge tier CTA in subscriptions; 3 semantic-warning retentions for queued/error states in TriageForm/ScorePdfPoller/score[id]). N=0 reflects already-clean state from prior commit.
- **Radius-strip:** 0 classes/rules removed, 12 `rounded-full` retained per the documented "radius-free allowlist" for functional pill/dot/cap shapes (status pills with emerald tint, pulse dots, progress-bar caps), 6 historical "rounded-lg stripped" comments confirm prior strip already shipped. PDF/email-template `border-radius` calls in `lib/score-pdf-template.ts`, `lib/score-email.ts`, `lib/audit-pipeline.ts`, `api/score/unsubscribe/route.ts` are out of scope (separate server-side rendering pipelines for PDFs and email — not the marketing-site UI design system).
- **Pharos→Astrant translation:** 0 user-visible strings updated. All 12 remaining `pharos`/`Pharos` matches in `marketing-site/src/` are internal-only: Worker URLs (`pharos-scanner.pharos-dev.workers.dev`, `pharos-mcp.pharos-dev.workers.dev`), R2 bucket name (`pharos-audits`), repo paths in code comments (`F:\pharos\…`), doc filename references (`pharos-stripe-decision-framework.md`, `pharos-corpus-layer-spec.md`), and an LLM-prompt validator regex (`\bpharos\.json\b`). Zero user-visible Pharos references — translation already complete.

## Endpoint verification

- (a) **Site root + SiteHeader:** PASS. HTTP 200 on `https://www.astrant.io/`. HTML preloads `/brand/astrant-mark-dark.png` via `<link rel="preload">`. Zero stale `astrant-wordmark-dark.svg` references.
- (b) **Token migration in deployed CSS:** PASS. Bundled CSS `/_next/static/css/18e44f7bbdd824bf.css` contains all 5 expected tokens: `color-dim`, `color-paper`, `color-rule`, `color-surface`, `color-surface-2`. Pattern 2 (homepage HTML inline) only surfaced 3 of 5 because Tailwind v4 inlines only the vars actually referenced by classes on the rendered page; `--color-paper` is bundle-resident but not yet referenced by any class (will surface in Slice A2 publishing-bundle pages). Pattern 1 (bundled CSS) is the authoritative test and confirms full migration.
- (c) **Amber-demotion visual check:** REQUIRES BRUNO BROWSER CONFIRMATION. Programmatic verification confirmed all amber call sites are either primary CTA fills (15) or documented exceptions (6); visual confirmation that the rendered homepage shows amber only on primary CTAs is a Bruno step.
- (d) **Radius-strip visual check:** REQUIRES BRUNO BROWSER CONFIRMATION. Programmatic verification confirmed zero non-allowlist `rounded-*` classes; visual confirmation of square corners on cards/buttons/inputs is a Bruno step.
- (e) **JetBrains Mono load check:** REQUIRES BRUNO BROWSER CONFIRMATION. Programmatic verification confirmed font is wired in `layout.tsx` (lines 15-19, 161); confirming the woff2 returns 200 in dev-tools is a Bruno step.

Asset and CSS endpoints all return HTTP 200:
- `/` → 200
- `/llms.txt` → 200
- `/brand/astrant-mark-dark.png` → 200
- `/_next/static/css/18e44f7bbdd824bf.css` → 200

## Boundary discipline check

**Forbidden-term grep surfaced 7 files; 5 are internal Dim 6 module code (out of user-facing scope). 2 are pre-existing publishing-surface concerns NOT introduced by this slice:**

1. `marketing-site/src/app/score/methodology/page.tsx:114-116` — public "Trust posture (TP-7)" heading + body copy. Predates Slice A1 (was in the prior `/score/methodology` page from before the foundation slice). User-facing publishing-surface concern relevant to Slice A2 boundary review, not introduced here.
2. `marketing-site/src/lib/score-pdf-template.ts:11,34` — server-rendered PDF template comments referencing TP-7. Internal comments in a server-only rendering pipeline. Not user-facing through the marketing site, but part of the customer audit PDF output.

The 5 internal Dim 6 files (promptset.ts, types.ts, ladder.ts, orchestrator.ts, adapters.ts) are correctly internal — they reference Stripe / TP-7 / etc. in code comments that document the Dim 6 implementation. None are user-facing.

**Recommendation:** flag (1) and (2) for Slice A2 boundary review. The publishing-bundle deploy will need to decide whether the existing `/score/methodology` page's public TP-7 disclosure should be reframed before the new `/methodology/calibration` page is added (per the publishing-bundle deploy prompt's existing IA-collision resolution).

## Deferred to Phase 1.5

- None from this slice. Favicon generation already shipped via `scripts/gen-favicon.mjs` per `layout.tsx:25-26`.

## Open observations

- **Foundation was ~70% pre-shipped at commit `0df931f`.** This slice's net change is the type-scale + spacing tokens + `--color-paper`. Everything else verified clean against the prior foundation slice's work. The idempotency-detection step in the prompt (Step 2) prevented thrash on already-shipped surfaces — without it, the deploy would have re-run sweeps and likely confused itself on whether to ADD or RENAME tokens that were already there.

- **Tailwind v4 selective inlining.** Pattern 2 (homepage HTML grep) returned 3 of 5 tokens, while Pattern 1 (bundled CSS grep) returned all 5. Tailwind v4 inlines vars only when a class on the rendered page references them. `--color-paper` is bundle-resident but unreferenced; the spacing/type-scale tokens (not in this verify) are similarly bundle-resident. This means future verify-at-endpoint runs should default to Pattern 1 (bundled CSS) for token-migration checks, not Pattern 2 (homepage). Worth folding into the publishing-bundle deploy prompt's verify section.

- **Wrangler OAuth TTL.** Build halted between Notion/Astrant/Stripe verification runs (~30-60 minutes earlier in this session) and the foundation deploy. Bruno re-authenticated and the deploy succeeded immediately. Worth noting as known-behavior: long-running session work that crosses the OAuth window will need re-auth at some point. CLOUDFLARE_API_TOKEN env var (durable, dashboard-issued) avoids this; OAuth is convenient but TTLs out.

- **Decision-5 amber + radius-allowlist exceptions are well-documented in code.** Every retained amber and rounded-full call site has an inline `// Logo + Foundation slice: ...` comment explaining why. This is the right shape for "halt and flag" discipline — the next agent reading the codebase can immediately see the exception's rationale without needing to read commit history or out-of-tree docs.
