# Citation Visibility v6 (accuracy fix): wording for Bruno's approval (2026-11-10)

These texts are on branch `claude/dim6-accuracy-fix-998e7b`, not merged or deployed. Nothing below is live. The logic behind them is in the plan Codex reviewed (8 rounds, no HIGH/MED left), saved in the session notes as `dim6-accuracy-fix-plan.md`.

## Why

The 2026-11-10 release check found the v5 accuracy check calling correct answers "mixed up with a different person or business" on all five sites, counting guesses as matches, garbling Tartine's self-description, giving 0 to correct homepage-URL answers, and counting only the literal domain as "named your site". v6 changes what is counted (see the plan); the wording below follows those changes:

- a mix-up is reported only when the answer says the site belongs to a different person or business AND a second check confirms it; an answer cut off by the AI's length limit is never counted as a confirmed mix-up (it gets its own "possible mix-up" wording);
- everything that is neither a confirmed match nor a confirmed mix-up is "could not be confirmed as describing your site" (was "did not say enough to check"), since it now also covers guesses, unconfirmed mix-ups, cut-off answers and answers giving a street address the site does not state;
- "matched how your site describes itself" becomes "described your site as the same person or business your site says it is" (Codex: "matched" overstated what is checked);
- answers that name the business count as naming the site, so the row is "Models name your site", and the note says which names count;
- a plain correct homepage address, given when asked for it, earns the link points (only those);
- "Average by model" becomes "Average answer score by model (0 to 100)" (RD-0123);
- the executive-summary phrase follows the naming rate, not the dimension score.

`<n>`, `<m>` and the like are numbers filled in by the code. `<Model>` is ChatGPT, Claude, Gemini or Perplexity. Clauses in [brackets] appear only when their count is above 0.

## Report: Citation Visibility table

| # | Location | Old text (v5) | New text (v6) |
|---|---|---|---|
| 1 | Row name | `Models name your domain` | `Models name your site` |
| 2 | "Models name your site" notes, when the answers could be checked | `<n>% of scored test answers named your domain and matched how your site describes itself. Of the <m> scored answers, <c> matched how your site describes itself, <w> described a different person or business than your site says it is, <u> did not say enough to check, [<f> could not be checked (scored 0), ]and <d> did not show that the model knew your site. <m> of <t> test answers could be scored, across 4 AI models. Average by model: ChatGPT <a>, Claude <a>, Gemini <a>, Perplexity <a>.` | `<n>% of scored test answers named your site (by its domain or the name your site gives itself) and described it as the same person or business your site says it is. Of the <m> scored answers, <c> described your site as the same person or business your site says it is, [<l> gave your homepage address when asked for it, ]<w> described a different person or business than your site says it is, [<k> was/were cut off by the AI's length limit, and the part we saw suggested a possible mix-up with a different person or business, ]<u> could not be confirmed as describing your site, [<f> could not be checked (scored 0), ]and <d> did not show that the model knew your site. We count your domain and the name your site gives itself; other brand names, nicknames or translations are not counted. <m> of <t> test answers could be scored, across 4 AI models. Average answer score by model (0 to 100): ChatGPT <a>, Claude <a>, Gemini <a>, Perplexity <a>.` |
| 3 | Same row, fail-closed notes (no description, injected description, too many entities, too large, too deep, invalid JSON) | `... Average by model: ...` | Unchanged except `Average answer score by model (0 to 100): ...` |
| 4 | "Models cite your URL" notes | `<n>% of scored test answers matched how your site describes itself and included at least one link to it.` | `<n>% of scored test answers included a link to your site and either described your site as the same person or business your site says it is, or gave your homepage address when asked for it.` |
| 5 | "Models treat your domain as the principal answer" notes (row name unchanged) | `<n>% of scored test answers matched how your site describes itself and put your domain in the first half of the answer, rather than only mentioning it at the end.` | `<n>% of scored test answers described your site as the same person or business your site says it is and named it (by its domain or its own name) in the first half of the answer, rather than only at the end.` |
| 6 | Mix-up row name, when some answers were cut off | `Answers that described a different person or business than your site says it is` | `Answers that described, or may have described, a different person or business than your site says it is` (unchanged when none was cut off) |
| 7 | Mix-up row notes, lead | `<w> of the <m> scored answers mixed up your site with a different person or business than your site says it is; they count as 0 in the checks above.` | Unchanged. New when only cut-off answers: `None of the <m> scored answers clearly mixed up your site with a different person or business.` |
| 8 | Mix-up row notes, cut-off sentence (new, only when > 0) | (none) | `<k> answers were cut off by the AI's length limit, and the part we saw suggested a possible mix-up with a different person or business; they count as 0 too, and they are not included in that number.` (one: `1 answer was cut off ...; it counts as 0 too, and it is not included in that number.`; with no confirmed mix-up: `... and we do not count them as mix-ups.`) |
| 9 | Mix-up row examples | `Examples of what the AI said: <Model>: "<quote>"; ...` (quote from the first sentence naming the site) | Same form; a quote now starts at the sentence the mix-up was confirmed in, a cut-off answer's quote ends with ` (cut off)`, and quotes are shortened or dropped so the cell is never cut mid-sentence (RD-0122). |
| 10 | Engine line (report notes, methodology footer) | `Astrant Citation Visibility v5 (4 AI models)` | `Astrant Citation Visibility v6 (4 AI models)` |

