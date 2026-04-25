# Agent Discoverability Score

**Price:** Free
**Status:** Launching soon — join waitlist at https://pharos.dev/score

A URL-input scan across 6 dimensions of agent discoverability. Public score on screen, detailed gap report to your inbox, monthly auto-rescan so you can watch your score improve.

## The six dimensions

Each dimension maps to a specific piece of technical infrastructure. The score tells you where you stand; the gap report tells you exactly what to fix.

- **llms.txt Quality** (15%) — Machine-readable sitemap telling agents what your site offers, and where.
- **MCP Server Discoverability** (20%) — Your agent-invocable endpoint, discoverable via `.well-known/mcp.json`.
- **OpenAPI / API Catalog** (10%) — Structured API description for service-based businesses.
- **Structured Capability Data** (20%) — JSON-LD schema: Organization, Service, Offer, FAQPage.
- **Agent-Parsable Content** (15%) — Pages that render cleanly without JavaScript; pricing in text, not images.
- **Citation Visibility & Monitoring** (20%) — Live audit of where you're cited across ChatGPT, Claude, Perplexity, Gemini.

## Why this, not the free Cloudflare tool?

Cloudflare shipped a free Agent Readiness Score tool in 2026 that does pass/fail checks across five categories. It's a good free check. We go deeper in three places:

1. **Quality rubrics, not pass/fail.** Our llms.txt check doesn't just verify the file exists; it scores curation quality, blockquote elevator-pitch, and whether the linked pages return good markdown. Same depth on every other dimension.
2. **Predicted referral lift per gap.** Each gap is annotated with an estimated impact on agent-attributed traffic. You fix what moves the needle first, not what's easy to check off.
3. **Live citation audit.** We query ChatGPT, Claude, Perplexity, and Gemini for prompts in your category and report your current citation share against competitors. Cloudflare can't see inside those engines. We can.

## Want the deeper analysis now?

The $79 Audit delivers the full 6-dimension report with live citation data in 60 seconds — no waitlist. See https://pharos.dev/audit

## FAQ

**What's the difference between Score and Audit?**
The free Score gives you a public grade across six dimensions. The $79 Audit adds live citation audit across major AI engines, competitor comparison, implementation estimates, and a JSON export for programmatic use. If you just want to know where you stand, use the Score. If you want a prioritized action plan, use the Audit.

**When does the Score launch?**
Soon. Drop your URL and email at https://pharos.dev/score and you'll be among the first to run it the day it ships.

**Will you charge for the Score later?**
No. The Score stays free. The paid tiers (Audit, Implementation, Custom, Retainer) go deeper.

## Related

- Audit (paid, instant): https://pharos.dev/audit
- Implementation ($1,299, <24h build): https://pharos.dev/implementation
- Custom (bespoke, from $5K): https://pharos.dev/custom
- Retainer ($149/mo Auto, $899/mo Managed): https://pharos.dev/retainer
- MCP Server: https://pharos-mcp.pharos-dev.workers.dev/mcp
