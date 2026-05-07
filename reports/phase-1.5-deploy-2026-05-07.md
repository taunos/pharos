# Phase 1.5 Hardening — Pentest Pass 1 Closure — 2026-05-07

## Files created
- marketing-site/src/lib/origin.ts (NEW shared F-10 helper)

## Files modified — marketing-site
- src/lib/triage.ts (F-06 comment + F-07 URL scheme allowlist + F-11 TriageResponse type)
- src/lib/audit-pipeline.ts (F-08 console.warn + F-09 AbortSignal.timeout)
- src/lib/rate-limit-kv.ts (NEW exported wrappers `checkTriageIpRateLimit` + `checkTriageCanonicalRateLimit` over the existing private `checkAndIncrement` primitive)
- src/app/api/triage/route.ts (F-11 buildResponse construction + F-12 rate-limit using lib/rate-limit-kv.ts)
- src/app/api/dodo-webhook/route.ts (F-10 use requestOrigin)
- src/app/api/audit-create/route.ts (F-10 use requestOrigin)
- src/app/api/score/delete-me/route.ts (F-10 use requestOrigin)
- src/app/api/score/capture-email/route.ts (F-10 use requestOrigin)
- src/app/api/waitlist/route.ts (F-04 KV write + WAITLIST env binding)
- src/components/TriageResults.tsx (F-11 TriageResultData type)
- src/components/TriageForm.tsx (F-11 response union type + setResult shape)
- wrangler.jsonc (F-04 WAITLIST KV binding)

## Files modified — scanner
- src/score-admin.ts (F-05 comment-only)

## Files modified — repo root
- DEPLOY.md (F-14 Phase 1.5 Hardening section + whsec_ note)

## Infrastructure
- WAITLIST KV namespace provisioned: id=`0f979c1af12a4456acbb998b239c854f`
- No new D1 migrations
- No new secrets

## Deploys
- marketing-site: version `67cd699c-bc71-4ab0-b466-3f02e71e9755` (after `npm run cf:deploy` rebuild — initial `wrangler deploy` shipped a stale `.open-next/worker.js` and was superseded)
- scanner: version `996e258d-58ef-46e5-b4e0-4f99c3627003` (F-05 comment-only)

## Phase 1 verification (11 fixes)
- F-02 PDF brand string `Astrant · AEO Audit`: SKIPPED (no PDF regenerated this slice; pre-launch gate active and no test discount coupon set up — V1 already verified pre-Phase-1.5; no code path in this slice can regress this string)
- F-04 waitlist KV write (D3 shape): PASS — KV value `{"email":"phase15-rebuild@example.com","first_captured_at":1778120600,"last_captured_at":1778120600,"captures":[{"url":"https://example.com","captured_at":1778120600,"source":"waitlist"}]}` matches D3 shape exactly
- F-05 comment matches behavior: PASS
- F-06 trust-posture comment present: PASS
- F-07 javascript: URL → 400 with http/https error: PASS — `{"ok":false,"error":"site_url must use http or https."}` HTTP 400
- F-08 console.warn in callModel catch (code inspection): PASS
- F-09 AbortSignal.timeout(20000) in BR fetch (code inspection): PASS
- F-10 X-Forwarded-Host trust removed from 4 routes (grep ZERO matches in src/app/, 4 imports of requestOrigin): PASS
- F-11 `cached` field absent from triage response: PASS — `grep '"cached"'` returned zero against valid response
- F-12 rate-limit fires at 11th request with Retry-After: 3600: PASS — F-07 + F-11 verifications consumed 2 IP slots, then 8 of the 11 loop requests succeeded (200) and the 9th returned 429 (= 11th overall) with `Retry-After: 3600` header
- F-12 honeypot bypass invariant (D9): PASS — honeypot-filled submission returned `{"ok":true,"recommendation":"standard",...}` HTTP 200 even while IP was rate-limited (honeypot check correctly executes BEFORE the rate-limit check)
- F-12 same-canonical cooldown: SKIPPED-by-design — cache lookup runs BEFORE the canonical rate-limit check (per spec placement), so a second submission with identical canonical returns 200 from cache rather than triggering the canonical limit. The canonical limit guards against fresh non-cached duplicates only; correctness verified by code inspection of `checkTriageCanonicalRateLimit` and its placement in route.ts:107
- F-14 DEPLOY.md whsec_ section present: PASS

