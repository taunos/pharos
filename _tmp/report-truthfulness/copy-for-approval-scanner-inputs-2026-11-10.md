# Copy for approval: scanner input fixes (scanner 1.5.2), 2026-11-10

Branch `claude/scanner-input-fixes-0351ed`. Fixes RD-0117, RD-0118, RD-0119 and RD-0120 from the 2026-11-10 release check. Nothing is deployed.

Every customer-visible text change is listed below as before / after. Items 1 to 6 are in the branch, so the panel could be run on them. **Item 7 (the version notice) is only a proposal. It is not changed in code.** Items 8 and 9 are optional follow-ups.

Where the text appears: **Score** = free Score page, Score PDF and email (the check notes). **Audit** = paid Audit report (check notes and remediation).

---

## 1. Page weight note (RD-0117): Score + Audit

The size is now the uncompressed HTML. It used to be the compressed transfer size.

**Before** (ugmonk.com):
> Homepage HTML size: 0.08 MB (83656 bytes). This check looks at page size only; it does not measure loading speed.

**After** (ugmonk.com, live free scan):
> Homepage HTML size: 1.17 MB (1223389 bytes), measured uncompressed. This check looks at page size only; it does not measure loading speed.

New variant, used when the page is over the 3 MB counting limit:
> Homepage HTML size: more than 3 MB uncompressed (we stopped counting at 3145728 bytes). This check looks at page size only; it does not measure loading speed.

New variant, used when the homepage could not be read. The check is N/A here; before, it scored 100 as "0 bytes":
> Not measured: we could not read your homepage's HTML in full, so we could not size it. This check is not counted in your score.

The Audit remediation text for this check is **unchanged**. The over-3-MB note gets the existing general text, not the "is X MB" text.

## 2. Live MCP check note (RD-0118): Score + Audit

The note now names the endpoint that was tested.

**Before:**
> The MCP server answered and listed 1 tool.

**After** (ugmonk.com):
> The MCP server at https://ugmonk.com/api/ucp/mcp answered and listed 14 tools.

## 3. MCP well-known note (RD-0118): Score + Audit

The wording is unchanged. It now names the endpoint the site advertises, so it agrees with the OpenAPI section.