Example (replayed 2026-11-08 rachelqueiroz run, recorded judge outputs): see `datasets/report-defects/replay/README.md` for the per-site numbers.

## Report: executive summary

| # | Location | Old text | New text |
|---|---|---|---|
| 11 | Weakest areas, Citation Visibility, naming rate below 40% | `in our test questions, AI assistants rarely named your site` (chosen from the dimension score) | `in our test questions, AI assistants rarely named your site and described it correctly` (chosen from the "Models name your site" rate) |
| 12 | Same, naming rate 40–69% | `in our test questions, AI assistants named your site only some of the time` | `in our test questions, AI assistants named your site and described it correctly only some of the time` |
| 13 | Same, naming rate 70% or more but the dimension is weak (links, placement) | (row 11 or 12, by dimension score) | `Citation Visibility needs work` (the existing neutral fallback) |
| 14 | "Strong" phrase (not used in the weak list today) | `in our test questions, AI assistants usually named your site` | `in our test questions, AI assistants usually named your site and described it correctly` |

## Website

| # | Location | Old text | New text |
|---|---|---|---|
| 15 | /score/methodology, citation_domain_named_rate | `(weight 40) — what fraction of scored test answers named your domain and matched how your site describes itself. Each answer that says it knows your site is compared with how your site describes itself (your llms.txt file, structured data, and homepage title and description). We check only who the site is and what kind of business it is, against your site's own description; details such as prices and dates are not checked. An answer that describes your site as a different person or business, says too little to check, or cannot be checked scores 0. If your site has no clear description we can read, those answers cannot be checked and score 0, and the report says so.` | `(weight 40) — what fraction of scored test answers named your site (by its domain or the name your site gives itself) and described it as the same person or business your site says it is. Each answer that says it knows your site is compared with how your site describes itself (your llms.txt file, structured data, and homepage title, description and main heading). We check only who the site belongs to and what field of business it is in, against your site's own description; products, prices, dates and other details are not checked. If your structured data states street addresses, an answer counts only if every street address it gives is one we could extract from your structured data or your homepage text. An answer is counted as a mix-up only when it says your site belongs to a different person or business and a second check confirms it; an answer that was cut off before the end is never counted as a match or as a confirmed mix-up. Answers that guess, say too little, or cannot be confirmed score 0, as do answers that cannot be checked. If your site has no clear description we can read, those answers cannot be checked and score 0, and the report says so.` |
| 16 | /score/methodology, citation_url_referenced_rate | `(weight 30) — what fraction included an actual URL on your host (not just the brand name).` | `(weight 30) — what fraction included an actual URL on your host (not just the brand name), among answers that described your site correctly, plus plain answers that gave your homepage address when asked for it.` |
| 17 | /score/methodology, citation_context_relevant_rate | `(weight 20) — what fraction positioned your domain in the first half of the response (vs a footer-style mention).` | `(weight 20) — what fraction named your site (by its domain or its own name) in the first half of the response (vs a footer-style mention), among answers that described your site correctly.` |
| 18 | /score/methodology, citation_misidentified_answers | `(not weighted) — shown only when at least one answer described a different person or business than your site says it is, with up to three short quotes from those answers. ...` | `(not weighted) — shown only when at least one answer described, or (for an answer that was cut off) may have described, a different person or business than your site says it is, with up to three short quotes from those answers. ...` |
| 19 | /methodology/calibration version line, /llms.txt engine line | `Astrant Citation Visibility v5 · ... v5 added a check that each answer matches how the site describes itself, and neither v4 nor v5 has been re-calibrated` | `Astrant Citation Visibility v6 · ... v5 added a check that each answer matches how the site describes itself, v6 made that check stricter about what counts as a match or a mix-up, and none of v4 to v6 has been re-calibrated` |
| 20 | /methodology/calibration meta description, homepage "MEASUREMENT LAYER" box | `Astrant Citation Visibility v5` | `Astrant Citation Visibility v6` |

Not changed: the score-comparability notice ("... Citation Visibility v5 (Nov 8, 2026) measure more strictly ...") names the historical release that made the measurement stricter; it stays as is.

## Questions for you

- Row 2: "could not be confirmed as describing your site" now covers guesses, non-answers, unconfirmed mix-ups, cut-off answers and answers with an address your site does not state. Plain enough, or should guesses get their own count?
- Row 2: the names sentence ("We count your domain and the name your site gives itself; ...") makes the note longer. Keep it here, or move it to the methodology page only?
- Row 13: when the site is named well but the dimension is weak for links or placement, the summary falls back to "Citation Visibility needs work". OK, or do you want a specific phrase (e.g. "AI assistants named your site but rarely linked to it")?
- A plain homepage URL given when asked earns 33 of 100 for that answer (link points only). OK?
