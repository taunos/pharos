# Report defects dataset

Every mistake anyone finds in a customer-facing Astrant report goes here, one JSON object per line in `defects.jsonl`. Reports include the paid Audit, the free Score, emails and, later, Implementation outputs.

Why: the panel rules (`tools/report-panel/rules.json`) catch mistakes we have already seen. This file keeps the full record, so that later we can:
- give an AI reviewer real past mistakes as examples;
- one day, train our own checker.

Both need labeled examples in one consistent format, kept from the start.

Also record **false alarms** (`"label": "not_defect"`): text a reviewer flagged that we checked and found correct. A checker trained only on mistakes learns to flag everything.

## Saving runs (automatic)

Add `--archive <name>` to every release-check panel run, for example `node tools/report-panel/run.mjs --archive release-check`. The run is then saved to `snapshots/<date>-<name>/` with nothing typed by hand:
- for each site: the report text and what it was made from (`scan.json`, `audit.json`, the AI calls, the Dim 6 answers), plus a log;
- for the run: a `manifest.json` with the commit, the AI models and each scoring version.

The inputs are saved because sites and AI answers change: later, the report text alone cannot prove a sentence was wrong. Clean reports are kept too, so a checker can learn what a correct report looks like.

After reading a run, add a line to `reviews` in its `manifest.json`: who read it, the date, which sites, and whether the reading was full or partial.
- A site that was read in full and has no entry in `defects.jsonl` counts as a checked clean report.
- A site nobody read has only not been checked.

`node datasets/report-defects/archive-run.mjs <out dir> <name>` saves an existing panel output the same way.

## How to add an entry

1. If the report isn't in a saved run, copy it into `snapshots/<date>-<run>/<site>/report.md`, as markdown text only (no PDF).
2. Append one line to `defects.jsonl`, using the next free id. Only the wrong text, the verdict, the reason, the severity and who found it need real thought; `fixed_text`, `fix_commit` and `caught_by_rule` can stay `null`.
3. Run `node --test datasets/report-defects/validate.test.mjs`. The validator checks every field, and that `text` really appears in the snapshot.

Add entries when the mistake is found, not when it is fixed. Update `status` and `fix_commit` later.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | `1` | format version; if a field changes, bump it and migrate the old lines |
| `id` | `RD-0001` … | unique, never reused |
| `label` | `defect` \| `not_defect` \| `disputed` | a real mistake; a false alarm checked and found correct; or reviewers disagree (keep `status` open, say who thinks what in `why`, resolve later) |
| `found_at` | `YYYY-MM-DD` | the date it was found |
| `found_by` | enum | `bruno`, `outside_reader` (someone outside Astrant, or their AI), `codex`, `gemini`, `reviewer_agent`, `orchestrator`, `panel_rule`, `customer` |
| `source` | string | where it was recorded: a file path or a short description |
| `product` | enum | `audit`, `free_score`, `implementation` |
| `surface` | enum | `report`, `pdf`, `email`, `score_page`, `methodology`, `other` |
| `site` | string | hostname of the site the report was about, or `*` when the mistake was on every report (fixed template text) |
| `scoring_version` | string \| null | the report's scoring version, if known |
| `section` | string | the part of the report, in plain words ("Structured data: Organization check note") |
| `text` | string | the exact text the customer saw, verbatim; for something missing, the nearest text it should have been next to |
| `context` | string \| null | a few surrounding lines, if they matter |
| `category` | enum | see below |
| `severity` | `blocker` \| `polish` \| `none` | `blocker`: false, invented advice, or could lead to a wrong action or conclusion. `none` only for `not_defect` |
| `why` | string | why it is wrong (or, for `not_defect`, why it is right) |
| `fixed_text` | string \| null | the corrected wording, if one exists |
| `status` | enum | `open`, `fixed`, `deferred`, `wont_fix`, `not_applicable` (for `not_defect`) |
| `fix_commit` | string \| null | the commit that fixed it |
| `caught_by_rule` | string \| null | the panel rule id that now catches it, if any |
| `snapshot` | string \| null | path under this folder to the report copy that contains `text` |

Categories: `false_claim` (says something untrue about the site), `misleading` (true but leads to a wrong conclusion), `invented_advice` (advice the owner cannot follow, or that needs invented data), `wrong_action` (advice that would make things worse), `not_applicable` (advice or a check that does not fit this kind of site), `raw_internal` (internal notes, ids or jargon shown to the customer), `unclear`, `inconsistent` (contradicts another part of the report), `overclaim` (promises outcomes), `placeholder`, `missing_info` (something the reader needs is absent), `wrong_language`, `other`.

## Privacy

Only reports about panel sites (`tools/report-panel/sites.json`) or public sites we scanned ourselves are committed. For a paying customer whose site is not on the panel, put the entry in `customer.local.jsonl`. That file is gitignored, uses the same format, and is never committed.
