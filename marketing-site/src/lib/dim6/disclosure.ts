// Slice 3b Dim 6 — disclosure copy SINGLE SOURCE OF TRUTH (locked decision 10).
//
// Every surface that displays Dim 6 disclosure (results page, audit PDF, email,
// methodology page) MUST import these constants. The MCP server gets a MIRROR
// file at mcp-server/src/dim6-disclosure.ts that duplicates these constants
// verbatim — the verification diff in T19 ensures the mirror stays in sync.
//
// The disclosure copy is load-bearing for trust. Don't soften it. Don't
// re-paraphrase per surface. If wording changes here, it changes everywhere
// AND the MCP mirror gets a one-line diff in CI / verification.

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
    "with a generated short-answer prompt set, scores each response for " +
    "whether your domain is correctly cited, and aggregates. Cells that " +
    "couldn't be scored (network failure, safety refusal, quota) are excluded " +
    "from the formula rather than penalized — see methodology for details.",

  // Long — full methodology-page-section copy
  long:
    "Citation Visibility (Dimension 6) is what Cloudflare's Agent Readiness " +
    "Score cannot see — it's the dimension that asks the question every " +
    "AEO buyer actually wants answered: \"What do hosted frontier models " +
    "actually say about my domain?\"\n\n" +
    "Methodology: Astrant generates a short-answer prompt set tuned to " +
    "your domain's category and signals, dispatches each prompt across " +
    "OpenAI GPT-4o, Anthropic Claude, Google Gemini 2.0 Flash, and " +
    "Perplexity Sonar (4 models, ~10 prompts = ~40 cells per audit), " +
    "scores each response for whether the model correctly identifies and " +
    "cites your domain, and aggregates. Each cell costs roughly $0.02 in " +
    "model fees; a full Dim 6 audit costs Astrant about $0.85.\n\n" +
    "Cell states: a cell is unmeasurable (excluded from the score) when " +
    "the network failed, the model refused on safety grounds, the provider " +
    "returned a quota error, or every retry path was exhausted. A cell is " +
    "truncated (included in the score, with a flag) when the response hit " +
    "the max_tokens cap but was otherwise valid. A cell scores 0 (included) " +
    "when the model returned a clean response that simply didn't cite your " +
    "domain.\n\n" +
    "Free-tier scans show a static demo preview only — full Dim 6 audit " +
    "ships with the $79 Audit. The free Score's composite is computed " +
    "across the 5 measured dimensions; Dim 6 is dropped from the formula " +
    "rather than scored against a placeholder.",

  // Free-tier preview shown in results UI
  freeTierPreview:
    "Sample Dim 6 audit: GPT-4o cites your domain in 6/10 prompts, Claude " +
    "in 4/10, Gemini in 2/10, Perplexity in 7/10. Aggregate: 47/100, " +
    "Grade: D+. (This is a static example; the live audit is your domain " +
    "across these 4 models.)",

  // Engine version line — appears in PDFs + methodology page footer
  engineLine: "Dim 6 engine: dim6:v1 (4 models, prompt-set v1)",
} as const;

export type Dim6Disclosure = typeof DIM6_DISCLOSURE;
