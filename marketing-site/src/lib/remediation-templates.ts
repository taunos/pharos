// Paid Audit remediation: fixed templates, no model call (engine v6,
// 2026-11-07). Llama 3.1 8B wrote these paragraphs before and produced most of
// the false advice in the 8-site evaluation (llms.txt read as a "Learning
// Management System", "existing JSON-LD" on sites with none, "add more links"
// to a 180-link file, one effort estimate for everything, leaked "[site
// value]" placeholders).
//
// ALL customer-facing remediation text lives in this file so it can be
// reviewed in one place. Rules every template follows:
//   - plain English, 2-4 short sentences plus a fixed effort estimate that
//     ends the paragraph as "Estimated effort: <duration>." (corpus-write.ts
//     reads it back with that pattern; the duration has no full stop);
//   - says WHAT to change on WHICH artifact, in the artifact's own terms;
//   - no promised outcome ("can help", never "will");
//   - never asks for invented content (ratings, prices, questions, tools);
//   - slots carry only values we measured ourselves: counts, scores, the
//     audited origin / host, fixed paths, and URLs on the audited host.
//     No free text copied from the site ever reaches a template.
//
// The state of each check is read from the scanner's own note templates
// (scanner/src/checks/*) by code below, never by a model. A note this code
// doesn't recognize falls back to the check's general template, or to the
// neutral UNKNOWN_CHECK_REMEDIATION where a specific template could
// contradict the note (r4: a wrong specific state is worse than a neutral one).

import type { SubCheck } from "./audit-types";

export type RemediationContext = {
  /** Audited origin, e.g. "https://example.com". */
  origin: string;
  /** Audited host, e.g. "example.com". */
  host: string;
  /** All sub-checks of the same dimension (for "depends on Presence" etc.). */
  siblings: SubCheck[];
};

// ─── Template text ────────────────────────────────────────────────────────

/** Dim 6 (Citation Visibility): fixed text, approved in round 1. */
export const DIM6_REMEDIATION: Record<string, string> = {
  citation_domain_named_rate:
    "You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting to change here. What can help these models name your business is clear content on your own site that says who you are, what you do and who you serve, using your business name and domain; Organization or LocalBusiness structured data on your homepage; the same business name, address and description everywhere you are listed; and mentions on independent sources these models read, such as directories, press coverage, industry lists and reviews on third-party platforms. Estimated effort: 4+ hours.",
  citation_url_referenced_rate:
    "You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, so there is no setting that makes them link to your site. What can help is having pages worth citing: one clear page for each thing you offer, each at a single stable address with a canonical URL, that answers the question in plain text near the top. Links to those pages from independent sources, such as directories, press coverage and industry lists, can also help, because these models draw on what other sites say. Estimated effort: 2 to 4 hours.",
  citation_context_relevant_rate:
    "You cannot edit ChatGPT, Claude, Gemini or Perplexity directly. What can help them present your business as a main answer rather than a passing mention is stating plainly, near the top of your homepage and key pages, who you are, what you do and who you serve, with your business name and domain; structured data (such as Organization or LocalBusiness) that says the same thing; and the same description of your business on the third-party sites that list you. Estimated effort: 2 to 4 hours.",
  citation_no_competitor_first_rate:
    "You cannot edit ChatGPT, Claude, Gemini or Perplexity directly, and you cannot remove competitors from their answers. What can help your business appear earlier is being clearly described for the questions people ask: content on your site that says what you do and who you serve in the words your customers use, the same business name, address and description everywhere you are listed, and mentions on independent sources these models read, such as directories, industry lists, press coverage and reviews on third-party platforms. Estimated effort: 4+ hours.",
};

const MCP_CARD_PATHS = ["/.well-known/mcp.json", "/.well-known/mcp/server-card.json"] as const;

/** Shown for a check id this module has no template for. */
export const UNKNOWN_CHECK_REMEDIATION =
  "This check did not pass; the Finding line above shows what we measured, and the methodology page at astrant.io/methodology explains what the check looks for. Estimated effort: not estimated for this check.";

// Shared close of the review_schema templates.
const RATINGS_TAIL =
  "Only add ratings markup for real ratings, never invented values; Google also ignores ratings a business publishes about itself in its own Organization or LocalBusiness markup.";

