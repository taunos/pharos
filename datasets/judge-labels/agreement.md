# Labeler agreement (A = Claude, B = Codex)

240 answers (6 sites × 10 questions × 4 models), labelled independently from GUIDE.md v2 and the site evidence. B never saw A's labels or the old judge's notes; A's labels were written to file before B's output was opened. Generated 2026-11-10.

## All 240 answers

| attribute | agree | % | Cohen's κ |
|---|---|---|---|
| identity | 229/240 | 95.4% | 0.89 |
| core_identity | 214/240 | 89.2% | 0.78 |
| answered | 222/240 | 92.5% | 0.81 |
| facts | 192/240 | 80.0% | 0.68 |
| has_unsupported_claims | 141/240 | 58.8% | 0.29 |
| invented_specifics | 236/240 | 98.3% | 0.66 |
| url | 231/240 | 96.3% | 0.78 |
| truncated | 233/240 | 97.1% | 0.84 |
| names_site | 235/240 | 97.9% | 0.97 |

Status: 92 agreed on every attribute · 140 settled by the guide's rules or Bruno's rule calls · 8 one-off items still wait on Bruno.

## Dev split (160 answers, 4 sites: eff, resend, ugmonk, rachelqueiroz)

| attribute | agree | % | Cohen's κ |
|---|---|---|---|
| identity | 152/160 | 95.0% | 0.87 |
| core_identity | 147/160 | 91.9% | 0.84 |
| answered | 152/160 | 95.0% | 0.84 |
| facts | 133/160 | 83.1% | 0.72 |
| has_unsupported_claims | 92/160 | 57.5% | 0.28 |
| invented_specifics | 159/160 | 99.4% | 0.00 |
| url | 160/160 | 100.0% | 1.00 |
| truncated | 155/160 | 96.9% | 0.82 |
| names_site | 159/160 | 99.4% | 0.99 |

Status: 69 agreed · 88 resolved by rule · 3 one-off items wait on Bruno (_tmp/report-truthfulness/label-oneoffs-for-bruno.md in the main checkout).

Label distribution in dev (A / B):
- identity: A same_entity 118, unidentifiable 31, different_named_entity 11 · B same_entity 124, unidentifiable 25, different_named_entity 11
- facts: A supported 105, none 27, unsupported 15, contradicted 13 · B supported 83, unsupported 36, none 27, contradicted 14
- invented_specifics: A false 160 · B false 159, true 1

## What the disagreements were, and how they were settled

Bruno's rule calls (2026-11-10): R1 = A, R2 = B, R3 = B. Together they settled 51 of the 59 items that went to him (dev 31 of 34).


- **facts (supported vs unsupported)**: the biggest group. B marks an answer "unsupported" whenever any detail the answer gives can't be checked against the evidence; A marks it "supported" when the part that answers the question is backed. R1 = A (Bruno): the main claim is enough → supported.
- **identity (same_entity vs unidentifiable)**: answers that address the site without describing it (URL-only answers that name the brand, popularity answers). R2 = B (Bruno): an answer about the site the question names is about your site → same_entity.
- **invented_specifics**: how sure we must be that a specific is false. R3 = B (Bruno): only when the site's text explicitly says otherwise. The same applies to facts=contradicted.
- No disagreement on any different_named_entity answer: both labelers marked the same answers as attributing the site to another named person.
- has_unsupported_claims (κ low): B marked true far more often (literal reading of GUIDE §5); resolved to B by rule. core_identity: every difference was correct vs not_stated (none involved "wrong"); resolved to correct.