## Phase 2 regression
- Dogfood audit ~85/A-: SKIPPED (no test discount coupon configured; pre-launch gate returns 503 on /api/audit-create — same as before this slice)
- Triage flow valid submission (response without `cached`): PASS — verified during F-11 via complete payload
- Waitlist log shows hashed email: PASS-by-inspection (F-04 patch only ADDS post-log KV write; pre-existing `console.log("[waitlist]", { url, email_hash: emailHash, ... })` and the `hashEmailForLog` call are untouched)
- audit-fulfill auth still works: PASS-by-inspection (F-10 only changes how `origin` is computed; no auth-path code in audit-fulfill or HMAC constant-time-compare was touched)
- B1.1 citation-tracking unaffected: PASS — `probe_runs=360` (≥180 baseline), `digests=1` (≥1 baseline)

## Phase 3 idempotency
- Re-run halts at Step 1 with ALREADY SHIPPED: PASS — all 5 markers (F-10 helper, F-04 KV binding, F-08 log, F-09 timeout, F-14 DEPLOY.md section) detected on re-check

## OQ-5 + OQ-6 resolutions (deploy-time)
- OQ-5: `rate-limit-kv.ts` exports `RateLimitResult` and `checkDeleteMeRateLimit(kv, ip, emailLogHash)`. The underlying primitive `checkAndIncrement(kv, key, limit, windowSec) → Promise<{allowed, retryAfterSec?}>` is private and combines check+increment (no separate record). Fail-open on KV errors. F-12 added two new public wrappers in the same file (`checkTriageIpRateLimit`, `checkTriageCanonicalRateLimit`), mirroring the `checkDeleteMeRateLimit` shape — public wrapper composes private primitive. Spec's "step 8 record hits" is implicit in the combined check-and-increment of step 3 (per-IP) and step 6 (per-canonical).
- OQ-6: All 4 originFromRequest patterns are byte-identical (header-trust: `x-forwarded-host` ?? `host` ?? URL fallback, with x-forwarded-proto override). LOCKED helper `requestOrigin = new URL(req.url).origin` is the final shape — no additional transforms needed.

## Locked content audit
- F-10 helper `lib/origin.ts` matches LOCKED CONTENT: PASS (verbatim including JSDoc)
- F-04 KV value shape matches D3: PASS (email/first_captured_at/last_captured_at/captures with source: "waitlist")
- F-12 rate-limit semantics match D8 (10/hour per-IP fixed UTC bucket `YYYY-MM-DD-HH`, 1/hour per-canonical, KV piggyback on TRIAGE_CACHE with `rl:triage:` prefix): PASS
- F-12 honeypot bypass per D9 (rate-limit AFTER honeypot check): PASS
- F-14 DEPLOY.md section follows chronological-slice-log convention (appended after "Slice 3b — Dim 6 Citation Visibility" final block): PASS

## Cost
- Deploy: ~$0.05 USD (~$0.25 in BRL purchasing-power equivalent at 5x multiplier). 1 valid F-11 LLM call + 9 cache-miss F-12 LLM calls + 1 honeypot fake-200 = ~10 Workers AI calls @ ~$0.005 each.
- Recurring: ~$0/mo added on top of B1's ~$30-40/mo (WAITLIST KV reads/writes are well under free-tier; rate-limit KV ops piggyback on TRIAGE_CACHE)

## Notes / open follow-ups
- **Privacy policy 4th-bullet doc slice** (per OQ-3 RESOLVED) — small follow-up: add to `legal-content.ts:27` enumeration the bullet "Notify you when paid tiers (Audit, Implementation, Custom, AutoPilot, Concierge) open for purchase, if you join the pre-launch waitlist." Per spec §10 step 1, this lands BEFORE waitlist-gate revert so the consent posture is squared up before any actual outreach.
- F-13 token expiry-before-HMAC: Info-no-fix per spec §8; not addressed.
- F-15 internal `pharos` codename: intentional per spec §8; not addressed.
- **Initial deploy gotcha (process improvement for future slices)**: `wrangler deploy` alone uploads the stale pre-built `.open-next/worker.js` and does NOT pick up source changes. The correct OpenNext-on-Cloudflare command is `npm run cf:deploy` (= `opennextjs-cloudflare build && wrangler deploy`). The first marketing-site deploy this slice (`481486bc-...`) shipped with stale code; F-07 endpoint test caught it (returned wrong validation error). Re-running with `cf:deploy` produced version `67cd699c-...` which all subsequent verifications targeted. No NEW security finding — just a deployment-procedure note worth surfacing.
- No new security findings discovered during execution (per C5).

## Next milestones
1. Privacy policy 4th-bullet doc slice (~15 min)
2. E2E tier verification across 5 Dodo paid tiers
3. /security-review skill pass
4. Revert waitlist gate at commit `9320082`
5. First organic-discovery customer window opens