// Templates per check id and state. Each is a function of the context plus
// the measured values its state parsed. `general` is used when the note
// doesn't match a known state.
export const T = {
  // ── Dim 1: llms.txt Quality ───────────────────────────────────────────
  presence: {
    missing: (o: string) =>
      `Create a file at ${o}/llms.txt. Per the llmstxt.org proposal it is a plain Markdown file: an H1 line with your business or site name, a one-paragraph summary as a blockquote (a line starting with >), then short lists of links to your most important pages. Serve it as text/plain or text/markdown. Estimated effort: 1 to 2 hours.`,
    wrongType: (o: string) =>
      `${o}/llms.txt exists, but your server does not send it as text. Set its Content-Type to text/plain or text/markdown (with charset=utf-8) in your server or hosting settings. Estimated effort: under 30 minutes.`,
  },
  spec_compliance: {
    fileMissing: (o: string) =>
      `Depends on Presence: there is no ${o}/llms.txt yet. When you create it, start it with an H1 line (# followed by your business or site name), then a one-paragraph summary written as a Markdown blockquote (a line starting with >). Estimated effort: under 30 minutes.`,
    both: (o: string) =>
      `Start ${o}/llms.txt with an H1 line (# followed by your business or site name), then a one-paragraph summary written as a Markdown blockquote (a line starting with >). The llmstxt.org format expects both at the top of the file. Estimated effort: under 30 minutes.`,
    noH1: (o: string) =>
      `Add an H1 line at the top of ${o}/llms.txt: # followed by your business or site name. The llmstxt.org format expects one H1, before everything else. Estimated effort: under 30 minutes.`,
    noBlockquote: (o: string) =>
      `Add a one-paragraph summary directly under the H1 in ${o}/llms.txt, written as a Markdown blockquote (the line starts with >). Say plainly what your business does and who it serves. Estimated effort: under 30 minutes.`,
  },
  linked_pages_quality: {
    fileMissing: (o: string) =>
      `Depends on Presence: there is no ${o}/llms.txt yet. When you create it, list your key pages as Markdown links on list lines (- [Page name](${o}/page)); this check then opens a sample of them. Estimated effort: under 30 minutes.`,
    noLinks: (o: string) =>
      `We found no links in ${o}/llms.txt in the form this check reads: Markdown links on list lines, such as - [Page name](${o}/page). If your file links to pages another way, add a list of your key pages in that form. Estimated effort: 30 minutes to 1 hour.`,
    sampled: (o: string, good: number, sampled: number) =>
      `${good} of the ${sampled} links we sampled from ${o}/llms.txt returned Markdown or plain text; the others returned HTML or an error. If your platform can publish a clean Markdown version of each linked page (the llmstxt.org proposal suggests the page address with .md added), point the links at those versions. If it can't, the links still work as normal web pages and this check can stay below passing. Estimated effort: 2 to 8 hours, depending on your platform.`,
  },
  curation_quality: {
    fileMissing: (o: string) =>
      `Depends on Presence: there is no ${o}/llms.txt yet. When you create it, keep the link list short and hand-picked: your main pages, not every URL on the site. Estimated effort: under 30 minutes.`,
    noLinks: (o: string) =>
      `We found no links in ${o}/llms.txt in the form this check reads (Markdown links on list lines, such as - [Page name](${o}/page)), so there was no list to judge. Add a short, hand-picked list of your key pages in that form. Estimated effort: 30 minutes to 1 hour.`,
    antipatterns: (o: string, fixes: string) =>
      `Edit the link list in ${o}/llms.txt: ${fixes}. llms.txt works best as a short, curated guide to your key pages rather than a full sitemap. Estimated effort: 30 minutes to 1 hour.`,
    // Fix phrases joined into `antipatterns` (one per problem the scanner found).
    fixTooMany: (n: number) => `cut it from ${n} links to the pages that matter most`,
    fixTag: "remove links to tag pages (/tag/)",
    fixArchive: "remove links to archive pages (/archive/)",
    fixSearch: "remove links to search-result pages",
    fixQuery: "remove query strings (the part after ?) from the links",
  },
  blockquote_eval: {
    fileMissing: (o: string) =>
      `Depends on Presence: there is no ${o}/llms.txt yet. When you create it, put a one-paragraph summary under the H1 as a Markdown blockquote (a line starting with >), saying what your business does and who it serves. Estimated effort: under 30 minutes.`,
    none: (o: string) =>
      `There is no blockquote summary in ${o}/llms.txt to rate. Add one directly under the H1: a single paragraph on one line starting with >, saying what your business does and who it serves. Estimated effort: under 30 minutes.`,
    instructionLike: (o: string) =>
      `The blockquote summary in ${o}/llms.txt contains text that reads like instructions to an AI system, so we scored it 0 without rating it. Rewrite it as a plain description of your business: what you do, who you serve and where. Estimated effort: under 30 minutes.`,
    empty: (o: string) =>
      `The blockquote in ${o}/llms.txt had no readable text once formatting and hidden characters were removed. Write the summary as plain sentences on one line starting with >. Estimated effort: under 30 minutes.`,
    // 1.5.0: fixed rules; `fixes` joins one phrase per rule the note says failed.
    rules: (o: string, fixes: string) =>
      `Edit the blockquote summary in ${o}/llms.txt: ${fixes}. This check scores three fixed rules: one paragraph, 50 to 250 words, and your business name in the text. Estimated effort: under 30 minutes.`,
    fixParagraph: "make it a single paragraph (a > line with no text starts a new one)",
    fixLength: (words: number) => `make it 50 to 250 words long (it has ${words} now)`,
    fixName: "name your business in it, as your llms.txt H1 or your domain names it",
  },

  // ── Dim 2: MCP Server Discoverability ─────────────────────────────────
  well_known: {
    noCard: (o: string) =>
      `We found no MCP discovery card at ${o}/.well-known/mcp.json or ${o}/.well-known/mcp/server-card.json. If you run an MCP server, publish a JSON card at one of those addresses with the server's name and a transports list giving its URL (server cards are still a draft proposal, so the format may change). If you don't run one, building an MCP server is a development project, worth it only if you have tools or data you want AI agents to use, such as booking, ordering or account lookups. Estimated effort: 30 minutes to 1 hour for the card; several days to build a new MCP server.`,
    missingFields: (o: string, path: string) =>
      `We found a discovery card at ${o}${path} but not both a name field and a non-empty transports list in it. Add "name" and a "transports" array whose entries give the server URL. If your card follows a different layout (server cards are still a draft proposal), you can keep it and add these two fields as well. Estimated effort: under 30 minutes.`,
    invalidJson: (o: string, path: string) =>
      `The discovery card at ${o}${path} is not valid JSON. Fix the syntax (any JSON validator shows where it breaks) and serve the file with Content-Type application/json. Estimated effort: under 30 minutes.`,
  },
  tool_coverage: {
    noCard:
      "Depends on Well-known discovery: there is no discovery card to read tools from. If you publish a card, list each tool your MCP server offers in its tools array, with a name, a plain-language description and an inputSchema. Estimated effort: 30 minutes to 1 hour.",
    noToolsField:
      "Your discovery card has no tools array. If your server's tools can be listed publicly, add a tools array with each tool's name, a plain-language description and an inputSchema (a JSON Schema for its inputs). If you'd rather agents see tools only after connecting, this check can stay below passing. Estimated effort: 30 minutes to 1 hour.",
    counts: (qualified: number, total: number) =>
      `${qualified} of the ${total} tools in your discovery card have both a description and an inputSchema field (the field names this check reads). It passes when 3 or more tools have a description, and scores full marks when they also have an inputSchema. Add a plain-language description and an inputSchema to each tool that lacks one. If your server has fewer than 3 tools, describe the ones it has; don't list tools it doesn't offer. Estimated effort: 30 minutes to 1 hour.`,
  },
  oauth_metadata: {
    failed: (o: string, state: string) =>
      `Your discovery card declares an authentication method, but ${o}/.well-known/oauth-authorization-server ${state}. If your server uses OAuth, publish authorization server metadata there (RFC 8414) with at least authorization_endpoint and token_endpoint. If your authorization server is on another host, or your server doesn't use OAuth, make the card's authentication entry say so; this check looks only at your own host. Estimated effort: 1 to 4 hours.`,
    stateMissingEndpoints: "is missing authorization_endpoint or token_endpoint",
    stateInvalidJson: "is not valid JSON",
    stateStatus: (status: number) => `returned status ${status}`,
    stateNoResponse: "did not respond",
    stateUnknown: "could not be read",
  },
  live_invocation: {
    noCard:
      "Depends on Well-known discovery: without a discovery card there is no server address for us to call. If you publish a card, include your MCP endpoint URL in its transports list. Estimated effort: under 30 minutes.",
    noTransport:
      "We found no URL in your discovery card's transports list, so we could not call your server. Add your MCP endpoint URL there; if your card already gives it under another field, list it under transports as well. Estimated effort: under 30 minutes.",
    authRequired: (status: number) =>
      `Your MCP endpoint answered our initialize request with status ${status}, which usually means it requires sign-in. That is normal for a server with private data, and this check cannot pass without credentials; make sure your discovery card declares the authentication method so agents know how to connect. Estimated effort: under 30 minutes.`,
    failed: (reason: string) =>
      `We could not complete an MCP initialize and tools/list exchange with the endpoint in your discovery card: ${reason}. Check that the card points to your live MCP endpoint and that it answers JSON-RPC initialize, then tools/list, over Streamable HTTP. Estimated effort: 1 to 4 hours.`,
    reasonTimeout: "the request timed out or failed",
    reasonStatus: (step: "initialize" | "tools/list", status: number) => `${step} returned status ${status}`,
    reasonNoResult: "initialize returned no result",
    reasonNoTools: "tools/list did not return a tools list",
    reasonTooLarge: "the reply was larger than our scan limit",
    reasonUnknown: "the exchange did not complete",
    reasonBadUrl: "the card's transport URL is not a valid web address",
  },
  dns_txt: {
    notFound: (o: string, h: string, weight: number) =>
      `We found no TXT record at _mcp.${h} that mentions MCP. There is no ratified standard for MCP discovery through DNS, so this is optional and has a weight of ${weight}% in this dimension. If you add one, create a TXT record named _mcp.${h} whose value points to your discovery card, for example mcp=${o}/.well-known/mcp.json; this check looks only for a record there whose text mentions MCP. Estimated effort: under 30 minutes.`,
    lookupFailed: (o: string, h: string) =>
      `Our DNS lookup for _mcp.${h} failed on this run, so this result says nothing about your DNS. MCP discovery through DNS has no ratified standard and is optional; if you add a record, a TXT record named _mcp.${h} with a value such as mcp=${o}/.well-known/mcp.json is what this check looks for. Estimated effort: under 30 minutes.`,
  },

  // ── Dim 3: OpenAPI / API Catalog ──────────────────────────────────────
  discovery: {
    homepageLinkOnly: (o: string) =>
      `We found your API description only through a link on your homepage. Also publish it at a standard address: ${o}/.well-known/api-catalog (an RFC 9727 API catalog that links to your OpenAPI file) or ${o}/openapi.json. Estimated effort: 30 minutes to 1 hour.`,
  },
  spec_validity: {
    noParse:
      "The file we found as your API description did not parse as JSON, or as YAML with an openapi or swagger version field. Check that it is the OpenAPI document itself (not an HTML page) and that it is valid JSON or YAML. If the address is an RFC 9727 API catalog, our check may have read the catalog instead of the OpenAPI file it links to, and your spec itself may be fine. Estimated effort: 1 to 2 hours.",
    noVersion:
      'The JSON document we found has no openapi or swagger version field at the top level. If it is your OpenAPI spec, add "openapi" with the 3.x version you follow (for example "3.1.0") at the root. If it is an RFC 9727 API catalog, our check may have read the catalog instead of the OpenAPI file it links to. Estimated effort: under 30 minutes.',
  },
  info_completeness: {
    missingFields: (fields: string) =>
      `Fill in the info block of your OpenAPI document: add ${fields}. Estimated effort: under 30 minutes.`,
    fieldTitle: "info.title",
    fieldVersion: "info.version",
    fieldDescription: "info.description (one or two sentences on what the API does)",
    noInfo:
      "Your OpenAPI document has no info object. Add one with a title, a version and a short description of what the API does; OpenAPI requires info.title and info.version. Estimated effort: under 30 minutes.",
    skipped:
      "This check needs a spec that parses (see Spec validity). Once it does, make sure info.title, info.version and info.description are filled in. Estimated effort: under 30 minutes.",
  },
  security_schemes: {
    none:
      "Your OpenAPI document doesn't say how clients authenticate. If the API needs credentials, describe the method under components.securitySchemes (for example an apiKey, http bearer or oauth2 scheme) and apply it with security. If the API is fully open, add security: [] at the top level to say so. Estimated effort: 30 minutes to 1 hour.",
    skipped:
      "This check needs a spec that parses (see Spec validity). Once it does, describe authentication under components.securitySchemes, or add security: [] if the API is open. Estimated effort: 30 minutes to 1 hour.",
  },
  operation_coverage: {
    undocumented: (missing: number, total: number) =>
      `${missing} of the ${total} operations in your OpenAPI document have no summary or description. Add a one-line summary to each, and a description where the behaviour isn't obvious.`,
    fewOperations:
      " This check also gives less credit to specs with fewer than 5 operations; don't add operations your API doesn't have.",
    allDocumentedFew: (total: number) =>
      `All ${total} operations in your OpenAPI document are documented, but this check gives less credit to specs with fewer than 5 operations. If your API has endpoints the spec doesn't list, add them; don't add operations your API doesn't have.`,
    effort: " Estimated effort: 1 to 4 hours.",
    noOperations:
      "Your OpenAPI document defines no operations under paths. Add each public endpoint of your API under paths, with its method, a summary and its parameters. Estimated effort: 1 to 3 days for an API with no documented endpoints yet.",
    skipped:
      "This check needs a spec that parses (see Spec validity). Once it does, make sure each operation under paths has a summary. Estimated effort: 1 to 4 hours.",
  },

  // ── Dim 4: Structured Capability Data ─────────────────────────────────
  json_ld_present: {
    none:
      "Your homepage has no JSON-LD structured data. Add a script block of type application/ld+json to the homepage that describes your business with schema.org Organization, or a more specific type such as LocalBusiness, ProfessionalService or Store, giving its name, url and description. Use only facts your site already states. Estimated effort: 1 to 2 hours.",
    invalid: (n: number) =>
      `${n} JSON-LD block(s) on your homepage failed to parse as JSON, so they are ignored. Fix the syntax in those blocks; Google's Rich Results Test or the Schema Markup Validator shows where each one breaks. Estimated effort: under 30 minutes.`,
  },
  organization_schema: {
    noneNoJsonLd:
      "Your homepage has no Organization structured data. Add an Organization block (or a more specific type such as LocalBusiness or ProfessionalService) in JSON-LD with your business's name, url and description; it can be the same block suggested under JSON-LD present. Estimated effort: 30 minutes to 1 hour.",
    none:
      "The JSON-LD on your homepage has no Organization block (we also accept subtypes such as LocalBusiness, Store or ProfessionalService). Add one with your business's name, url and description. Estimated effort: 30 minutes to 1 hour.",
    missingFields: (fields: string) =>
      `The Organization block on your homepage is missing ${fields}. Add the missing fields, using the same name and description your site already shows. Links to social profiles (sameAs) are optional; add them only for profiles you really have. Estimated effort: under 30 minutes.`,
  },
  service_offer_schema: {
    none:
      "We found no Service, Product or Offer structured data on your homepage (this check reads the homepage only). If you sell services, add a Service block for each main service with name, description and provider (your Organization); if you sell products, use Product with an Offer, adding a price only if you publish one. If your site doesn't sell anything, this check doesn't fit it and you can leave it. Estimated effort: 1 to 3 hours.",
    partial: (fields: number) =>
      `The best Service, Product or Offer block on your homepage has ${fields} of the 3 fields this check looks for: name, description and a provider (or brand or seller). Add the missing ones; a price is not required. Estimated effort: under 30 minutes.`,
  },
  faq_schema: {
    // 1.5.0: fixed rules; the note gives the pair count and how many met them.
    rules: (missed: number, total: number) =>
      `${missed} of the ${total} Q&A pairs in your FAQPage markup do not meet this check's rules: each Question's name is phrased as a question (for example ending in ?) of 3 to 40 words, and its acceptedAnswer text answers it in 5 to 300 words. Revise those pairs to match the questions and answers shown on the page; don't add questions to raise this score. Estimated effort: 30 minutes to 1 hour.`,
    general:
      "If you revise your FAQPage markup, make each Question in mainEntity a question a customer would ask, with an acceptedAnswer that answers it directly. Mark up only questions and answers that appear on the page. Estimated effort: 30 minutes to 1 hour.",
  },
  // r5: chosen by the validation failure the scanner names (1.4.2 notes);
  // `general` when the note names none or several.
  review_schema: {
    missing: (n: number) =>
      `We found ${n} Review or AggregateRating block(s), but each is missing a field this check needs: an AggregateRating needs a ratingValue and a ratingCount or reviewCount, and a Review needs an author and a reviewRating with a ratingValue. Complete them with the real values shown on your page, or remove the markup. ${RATINGS_TAIL} Estimated effort: 30 minutes to 1 hour.`,
    invalid: (n: number) =>
      `We found ${n} Review or AggregateRating block(s), but their values did not pass our checks: a ratingValue must be a number between worstRating and bestRating (1 to 5 unless the block declares other limits), and a ratingCount or reviewCount must be a whole number above 0. Correct them to the real values shown on your page, or remove the markup. ${RATINGS_TAIL} Estimated effort: under 30 minutes.`,
    general: (n: number) =>
      `We found ${n} Review or AggregateRating block(s), but none passed our checks. An AggregateRating needs a ratingValue between worstRating and bestRating (1 to 5 unless the block declares other limits) and a ratingCount or reviewCount that is a whole number above 0; a Review needs an author and a reviewRating with such a ratingValue. Check each block against the real values shown on your page, or remove the markup. ${RATINGS_TAIL} Estimated effort: 30 minutes to 1 hour.`,
  },

  // ── Dim 5: Agent-Parsable Content ─────────────────────────────────────
  js_vs_no_js_render_diff: {
    lowOverlap: (pct: number) =>
      `About ${pct}% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs. Tools that don't run JavaScript (several AI crawlers among them) see only the HTML your server sends. Render the main content on the server (server-side rendering, pre-rendering or static generation) so the first HTML response contains it; on a website builder, check whether it offers this. Estimated effort: 2 to 5 days on a custom app.`,
    shell:
      "Before JavaScript runs, your homepage's HTML contains almost no text; it looks like an app shell that fills in later. Tools that don't run JavaScript (several AI crawlers among them) see an empty page. Render the main content on the server (server-side rendering, pre-rendering or static generation); on a website builder, check whether it offers this. Estimated effort: 2 to 5 days on a custom app.",
    noSignals:
      "Your homepage HTML has text, but this check didn't find words such as pricing, plans, services or features in it. If your homepage describes what you offer, make sure that text is in the HTML itself rather than loaded later or shown only in images. If your site doesn't sell anything, this check is a weak fit and you can leave it. Estimated effort: 1 to 2 hours.",
  },
  page_weight_lcp: {
    heavy: (mb: string) =>
      `Your homepage's HTML document is ${mb} MB; this check measures the HTML file only (not images or scripts) and passes under 1 MB. Large HTML usually comes from data, scripts or styles written into the page; move them into separate files or trim them. Load time (LCP) was not measured. Estimated effort: 2 to 8 hours.`,
    general:
      "This check measures the size of your homepage's HTML document and passes under 1 MB. Large HTML usually comes from data, scripts or styles written into the page; move them into separate files or trim them. Estimated effort: 2 to 8 hours.",
  },
  markdown_negotiation: {
    noMarkdown: (o: string) =>
      `When we asked your homepage for Markdown (Accept: text/markdown) it returned HTML, and we found no Markdown version at ${o}/index.md. Serving Markdown is an emerging convention, not a standard: if your platform supports it, return a Markdown version of key pages to requests that ask for text/markdown, or publish one at the page address with .md added. Label a response text/markdown only if its body really is Markdown. Estimated effort: 1 to 3 days on a custom site; some hosted platforms can't do this.`,
    noResponse:
      "Your homepage did not answer our requests during this check, so we could not test for Markdown. This may have been temporary; if it keeps happening, check that your server answers requests from automated clients. Estimated effort: under 30 minutes.",
  },
  pricing_text_visibility: {
    notLoading: (where: string) =>
      `The pricing page we found${where} did not load; it returned an error. Fix the page, or update or remove the links that point to it. Estimated effort: under 30 minutes.`,
    noPrices: (where: string) =>
      `We found a pricing page${where} but no prices in its HTML text. If you publish prices, put them in the page text (the amount with its currency, and the billing period if it repeats) rather than only in images, in scripts that load later or behind a form. If you don't publish prices, this check doesn't fit your site. Estimated effort: 30 minutes to 1 hour.`,
    noPeriod: (n: number, where: string) =>
      `We found ${n} price(s) on your pricing page${where}, but none followed by a billing period such as "/month" or "per year". If your prices are recurring, write the period next to each amount. If they are one-time prices, no change is needed; this check is designed for subscription pricing. Estimated effort: under 30 minutes.`,
    inModal: (where: string) =>
      `Prices on your pricing page${where} appear inside markup that looks like a popup or gated area. Show the main prices in the page text itself, not only in a popup, behind a login or after a form. Estimated effort: 1 to 2 hours.`,
    // `where` slot: " (<url>)" for a URL on the audited host, else "".
    where: (url: string) => ` (${url})`,
  },
  case_study_scannability: {
    notLoading:
      "The case-study pages we found did not load; they returned errors. If they are real case studies, fix them or update the links that point to them; if they aren't case studies, this check doesn't apply and you can ignore it. Estimated effort: under 30 minutes.",
    sampled: (pages: number, missing: string) =>
      `On the ${pages} case-study page(s) we sampled, we found ${missing}. If you edit them, give each story a few clear subheadings (for example the client, the problem, what you did and the result) and put the key facts, only ones the client has agreed to share, in a short list. If the pages we sampled aren't case studies, this check doesn't apply and you can ignore it. Estimated effort: 1 to 2 hours per page.`,
    missingHeadings: "fewer than three subheadings (h2 or h3)",
    missingLists: "no bulleted or numbered list",
    missingBold: "no bold text",
    general:
      "If you edit your case-study pages, give each story a few clear subheadings (for example the client, the problem, what you did and the result) and put the key facts in a short list. Use only facts the client has agreed to share. Estimated effort: 1 to 2 hours per page.",
  },
} as const;