**Before:**
> …an MCP server was found (an MCP endpoint answered at https://ugmonk.com/api/mcp) but it is not advertised with a server card

**After:**
> …an MCP server was found (an MCP endpoint answered at https://ugmonk.com/api/ucp/mcp) but it is not advertised with a server card

## 4. MCP discovery-card remediation (RD-0119): Audit, NEW TEXT, please review

**Before** (all sites with no card, ugmonk included):
> We found no MCP discovery card at https://ugmonk.com/.well-known/mcp.json or https://ugmonk.com/.well-known/mcp/server-card.json. If you run an MCP server, publish a JSON card at one of those addresses with the server's name and a transports list giving its URL (server cards are still a draft proposal, so the format may change). If you don't run one, building an MCP server is a development project, worth it only if you have tools or data you want AI agents to use, such as booking, ordering or account lookups. Estimated effort: 30 minutes to 1 hour for the card; several days to build a new MCP server.

**After, (a) Shopify runs the server.** Used only when the store's `/.well-known/ucp` profile points its MCP endpoint at `*.myshopify.com`:
> We found no MCP discovery card at https://ugmonk.com/.well-known/mcp.json or https://ugmonk.com/.well-known/mcp/server-card.json. Your store's MCP server is run by Shopify: the commerce profile Shopify publishes for your store (https://ugmonk.com/.well-known/ucp) points to it. Shopify stores generally can't serve their own files under /.well-known/, so adding a card there is up to Shopify rather than something you can change in your store settings or theme. Server cards are still a draft proposal, and agents that read the commerce profile can already find the server. Estimated effort: nothing to do on your side unless Shopify adds this option.

**After, (b) an MCP endpoint answered but we can't tell who hosts it.** A link or a DNS record alone does not count; those keep text (c):
> We found your MCP server, but no discovery card at {origin}/.well-known/mcp.json or {origin}/.well-known/mcp/server-card.json. If you host the server yourself, publish a JSON card at one of those addresses with the server's name and a transports list giving its URL (server cards are still a draft proposal, so the format may change). If a platform runs the server for you, whether a card can be published at those addresses is up to the platform. Estimated effort: 30 minutes to 1 hour if you host the server; nothing to do if the platform controls those addresses.

**(c) No MCP endpoint answered and Shopify doesn't run it:** the "before" text, unchanged.

Points to check:
- "generally can't" is deliberate. We have not confirmed that this particular store can't serve files there (RD-0119 says so too).
- The Shopify claim rests on observed evidence (the myshopify.com endpoint in the store's own profile), not on a guess.

## 5. Tool coverage remediation when Shopify runs the server (RD-0119): Audit, NEW TEXT

**Before:**
> Depends on Well-known discovery: there is no discovery card to read tools from. If you publish a card, list each tool your MCP server offers in its tools array, with a name, a plain-language description and an inputSchema. Estimated effort: 30 minutes to 1 hour.

**After** (Shopify case only; every other site keeps the "before" text):
> Depends on Well-known discovery: there is no discovery card to read tools from. Your store's MCP server is run by Shopify, so whether its tools are listed in a card is up to Shopify; agents that connect to the server can list its tools themselves. Estimated effort: nothing to do on your side.

## 6. Product / Offer check on drveit.com.br (RD-0120): Score + Audit

No new wording here. The site now gets an existing note in place of the false N/A note.

**Before:**
> We found no product pages, no prices on the homepage and no pricing page, so this check is not counted in your score.

**After** (now scored 0/100):
> no Service / Product / Offer schema on the homepage or on the sampled product listing page (https://drveit.com.br/produtos/)

New wording: "sampled product listing page". It is used when the sampled page is a product index or shop page (`/produtos/`, `/shop`) rather than one product. On the Score page that note reads "…on the product listing page we sampled (…)". Notes about a single product page are unchanged.

In the Audit, the remediation for this note is the existing neutral text ("This check did not pass; the Finding line above shows what we measured…"). That is existing behaviour for any note about a sampled product page. See item 9.

Sub-check changes against the 2026-11-10 release-check scans, from the free panel run on live sites the same day. The render check is left out because the free and paid tiers measure it differently.

| Site | Change |
|---|---|
| ugmonk | page weight 100 → 50; Product/Offer 0 → 100 (its `/en-br/products/…` links are now recognized and sampled) |
| drveit | Product/Offer N/A → 0 |
| eff, resend, tartine | no change apart from the page-weight byte counts in the notes |
| coffeecircle (not in the release check) | free-tier render check: German words and € prices now count as commercial signals, so 50 → 100 (score 76 B in the latest free run); note wording unchanged |

---

## 7. Version comparability notice: PROPOSAL ONLY (not changed in code)

Where: `marketing-site/src/lib/version-notice.ts`, shown in the Audit report and on the methodology pages. 1.5.2 can lower scores (ugmonk's page weight went 100 → 50), so the notice should probably name it.

**Current:**
> Scores are only comparable between reports made with the same version. Astrant Score scoring version 1.5.1 (Nov 7, 2026) and Citation Visibility v5 (Nov 8, 2026) measure more strictly than earlier versions, so a lower score after these dates does not by itself mean your site got worse.

**Proposed:**
> Scores are only comparable between reports made with the same version. Astrant Score scoring version 1.5.2 (Nov 10, 2026) and Citation Visibility v5 (Nov 8, 2026) measure more strictly than earlier versions, so a lower score after these dates does not by itself mean your site got worse.

Alternative, if you'd rather keep both dates:
> Scores are only comparable between reports made with the same version. Astrant Score scoring versions 1.5.1 (Nov 7, 2026) and 1.5.2 (Nov 10, 2026), and Citation Visibility v5 (Nov 8, 2026), measure more strictly than earlier versions, so a lower score after these dates does not by itself mean your site got worse.

The date in the proposal is the date of the fix, not of a deploy. If the scanner is deployed later, the date should be the deploy date. Automatic and already in the branch: the Score page's "current engine is v…" banner now says 1.5.2. Scans made under 1.5.1 will show the existing "older engine" re-scan banner.

## 8. Optional: Dim 2 "no MCP signal" N/A note

The scanner now also reads `/robots.txt` for MCP endpoint links. The N/A note lists where we looked and does not mention robots.txt. It is not false, just incomplete. Possible addition: "…no MCP link in /llms.txt, /robots.txt or on the homepage…". **Not changed.**

## 9. Optional follow-up: remediation for a sampled product page

When the homepage and the sampled product page both lack Product markup, the Audit shows the neutral fallback text. A specific template could say: "We found no Service, Product or Offer structured data on your homepage or on {page}, a product page it links to…". **Not written.** This is new framing and needs your wording.
