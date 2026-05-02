# Stripe Dim 6 Verification — 2026-05-02

## TL;DR

**Verification status: INVALID as a methodology test.** Bug 2 + CC-3
contamination affected 40/40 cells. Per the framework's cross-check rule
(`pharos-stripe-decision-framework.md` Outcome C cross-check), the
A/B/C decision **cannot be applied** until the prompt-set generator is
fixed and Stripe is re-run.

The audit DID complete end-to-end; the orchestrator + ladder + judge
ran cleanly under `dim6:v2`. The bug is upstream of the judge in the
prompt-set generator. The judge produced sane output on the cells it
received.

## Scan
- scan_id: `77497048-f3a2-43ef-b8a4-628cc088a46a`
- engine_version: `dim6:v2` ✓
- row count: 40 (expected 32-48; clean fan-out 10 prompts × 4 models)
- duration: ~5s wall-time on the model-call layer (orchestrator
  batched-concurrency working as designed)
- Composite (per audit-fulfill response): **41 / D**, gap_count: 17

## Pre-flight findings
- Active engine constant: `dim6:v2` (verified in deployed
  marketing-site Worker `f37ab6e1...` from yesterday's parser hotfix)
- Prompt-set cache-key shape: NOT directly inspected this run; assumed
  pinned to `prompts:dim6:v1:` per yesterday's plan note. Engine-version-
  tagging on prompt-set cache: **ABSENT** (known, not fixed this run)
- Cache state at run time: stripe.com prompt-set may have been pre-cached
  from an earlier failed-fallback path; not investigated this run since
  the contamination is upstream
- Capability-separation invariant on scanner: HOLDS (no API keys bound
  on scanner Worker — verified yesterday)

## Per-model judge distribution

| Model | AFFIRM | DENY | unmeasurable | unparsed | total |
|-------|--------|------|--------------|----------|-------|
| Perplexity | 4 | 6 | 0 | 0 | 10 |
| Anthropic | 4 | 6 | 0 | 0 | 10 |
| OpenAI | 4 | 6 | 0 | 0 | 10 |
| Gemini | 0 | 0 | 10 | 0 | 10 |

Gemini all-unmeasurable: 429 rate-limit cascade reproduced (same
behavior as Astrant's v1 + v2 dogfood runs). Per-provider semaphore
remains queued.

## Per-model rates (over judged cells)

| Model | AFFIRM/judged | judged_n | total_n |
|-------|---------------|----------|---------|
| Perplexity | 0.40 | 10 | 10 |
| Anthropic | 0.40 | 10 | 10 |
| OpenAI | 0.40 | 10 | 10 |
| Gemini | n/a | 0 | 10 |

## Per-model citation_score averages

| Model | avg_score | max_score |
|-------|-----------|-----------|
| Perplexity | 16 | 70 |
| Anthropic | 4 | 10 |
| OpenAI | 28 | 70 |
| Gemini | 0 | 0 |

## Confabulation tax (vs Perplexity baseline)

| Model | Stripe tax | Astrant tax (yesterday) | Contraction |
|-------|-----------|------------------------|-------------|
| Anthropic | **0pp** | +10pp | -10pp ✓ |
| OpenAI | **0pp** | +10pp | -10pp ✓ |
| Gemini | n/a | n/a | n/a |

**This signal is contaminated and not interpretable.** All three models
ran the same broken-prompt set, so identical AFFIRM rates are not
evidence of judge calibration; they're evidence of identical inputs.

## Composite scoring
- Dim 6 (v2 composite, all 4 models): contaminated; not computed
- Dim 6 (Perplexity-only, hypothetical): contaminated; not computed
- Gap (estimated confabulation inflation): not computable

## Bank fallback occurrences

**100% of cells.** All four models, all 10 queries each.

| Model | bank_fallback_rows |
|-------|--------------------|
| Perplexity | 10 |
| Anthropic | 10 |
| OpenAI | 10 |
| Gemini | 10 |

Sample query_rationale strings (verbatim):
- `Bank fallback: top-3 short answer, prompts model to produce URL citations.`
- `Bank fallback: direct domain query, baseline 'is this domain known' check.`
- `Bank fallback: credibility-framed competitor short answer.`
- `Bank fallback: research-intent short answer, URL-only output.`
- `Bank fallback: paragraph-bounded direct domain check.`
- `Bank fallback: yes/no recognition check, forced short answer.`
- `Bank fallback: URL-only enumeration for citation-grounding.`
- `Bank fallback: alternative-framing — tests competitor mention adjacent to target.`
- `Bank fallback: positioning-framing — competitor-first risk check.`
- `Bank fallback: buyer-intent shortlist — single-pick short answer.`

## CC-3 placeholder bug — the second contamination

The bank fallback prompt set contains **literal unsubstituted placeholder
text** that ends up in the queries the models actually receive:

- "Name the top 3 **their software category** vendors. One sentence per vendor, including the URL."
- "Who are the most credible providers of **their software category**? Give 3, one URL each."
- "If I'm researching **their software category**, what 2-3 sites should I read first? Just URLs."
- "List 3 **their software category** tools by URL only."
- "What's a quick alternative to stripe.com in **their software category**? Name one and link it."
- "Which **their software category** provider should a small B2B SaaS company evaluate first? One name + URL."

The phrase "their software category" is a literal placeholder that should
have been substituted with Stripe's actual category ("payment processing"
or similar). Models cannot infer the category from this prompt — they can
only note that the requester used a strange phrasing.

This is the CC-3 polish item from the v3 review of the Slice 3b kickoff
prompt:

> Task 7 templated fallback's `[organization's category]` placeholder
> text — derive from signals or fall back to domain-only queries; never
> send literal placeholder to LLMs.

I rated CC-3 Info-with-fix-suggestion in pass 4 of the kickoff review.
We fired v4 anyway. The agent did not catch CC-3 during execution. It is
now actively breaking every paid audit's prompt set.

## What we did learn (real signal despite contamination)

The 2 of 10 bank prompts that **directly name the domain** (`What does
stripe.com do?` and `Give me one paragraph: what is stripe.com and why
might I use it?`) produced substantive Perplexity responses with explicit
RAG-grounded citations.

Verbatim Perplexity AFFIRM responses:

> **Stripe.com provides a financial infrastructure platform that enables
> businesses to accept online and in-person payments, manage billing and
> subscriptions, prevent fraud, and handle money movement across 135+
> currencies and payment methods.[3][1][2]**

> **Stripe.com** is the website for Stripe, Inc., an Irish-American
> multinational financial services and SaaS company dual-headquartered in
> South San Francisco and Dublin, offering payment-processing software,
> APIs for e-commerce and mobile apps, and tools like Stripe Connect for
> multiparty payments, billing for subscriptions, Stripe Issuing for custom
> cards, and Stripe Treasury for embedded financial services...

These responses contain real citation signal. The judge correctly returned
AFFIRM for them. **The judge IS working on properly-formed prompts.** The
contamination is upstream — the prompt-set generator is failing, and the
templated-fallback set has its own bug that makes its prompts useless.

## Open observations (not actions)

- The fact that ALL FOUR models (including Gemini, before it cascaded)
  received Bank fallback prompts means Bug 2 is **pervasive across all
  paid audits, not domain-specific**. Astrant's v1 and v2 dogfood and
  Stripe's v2 dogfood all show 100% Bank fallback firing. The
  LLM-driven prompt-set generator's TP-7 retry ladder is exhausting on
  every audit.
- The Stripe composite (41/D) being lower than Astrant's (74/B) under
  v2 is **not a Dim 6 finding** — it's likely Dims 1-5 dragging Stripe
  down (no llms.txt at stripe.com root, OpenAPI spec lives at
  github.com/stripe/openapi not at a `/.well-known/` path, no public
  MCP server). This is independently interesting calibration data
  about what the dimension structure rewards but doesn't bear on the
  Dim 6 methodology question.
- Gemini's all-unmeasurable continues. Per-provider semaphore (Phase
  1.5 hardening item) is the correct fix; not addressed this run.
- The Anthropic citation_score average of 4 is suspicious vs OpenAI's
  28 — both AFFIRMed at the same rate (4/10) but the underlying
  per-cell scores diverge sharply. Worth a closer look post-Bug-2-fix.

## Required next steps before re-running Stripe verification

1. **Fix CC-3** — replace `[organization's category]` placeholder
   substitution in the templated fallback set. Either derive a category
   guess from signal_inputs (org description, H1s, meta description) or
   fall back to domain-only queries that don't require category context
   (`Have you heard of <domain>?`, `What does <domain> do?`, etc.).
2. **Investigate Bug 2** — the LLM-driven prompt-set generator is
   failing on every audit. Triage steps from
   `pharos-stripe-decision-framework.md`:
   - Check Workers AI invocation logs for the generator's call path via
     `wrangler tail`
   - Re-run the generator manually with known-good signal_inputs
   - Inspect the validator's reject-reason field if the TP-7 ladder
     records it
3. **Force prompt-set cache miss for stripe.com** before re-running —
   delete the cached entry under
   `prompts:dim6:v1:<sha256(stripe.com+signals)>` so the regenerated
   prompt set lands on the next run (will require Bug 2 fix to actually
   produce a non-fallback set)
4. **Re-run Stripe verification** with proper prompts. Expected:
   Perplexity AFFIRM ≥ 0.85 if the methodology hypothesis holds.

## Decision-framework verdict

Per `pharos-stripe-decision-framework.md` Outcome C cross-check:

> Confirm Bank fallback isn't the reason. If `query_rationale LIKE
> 'Bank fallback:%'` is non-empty on the Perplexity rows, we're scoring
> against generic-bank prompts, not Stripe-specific ones — that's not a
> methodology problem, it's Bug 2.

Bank fallback fired on **100% of Perplexity rows** (10/10). Cross-check
fires. **No A/B/C verdict can be issued from this run.** The methodology
test is paused pending Bug 2 + CC-3 fix.

## Raw rows

Saved at `/tmp/stripe-dim6-rows.json` (304 lines, full per-cell dump).
Excerpted for clarity above.
