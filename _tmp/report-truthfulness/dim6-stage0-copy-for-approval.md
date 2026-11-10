# Citation Visibility: wording for Bruno's approval (2026-11-10)

Branch `claude/dim6-accuracy-fix-998e7b`, not merged or deployed. Nothing below is live.

Part A is what this branch changes now (Stage 0: deterministic fixes only, judge rules untouched).
Part B is a proposal for when the judge changes ship (Stage 1, after the gold label set); it is not
implemented on this branch.

## Part A — changed on this branch

| # | Location | Old text | New text | Why |
|---|---|---|---|---|
| 1 | "Models name your domain" notes, last sentence (every run, every variant) | `... Average by model: ChatGPT <a>, Claude <a>, Gemini <a>, Perplexity <a>.` | `... Average answer score by model (0 to 100): ChatGPT <a>, Claude <a>, Gemini <a>, Perplexity <a>.` | RD-0123: the numbers are average per-answer scores, but sat in the naming row and read as "how often each AI named you" (tartine: "Perplexity 0" although Perplexity named the domain). |
| 2 | "Answers that described a different person or business..." row | Lead + up to 3 quotes of up to 25 words + closing sentences; over 1000 characters the report cut it mid-sentence ("... This row is for") | Same text, but the quotes are shortened to 15 words, then reduced to 2, 1, 0 quotes until the whole note fits; the lead and the closing sentences are never cut | RD-0122 (resend, drveit, ugmonk). |

No other customer-facing text changes. Not customer-facing but worth knowing: the accuracy judge now
receives the site's self-description one labelled field per line ("Title: ...", "Main heading: ...",
cut fields end with "..."), and a page in a charset we cannot read is treated as "could not read a
clear description" (existing fail-closed note) instead of being judged on garbled text (RD-0103).

## Part B — proposal for Stage 1 (evidence instead of verdicts; not implemented)

Direction from the orchestrator: show what the AI said next to what the site says, and phrase counts as
what answers said, not as our conclusion. `<...>` are filled in by code; quotes are the AI's own words
(deterministic excerpt, escaped), site text is the site's own field.

| # | Location | Proposed text |
|---|---|---|
| B1 | Row name | `Answers that said your site belongs to someone else` |
| B2 | Row lead | `<w> of the <m> scored answers said your site belongs to a different person or business. Here is what they said, next to what your site says about itself:` |
| B3 | One example per flagged answer (up to 3) | `<Model> said: "<AI quote>". Your <homepage title / structured data / llms.txt> says: "<site text>".` |
| B4 | Cut-off answers | `<k> more answers were cut off by the AI's length limit after starting to describe someone else; we do not count them as mix-ups.` |
| B5 | Naming row, breakdown | `Of the <m> scored answers, <c> named your site and said what your site says it is, <l> gave your homepage address when asked, <w> said your site belongs to someone else, <u> did not say enough for us to confirm who they meant (for example, they guessed from your domain name), and <d> said they did not know your site.` |
| B6 | Naming row, names sentence | `We count your domain and the name your site gives itself (for example in your homepage title); other names or translations are not counted.` |
| B7 | Executive summary, weak phrase | `in our test questions, AI assistants rarely named your site and said what it is` / `... only some of the time` |
| B8 | Methodology | One paragraph per attribute (answered or guessed; same / someone else / not enough to say; checked facts; homepage address; cut off), each with its evidence rule. |

## Questions

- A1: OK to relabel the average now, ahead of the rest?
- B: is "said your site belongs to someone else" + side-by-side quotes the direction you want? Should
  the site text in B3 be shown even when it is long (cut at ~20 words)?
- Version: this branch changes what the judge reads but keeps the engine label "Citation Visibility
  v5" (a bump changes the version strings on the homepage, methodology and llms.txt). Bump now or with
  Stage 1?
