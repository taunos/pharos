# TP-7 Boundary Fix — 2026-05-02

**Worker version:** `844891b0-3b73-4564-94d7-e9f2def4a12f`
**Slice:** Pre-A2. Resolves pre-existing technique-disclosure leak before publishing-bundle deploy.

## Files modified

- `marketing-site/src/app/score/methodology/page.tsx` — heading + body prose rename (lines 114, 116)
  - `<h3>Trust posture (TP-7)</h3>` → `<h3>Validator-driven trust pattern</h3>`
  - body: `the same six-rung TP-7 trust ladder we use` → `the same six-rung validator-driven trust pattern we use`

No other files modified. All other TP-7 references in the codebase are internal-only comments, retained per the project codename rule (internal codenames stay; public-facing strings change).

## Discovery scope

**TP-7 references found in customer-facing code (1 file, 2 lines):**
- `marketing-site/src/app/score/methodology/page.tsx:114` — `<h3>Trust posture (TP-7)</h3>` heading (RENAMED)
- `marketing-site/src/app/score/methodology/page.tsx:116` — body prose reference to "TP-7 trust ladder" (RENAMED)

**Internal-only TP-7 references kept (10 occurrences across 7 files):**
- `marketing-site/src/lib/dim6/adapters.ts:4` — file header comment (`//`)
- `marketing-site/src/lib/dim6/ladder.ts:1` — file header comment (`//`)
- `marketing-site/src/lib/dim6/ladder.ts:291` — JSDoc comment (`/** */`)
- `marketing-site/src/lib/dim6/orchestrator.ts:88` — JSDoc comment (`/** */`)
- `marketing-site/src/lib/dim6/promptset.ts:23` — multi-line `//` comment
- `marketing-site/src/lib/dim6/promptset.ts:275` — JSDoc comment (`/** */`)
- `marketing-site/src/lib/dim6/promptset.ts:311` — inline `//` comment
- `marketing-site/src/lib/dim6/types.ts:33` — multi-line `//` comment
- `marketing-site/src/lib/score-pdf-template.ts:11` — multi-line `//` comment in file's leading docblock
- `marketing-site/src/lib/score-pdf-template.ts:34` — `//` comment in "Lift bucketing" section header

**Verification of `score-pdf-template.ts` (per CLI prompt's verify-before-assuming rule):** both lines 11 and 34 read directly from the file are inside `//` comment blocks, NOT inside template-string literals that emit to PDF body content. The file's PDF-body templates use the engine version stamp from runtime (`engine v<scoring_version>` placeholder in the footer, line 13 in comment) but do NOT render the literal "TP-7" string into customer-visible PDF content. Comments retained per hinge-question rule.

## Endpoint verification

- **Residual TP-7 / Trust posture greps on live `/score/methodology`:** ZERO matches (case-insensitive, all four pattern variants checked: `TP-7`, `TP7`, `Trust posture`, `trust posture`)
- **New "validator-driven trust" label rendered on live page:** 4 matches (heading + body prose + 2 React-rendering structural occurrences)
- HTTP 200 on `https://www.astrant.io/score/methodology`

## Open observations

- **Discovery scan caught the TP-7 heading + body + 10 internal comment refs in one project-wide grep.** The discovery-as-audit pattern in Step 1 worked as designed — no surprise references in unexpected places (e.g., shared components rendered across pages, JSON-LD payloads, error-message strings, email templates).
- **The `score-pdf-template.ts:11,34` references were correctly identified as comments-only.** The verify-before-assuming language added per CLI feedback prevented blind skip; the agent inspected the actual file content and confirmed both lines are in `//` blocks. If a future TP-7 reference lands in a template-string literal that emits to PDF body, the same inspection step would catch it and rename appropriately.
- **Slice A2 (publishing-bundle) is now unblocked from a boundary-discipline perspective.** The publishing-bundle deploy prompt's Step 6 forbidden-term grep on `/methodology/calibration` and `/llms.txt` will not surface a pre-existing TP-7 leak.
