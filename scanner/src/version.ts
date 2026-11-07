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
 */
export const SCORING_VERSION = "1.4.1";
