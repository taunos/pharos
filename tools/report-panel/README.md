# Report panel: the release gate for Audit reports

Code review does not catch bad report output. In November 2026 an evaluation of 8 real sites found 42 defects in the paid Audit report, and many code reviews had missed all of them. So the rule is this: before we ship a change that can alter what a customer reads, we run the change on a fixed panel of real sites and read the reports it produces.

## When it is required

Run the gate for any change to:

- scanner checks or scoring (`scanner/src/checks/`, `scanner/src/run-scan.ts`, version bumps)
- the Audit pipeline (`marketing-site/src/lib/audit-*.ts`, `marketing-site/src/lib/dim6/`)
- remediation (the LLM prompts, the fallbacks, the post-processing)
- the Audit report or Score PDF templates
- any report copy (executive summary, notes, N/A texts, headings)

Merging, deploying, or reopening Audit checkout all wait until the latest panel run has **zero HIGH findings**.

## Steps

From the repo root:

1. **Start the AI proxy.** Keep it running in its own terminal. It uses your `wrangler login`:
   `node tools/report-panel/start-proxy.mjs`
   It runs `wrangler dev` on 127.0.0.1:8799 and never deploys anything.
2. **Run the panel:**
   `node tools/report-panel/run.mjs`
   - Add `--only rachelqueiroz,ugmonk` to run some sites only.
   - Add `--no-pdf` to skip the PDF.
   - Add `--repo <worktree>` to test another checkout.
   The reports are written to `tools/report-panel/out/<site>/`, which is gitignored. Each site gets `report.md`, `report.html`, `report.pdf`, `audit.json`, a `*-SYNTHETIC-DIM6.*` variant, the AI calls and a log.
3. **Lint the reports:**
   `node tools/report-panel/check.mjs`
   It exits non-zero on any FAIL. It catches:
   - placeholders, internal jargon and hallucination markers;
   - outcome promises;
   - ratings advice to sites that have no ratings;
   - checks scored when the panel says they must be N/A;
   - checks scored 0 for things the panel says exist.

   The rules are in `rules.json` and the facts for each site are under `expect` in `sites.json`. Run `npm test` in this folder after you change either one.
4. **Read every report** (`report.md` and the synthetic Dim 6 variant). Read them all; a passing check is not enough. Compare each one against the `expect` notes for its site in `sites.json`.
5. **Codex review.** Give Codex the reports and ask the same questions as in the Gemini file.
6. **Gemini review.** Run `node tools/report-panel/make-gemini-file.mjs`. It writes `out/gemini-review-<date>.md`. Send that file to Bruno, who pastes it into Gemini.
7. **Save the run.** Run it with `--archive <name>` (or use `node datasets/report-defects/archive-run.mjs <out dir> <name>` afterwards), and add every finding from steps 4 to 6 to `datasets/report-defects/defects.jsonl`, false alarms included. See that folder's README.
8. **Triage** the findings from all three reads as HIGH, MED or LOW. Fix every HIGH and run the panel again. Ship only when a run has zero HIGH findings.

## Free Score

The free Score (what every new visitor gets first) has its own run. It needs no AI proxy and costs nothing:

1. `node tools/report-panel/run.mjs --tier free` runs the scanner's free tier for each site and writes `out/free/<site>/`:
   - `score-page.md`: the results page `/score/[id]`, rendered server-side from the real `page.tsx` as a first-time visitor sees it (Next shims for links, images and the Cloudflare context; the Audit checkout closed, as in production). Add `--checkout-open` (with `--out tools/report-panel/out/free-open`) for the open-checkout variant.
   - `score-pdf.md`: the text of the Score PDF HTML (`renderScoreReportHTML`). The PDF itself is not printed.
   - `score-email.md`: the "gap report ready" email, text and HTML parts. It is built, never sent.
   - `scan.json` and `score.json` (the scan, for the expect checks), plus the `.html` of each surface.
2. `node tools/report-panel/check.mjs --out tools/report-panel/out/free` lints the three surfaces. Rules marked `"only": "free"` in `rules.json` run on these files only; rules marked `"only": "paid"` skip them.
3. Read all three files for every site.

## Real Dim 6 (paid)

By default Dim 6 runs with no provider keys, so Citation Visibility comes out N/A. The synthetic variant shows the Dim 6 remediation text instead.

To measure Dim 6 for real:

1. Set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY` and `PERPLEXITY_API_KEY` in the shell session only. Never put them in a file.
2. Add `--dim6 env` to the run. Add `--no-synthetic-dim6` too, since the synthetic variant isn't needed.
3. Run one site first and check the provider dashboards before running the rest.
4. Remove the keys from the session when you're done.

## Costs

| Run | Cost |
|---|---|
| Full panel without real Dim 6 | about $0.03 of Workers AI (in practice inside the 10,000-neuron daily free allowance) |
| Real Dim 6 | about $0.16 per site typical, $0.65 per site worst case (4 providers × 10 questions) |
| Full 10-site panel with real Dim 6 | about $1.60 typical |

The run prints its Workers AI tally. It cannot see provider spend; check that on each provider's dashboard.

## What differs from production (say so when reporting)

- Paid Dim 5 rendering uses local headless Chrome `--dump-dom` in place of Cloudflare Browser Rendering.
- The PDF is printed with local Chrome.
- D1, KV and R2 are in-memory stubs, so there are no caches or budget counters.
- The Dim 6 question-set database is absent, so production's fail-open path runs.
- No email is sent.

## What it cannot catch

- **Variable remediation text.** The same inputs can give different wording on the next run. A clean run means only that this run was clean, so compare runs by problem class, not by exact text.
- **Live sites change.** If a report looks wrong, re-check the site before blaming the code, and keep `expect` in `sites.json` current.
- **Only listed problems.** The lint catches known patterns. A new kind of wrong advice gets through until someone reads it.
- **The panel's coverage.** It covers 10 sites: local businesses, two pt-BR sites, a German € shop, a nonprofit, e-commerce, an agency and SaaS with and without an API. A business type missing from the list is untested.
- **Production rendering, timing and email delivery.** See the differences above.

## Safety

- `ai-proxy/` is local-only and unauthenticated. **Never deploy it.** If it were deployed by mistake it still could not be used:
  - it has `workers_dev: false` and no routes;
  - it rejects any request whose Host is not localhost or 127.0.0.1.
- Never commit anything under `out/`. The reports contain third-party site content and AI prompts.