// ─── State selection (code-parsed scanner notes, never a model) ─────────

const int = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? n : null;
};

function sibling(ctx: RemediationContext, id: string): SubCheck | undefined {
  return ctx.siblings.find((s) => s.id === id);
}

// llms.txt fetched? (Dim 1 presence scored 0 means no file / fetch failed.)
function llmsFileMissing(ctx: RemediationContext): boolean {
  const p = sibling(ctx, "presence");
  return p !== undefined && p.score === 0;
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function cardPath(notes: string): string | null {
  for (const p of MCP_CARD_PATHS) if (notes.includes(`at ${p}`)) return p;
  return null;
}

// Hostnames are compared without one leading "www.".
const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

// A URL from a scanner note, kept only when it is on the audited host and
// made of plain URL characters; anything else is dropped (no slot).
function auditedHostUrl(raw: string | undefined, ctx: RemediationContext): string | null {
  if (!raw || raw.length > 200) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (bareHost(u.hostname) !== bareHost(ctx.host)) return null;
  if (u.search || u.hash || u.username || u.password) return null;
  if (!/^[A-Za-z0-9._~\/-]{0,100}$/.test(u.pathname)) return null;
  return `${u.origin}${u.pathname}`;
}

function dnsHost(notes: string, ctx: RemediationContext): string {
  const m = notes.match(/_mcp\.([a-z0-9.-]{1,253})/i);
  const h = m?.[1]?.replace(/\.$/, "");
  return h && bareHost(h) === bareHost(ctx.host) ? h.toLowerCase() : ctx.host;
}

type Selector = (sub: SubCheck, ctx: RemediationContext) => string;

const SELECTORS: Record<string, Selector> = {
  // r6: every selector below picks a specific template only for a note that
  // proves the state; any other note gets UNKNOWN_CHECK_REMEDIATION.
  presence: (s, c) => {
    if (/^status=200, content-type=/.test(s.notes)) return T.presence.wrongType(c.origin);
    if (/^fetch failed$|^status=\d{3}$/.test(s.notes)) return T.presence.missing(c.origin);
    return UNKNOWN_CHECK_REMEDIATION;
  },

  spec_compliance: (s, c) => {
    if (llmsFileMissing(c)) return T.spec_compliance.fileMissing(c.origin);
    const m = s.notes.match(/^h1=(yes|no), blockquote=(yes|no)$/);
    if (!m) return UNKNOWN_CHECK_REMEDIATION;
    const h1 = m[1] === "yes";
    const bq = m[2] === "yes";
    if (!h1 && bq) return T.spec_compliance.noH1(c.origin);
    if (h1 && !bq) return T.spec_compliance.noBlockquote(c.origin);
    if (!h1 && !bq) return T.spec_compliance.both(c.origin);
    return UNKNOWN_CHECK_REMEDIATION;
  },

  linked_pages_quality: (s, c) => {
    if (llmsFileMissing(c)) return T.linked_pages_quality.fileMissing(c.origin);
    const m = s.notes.match(/^(\d+)\/(\d+) sampled links/);
    const good = int(m?.[1]);
    const n = int(m?.[2]);
    if (good !== null && n !== null && n > 0 && good <= n) return T.linked_pages_quality.sampled(c.origin, good, n);
    if (/^no links to sample$/.test(s.notes)) return T.linked_pages_quality.noLinks(c.origin);
    return UNKNOWN_CHECK_REMEDIATION;
  },

  curation_quality: (s, c) => {
    if (llmsFileMissing(c) || /^file missing/.test(s.notes)) return T.curation_quality.fileMissing(c.origin);
    if (/^empty file|^the file has no Markdown links/.test(s.notes)) return T.curation_quality.noLinks(c.origin);
    const fixes: string[] = [];
    const many = int(s.notes.match(/(\d+) links \(>100\)/)?.[1]);
    if (many !== null) fixes.push(T.curation_quality.fixTooMany(many));
    if (/tag pages linked/.test(s.notes)) fixes.push(T.curation_quality.fixTag);
    if (/archive pages linked/.test(s.notes)) fixes.push(T.curation_quality.fixArchive);
    if (/search-result URLs linked/.test(s.notes)) fixes.push(T.curation_quality.fixSearch);
    if (/links contain query strings/.test(s.notes)) fixes.push(T.curation_quality.fixQuery);
    if (fixes.length === 0) return UNKNOWN_CHECK_REMEDIATION;
    return T.curation_quality.antipatterns(c.origin, joinWithAnd(fixes));
  },

  blockquote_eval: (s, c) => {
    if (llmsFileMissing(c)) return T.blockquote_eval.fileMissing(c.origin);
    const B = T.blockquote_eval;
    if (/^blockquote contains instruction-like text/.test(s.notes)) return B.instructionLike(c.origin);
    if (/^blockquote empty after cleaning$/.test(s.notes)) return B.empty(c.origin);
    if (/^no blockquote to evaluate$/.test(s.notes)) return B.none(c.origin);
    const m = s.notes.match(/^\d of 3 blockquote rules met: one paragraph \((yes|no)\); 50 to 250 words \((yes|no), (\d+) words\); names the business \((yes|no)\)\.$/);
    if (!m) return UNKNOWN_CHECK_REMEDIATION;
    const fixes: string[] = [];
    if (m[1] === "no") fixes.push(B.fixParagraph);
    const words = int(m[3]);
    if (m[2] === "no" && words !== null) fixes.push(B.fixLength(words));
    if (m[4] === "no") fixes.push(B.fixName);
    return fixes.length > 0 ? B.rules(c.origin, joinWithAnd(fixes)) : UNKNOWN_CHECK_REMEDIATION;
  },

  well_known: (s, c) => {
    const path = cardPath(s.notes);
    if (path && /invalid JSON/.test(s.notes)) return T.well_known.invalidJson(c.origin, path);
    // "missing name or transports" (before 1.4.0); "missing a server name and
    // a transport URL ..." (1.4.0).
    if (path && /^card present at \S+ but missing /.test(s.notes)) return T.well_known.missingFields(c.origin, path);
    if (/^no card at /.test(s.notes)) return T.well_known.noCard(c.origin);
    return UNKNOWN_CHECK_REMEDIATION;
  },

  tool_coverage: (s) => {
    // "<q> of <n> tools have ..." (before 1.4.0); "<n> tool(s) declared: <d>
    // with a description, <k> with an input schema (inputSchema); <q> have
    // both" (1.4.0).
    const old = s.notes.match(/^(\d+) of (\d+) tools have/);
    const cur = s.notes.match(/^(\d+) tool\(s\) declared: .*; (\d+) have both$/);
    const q = int(old?.[1] ?? cur?.[2]);
    const n = int(old?.[2] ?? cur?.[1]);
    if (q !== null && n !== null && n > 0 && q <= n) return T.tool_coverage.counts(q, n);
    if (/no tools\[\] field/.test(s.notes)) return T.tool_coverage.noToolsField;
    if (/^no card or no tools declared$/.test(s.notes)) return T.tool_coverage.noCard;
    return UNKNOWN_CHECK_REMEDIATION;
  },

  oauth_metadata: (s, c) => {
    const O = T.oauth_metadata;
    let state: string = O.stateUnknown;
    if (/missing required endpoints/.test(s.notes)) state = O.stateMissingEndpoints;
    else if (/invalid JSON/.test(s.notes)) state = O.stateInvalidJson;
    else if (/returned no response/.test(s.notes)) state = O.stateNoResponse;
    else {
      const st = int(s.notes.match(/oauth-authorization-server returned (\d{3})\b/)?.[1]);
      if (st !== null) state = O.stateStatus(st);
    }
    return O.failed(c.origin, state);
  },

  live_invocation: (s, c) => {
    const L = T.live_invocation;
    const n = s.notes;
    const wk = sibling(c, "well_known");
    // 1.4.0: no card, and no declared or guessed endpoint answered.
    if (/^no MCP endpoint answered/.test(n)) return L.noCard;
    if (/^no usable transport URL in card/.test(n)) return L.failed(L.reasonBadUrl);
    if (/^no transport URL/.test(n)) {
      return wk && wk.score === 0 ? L.noCard : L.noTransport;
    }
    // The failure templates speak of "the endpoint in your discovery card":
    // without a card (an endpoint found another way) stay neutral.
    if (wk && wk.score === 0) return UNKNOWN_CHECK_REMEDIATION;
    const initStatus = int(n.match(/^initialize returned status (\d{3})\b/)?.[1]);
    if (initStatus === 401 || initStatus === 403) return L.authRequired(initStatus);
    let reason: string = L.reasonUnknown;
    if (/timed out or failed/.test(n)) reason = L.reasonTimeout;
    else if (/exceeded the scan limit/.test(n)) reason = L.reasonTooLarge;
    else if (initStatus !== null) reason = L.reasonStatus("initialize", initStatus);
    else if (/no result in body/.test(n)) reason = L.reasonNoResult;
    else {
      const listStatus = int(n.match(/^tools\/list returned status (\d{3})\b/)?.[1]);
      if (listStatus !== null) reason = L.reasonStatus("tools/list", listStatus);
      else if (/^tools\/list returned/.test(n)) reason = L.reasonNoTools;
    }
    return L.failed(reason);
  },

  dns_txt: (s, c) => {
    const h = dnsHost(s.notes, c);
    // "DoH status <n>" / "DoH error: ..." / "no TXT at _mcp.<host>" before 1.4.0.
    if (/^DNS lookup for _mcp\.\S+ did not complete\.|^DoH (?:status|error)\b/.test(s.notes)) return T.dns_txt.lookupFailed(c.origin, h);
    if (!/^(?:No TXT record|no TXT) at _mcp\./.test(s.notes)) return UNKNOWN_CHECK_REMEDIATION;
    const w = Math.max(0, Math.min(100, Math.round(Number(s.weight) || 0)));
    return T.dns_txt.notFound(c.origin, h, w);
  },

  // "homepage-link" before E12.
  discovery: (s, c) => (/^Found via homepage[ -]link /.test(s.notes) ? T.discovery.homepageLinkOnly(c.origin) : UNKNOWN_CHECK_REMEDIATION),

  spec_validity: (s, c) => {
    // noVersion speaks of a JSON document; a YAML one gets the neutral text.
    if (/^JSON parsed but no "openapi" or "swagger" version field/.test(s.notes)) return T.spec_validity.noVersion;
    if (/did not parse as JSON or recognizable YAML\.$/.test(s.notes)) return T.spec_validity.noParse;
    return UNKNOWN_CHECK_REMEDIATION;
  },

  info_completeness: (s) => {
    const I = T.info_completeness;
    if (/^Skipped/.test(s.notes)) return I.skipped;
    const m = s.notes.match(/title=(yes|no), version=(yes|no), description=(yes|<20 chars or missing)/);
    if (m) {
      const missing: string[] = [];
      if (m[1] !== "yes") missing.push(I.fieldTitle);
      if (m[2] !== "yes") missing.push(I.fieldVersion);
      if (m[3] !== "yes") missing.push(I.fieldDescription);
      if (missing.length > 0) return I.missingFields(joinWithAnd(missing));
      return UNKNOWN_CHECK_REMEDIATION;
    }
    // r5: specific text only for a note that proves the state.
    if (/^Spec is missing the "info" object/.test(s.notes)) return I.noInfo;
    return UNKNOWN_CHECK_REMEDIATION;
  },

  security_schemes: (s) => {
    if (/^Skipped/.test(s.notes)) return T.security_schemes.skipped;
    if (/^No components\.securitySchemes and no top-level security/.test(s.notes)) return T.security_schemes.none;
    return UNKNOWN_CHECK_REMEDIATION;
  },

  operation_coverage: (s) => {
    const O = T.operation_coverage;
    if (/^Skipped/.test(s.notes)) return O.skipped;
    const m = s.notes.match(/^(\d+) operation\(s\); (\d+)\/(\d+) have a summary or description/);
    const total = int(m?.[1]);
    const documented = int(m?.[2]);
    if (total !== null && documented !== null && total > 0 && documented <= total) {
      const few = total < 5;
      if (documented === total) return `${O.allDocumentedFew(total)}${O.effort}`;
      return `${O.undocumented(total - documented, total)}${few ? O.fewOperations : ""}${O.effort}`;
    }
    if (/^Spec missing "paths" object|^Spec has paths object but zero HTTP operations/.test(s.notes)) return O.noOperations;
    return UNKNOWN_CHECK_REMEDIATION;
  },

  json_ld_present: (s) => {
    const n = int(s.notes.match(/^(\d+) JSON-LD block\(s\) present but failed to parse/)?.[1]);
    if (n !== null && n > 0) return T.json_ld_present.invalid(n);
    if (/^no JSON-LD found on homepage$/.test(s.notes)) return T.json_ld_present.none;
    return UNKNOWN_CHECK_REMEDIATION;
  },

  organization_schema: (s, c) => {
    const O = T.organization_schema;
    const m = s.notes.match(/name=(true|false), url=(true|false), description=(true|false)/);
    if (m) {
      const missing: string[] = [];
      if (m[1] !== "true") missing.push("name");
      if (m[2] !== "true") missing.push("url");
      if (m[3] !== "true") missing.push("description");
      if (missing.length > 0) return O.missingFields(joinWithAnd(missing));
      return UNKNOWN_CHECK_REMEDIATION;
    }
    if (!/^no Organization schema$/.test(s.notes)) return UNKNOWN_CHECK_REMEDIATION;
    const ld = sibling(c, "json_ld_present");
    return ld && ld.score === 100 ? O.none : O.noneNoJsonLd;
  },

  service_offer_schema: (s) => {
    // Both templates speak of the homepage: a note about a sampled product
    // page (1.4.0) gets the neutral text.
    if (/sampled product page/.test(s.notes)) return UNKNOWN_CHECK_REMEDIATION;
    const k = int(s.notes.match(/best match has (\d)\/3 required fields/)?.[1]);
    // Markup with 0 of 3 fields is markup, not "no structured data".
    if (k !== null && k <= 2) return T.service_offer_schema.partial(k);
    if (/^no Service \/ Product \/ Offer schema$/.test(s.notes)) return T.service_offer_schema.none;
    return UNKNOWN_CHECK_REMEDIATION;
  },

  faq_schema: (s) => {
    const m = s.notes.match(/^(\d+) Q&A pair\(s\); (\d+) read as clear questions with direct answers\.$/);
    const q = int(m?.[1]);
    const k = int(m?.[2]);
    if (q !== null && k !== null && q > 0 && k < q) return T.faq_schema.rules(q - k, q);
    return T.faq_schema.general;
  },

  review_schema: (s) => {
    const R = T.review_schema;
    const n = int(s.notes.match(/^(\d+) Review\/AggregateRating block/)?.[1]);
    if (n === null || n === 0 || !/; well-formed=false(?::|$)/.test(s.notes)) return UNKNOWN_CHECK_REMEDIATION;
    if (/: each block is missing a required field$/.test(s.notes)) return R.missing(n);
    if (/: each block has a rating value or count that is not valid$/.test(s.notes)) return R.invalid(n);
    return R.general(n);
  },

  js_vs_no_js_render_diff: (s) => {
    const pct = int((s.notes.match(/^About (\d+)% of the distinct words/) ?? s.notes.match(/token overlap (\d+)%/))?.[1]);
    if (pct !== null && pct <= 100) return T.js_vs_no_js_render_diff.lowOverlap(pct);
    if (/minimal HTML/.test(s.notes)) return T.js_vs_no_js_render_diff.shell;
    if (/no obvious pricing\/capabilities signals/.test(s.notes)) return T.js_vs_no_js_render_diff.noSignals;
    return UNKNOWN_CHECK_REMEDIATION;
  },

  page_weight_lcp: (s) => {
    const mb = (s.notes.match(/^Homepage HTML size: (\d{1,4}\.\d{2}) MB/) ?? s.notes.match(/^Page weight (\d{1,4}\.\d{2})MB/))?.[1];
    return mb ? T.page_weight_lcp.heavy(mb) : T.page_weight_lcp.general;
  },

  markdown_negotiation: (s, c) => {
    if (/^Site did not respond to markdown or HTML requests\./.test(s.notes)) return T.markdown_negotiation.noResponse;
    // "No markdown variant or content negotiation." before 1.4.1.
    if (/^We found no Markdown version at the addresses we checked |^No markdown variant or content negotiation\./.test(s.notes)) {
      return T.markdown_negotiation.noMarkdown(c.origin);
    }
    return UNKNOWN_CHECK_REMEDIATION;
  },

  pricing_text_visibility: (s, c) => {
    const P = T.pricing_text_visibility;
    // 1.4.2: prices checked on the homepage or a linked page (no pricing
    // page); every template here speaks of a pricing page.
    if (/^No pricing page found/.test(s.notes)) return UNKNOWN_CHECK_REMEDIATION;
    const url = auditedHostUrl(s.notes.match(/^Detected (?:pricing path )?(\S+?)(?:;| but)/)?.[1], c);
    const where = url ? P.where(url) : "";
    if (/didn't return 200/.test(s.notes)) return P.notLoading(where);
    if (/modal-suggesting markup/.test(s.notes)) return P.inModal(where);
    // "none with /period suffix" (before 1.4.0); "none with a billing period
    // ..." (1.4.0).
    const n = int(s.notes.match(/; (\d+) price token\(s\) but none with (?:\/period suffix|a billing period)/)?.[1]);
    if (n !== null && n > 0) return P.noPeriod(n, where);
    if (/no price patterns detected/.test(s.notes)) return P.noPrices(where);
    return UNKNOWN_CHECK_REMEDIATION;
  },

  case_study_scannability: (s) => {
    const C = T.case_study_scannability;
    if (/none returned 200/.test(s.notes)) return C.notLoading;
    const pages = int(s.notes.match(/^Sampled (\d+) page\(s\)/)?.[1]);
    if (pages === null || pages === 0) return C.general;
    // "(h:✗ l:✓ b:✓)" before 1.4.2; "(headings: no, lists: yes, bold text: yes)" since.
    const NO = String.fromCharCode(0x2717); // the scanner's old "missing" mark
    const missing: string[] = [];
    if (s.notes.includes(`h:${NO}`) || s.notes.includes("headings: no")) missing.push(C.missingHeadings);
    if (s.notes.includes(`l:${NO}`) || s.notes.includes("lists: no")) missing.push(C.missingLists);
    if (s.notes.includes(`b:${NO}`) || s.notes.includes("bold text: no")) missing.push(C.missingBold);
    if (missing.length === 0) return C.general;
    return C.sampled(pages, joinWithAnd(missing));
  },
};

for (const id of Object.keys(DIM6_REMEDIATION)) {
  SELECTORS[id] = () => DIM6_REMEDIATION[id];
}

/** Every check id that has its own remediation template. */
export const REMEDIATION_CHECK_IDS: readonly string[] = Object.keys(SELECTORS);

/**
 * The remediation paragraph for one failing sub-check. Deterministic: the
 * same sub-check and context always give the same text.
 */
export function remediationFor(sub: SubCheck, ctx: RemediationContext): string {
  const select = SELECTORS[sub.id];
  return select ? select({ ...sub, notes: String(sub.notes ?? "") }, ctx) : UNKNOWN_CHECK_REMEDIATION;
}
