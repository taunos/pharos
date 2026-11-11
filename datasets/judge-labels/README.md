# Citation Visibility gold labels

An independent labelled set of Citation Visibility answers, so any change to the judge can be measured against something other than the judge itself. Stage 0 of the judge-fix pipeline (Bruno, 2026-11-10).

## Files

| file | what |
|---|---|
| `GUIDE.md` | Labeling rules (v2, after Codex review). Each answer gets separate attributes: identity, core_identity, answered, facts, has_unsupported_claims, invented_specifics, url, truncated, names_site. |
| `codex-guide-review.md` | Codex's review of guide v1; v2 adopts most of it. |
| `evidence/<site>.md` | What the site itself says (URL, short excerpt, fetch date 2026-11-10), dev sites only. Labels are reproducible from these. |
| `dev.jsonl` | Dev labels, one line per answer: top-level attributes (agreed or resolved; `null` while waiting on Bruno), `labeler_a` (Claude), `labeler_b` (Codex), `final` (`null` until every attribute is resolved), `status` (agreed / resolved_by_rule / needs_bruno), `pending`, `resolutions`, `evidence`. |
| `agreement.md` | A-vs-B agreement per attribute (counts, %, Cohen's κ). |
| `disagreements-for-bruno.md` | Every dev answer where A and B disagreed on identity, facts or invented_specifics, plus the three rule questions. Bruno answered the rules on 2026-11-10 (R1 = A, R2 = B, R3 = B); the 3 dev items left over are in `_tmp/report-truthfulness/label-oneoffs-for-bruno.md` in the main checkout. |
| `score.mjs` | Scores a judge's verdicts against the labels. `score.test.mjs` tests it. |
| `extract-old-judge.mjs` | Turns the old judge's `result.notes` into a verdict file for `score.mjs`. |
| `baseline/old-judge-verdicts.jsonl` | The old judge's verdicts on the dev answers (from the 2026-11-10 release check and the 2026-11-08 Rachel Queiroz panel run); regenerate any set with `extract-old-judge.mjs`. |

Held-out labels are NOT in this repo. Two sites were held out by a recorded random seed; whoever changes the judge must not see or tune on them. Freeze the judge before it is scored on the held-out set.

## Data

- Answers: `datasets/report-defects/snapshots/2026-11-10-release-check/<site>/dim6-cells.json` (5 sites) and the 2026-11-08 panel run for rachelqueiroz (`tools/report-panel/out/dim6-real/rachelqueiroz/dim6-cells.json` in the main checkout; not committed). 40 answers per site.
- Rachel Queiroz's site is always in dev: its namesake mix-ups (the novelist Rachel de Queiroz) are the known positives and the judge fixer already knows them.

## Scoring a judge

Write one JSON line per answer: `{"site":"eff","qid":"q1","modelId":"openai:gpt-4o","verdict":"CORRECT"}`. Verdicts: `CORRECT`, `MIXUP` (alias `WRONG`: "mixed up your site with a different person or business"), `WRONG_FACTS` (optional: right entity, wrong facts), `UNCLEAR`, `DENY` (alias `NOT_CITED`).

```bash
node datasets/judge-labels/score.mjs --judge my-verdicts.jsonl --labels datasets/judge-labels/dev.jsonl
```

`--as a` / `--as b` scores against one labeler's raw labels, which brackets how much Bruno's open calls could move each number. `--json` prints everything, including the keys behind each count.

It prints, with denominators:
1. **False "different business" accusations**: answers labelled not a different entity but judged MIXUP (also: how many of those answers were backed by the site; and MIXUP precision).
2. **Recall on real different-entity answers** (definite and hedged separately).
3. **Precision of CORRECT**: share of CORRECT verdicts that are truly correct (right entity, committed answer, facts backed by the site, nothing invented), and a breakdown of what the rest were (guesses, unsupported, invented...).
4. **Clear cases**: on answers whose right verdict is unambiguous (truly correct / definite mix-up / plain non-answer), the share given a definite verdict (coverage) and the share given the right one.

Answers whose needed labels still wait on Bruno are left out of that metric; the count left out is printed.

```bash
node --test datasets/judge-labels/score.test.mjs
```

## Baseline: the old judge (llama-3.3-70b) on dev, 160 answers

| metric | final labels | range across A / B labels |
|---|---|---|
| False "different business" accusations | 10/149 (6.7%); 7/106 (6.6%) of answers backed by the site | 10/149 (6.7%) both |
| MIXUP precision | 7/17 (41.2%) | 7/17 (41.2%) |
| Recall on real different-entity answers | 7/11 (63.6%): definite 5/7, hedged 2/4 | same |
| Precision of CORRECT (strict) | 95/103 (92.2%), 1 left out pending Bruno | A 95/104 (91.3%) · B 75/104 (72.1%) |
| Clear cases: coverage / accuracy | 125/127 (98.4%) / 114/127 (89.8%) | accuracy A 90.6% · B 88.8% |

Per dev site, false accusations: eff 2/40, rachelqueiroz 1/29, resend 3/40, ugmonk 4/40. The old judge accuses roughly one in 15 site-backed answers of being a mix-up, and more than half of its mix-up verdicts are false. Final labels apply Bruno's rule calls R1–R3 (2026-11-10, see GUIDE.md); 3 dev answers still wait on one-off calls.
