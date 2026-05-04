# Internal Methodology Doc — Ready-to-Paste Diffs (2026-05-03)

**Target file:** `pharos-citation-audit-calibration-methodology.md` (lives in OneDrive workspace, NOT in F:\ repo — acquisition asset, technique-level disclosure surface)

**Source-of-truth:** `F:\pharos\reports\multi-known-positive-2026-05-02.md` §8

**Why these diffs exist:** Today's session shipped Slice A2.1 (public methodology page caveat update) and Slice A3 (dogfood-methodology integration with site-wide Schema.org propagation). The internal acquisition asset still reflects pre-multi-known-positive corpus state — three small edits bring it current.

**Scope:** Three diffs. Internal naming convention applies (specific anchor brands named explicitly; this is the technique-level disclosure surface, not the public page). Apply via Bruno's normal OneDrive .md edit flow; no Claude Code involvement needed.

---

## Diff (a) — §8 caveat #1 revised (closes the single-anchor caveat)

**Locate:** §8 of the internal doc, caveat numbered "#1" — currently reads roughly "Single high-end calibration anchor. The methodology validates against one well-indexed major brand as a known-positive control. Future calibration passes will add more known-positive anchors..."

**Replace entire caveat text with:**

```
**Calibrated against four known-positive anchors as of 2026-05-02:** Stripe (payments infrastructure), Salesforce (enterprise SaaS at scale), GitHub (training-corpus-overrepresented developer infrastructure), HubSpot (mid-tier B2B SaaS, customer-profile). All four show maximum-strength Outcome A. Slope-generalization established at the known-positive recognition tier. Recognition-gradient between Astrant-tier (known-mid) and HubSpot-tier (known-positive) not yet sampled — intermediate-recognition anchors queued for next calibration pass.
```

**Why this wording (vs the public page's abstracted form):** The public methodology page at /methodology/calibration uses abstracted profile categories ("payments infrastructure," "developer infrastructure with dense training-data presence," etc.) per boundary-discipline. The internal doc names the four specific anchors directly because it IS the technique-level disclosure surface — acquirer DD will read both, and the internal version is where corpus composition lives explicitly.

---

## Diff (b) — §9 follow-up #1 marked complete

**Locate:** §9 (Follow-ups / open queue) of the internal doc, item #1 — currently labeled approximately "Multi-known-positive corpus expansion — add 2-3 known-positive anchors to validate slope generalization across the high-recognition tier."

**Append (or update status to) the following closure stamp:**

```
**Closed 2026-05-02** — see `pharos/reports/multi-known-positive-2026-05-02.md`. All four anchors (Stripe + Salesforce + GitHub + HubSpot) confirm Outcome A at maximum strength. §8 caveat #1 revised accordingly (see Diff a above). Slope generalization established at the known-positive recognition tier; recognition-gradient sampling between known-mid and known-positive endpoints queued as Pass 4 (see new §9 entry, Diff c below).
```

If §9 follow-up #1 is in a numbered or bulleted list with a status field, set the status to ✓ / Closed / Done per the doc's existing convention.

---

## Diff (c) — New §9 follow-up entry: Pass 4 stub

**Locate:** §9 (Follow-ups / open queue) of the internal doc. Add as a new entry — recommend placing immediately after the closed Diff (b) item so the calibration-pass progression reads chronologically.

**Insert:**

```
**Pass 4 — Recognition-gradient + known-negative anchor calibration (queued).**

Two sub-tasks:

1. **Recognition-gradient sampling.** When paying-customer profile data accumulates, sample 2-3 intermediate-recognition anchors (Series A B2B SaaS, ~6-12 mo public web presence) to validate slope monotonicity through the customer-relevance gradient. Currently the methodology validates at recognition-tier endpoints (mid-tier B2B SaaS via HubSpot, high-recognition cluster via Stripe/Salesforce/GitHub) but doesn't yet sample intermediate points.

2. **Known-negative anchor.** Add a sub-100-page brochure site as known-negative control to validate the judge's ceiling against over-AFFIRM on weak-signal inputs. Confirms the judge can produce a low score for a domain with genuinely thin citation surface, not just relative low-vs-high comparisons among already-validated brands.

**Trigger:** paying-customer-data availability OR customer conversation surfaces a "does it work for my smaller domain" question that the current corpus can't answer empirically. Estimated cost: ~$0.85 × 4-5 anchors = ~$3.40-4.25 + setup time.

**Status post-trigger:** when triggered, the public methodology page's `disambiguatingDescription` field in the root-layout Organization schema (added in Slice A3, 2026-05-03) goes stale site-wide and must be updated as part of the Pass 4 deploy slice.
```

---

## Pre-paste boundary-discipline check

Before pasting into the internal doc, confirm:

- ✓ Diffs (a) and (c) name the four anchors directly — this is **intentional** for the internal doc (technique-level disclosure surface). Do NOT abstract them.
- ✓ Diff (c) references Slice A3's `disambiguatingDescription` — links the internal doc to the public-surface implementation so future maintainers know the cross-surface coupling.
- ✓ No public-surface boundary-discipline rules apply to the internal doc — provider names (OpenAI/Anthropic/Gemini/Perplexity), threshold values (+25pp/+30pp/+40pp/≥0.85), Pass labels are all allowed in the internal doc since it's the technique-level disclosure surface.

## Post-paste suggestion

Update the internal doc's `Last updated:` / version stamp at the top to `2026-05-03`. Optionally add a one-line changelog entry:

```
**2026-05-03 changelog:** §8 caveat #1 revised to reflect 4-anchor calibration (multi-known-positive corpus expansion closed 2026-05-02). §9 follow-up #1 marked complete. New §9 entry added for Pass 4 (recognition-gradient + known-negative anchor calibration, trigger-gated).
```

---

## After Bruno applies the diffs

No CLI follow-up required — the internal doc is OneDrive-only and has no automated verification surface. Optional: save a copy of the post-edit file under `F:\pharos\reports\internal-doc-snapshot-2026-05-03.md` if you want a versioned snapshot in the repo for cross-reference. (Spec-wise this is the acquisition asset, so a periodic in-repo snapshot may be worth standing up as a discipline — flag for the post-A3 strategic conversation.)
