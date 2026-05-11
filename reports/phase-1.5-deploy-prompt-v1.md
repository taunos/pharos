# Phase 1.5 Hardening — Pentest Pass 1 Closure (Claude Code Deploy Prompt) — v1

**Companion to:**
- `pharos-phase-1.5-hardening-spec.md` (v3 FROZEN — all 13 OQs N/A; OQ-1/2/3 RESOLVED via V-prompt 2026-05-07; OQ-5/OQ-6 resolve at deploy-prompt Step 0). Reference doc; this deploy prompt is mechanically self-contained per the inline-constraints discipline.
- `pharos-phase-1.5-verification-prompt.md` v2 (executed 2026-05-07; report at `reports/phase-1.5-verification-report-2026-05-07.md` — CLI agent's verification report from that run).

**Purpose.** Close 9 still-open Phase-1.5 hardening items from the 2026-04-30 static pentest pass + 1 doc note. Six are mechanical 1-line fixes (F-02 verify-only, F-05 comment, F-06 comment, F-08 console.warn, F-09 AbortSignal, F-14 doc). Three involve refactoring or new infra: F-10 (4-route refactor + new shared `lib/origin.ts` helper), F-11 (TS-type-driven 3-site sweep for `cached` field removal), F-12 (rate-limit using existing `lib/rate-limit-kv.ts` helper), F-04 (waitlist persistence to new `WAITLIST` KV namespace). All sit on top of locked architectural patterns (TP-7 LLM trust ladder, email-flow security, webhook signature verification, scan-token HMAC) — none of those change.

**Scope is medium-narrow.** No new providers; no new LLM-API spend except ~$0.011-0.055 one-time for F-12 rate-limit smoke (11 calls × ~$0.001-0.005); no schema changes on existing tables; one new KV namespace (`WAITLIST`) at pre-launch volume. Estimated effort: ~1.5-2h CLI execution.

**Pre-deploy gate.** Before running this prompt, Bruno should:

1. **Confirm B1 + B1.1 still operational** — daily probe cron at `0 2 * * *` UTC ran successfully overnight; `digests` D1 table still has the row from B1.1's Phase 2 verification. Marketing-site is the workspace this slice touches; citation-tracking is independent and should not regress.
2. **Confirm `F:\pharos\` working tree is clean** (or only contains WIP unrelated to this slice).
3. **(Optional)** Skim `pharos-phase-1.5-hardening-spec.md` v3 for full rationale on each F-XX item.

Once gate passes, paste the section below into a fresh Claude Code session pointed at `F:\pharos\`.

---

```
You are deploying Phase 1.5 Hardening — Pentest Pass 1 Closure. This adds 9 security-hardening fixes + 1 doc note to the marketing-site Worker (and one comment-only update to scanner). All fixes sit on top of locked architectural patterns; nothing about TP-7 LLM trust ladder, webhook signature verification, email-flow security, or scan-token HMAC changes.

ENVIRONMENT NOTE: on Windows + Git Bash, `wrangler` is NOT on global PATH. From `F:\pharos\marketing-site/` (or `F:\pharos\scanner/` for the F-05 step) call `./node_modules/.bin/wrangler ...`. Use forward-slash paths in bash; backslash paths break Git Bash.

INLINE PROJECT CONSTRAINTS (treat as hard rules — they apply across this entire prompt):

(C1) **Backwards compatibility on existing security patterns.** TP-7 LLM trust ladder, webhook signature verification, email-flow security pattern (versioned tokens / two-step unsubscribe / per-recipient R2 keys / hashEmailForLog), scan-token HMAC, all engine versions, all cache key formats — NONE of these change. If you find yourself touching `lib/dodo.ts` (verifyWebhook, decodeSecret, constantTimeEqual), `lib/score-tokens.ts` (issueScanToken, verifyScanToken, hashEmailForLog), `lib/email-normalize.ts`, `dim6/*`, or `audit-pipeline.ts`'s `llmEnrichGaps`/`callModel` body (vs the catch block at F-08) — STOP and re-read the spec.

(C2) **Verify-at-endpoint discipline.** After deploy, exercise the actual deployed Worker via curl/POST tests for F-04, F-07, F-10, F-11, F-12. F-08, F-09 verify by code inspection of deployed source (invasive runtime tests are infeasible or wasteful — see Phase 1 verify section). Exit code is necessary but not sufficient.

(C3) **Idempotency.** This prompt is safe to re-run. Each step has an "already done" check. If everything has already shipped, halt with "ALREADY SHIPPED."

(C4) **No `git commit` until verification PASSES.** All Phase 1 + Phase 2 + Phase 3 verifications must pass before commit.

(C5) **No scope creep.** F-13 (token expiry-before-HMAC microscopic timing oracle) is Info-no-fix per spec — do NOT touch. F-15 (internal `pharos` codename in env binding) is intentional — do NOT rename. If you discover NEW security findings during execution, report at end-of-run; do NOT auto-fix.

(C6) **Don't break B1/B1.1 citation-tracking.** That Worker is at `F:\pharos\citation-tracking\` and is INDEPENDENT of this slice's marketing-site changes. Do NOT touch `citation-tracking/`. If you accidentally regress its production cron `0 2 * * *` or its `0 14 1 * *` digest cron, halt and report.

CRITICAL CONTENT BOUNDARY:

Phase 1.5 doesn't ship customer-facing copy beyond the F-14 DEPLOY.md note (internal ops doc) and one comment-only F-06 documentation note in `lib/triage.ts`. The F-04 waitlist KV write is to an internal KV namespace (not customer-facing). The audit-discipline rules don't apply at the customer-facing level for this slice — but DO apply to:

- `DEPLOY.md` section text (operational doc; future readers need clear info)
- The F-06 comment in `parseLlmJson` (future maintainers need accurate trust-posture context)
- The new `lib/origin.ts` JSDoc (future readers need to know it's a hardening helper)

LOCKED CONTENT ARTIFACTS (verbatim from spec v3 — DO NOT modify; inline below for self-containment):

### Locked: NEW FILE `marketing-site/src/lib/origin.ts` (per D11)

```ts
// src/lib/origin.ts
//
// Returns the request's origin from req.url ONLY — does NOT trust the
// X-Forwarded-Host header. Cloudflare Workers don't have intermediate
// proxies that legitimately set X-Forwarded-Host, so the header is
// either edge-controlled (redundant with req.url) or attacker-controlled
// (defense-in-depth: don't read it).
//
// Use this helper in any route that needs the inbound origin for URL
// construction (return_url, redirect targets, fulfillment dispatch, etc.).
//
// Phase 1.5 hardening (F-10) — replaces 4 copy-pasted originFromRequest()
// patterns across audit-create, dodo-webhook, score/delete-me,
// score/capture-email.

export function requestOrigin(req: Request): string {
  return new URL(req.url).origin;
}
```

### Locked: F-04 KV value shape (per D3)

```json
{
  "email": "<normalized_email>",
  "first_captured_at": <unix_seconds>,
  "last_captured_at": <unix_seconds>,
  "captures": [
    {"url": "<site_url>", "captured_at": <unix>, "source": "waitlist"}
  ]
}
```

The `source` field is union-of-one ("waitlist") at v3 per OQ-1 resolution; retained as union for forward-extensibility.

### Locked: F-12 rate-limit semantics (per D8 + D12)

- Per-IP: 10 requests / fixed hourly bucket keyed `YYYY-MM-DD-HH` UTC. Worst-case 20 requests in 2 minutes at boundary; acceptable for v1.
- Per-canonical-submission: 1-hour cooldown.
- KV namespace: piggyback on existing `TRIAGE_CACHE` with `rl:` key prefix.
- 429 response with `Retry-After: 3600` header.
- Implementation: USE the existing `src/lib/rate-limit-kv.ts` helper from Slice 2b Phase 1 — DO NOT reimplement inline.
- **Honeypot bypass invariant (D9):** rate-limit check goes AFTER the honeypot check. Honeypot-filled submissions return fake-200 without incrementing counters. Otherwise bots get a probe vector ("am I rate-limited?") which is signal.

### Locked: F-14 DEPLOY.md section (per V6)

Append to `F:/pharos/DEPLOY.md` as a new top-level section matching its chronological-slice-log convention:

```markdown
## Slice: Phase 1.5 Hardening (2026-05-07)

### Dodo Webhook Secret

The `DODO_WEBHOOK_SECRET` MUST include the `whsec_` prefix when set. The prefix is what triggers base64 decoding in `marketing-site/src/lib/dodo.ts:decodeSecret`. Without the prefix, the secret is treated as raw UTF-8 bytes and ALL signature verifications fail with HTTP 400.

Symptom of missing prefix: every Dodo webhook delivery fails with `invalid signature` in tail logs.

Set via (from `F:/pharos/marketing-site/`):
\`\`\`bash
echo "whsec_<the_secret>" | ./node_modules/.bin/wrangler secret put DODO_WEBHOOK_SECRET
\`\`\`
```

### Locked: F-04 wrangler.jsonc binding addition (per D2 + V5)

Match V5-confirmed shape: tabs indentation, `//` comments, fields ordered `binding, id`. Append to existing `kv_namespaces` array:

```jsonc
{
    "binding": "WAITLIST",
    "id": "<id-from-wrangler-kv-namespace-create>"
}
```

### Locked: F-04 waitlist persistence code (per §4.9)

```ts
// In src/app/api/waitlist/route.ts, AFTER existing hashEmailForLog log + email validation:
const normalized = normalizeEmail(email);
const kvKey = `waitlist:${normalized}`;
const existingRaw = await env.WAITLIST.get(kvKey);
const now = Math.floor(Date.now() / 1000);
const captureEvent = { url, captured_at: now, source: "waitlist" as const };

if (existingRaw) {
  const existing = JSON.parse(existingRaw);
  existing.last_captured_at = now;
  existing.captures.push(captureEvent);
  await env.WAITLIST.put(kvKey, JSON.stringify(existing));
} else {
  const fresh = {
    email: normalized,
    first_captured_at: now,
    last_captured_at: now,
    captures: [captureEvent],
  };
  await env.WAITLIST.put(kvKey, JSON.stringify(fresh));
}
```

Add `WAITLIST: KVNamespace` to the route's env type interface.

### Locked: F-05 comment text (per D6)

```ts
// In scanner/src/score-admin.ts at line ~60, replace the misleading comment with:
// KV failure → request allowed; this is acceptable v1 trade-off because KV outage is rare
// and rate limit is defense-in-depth, not the primary auth gate. If KV outages become
// frequent or the rate limit becomes the primary anti-DoS gate, switch to fail-closed.
```

### Locked: F-06 comment text (per D7)

```ts
// In src/lib/triage.ts inside parseLlmJson (~lines 181-207), add:
// F-06 trust posture: explanation field is rendered as text (React JSX
// auto-escapes in TriageResults.tsx:53); explicit URL-strip validator
// deferred until rendering path changes. Verified 2026-05-07 by V-prompt v2.
```

### Locked: F-07 URL scheme allowlist (per §4.1)

```ts
// In src/lib/triage.ts validation block (~lines 236-240), replace bare new URL(b.site_url) with:
let u: URL;
try {
  u = new URL(b.site_url);
} catch {
  return { ok: false, error: "site_url must be a valid URL." };
}
if (u.protocol !== "http:" && u.protocol !== "https:") {
  return { ok: false, error: "site_url must use http or https." };
}
```

### Locked: F-08 console.warn (per §4.3)

```ts
// In src/lib/audit-pipeline.ts callModel catch block (~lines 332-343), add BEFORE return "":
console.warn("[callModel] AI call threw:", err);
```

### Locked: F-09 AbortSignal (per §4.3)

```ts
// In src/lib/audit-pipeline.ts generatePdf BR fetch (~lines 607-625), add to fetch options:
signal: AbortSignal.timeout(20000)
```

20-second ceiling on Browser Rendering REST API call.

---

STEPS:

# 0. Pre-flight verification + state reads

```bash
git status
# Working tree should be clean or show only WIP unrelated to this slice.

# Confirm B1 + B1.1 citation-tracking still operational (don't regress in this slice):
cd F:/pharos/citation-tracking
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM probe_runs;"
./node_modules/.bin/wrangler d1 execute pharos-citation-tracking --remote --command "SELECT COUNT(*) FROM digests;"
# probe_runs should have at least 180 rows (cycle 48ed50d6) plus any subsequent daily fires.
# digests should have at least 1 row (Phase 2 test row from B1.1 deploy).

# Marketing-site sanity:
cd F:/pharos/marketing-site
./node_modules/.bin/wrangler whoami 2>&1 | head -10
ls src/lib/origin.ts 2>&1 && echo "ALREADY EXISTS" || echo "GREENFIELD origin.ts"
```

# 0.5. OQ-5 + OQ-6 implementation-shape reads (resolves spec deferrals)

**OQ-5 — read `src/lib/rate-limit-kv.ts` public API:**

Read `F:/pharos/marketing-site/src/lib/rate-limit-kv.ts` in full. Note:
- Exported function names (the spec's reference shape uses imagined names `checkRateLimit` / `recordRateLimitHit`; map to actual exports)
- Parameter shape (KV binding, key prefix, identifier, limit, window-seconds — does the helper accept these as separate args or as a config object?)
- Return type (`{ allowed: boolean, ... }` or just a boolean? Does it have a separate `.recordHit()` or is check-and-record combined?)
- Error semantics (does it throw on KV failure, or fail-open?)

**OQ-6 — read existing `originFromRequest` patterns** in the 4 F-10 routes (verify behavior beyond `new URL(req.url).origin`):

```bash
grep -n "originFromRequest\|x-forwarded-host" \
  src/app/api/audit-create/route.ts \
  src/app/api/dodo-webhook/route.ts \
  src/app/api/score/delete-me/route.ts \
  src/app/api/score/capture-email/route.ts
```

For each route, Read the surrounding 15 lines around the function definition. Note any non-trivial behavior beyond URL-vs-header logic (trailing-slash normalization, port stripping, etc.). If a route has additional transforms, replicate them in the new shared helper. If all 4 routes are pure header-vs-url with no other transforms (which V-prompt evidence at `audit-create:18-26` and `dodo-webhook:13-21` suggests), the helper from LOCKED CONTENT is the final shape.

# 1. Idempotency check

```bash
cd F:/pharos/marketing-site
ls src/lib/origin.ts 2>&1 && echo "F-10 helper EXISTS"
grep -F "WAITLIST" wrangler.jsonc 2>&1 && echo "F-04 KV BOUND"
grep -F "[callModel] AI call threw" src/lib/audit-pipeline.ts 2>&1 && echo "F-08 LOG ADDED"
grep -F "AbortSignal.timeout(20000)" src/lib/audit-pipeline.ts 2>&1 && echo "F-09 TIMEOUT ADDED"
grep -F "Slice: Phase 1.5 Hardening" F:/pharos/DEPLOY.md 2>&1 && echo "F-14 DOC ADDED"
```

Branch resolution:
- All present → ALREADY SHIPPED. Skip to Phase 1 verification only.
- Some present → resume from the appropriate step.
- None present → GREENFIELD; proceed from Step 2.

# 2. F-10 — create shared `lib/origin.ts` helper

Write `F:/pharos/marketing-site/src/lib/origin.ts` per LOCKED CONTENT. If OQ-6 read revealed any additional behavior (port stripping, trailing-slash normalization), incorporate it.

# 3. F-10 — refactor 4 routes to use the shared helper

Edit each of these 4 route files:

- `src/app/api/dodo-webhook/route.ts` — delete local `originFromRequest()` (~lines 13-21); add `import { requestOrigin } from "@/lib/origin";`; replace call site at line 126 (`originFromRequest(req)` → `requestOrigin(req)`).
- `src/app/api/audit-create/route.ts` — same pattern (delete ~lines 18-26; replace call at line 111).
- `src/app/api/score/delete-me/route.ts` — same pattern (delete ~lines 27-37; replace call at line 39).
- `src/app/api/score/capture-email/route.ts` — same pattern (delete ~lines 56-?; replace call at line 82).

After all 4 refactored, verify no remaining `x-forwarded-host` references in src/:

```bash
grep -rn "x-forwarded-host" src/ 2>&1
# Expected: ZERO matches. If any remain, halt and investigate.
```

# 4. F-11 — drop `cached` field via TS-type-driven sweep (per D13)

Edit `src/lib/triage.ts` — find the `TriageResponse` type and remove the `cached: boolean` field. Save.

Run `npm run build` (or `npx tsc --noEmit` from `marketing-site/`). TypeScript will error on:
- `src/app/api/triage/route.ts:25-37` — `buildResponse(...)` constructs response with `cached`. Remove the parameter and the field.
- `src/components/TriageResults.tsx:9` — `TriageResultData` type has `cached: boolean;`. Remove.

After fixing all errors, the field is uniformly removed across the codebase. No stragglers possible.

# 5. F-07 — URL scheme allowlist in `lib/triage.ts`

Edit the validation block (~lines 236-240) per LOCKED CONTENT. Replace bare `new URL(b.site_url)` with try-catch + protocol allowlist.

# 6. F-06 — comment-only documentation in `lib/triage.ts`

Edit `parseLlmJson` (~lines 181-207). Add the comment per LOCKED CONTENT.

# 7. F-12 — rate-limit using `lib/rate-limit-kv.ts` helper

Edit `src/app/api/triage/route.ts`. Apply the rate-limit logic per LOCKED CONTENT, adapting the helper-call shape to the actual API surface from OQ-5 read.

**Placement (per D9 honeypot bypass invariant):**
1. Body parse + JSON validation
2. **Honeypot check** (existing — no change)
3. **Rate-limit per-IP check** (NEW)
4. validateSubmission
5. Cache lookup (existing)
6. **Rate-limit per-canonical-submission check** (NEW; AFTER cache miss but BEFORE LLM call)
7. Workers AI call (existing)
8. **Record rate-limit hits** (NEW; after successful LLM call)

The rate-limit checks MUST go AFTER the honeypot check. Per D9, honeypot-filled submissions return fake-200 without incrementing counters.

# 8. F-08 — console.warn in `audit-pipeline.ts` callModel catch

Edit `src/lib/audit-pipeline.ts` callModel catch block (~lines 332-343). Add `console.warn("[callModel] AI call threw:", err);` BEFORE `return "";`.

# 9. F-09 — AbortSignal.timeout in `audit-pipeline.ts` generatePdf BR fetch

Edit `src/lib/audit-pipeline.ts` generatePdf (~lines 607-625). Add `signal: AbortSignal.timeout(20000)` to the fetch options object.

# 10. F-04 — provision WAITLIST KV namespace

```bash
cd F:/pharos/marketing-site
./node_modules/.bin/wrangler kv namespace create WAITLIST 2>&1
```

Capture the returned `id` from the output (UUID format).

# 11. F-04 — bind WAITLIST in `wrangler.jsonc`

Edit `marketing-site/wrangler.jsonc`. Append to the existing `kv_namespaces` array. **Match the file's actual indentation (TABS, not spaces — V5 confirmed)**:

```jsonc
{
    "binding": "WAITLIST",
    "id": "<id-from-step-10>"
}
```

After edit, verify:

```bash
grep -A 1 "WAITLIST" wrangler.jsonc
```

# 12. F-04 — waitlist persistence in `app/api/waitlist/route.ts`

Edit `src/app/api/waitlist/route.ts`:

1. Add `WAITLIST: KVNamespace` to the env interface (currently anonymous inline type at the `getCloudflareContext().env as unknown as { UNSUBSCRIBE_SECRET?: string }` cast — extend it).
2. Add the KV write logic per LOCKED CONTENT, AFTER the existing `hashEmailForLog` log call.

# 13. F-05 — comment-only update in scanner

Edit `F:/pharos/scanner/src/score-admin.ts` at line ~60. Replace the misleading comment per LOCKED CONTENT.

# 14. F-14 — append DEPLOY.md section

Edit `F:/pharos/DEPLOY.md`. Append the new top-level section per LOCKED CONTENT after the existing "Slice 3b — Dim 6 Citation Visibility" section.

# 15. Marketing-site deploy

```bash
cd F:/pharos/marketing-site
./node_modules/.bin/wrangler deploy 2>&1 | tail -20
```

Capture worker version ID from output. Confirm:
- Build succeeds (no TS errors from F-11 sweep)
- WAITLIST binding listed in deploy output
- Routes (astrant.io, www.astrant.io) listed

# 16. Scanner deploy (F-05 comment-only — redeploys for source/repo parity)

```bash
cd F:/pharos/scanner
./node_modules/.bin/wrangler deploy 2>&1 | tail -10
```

Capture scanner version ID. Behavior unchanged.

# 17. Phase 1 verification — 11 fixes

**F-02 verify (PDF brand string):**
Generate a fresh dogfood audit PDF (or test scan endpoint). Inspect the PDF header. Should read `Astrant · AEO Audit`. Already verified by V1 in V-prompt; this is a sanity check post-deploy.

**F-04 verify (waitlist KV write):**

```bash
cd F:/pharos/marketing-site
WORKER_URL="https://astrant.io"  # or workers.dev URL from deploy output
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","email":"phase15-test@example.com"}' \
  "${WORKER_URL}/api/waitlist"
# Expected: {"ok": true}

./node_modules/.bin/wrangler kv key get "waitlist:phase15-test@example.com" --binding WAITLIST --remote 2>&1
# Expected: JSON value matching D3 shape (email, first_captured_at, last_captured_at, captures array)
```

**F-05 verify:** read `scanner/src/score-admin.ts:60`; confirm comment matches LOCKED CONTENT.

**F-06 verify:** read `marketing-site/src/lib/triage.ts` parseLlmJson; confirm comment present.

**F-07 verify (javascript: URL rejection):**

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"site_url":"javascript:alert(1)","custom_needs":"test"}' \
  "${WORKER_URL}/api/triage"
# Expected: 400 with error "site_url must use http or https."
```

**F-08 verify (code inspection):**

```bash
grep -F "[callModel] AI call threw" src/lib/audit-pipeline.ts
```

**F-09 verify (code inspection):**

```bash
grep -F "AbortSignal.timeout(20000)" src/lib/audit-pipeline.ts
```

**F-10 verify (X-Forwarded-Host injection rejected):**

```bash
# Use a test/discount-coupon flow if available; otherwise verify by code inspection that
# all 4 routes import requestOrigin from "@/lib/origin" and call it.
grep -rn "requestOrigin\|originFromRequest" src/app/api/
# Expected: 4 imports of requestOrigin; ZERO references to originFromRequest function (deleted).
grep -rn "x-forwarded-host" src/
# Expected: ZERO matches.
```

For runtime verification (optional, only if a non-production test webhook is set up):

```bash
# Audit-create return_url smoke (uses test discount coupon if Bruno has one configured):
curl -s -X POST -H "Content-Type: application/json" -H "X-Forwarded-Host: evil.example.com" \
  -d '{"url":"https://test.com","email":"test@example.com"}' \
  "${WORKER_URL}/api/audit-create"
# Expected: 503 (pre-launch gate) — that's fine; the X-Forwarded-Host bit is the defense-in-depth.
# In production with the gate disabled, return_url would point at astrant.io, not evil.example.com.
```

**F-11 verify (cached field absent):**

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"site_url":"https://example.com","custom_needs":"product onboarding"}' \
  "${WORKER_URL}/api/triage" | grep -c '"cached"'
# Expected: 0 (no cached field in response).
```

**F-12 verify (rate limit fires at 11th request):**

```bash
# Issue 11 distinct triage submissions from same IP rapidly:
for i in 1 2 3 4 5 6 7 8 9 10 11; do
  echo "--- Request $i ---"
  curl -s -X POST -H "Content-Type: application/json" \
    -d "{\"site_url\":\"https://example.com\",\"custom_needs\":\"variant $i for rate limit test\"}" \
    "${WORKER_URL}/api/triage" -w "\nHTTP %{http_code}\n"
done
# Expected: requests 1-10 return 200; request 11 returns 429 with Retry-After: 3600.

# Same-canonical cooldown test (1-hour cooldown on identical canonical hash):
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"site_url":"https://canon-test.com","custom_needs":"identical submission for cooldown test"}' \
  "${WORKER_URL}/api/triage" -w "\nHTTP %{http_code}\n"
# Wait 5 seconds then issue an identical request:
sleep 5
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"site_url":"https://canon-test.com","custom_needs":"identical submission for cooldown test"}' \
  "${WORKER_URL}/api/triage" -w "\nHTTP %{http_code}\n"
# Expected: first returns 200 (cache hit on second normally; rate-limit-canon should return 429).
```

**F-12 verify — honeypot bypass invariant (D9):**

```bash
# Submit with referral_code filled (honeypot):
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"site_url":"https://example.com","custom_needs":"bot test","referral_code":"BOT"}' \
  "${WORKER_URL}/api/triage" -w "\nHTTP %{http_code}\n"
# Expected: 200 with fake "standard" recommendation. Rate-limit counter NOT incremented.
# Verify by issuing 1 more legitimate request and confirming you're not at the limit yet.
```

**F-14 verify:** read `F:/pharos/DEPLOY.md`; confirm `Slice: Phase 1.5 Hardening` section present.

# 18. Phase 2 — regression on existing passing paths

- **Dogfood audit end-to-end** with discount-coupon test (if Bruno has one configured): POST `/api/audit-create` → webhook → fulfill → PDF. Composite still ~85/A-, no errors.
- **Triage flow with valid submission**: still routes correctly, response shape correct minus `cached` field.
- **Waitlist log-hashing visible in tail**: `wrangler tail pharos-marketing` while POSTing to /api/waitlist; should show hashed email, never raw.
- **`audit-fulfill` constant-time auth still functional**: existing pattern not regressed by F-10 changes.
- **B1.1 citation-tracking unaffected**: re-check `digests` table count + `probe_runs` count; should be ≥ Phase 1 baseline.

# 19. Phase 3 — idempotency

Re-run this entire deploy prompt. Confirm Step 1 idempotency check correctly identifies the slice as already-shipped and halts cleanly.

# 20. Output ship-report

Write `F:/pharos/reports/phase-1.5-deploy-2026-05-XX.md` (use today's UTC date) with:

```
# Phase 1.5 Hardening — Pentest Pass 1 Closure — <YYYY-MM-DD>

## Files created
- marketing-site/src/lib/origin.ts (NEW shared F-10 helper)

## Files modified — marketing-site
- src/lib/triage.ts (F-06 comment + F-07 URL scheme allowlist + F-11 TriageResponse type)
- src/lib/audit-pipeline.ts (F-08 console.warn + F-09 AbortSignal.timeout)
- src/app/api/triage/route.ts (F-11 buildResponse construction + F-12 rate-limit using lib/rate-limit-kv.ts)
- src/app/api/dodo-webhook/route.ts (F-10 use requestOrigin)
- src/app/api/audit-create/route.ts (F-10 use requestOrigin)
- src/app/api/score/delete-me/route.ts (F-10 use requestOrigin)
- src/app/api/score/capture-email/route.ts (F-10 use requestOrigin)
- src/app/api/waitlist/route.ts (F-04 KV write + WAITLIST env binding)
- src/components/TriageResults.tsx (F-11 TriageResultData type)
- wrangler.jsonc (F-04 WAITLIST KV binding)

## Files modified — scanner
- src/score-admin.ts (F-05 comment-only)

## Files modified — repo root
- DEPLOY.md (F-14 Phase 1.5 Hardening section + whsec_ note)

## Infrastructure
- WAITLIST KV namespace provisioned: id=<uuid-from-step-10>
- No new D1 migrations
- No new secrets

## Deploys
- marketing-site: version <id from step 15>
- scanner: version <id from step 16> (F-05 comment-only)

## Phase 1 verification (11 fixes)
- F-02 PDF brand string `Astrant · AEO Audit`: PASS|FAIL
- F-04 waitlist KV write (D3 shape): PASS|FAIL
- F-05 comment matches behavior: PASS|FAIL
- F-06 trust-posture comment present: PASS|FAIL
- F-07 javascript: URL → 400 with http/https error: PASS|FAIL
- F-08 console.warn in callModel catch (code inspection): PASS|FAIL
- F-09 AbortSignal.timeout(20000) in BR fetch (code inspection): PASS|FAIL
- F-10 X-Forwarded-Host trust removed from 4 routes (grep ZERO matches): PASS|FAIL
- F-11 `cached` field absent from triage response: PASS|FAIL
- F-12 rate-limit fires at 11th request with Retry-After: 3600: PASS|FAIL
- F-12 honeypot bypass invariant (D9): PASS|FAIL
- F-14 DEPLOY.md whsec_ section present: PASS|FAIL

## Phase 2 regression
- Dogfood audit ~85/A-: PASS|FAIL|SKIPPED
- Triage flow valid submission (response without `cached`): PASS|FAIL
- Waitlist log shows hashed email: PASS|FAIL
- audit-fulfill auth still works: PASS|FAIL
- B1.1 citation-tracking unaffected: PASS|FAIL

## Phase 3 idempotency
- Re-run halts at Step 1 with ALREADY SHIPPED: PASS|FAIL

## OQ-5 + OQ-6 resolutions (deploy-time)
- OQ-5: rate-limit-kv.ts API surface mapped to: <actual exported function names + parameter shape>
- OQ-6: originFromRequest patterns: <"identical pure header-vs-url logic in all 4 routes" or describe variations>

## Locked content audit
- F-10 helper `lib/origin.ts` matches LOCKED CONTENT: PASS
- F-04 KV value shape matches D3: PASS
- F-12 rate-limit semantics match D8 (10/hour per-IP, 1/hour per-canonical, fixed bucket): PASS
- F-12 honeypot bypass per D9: PASS
- F-14 DEPLOY.md section follows chronological-slice-log convention: PASS

## Cost
- Deploy: ~$0 (mechanical fixes only; F-12 verification used ~11 LLM calls = ~$0.011-0.055)
- Recurring: ~$0/mo added on top of B1's ~$30-40/mo

## Notes / open follow-ups
- **Privacy policy 4th-bullet doc slice** (per OQ-3 RESOLVED) — small follow-up: add to `legal-content.ts:27` enumeration the bullet "Notify you when paid tiers (Audit, Implementation, Custom, AutoPilot, Concierge) open for purchase, if you join the pre-launch waitlist." Per spec §10 step 1, this lands BEFORE waitlist-gate revert so the consent posture is squared up before any actual outreach.
- F-13 token expiry-before-HMAC: Info-no-fix per spec §8; not addressed.
- F-15 internal `pharos` codename: intentional per spec §8; not addressed.

## Next milestones
1. Privacy policy 4th-bullet doc slice (~15 min)
2. E2E tier verification across 5 Dodo paid tiers
3. /security-review skill pass
4. Revert waitlist gate at commit `9320082`
5. First organic-discovery customer window opens
```

Print "DONE" and the path to the report file.

DO NOT:
- Modify B1/B1.1 citation-tracking code (`F:\pharos\citation-tracking/`) — that worker is independent of this slice
- Modify the audit-pipeline LLM trust ladder (`callModel` body, `llmEnrichGaps`, `dim6/*`) — only F-08/F-09 mechanical additions
- Modify webhook signature verification (`lib/dodo.ts` decodeSecret/verifyWebhook/constantTimeEqual) — locked
- Modify scan-token HMAC (`lib/score-tokens.ts`) — locked; F-13 is Info-no-fix
- Modify any engine version constant (SCORING_VERSION, REMEDIATION_ENGINE_VERSION, CITATION_TRACKING_VERSION, dim6:vN, CORPUS_SCHEMA_VERSION)
- Modify any cache key prefix (`triage:v2:`, `audit:remediation:v3:`, `llm:v1:`, `scan:v1.1.0:`, `dim6:v1:`)
- Add new D1 migrations (this slice has ZERO D1 schema changes; only the new WAITLIST KV)
- Modify cron triggers (B1 probe `0 2 * * *` and B1.1 digest `0 14 1 * *` are not this slice's concern)
- Touch the pre-launch waitlist gate at commit `9320082` — that's a SEPARATE post-Phase-1.5 action
- Rename `pharos` env binding (per F-15 — intentional)
- Skip Phase 1 verification or commit before all PASS
- Reimplement rate-limit logic inline in F-12 — USE the existing `lib/rate-limit-kv.ts` helper (anomaly #2 from V-prompt; D12 in spec)
- Add internal slice labels ("Slice B1.1", "Phase 1.5") to customer-facing copy or commit messages targeting customer surfaces
- `git commit` until Phase 1 + Phase 2 + Phase 3 verifications all PASS (per C4)
- Auto-fix any NEW security findings discovered during execution — report at end-of-run only (per C5)
```

---

## After Claude Code finishes

Bring the ship-report (or its contents) back to chat. Verification: confirm Phase 1 (11 fixes), Phase 2 (regression), and Phase 3 (idempotency) all PASS. Confirm OQ-5 and OQ-6 resolutions match what the deploy prompt expected. Confirm B1/B1.1 citation-tracking unaffected (sanity check).

**Post-deploy follow-ups (NOT part of this slice):**

1. **Privacy policy 4th-bullet doc slice** (~15 min) — add the waitlist email-collection bullet to `legal-content.ts:27` enumeration. Closes the OQ-3 consent gap before any actual waitlist outreach happens.
2. **E2E tier verification** across all 5 Dodo paid tiers using discount-coupon test. Temporarily bypass waitlist gate for the test, then re-enable until step 4.
3. **/security-review skill pass** — fresh review of hardened code.
4. **Revert waitlist gate at commit `9320082`** — paid CTAs reopen. WAITLIST KV continues to capture pre-launch list.
5. **First organic-discovery customer window opens.**

After step 4, the pre-launch readiness sequence is complete. Phase 1.5 is operationally retired into "verified hardening from 2026-05-07 pentest closure" baseline state.
