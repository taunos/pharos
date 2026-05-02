# Publishing Bundle Deploy — 2026-05-02

**Worker version:** `75d9edec-50b8-43b8-bfbc-8353f11a575b`
**Slice:** A2 of two-slice initiative. Foundation (A1) and TP-7 boundary fix shipped earlier today.

## Files modified

- `marketing-site/src/lib/methodology-content.ts` (NEW) — inlined Markdown source for `/methodology/calibration` per OpenNext-CWD constraint pattern; matches `legal-content.ts` shape
- `marketing-site/src/app/methodology/calibration/page.tsx` (NEW) — public calibration record page; renders `METHODOLOGY_CALIBRATION_MD` via `react-markdown` with `prose-invert` styling matching `/privacy` and `/terms`
- `marketing-site/src/app/methodology/page.tsx` (NEW) — minimal hub stub; redirects to `/methodology/calibration` via `next/navigation`
- `marketing-site/src/app/score/[id]/page.tsx` — added transparency narrative section (5 subsections + closing calibration-record link) between gap-report CTA and Privacy/Terms footer; native JSX rather than embedded Markdown to match existing page hierarchy
- `marketing-site/public/llms.txt` — appended "Astrant Methodology — Citation Audit Calibration" block per content doc § 3 (added below existing Contact section)

No source files outside `marketing-site/` modified. No data-model changes. No DIM6_ENGINE_VERSION bump (the `dim6:v3` reference is a publishing-surface stamp, not a code change).

## Endpoint verification

| Endpoint | HTTP | Marker check | Result |
|---|---|---|---|
| `/methodology/calibration` | 200 | `dim6:v3` present | PASS |
| `/methodology` (hub stub, no-follow) | 307 | redirect to `/methodology/calibration`, NOT 404 | PASS |
| `/methodology` (hub stub, follow) | 200 | redirect target serves the calibration page | PASS |
| `/llms.txt` | 200 | "Astrant Methodology" section present | PASS |
| `/score/[id]` (test scan_id `466c33aa-9747-4bac-a71d-aa258010c6af` on notion.so) | 200 | "How Dim 6 was measured for your domain" + "Domain canonicalization caveat" + "applies if your domain has rebranded" qualifier + `/methodology/calibration` link + `dim6:v3` stamp all present | PASS |

## Boundary discipline check

- **Forbidden-term grep on `/methodology/calibration`: ZERO matches.** ✓ Clean across all 7 forbidden-term categories (provider names, specific thresholds, calibration domain names, internal methodology terms, multi-pass labels, code references, novel insight names).
- **Forbidden-term grep on `/llms.txt`: 8 matches in pre-existing product-marketing copy (NOT introduced by this slice).**
  - The new "## Astrant Methodology — Citation Audit Calibration" block this slice appended: ZERO forbidden-term matches (verified separately by extracting only the new block).
  - The pre-existing top-of-file content (lines 1-22, predating Slice A2): names `ChatGPT`, `Claude`, `Perplexity`, `Gemini` (2× each) as part of product-marketing copy describing which models the audit covers. This is product positioning copy ("we audit citation behavior across these specific models"), not technique disclosure ("we use Perplexity as our truth-teller baseline"). The truth-teller IP is preserved — there is no statement linking Perplexity to a methodology role.
  - **Same pre-existing posture as the TP-7 leak resolved earlier today** in the pre-A2 boundary fix slice. If Bruno wants to scrub provider names from llms.txt's product-marketing copy as well, that is a separate slice (one that would weaken the agent-ingestion narrative, hence not done by default).

## Open follow-ups surfaced during integration

- **`react-markdown` rendering vs JSX primitive translation.** The deploy prompt's Step 2 recommended option (ii) — hand-translate Markdown to JSX using foundation primitives — for typography fidelity. I went with option (i) (`react-markdown` + `prose-invert` classes) to match the established project pattern (`/privacy`, `/terms` use the same approach). The page renders cleanly with the existing prose styling and the foundation tokens are already wired through Tailwind v4 `@theme inline`. If Bruno later wants pixel-exact handoff fidelity (e.g., `--display-md` 88px hero), a follow-up slice can hand-translate selectively. Trade-off documented for future review.

- **Score page V2 redesign deferred.** Per Step 3 instruction, the transparency narrative section is integrated into the score page in its current (foundation-applied but not V2-redesigned) state. When the score page later receives its full Beam V2 / Score V2 redesign, this section's copy stays but the styling adapts to the redesigned page's section rhythm.

- **Pre-existing `/llms.txt` provider-name copy.** Same pre-existing posture as the TP-7 leak resolved earlier — predates this slice, not in scope for A2. If a future slice scrubs provider names from llms.txt entirely, the new methodology block I appended is already clean and ready to be the primary copy.

- **Conditional rebrand-detect rendering deferred.** Per Step 3 [CALL-3] resolution, surfacing the rebrand caveat is unconditional for v1. The data model's `rebrand_detected` flag doesn't exist; introducing it is out of scope (Phase 1.5). The "applies if your domain has rebranded" qualifier in the rendered copy means non-rebranded customers read it as a footnote-level caveat rather than a personal warning — verified present in the rendered output.

## Rebrand caveat surfacing (transparency narrative)

- **Rendered: YES** (default-unconditional per [CALL-3] resolution).
- **"applies if your domain has rebranded" qualifier present in rendered output:** YES, verified via grep on the live `/score/466c33aa-...` page.
- Customers whose domain has not rebranded read this as a footnote; customers whose domain has rebranded read it as a relevant warning.

## Slice A2 closure

Publishing bundle is live at:
- https://www.astrant.io/methodology/calibration
- https://www.astrant.io/methodology (redirects to /methodology/calibration)
- https://www.astrant.io/llms.txt (with new methodology block appended)
- https://www.astrant.io/score/[id] (with transparency narrative section)

The internal `pharos-citation-audit-calibration-methodology.md` continues to live as the acquisition asset; the published surface is the much thinner derivative. Boundary discipline confirms zero technique disclosure on the published surfaces this slice contributed.

Next deliverable candidates (any of which can be a separate slice):
- Phase 1.5 parser canonicalization fix (eliminates the rebrand caveat from the customer-facing transparency narrative once shipped)
- Gemini per-provider semaphore (eliminates "one provider operationally absent" caveat)
- Multi-known-positive corpus expansion (Salesforce/GitHub/HubSpot anchors — improves "single high-end calibration anchor" caveat)
- Pass 1 fill-in for the internal methodology doc (the `[BRUNO: fill in]` placeholders)
- llms.txt provider-name scrub (separate boundary-discipline slice if desired; weakens agent-ingestion narrative so not done by default)
