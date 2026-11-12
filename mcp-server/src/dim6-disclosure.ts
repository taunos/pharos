// MIRROR FILE — DO NOT EDIT INDEPENDENTLY.
//
// Single source of truth: F:/pharos/marketing-site/src/lib/dim6/disclosure.ts
//
// Per Slice 3b locked decision 10: disclosure copy must stay byte-equal
// across all 4 surfaces (results page, audit PDF, email, methodology page +
// MCP server). The other 3 surfaces import the constants directly from the
// SOT module on marketing-site. The MCP server lives in a separate package
// (separate Worker, separate node_modules), so it gets a MIRROR copy here.
//
// Verification (run before deploy + as part of CI):
//
//   node -e "
//     const a = require('../marketing-site/src/lib/dim6/disclosure.ts');
//     const b = require('./src/dim6-disclosure.ts');
//     if (JSON.stringify(a.DIM6_DISCLOSURE) !== JSON.stringify(b.DIM6_DISCLOSURE)) {
//       console.error('MIRROR DIVERGENCE'); process.exit(1);
//     }
//   "
//
// (TypeScript-aware variant: see the cross-shell diff helper in DEPLOY.md.)

export const DIM6_DISCLOSURE = {
  // Short banner — fits in a results-page sub-section header
  short:
    "Dim 6 (Citation Visibility) measures what hosted models actually say " +
    "about your domain. Free-tier shows a static demo preview only. The full " +
    "live audit ships with the $79 Audit.",

  // Mid-length — for the audit PDF intro and the methodology page section header
  medium:
    "Citation Visibility is the only AEO dimension that asks the actual " +
    "frontier models what they say when prompted about your domain. Astrant " +
    "queries OpenAI GPT-4o, Anthropic Claude, Google Gemini, and Perplexity " +
    "with a generated short-answer prompt set, checks each answer against " +
    "your site's own text, scores the answers we could check for whether " +
    "your domain is named and cited, and averages them. Answers that didn't " +
    "come back (network failure, safety refusal, quota) and answers we could " +
    "not check against your site's text are left out of the score rather " +
    "than penalized — see methodology for details. " +
    "Perplexity's answers come from a live web search; GPT-4o, Claude and " +
    "Gemini are queried without web search, so their answers reflect what " +
    "each model already knows about your brand (brand recall), not live " +
    "search results.",

  // Long — full methodology-page-section copy
  long:
    "Citation Visibility (Dimension 6) is what Cloudflare's Agent Readiness " +
    "Score cannot see — it's the dimension that asks the question every " +
    "AEO buyer actually wants answered: \"What do hosted frontier models " +
    "actually say about my domain?\"\n\n" +
    "Methodology: Astrant generates a short-answer prompt set about your " +
    "domain (direct questions such as \"What does {domain} do?\"), " +
    "dispatches each prompt across OpenAI GPT-4o, Anthropic Claude, Google " +
    "Gemini 2.5 Flash, and Perplexity Sonar (4 models, ~10 prompts = ~40 " +
    "cells per audit), checks each answer against your site's own text " +
    "(your llms.txt file, structured data, and homepage title, description " +
    "and main heading), scores the answers we could check for whether they " +
    "name and link your site, and averages them. Perplexity's answers come " +
    "from a live web search; GPT-4o, Claude and Gemini are queried without " +
    "web search, so their answers reflect what each model already knows " +
    "about your brand (brand recall), not live search results. Each cell " +
    "costs roughly $0.02 in " +
    "model fees; a full Dim 6 audit costs Astrant about $0.85.\n\n" +
    "Cell states: a cell is unmeasurable (left out of the score) when " +
    "the network failed, the model refused on safety grounds, the provider " +
    "returned a quota error, or every retry path was exhausted. A cell is " +
    "not checkable (also left out of the score, and counted on its own line " +
    "in the report) when the answer did not give enough evidence to check " +
    "against your site's text, was cut off before the part we would check, " +
    "or one of our checks failed. A cell scores 0 (included) when the answer " +
    "did not show that the model knew your site, linked your site to a " +
    "different person or business, said something your site's text " +
    "contradicts, or said it knew your site when your site has no " +
    "description we can use. A cell is truncated (included, with a flag) when the " +
    "response hit the max_tokens cap and the part we checked was complete." +
    "\n\n" +
    "Grading: Citation Visibility is graded only when at least 24 of the " +
    "40 test answers could be checked, with at least 5 from each of the 4 " +
    "AI models. Below that, the report shows the counts and the reason " +
    "instead of a grade, and Citation Visibility is not counted in the " +
    "overall score.\n\n" +
    "Free-tier scans show a static demo preview only — full Dim 6 audit " +
    "ships with the $79 Audit. The free Score's composite is computed " +
    "across the 5 measured dimensions; Dim 6 is dropped from the formula " +
    "rather than scored against a placeholder.",

  // Free-tier preview shown in results UI
  freeTierPreview:
    "Not measured in the free Score. The $79 Audit asks four AI models " +
    "(OpenAI GPT-4o, Anthropic Claude, Google Gemini and Perplexity Sonar) " +
    "about 10 questions each about your domain and checks whether each " +
    "answer names and cites it. This dimension is not counted in your free " +
    "score.",

  // Engine version line — appears in PDFs + methodology page footer
  engineLine: "Dim 6 engine: dim6:v3 (4 models, prompt-set v3)",
} as const;

export type Dim6Disclosure = typeof DIM6_DISCLOSURE;
