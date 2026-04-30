---
title: Phase 1.5 hardening — staging instructions for Claude Code
status: STAGING_INSTRUCTIONS (not the prompt itself; this is the meta-prompt that tells Claude Code how to stage the actual prompt)
date: 2026-04-30
fires_after: Slice 2b shipped 2026-04-30 (scanner version 999939cf-04c4-4778-a67e-367f9c686193, marketing-site version 927038bb-4991-492c-8241-80eeb6b9bb2f)
companion_to: workspace/pharos-pentest-findings-static-pass-1.md
---

# Phase 1.5 hardening — staging instructions

**Hand this entire document to Claude Code as the prompt.** Claude Code's job is to *stage* (write to disk, not execute) the actual Phase 1.5 hardening prompt that Bruno will review before firing.

## Instructions to Claude Code

Read `workspace/pharos-pentest-findings-static-pass-1.md` and `memory/project_live_services.md`. Stage (do NOT execute) a Claude Code prompt covering Phase 1.5 hardening: F-05, F-06, F-07, F-08, F-09, F-10, F-11, F-12, F-14, plus waitlist persistence.

### What's already shipped — DO NOT re-touch

- **F-01 (email normalization)** shipped in the Slice 2b pre-deploy refinement batch on 2026-04-30. Helper at `marketing-site/src/lib/email-normalize.ts` and `scanner/src/email-normalize.ts`. Applied at every email entry point.
- **F-02 (PHAROS → Astrant in PDF header)** shipped — `audit-pipeline.ts:571` now reads `Astrant · AEO Audit`.
- **F-03 (constant-time auth)** shipped — `constantTimeEqual` exported from `marketing-site/src/lib/dodo.ts`; scanner mirror at `scanner/src/auth.ts`. Applied in `audit-fulfill/route.ts`, scanner `score-admin.ts requireAdminAuth`, and scanner `index.ts` paid-tier auth.
- **F-04 (hashed email logs)** shipped — `triage` and `waitlist` routes now log `email_hash` (salted with `UNSUBSCRIBE_SECRET` when bound, else `[unsalted]` fallback marker). Note: F-04 only addressed the *log redaction* half of the waitlist finding; the *persistence* half (functional bug — only `console.log`, no D1/KV write) is still pending and is part of Phase 1.5 below.

See `DEPLOY.md` "Slice 2b pre-deploy refinements (2026-04-30)" section for the canonical record of what shipped.

### What's explicitly NOT in scope

- **F-13** (token expiry checked before HMAC verify) is Info-only per the findings doc — no action required, listed for completeness.
- **F-15** (`PHAROS_CORPUS` D1 binding name) is **intentional** per `project_naming_status.md` ("Internal worker names retained as `pharos-*`"). The findings doc lists it specifically to mark it as a *non-finding*. Do NOT touch internal `PHAROS_*` env-binding names. If an agent reading the findings doc top-to-bottom is tempted to "fix" this, the staged prompt must call this out explicitly.

### Special note on F-10 — scope expansion vs the findings doc

