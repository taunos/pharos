# Gemini Paid-Tier Upgrade + 2.5 Flash Migration — 2026-05-04

## Summary

The dim6 audit-pipeline's "one provider operationally absent" issue (Gemini absent across all 5 paid calibration audits during 2026-05-02 corpus expansion) is **resolved**. Two-part fix:

1. **Bruno-side:** GCP project linked to billing, Gemini API moved from free tier to paid Tier 1.
2. **Code-side:** Model identifier upgraded `gemini-2.0-flash` → `gemini-2.5-flash` across the dim6 module, plus DEPLOY.md doc reference.

Verified via 20-call parallel burst test: 20/20 ok on `gemini-2.5-flash` (was 20/20 `client_error` 404 on `gemini-2.0-flash` post-tier-upgrade).

## Memory misdiagnosis correction

The TODO.md item #6 ("Gemini per-provider semaphore") and the methodology-page caveat ("one provider operationally absent due to upstream rate-limit behavior") were both framed against a **rate-limit cascade** interpretation. That framing was wrong.

The actual root cause was that **`gemini-2.0-flash` is no longer available to new users**. Google retired the model for new API access. The audit pipeline's calls were returning HTTP 404 with message "This model models/gemini-2.0-flash is no longer available to new users. Please update your code to use a newer model..." — not 429 rate-limit responses.

The 4xx-other-than-429 path in the adapter ([adapters.ts:175](../marketing-site/src/lib/dim6/adapters.ts#L175)) classifies these as `client_error`, which the TP-7 ladder treats as a categorical fail — same operational observable ("Gemini absent in all cells") as a rate-limit cascade, but a structurally different cause. The "rate-limit" framing in memory was an inference from the symptom, not direct verification of the error class.

**Implication:** the engineering work in TODO #6 ("Gemini per-provider semaphore") was scoped against the wrong root cause and is now obsolete. A semaphore would have isolated Gemini's request budget but wouldn't have made retired-model calls succeed. Tier upgrade + model bump is the actual fix.

## Diagnostic procedure

- **Step 1 (test endpoint deploy):** Added `marketing-site/src/app/api/internal/gemini-burst-test/route.ts` — POST endpoint that fires 20 parallel Gemini calls via the existing `callGemini` adapter, returns outcome counts, requires `INTERNAL_FULFILL_KEY` auth. Worker `a83356d0-d9de-4166-b9e6-6901a45ee896`.
- **Step 2 (test under 2.0-flash):** Result: `client_error: 20`, all returning HTTP 404 "no longer available to new users." Confirmed: 429 cascade is not the failure mode; model retirement is.
- **Step 3 (model upgrade deploy):** Updated `gemini-2.0-flash` → `gemini-2.5-flash` in 4 source files + 1 doc reference. Worker `8e482c18-2590-4d50-ae93-84953225da96`.
- **Step 4 (test under 2.5-flash):** Result: `ok: 20`, `interpretation: PAID_TIER_RESOLVED`. Cascade not firing; all parallel calls succeed.
- **Step 5 (cleanup deploy):** Removed the diagnostic endpoint + empty parent directories. Worker `e23ac215-ebe5-46bf-adaf-a079eb478d8d`. Verified endpoint returns 404 post-cleanup.

## Files modified

- [marketing-site/src/lib/dim6/adapters.ts](../marketing-site/src/lib/dim6/adapters.ts) — model identifier + URL update + JSDoc comment block
- [marketing-site/src/lib/dim6/types.ts](../marketing-site/src/lib/dim6/types.ts) — `ModelId` type alias + `ALL_MODEL_IDS` array
- [marketing-site/src/lib/dim6/orchestrator.ts](../marketing-site/src/lib/dim6/orchestrator.ts) — per-model average dispatch table
- [DEPLOY.md](../DEPLOY.md) — 4-model set documentation reference
- `marketing-site/src/app/api/internal/gemini-burst-test/route.ts` — temporary diagnostic endpoint, created and removed within this slice

## Cost impact

Per-audit Gemini contribution at 2.5 Flash pricing ($0.30 input / $2.50 output per 1M tokens): roughly $0.10/audit at ~50 calls × ~50 input + ~800 output tokens. Total per-audit cost goes from ~$0.85 (3-provider, with Gemini absent) to ~$0.95 (4-provider, with Gemini restored). Marginal vs the $79 audit price.

## Engine version unchanged

Per locked-constants discipline (C1 across the publishing-bundle slices): the engine version stamp `dim6:v3` is **NOT** bumped by this slice. Reasoning:

- The model identifier change is a content-side adjustment, not a methodology-pipeline change. The TP-7 ladder, judge logic, prompt-set generator, and scoring math are all unchanged.
- The dim6 cell cache key includes `engine_version` AND `model_id` — so existing cached cells under `model_id="google:gemini-2.0-flash"` and engine `dim6:v3` remain valid for historical reads, while new cells under `model_id="google:gemini-2.5-flash"` write under a distinct cache namespace. No invalidation cascade.
- The methodology page's engine-version stamp continues to read `dim6:v3` — accurate, since the methodology generation logic hasn't changed.

If a future change to dim6 *judging logic* (not just model identifier) lands, that's the trigger for a `dim6:v4` engine bump, not this slice.

## Queued follow-up — caveat removal slice

The methodology page caveat at [marketing-site/src/lib/methodology-content.ts:60](../marketing-site/src/lib/methodology-content.ts#L60) currently reads:

> **One provider operationally absent.** One of the four major-language-model providers in the audit corpus produces no judged verdicts due to upstream rate-limit behavior. Methodology runs on three-provider evidence pending a per-provider isolation fix.

This is now stale. After a real audit confirms 4-provider coverage in a full scan (vs the stub-prompt burst test), the caveat should be removed across:

- `/methodology/calibration` (Known Limits section)
- `/llms.txt` (Known Limits methodology block)

Recommend running a single calibration audit on the dogfood domain (Astrant.io) to confirm `judged_n: 4` across cells, then queueing a small caveat-removal slice. Estimated cost: ~$0.95 for the verification audit + ~10-min slice for the caveat removal.

Trigger condition: real-audit verification of 4-provider judged_n coverage. Stale-caveat-on-public-surface is a low-urgency issue but should land within a week or two of this slice.

## Open follow-ups beyond this slice

- **Citation-tracking spec v3** (Cowork-side): drop the "operationally absent across all 5 paid audits per memory" framing in OQ-B; the underlying cause was model deprecation, not rate-limit cascade. The 3-of-4 validity threshold concern in OQ-K-2 (flagged in v2 review) is now moot.
- **Memory cleanup**: `project_methodology_validation_state.md` (Cowork-side) reference to "Gemini operationally absent due to rate-limit cascade" needs correcting to "Gemini operationally absent due to gemini-2.0-flash retirement; resolved 2026-05-04 by paid-tier + 2.5 Flash upgrade."

DONE
