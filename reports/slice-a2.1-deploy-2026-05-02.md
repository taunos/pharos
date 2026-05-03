# Slice A2.1 — Methodology Caveat Update — 2026-05-02

## Files modified

- [marketing-site/src/lib/methodology-content.ts:56](../marketing-site/src/lib/methodology-content.ts#L56) — Edit (b) lead-in widening + Edit (c) sentence 1 widening (combined on one line)
- [marketing-site/src/lib/methodology-content.ts:58](../marketing-site/src/lib/methodology-content.ts#L58) — Edit (a) caveat #1 replacement

## Wording polish applied

- GitHub abstraction in §6 ship-report blockquote was: `high-training-data-presence developer infrastructure`
- Replaced in the on-page text with: `developer infrastructure with dense training-data presence`

## Endpoint verification (https://www.astrant.io/methodology/calibration)

- (a) New wording present on live page: **PASS** (2 occurrences — body + Next.js serialized payload)
- (b) Four-anchor framing present: **PASS** (2 occurrences)
- (c) Recognition-gradient sentence present (`intermediate-recognition`): **PASS** (2 occurrences)
- (d) Old caveat absent on live page: **PASS** (0 occurrences of "Single high-end calibration anchor")
- (e) Engine version locked at dim6:v3: **PASS**
  - `dim6:v3` present: 5 occurrences (header banner + lead-in + history row + Next.js payload duplicates)
  - `grep -oE "dim6:v[0-9]+" | sort -u` listing: `dim6:v1`, `dim6:v2`, `dim6:v3` (expected subset — historical rows in versioning-history table)
  - `>v3` drift grep (`dim6:v[4-9]|dim6:v[1-9][0-9]+`): 0 matches
- (f) Boundary discipline (no provider/domain leaks): **PASS** (0 matches across Stripe/Salesforce/GitHub/HubSpot/Notion/OpenAI/Anthropic/Gemini/Perplexity/Claude/GPT-4)
- (g) Lead-in tweak shipped (Edit b): **PASS**
  - New "Current calibration scope and known limits at engine version dim6:v3": 2 occurrences
  - Old "Current limits at engine version dim6:v3": 0 occurrences
- (h) Sentence 1 widened (Edit c): **PASS**
  - New "explicit about both what's been validated and what hasn't": 2 occurrences
  - Old "explicit about what hasn't been validated yet": 0 occurrences

## Build + deploy

- Deploy command run: `cd marketing-site && npm run cf:deploy` (chains `opennextjs-cloudflare build && wrangler deploy`)
- Worker version ID: `9fd33768-3380-4db1-a7d3-0c1f7e7e620b`
- Live URL verified: https://www.astrant.io/methodology/calibration

## Notes / open follow-ups

- "Known limits" section heading not touched per slice scope discipline. After Edits (b) + (c), the heading is mildly stale relative to widened framing — flagged previously for Bruno's call. If desired, a follow-up Slice A2.2 can rename `## Known limits` → `## Calibration scope and known limits` (single-line edit).
- Internal `pharos-citation-audit-calibration-methodology.md` (OneDrive) edits remain queued — three diffs per `reports/multi-known-positive-2026-05-02.md` §8: (a) §8 caveat #1 revised with internal-version naming the four specific anchors, (b) §9 follow-up #1 marked complete, (c) new §9 entry for Pass 4 stub. Bruno-driven, no Claude Code prompt needed.
- Pre-existing unrelated WIP: `.claude/settings.json` modified — not in slice scope, untouched.

DONE