The findings doc names `dodo-webhook/route.ts` and `audit-create/route.ts` for the X-Forwarded-Host trust issue. But Slice 2b added **two new instances of the same `x-forwarded-host` pattern** that the findings doc could not have known about (it was authored before Slice 2b's routes landed):

- `marketing-site/src/app/api/score/capture-email/route.ts:57`
- `marketing-site/src/app/api/score/delete-me/route.ts:28`

The staged Phase 1.5 prompt **must** call out all four call sites and fix them in the same pass. Do not let an agent only fix the two the findings doc named.

### Structural requirements for the staged prompt

Match the structure of `pharos-slice-2b-pre-deploy-fixes-prompt.md` (the prompt Bruno reviewed and fired on 2026-04-30). Specifically:

1. **Front matter** stating: scope, what's in / what's out, what already shipped, what NOT to change.
2. **Numbered tasks in execution order**. Order should be: low-risk first (logging, comments), behavioral changes mid (F-07, F-09, F-10), infrastructure additions last (F-12 rate limit, waitlist persistence). Specific suggested order: F-05 → F-08 → F-14 → F-09 → F-10 → F-07 → F-06 → F-11 → F-12 → waitlist.
3. **Locked decisions** called out explicitly (e.g., "F-05: choose option 1 from findings doc — match comment to behavior, keep fail-open with explicit comment. Reason: KV outage is rare and rate limit is anti-abuse, not anti-DoS").
4. **Explicit list of files modified per task** with line-number anchors where the doc has them.
5. **Verification section** matching what we did post-Slice-2b deploy:
   - Build + typecheck must pass clean for both packages.
   - Grep audits: zero matches for `x-forwarded-host` (post-F-10), zero matches for `cached: ` in TriageResponse (post-F-11), zero matches for raw `email=` in console logs (already verified post-F-04 but re-confirm).
   - Live curl matrix:
     - `/privacy`, `/terms`, `/score`, `/score/delete-me` → 200
     - Scanner `/health` → 200 with version JSON
     - Scanner admin endpoints reject 401 without auth and with bogus key
     - **New post-F-12 test:** 11 rapid POSTs to `/api/triage` should produce a 429 on the 11th request (or whatever cap the implementation chose; document the cap in the prompt).
     - **New post-F-10 test:** POST with `X-Forwarded-Host: evil.example.com` to `/api/audit-create` (with the 503 pre-launch guard temporarily lifted in a local dev environment) → return_url in response should NOT contain `evil.example.com`. Acceptable substitute: assert the originFromRequest helper no longer reads the header (code-level, not behavioral).
   - Mental trace: walk through the F-10 fix end-to-end. An attacker who sends a forged `X-Forwarded-Host` header should not be able to influence any URL the worker constructs and returns to the user or sends in a webhook callback.
6. **Architectural invariants** section listing what must NOT change:
   - Slice 2b token format (no email in scan-bound URL, version prefix `v1.`).
   - Trust-domain split (`INTERNAL_FULFILL_KEY` vs `INTERNAL_SCANNER_ADMIN_KEY`).
   - R2 key derivation `score-reports/<scan_id>/<sha256(normalized_email)[:16]>.pdf`.
   - TP-7 LLM trust ladder.
   - Honeypot field name (`referral_code` JSON key, `website_url_2` HTML name).
   - The four already-shipped F-01 through F-04 fixes.
7. **PR groupings.** Three PRs:
   - **PR 1 — minor hardening + docs:** F-05, F-08, F-09, F-10, F-14. Low-risk, mostly comments / one-line additions.
   - **PR 2 — triage hardening:** F-06, F-07, F-11, F-12. All scoped to `lib/triage.ts` + `app/api/triage/route.ts`.
   - **PR 3 — waitlist persistence:** functional bug fix. Document the schema decision (KV vs D1) in the PR body. Default recommendation: KV namespace `WAITLIST` with key pattern `waitlist:<source>:<sha256(email_normalized)[:16]>` and value `{url, email_normalized, captured_at, source}`. D1 if/when retention or analytics queries grow.

### Live-traffic scan (separate task before staging the prompt)

After reading the findings doc and `memory/project_live_services.md`, run `wrangler tail` against both Workers (`pharos-scanner` and `pharos-marketing` / `astrant-marketing-prod`) for ~2 minutes each. Look for:

- Unusual error rates (5xx clusters, repeated D1 / KV failures, BR cap hits).
- Abuse signatures (repeated honeypot fills, rate-limit 429s spiking, bogus admin-key attempts).
- Unexpected traffic on Slice 2b endpoints (`/api/score/capture-email`, `/api/score/delete-me`, `/api/score/[id]/pdf`, `/api/score/[id]/state`).
- Resend delivery failures or bounce loops.

Roll material findings into the staged prompt as additional tasks (numbered after the existing F-* items, e.g., "T-LIVE-1: ..."). Document immaterial findings in a footnote at the bottom of the staged prompt so they're not lost but don't bloat the action queue.

### Output format

Write the staged prompt to: `F:\pharos\PHASE_1_5_HARDENING_PROMPT.md` (sibling to `DEPLOY.md`). Bruno will review and fire it manually when ready.

After writing the prompt file, output a brief summary (≤200 words) of:
1. What's in the staged prompt (high-level task list).
2. Any new findings from the live-traffic scan that were rolled in.
3. Anything you noticed during staging that warrants Bruno's attention before firing (e.g., a finding that turned out to already be fixed, an environmental concern, etc.).

**Do not deploy. Do not modify any application code. Only write the staged prompt file.**
