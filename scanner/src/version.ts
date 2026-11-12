/**
 * Scanner scoring engine version. Bump on any change that affects how scores
 * are computed (new dimension, new sub-check, weight changes, scoring math).
 * Stamped on every scan response as `scan.scoring_version`. Included in cache
 * keys so version bumps invalidate stale entries automatically.
 *
 * Distinct namespace from audit-fulfill's REMEDIATION_ENGINE_VERSION_TAG —
 * scanner version is about scoring math; remediation version is about
 * LLM-generated guidance. The two evolve independently.
 *
 * History:
 * - 1.0.0 (Slice 1, implicit before Slice 2a): Dim 1 + 2 + 4, 3-of-6 composite.
 * - 1.1.0 (Slice 2a): Adds Dim 5 (Agent-Parsable Content); composite becomes 4-of-6.
 * - 1.2.0 (Slice 3a, 2026-04-30): Adds Dim 3 (OpenAPI / API Catalog) with
 *   whole-dim N/A. Composite becomes 5-of-6 with renormalization across
 *   applicable dimensions. Replaces SLICE2A_WEIGHTS with SPEC_WEIGHTS in
 *   compositeOf. Adds ScanResult.dimensions_applicable. Parity invariant:
 *   content-only sites with Dim 3 N/A produce the same composite as v1.1.0.
 *   NOTE: v1.2.0 shipped with drifted SPEC_WEIGHTS (Dim 3 inflated 10→15,
 *   Dim 6 deflated 20→15). Content-only sites unaffected (parity holds at
 *   70 either way) but API-active scans diverged. Corrected in 1.2.1.
 * - 1.2.1 (Slice 3a hotfix, 2026-04-30): SPEC_WEIGHTS restored to canonical
 *   OQ-04 §1 values (15/20/10/20/15/20). Dim 6's 20% strategic-differentiator
 *   weight preserved for Slice 3b. Cache invalidates cleanly via prefix bump.
 * - 1.3.0 (Slice 3b, 2026-05-01): Adds Dim 6 (Citation Visibility) — the
 *   strategic differentiator (what hosted models actually say about a domain;
 *   the dimension Cloudflare's Agent Readiness Score cannot see). Dimensions
 *   array goes 5→6. Free-tier emits a static demo preview with na:true; paid-
 *   tier audit-fulfill replaces this with a real 4-model audit (OpenAI gpt-4o,
 *   Anthropic Claude, Google Gemini 2.0 Flash, Perplexity Sonar — TP-7 ladder
 *   with templated fallback, 30-day cache, daily soft cap of 100 paid audits).
 *   Engine version `dim6:v1` stamped on every paid audit row in
 *   citation_audit_response (corpus migration 0003, schema_version 1.1.0).
 *   Capability separation: scanner has zero of OPENAI_API_KEY /
 *   ANTHROPIC_API_KEY / GOOGLE_AI_API_KEY / PERPLEXITY_API_KEY (verified at
 *   deploy time via wrangler secret list).
 * - 1.3.1 (E12 scoring defects, 2026-11-05): Dim 3 homepage-link discovery
 *   wired (reuses Dim 4's homepage read); Dim 3 discovery rejects HTML /
 *   unparseable 200s (soft-404s); Dim 2 dns_txt counts only TXT records at
 *   _mcp.<host> that mention mcp (not CNAME chains); Dim 2 live check runs
 *   the MCP initialize handshake before tools/list and parses JSON / SSE
 *   replies per message (no greedy regex). `CURRENT_SCORING_VERSION` on
 *   /score/[id] bumped in lockstep.
 * - 1.3.2 (report truthfulness, 2026-11-07): Dim 4 review_schema is sub-check
 *   N/A (weight redistributed) when no Review / AggregateRating markup exists;
 *   scored on well-formedness only when present (absence used to score 0 and
 *   pushed sites to invent ratings). Dim 2 is whole-dimension N/A when Dim 3
 *   is whole-dimension N/A for no API surface (not unmeasured) AND no MCP
 *   artifact was found (no 200 at either card path, no _mcp TXT); composite
 *   renormalizes as for any whole-dim N/A. Dim 3's result is handed to Dim 2
 *   in run-scan (no extra fetch). `CURRENT_SCORING_VERSION` on /score/[id]
 *   bumped in lockstep.
 * - 1.3.3 (report truthfulness r2, 2026-11-07): no score for invented or
 *   inapplicable data. Dim 4 accepts schema.org subtypes (LocalBusiness,
 *   Dentist, Corporation, SoftwareApplication, ...; @type arrays and
 *   schema.org IRIs) and finds nested Review / AggregateRating; Organization
 *   passes on name + url + description (sameAs a bonus); Service / Product
 *   needs no price; faq_schema is N/A without FAQPage markup and has no >=5
 *   count ladder. Dim 5 recognizes non-USD prices (R$, euro, pound, yen,
 *   rupee, ISO codes), drops the case-study "metrics" criterion, and no
 *   longer probes "https://host.md" or counts /llms.txt as a .md variant.
 *   Dim 2 oauth_metadata is N/A without an MCP card. Dim 3 info / security /
 *   operation sub-checks are N/A "not measured" on YAML specs. Dim 1 reads
 *   the full multi-line blockquote. A failed or budget-skipped AI rating
 *   (Dim 1 blockquote, Dim 4 FAQ) marks the sub-check N/A "not measured"
 *   instead of a default 50. `CURRENT_SCORING_VERSION` on /score/[id]
 *   bumped in lockstep.
 * - 1.4.0 (report truthfulness r3, 2026-11-07): no false statements about
 *   what a site has. Dim 2 goes N/A only on positive absence: MCP links in
 *   /llms.txt or on the homepage, /.well-known/ucp, a /api/mcp endpoint
 *   answering MCP initialize, API links and a GraphQL endpoint all count as
 *   evidence, and a declared endpoint that answers (or asks for OAuth) is
 *   credited in the live check. Server cards in the remotes[] / remote /
 *   serverInfo shapes are read (name, transport, nested auth, input_schema);
 *   oauth_metadata uses the card's authorization server and is N/A when the
 *   card declares no auth; dns_txt is informational (no ratified standard).
 *   Dim 3 follows an API catalog's service-desc link (same site) and scores
 *   that spec; with API evidence but no OpenAPI the N/A note says so. Dim 1
 *   counts every Markdown link. Dim 4 traverses nested JSON-LD for every type
 *   (bounded; "not fully inspected" past the bound), complete Organization
 *   = 100, FAQ Q&A needs answer text, ratings need numeric values, and a
 *   store's product page is sampled when the homepage has no Product. Dim 5
 *   markdown needs a markdown / text content type and a non-HTML body,
 *   billing periods are read in more forms and languages (one-time prices
 *   need none), account / login / cart paths are never content pages, and
 *   case-study detection is multilingual and samples one study from an index.
 *   "Page weight + LCP" is "Page weight". The FAQ AI rating accepts a numbered
 *   per-question reply. `CURRENT_SCORING_VERSION` on /score/[id] bumped in
 *   lockstep.
 * - 1.4.1 (report truthfulness r4, 2026-11-07): Dim 4 FAQ Q&A credit needs
 *   @type Question (and Answer when the answer is typed); ratings need a
 *   ratingValue inside bestRating / worstRating (1-5 or 0-100 by default)
 *   and positive integer counts; service_offer_schema is N/A when nothing
 *   shows the site sells online (no markup, no product link, no price on the
 *   homepage, no pricing page). Dim 5 case-study pages reached through
 *   /work, /portfolio or /projects count only when they look like a case
 *   study, and a JavaScript-built case-study page is not measured (N/A, not
 *   0); linear HTML scanning (stripTags, anchors, headings) replaces regexes
 *   that were super-linear on hostile HTML. Every probe of a URL the site
 *   declares (MCP endpoints, /api/mcp, UCP, OAuth server, catalog
 *   service-desc, product and case-study pages, GraphQL) stays on the
 *   audited site on every redirect hop; a request body is never replayed to
 *   another site; a card endpoint on another site is not called and
 *   live_invocation is N/A. Plain-language notes for the render overlap and
 *   Markdown checks. `CURRENT_SCORING_VERSION` on /score/[id] bumped in
 *   lockstep.
 * - 1.4.2 (report truthfulness r5, 2026-11-07): Dim 5 pricing discovery,
 *   the pricing page read, Dim 2 card discovery and Dim 3 well-known /
 *   canonical / homepage-linked spec discovery stay on the audited site on
 *   every hop; homepage pricing links are deduplicated and capped (3), with
 *   one time budget for discovery and sampling. With no pricing page, prices
 *   shown on the homepage or on a homepage-linked page (product pages first,
 *   at most 3) are scored; with none, the check is "not measured" (N/A).
 *   Ratings: a ratingValue above 5 needs a declared bestRating (no assumed
 *   0-100 scale); the review_schema note names the validation failure
 *   (missing field / invalid value). service_offer_schema N/A note says what
 *   was checked. Case-study notes use plain words for headings / lists /
 *   bold text. `CURRENT_SCORING_VERSION` on /score/[id] bumped in lockstep.
 * - 1.5.0 (fixed rules, 2026-11-07): no model call in the scan. Dim 1
 *   blockquote_eval scores three rules (one paragraph, 50-250 words, names
 *   the business: the llms.txt H1 name or the host's main label); text that
 *   reads like instructions to an AI still scores 0. Dim 4 faq_schema scores
 *   the share of Q&A pairs whose question is phrased as a question of 3-40
 *   words and whose answer has 5-300 words. The Workers AI binding and daily
 *   AI budget are gone. Dim 5 markdown_negotiation is informational (N/A,
 *   not scored), like Dim 2 dns_txt. Dim 3 parses YAML specs in full (the
 *   `yaml` package: failsafe schema, alias cap, no unknown tags; a YAML spec
 *   over 512 KB is "not read in full") and runs the JSON checks on them.
 *   `CURRENT_SCORING_VERSION` on /score/[id] bumped in lockstep.
 * - 1.5.1 (report truthfulness r6, 2026-11-07): Dim 3 YAML specs: cap
 *   lowered to 256 KB plus a 20,000-node budget counted on yaml's token
 *   stream before parsing (over either is "not read in full"); a key repeated
 *   in one mapping fails spec_validity (linear per-mapping check). Dim 4
 *   faq_schema: question 2-40 words, answer 1-300 words and 2+ characters;
 *   the note describes structure only; a typed Question missing its name or
 *   answer text counts as failing and the note gives how many. Dim 1
 *   blockquote_eval: two rules, one paragraph and 10-100 words (was 50-250;
 *   "names the business" dropped, the H1 names it). Dim 2 well_known
 *   evidence says whether both card addresses answered 404 / 410.
 *   `CURRENT_SCORING_VERSION` on /score/[id] bumped in lockstep.
 * - 1.5.2 (scanner inputs, 2026-11-10; RD-0117..0120): Dim 5 page weight
 *   is the decompressed homepage HTML (Content-Length, the compressed
 *   transfer size, is no longer used: ugmonk.com scored 100 on 83,656 bytes
 *   for about 1.2 MB of HTML); the note says "measured uncompressed", a body
 *   past 3 MB is "more than 3 MB", and an unread homepage is N/A "not
 *   measured" (it scored 100 as 0 bytes). Dim 2 tests the MCP endpoints the
 *   site advertises (llms.txt, homepage, /robots.txt, /.well-known/ucp, _mcp
 *   TXT) before the guessed /api/mcp, which counts only when none answered;
 *   the tools/list note names the endpoint tested; well_known evidence gives
 *   the endpoint found and whether Shopify hosts it (UCP endpoint on
 *   *.myshopify.com). Dim 4 product pages and Dim 5 price-sample product
 *   pages are recognized in other languages (/produtos/x, /productos, /shop,
 *   /loja ...), with a product index taken when no product page is linked;
 *   Dim 5 follows pricing links named in other languages (Preços, Planos,
 *   Precios, Tarifs, Preise ...); the free-tier render check counts
 *   pricing / product / service words in those languages and any recognized
 *   price (euro, R$ ...) as commercial signals, not only English words and
 *   "$". `CURRENT_SCORING_VERSION` on /score/[id]
 *   bumped in lockstep.
 */
export const SCORING_VERSION = "1.5.2";
