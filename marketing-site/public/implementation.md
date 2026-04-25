# AEO Implementation

**Price:** $1,299 one-time
**Delivery:** <24 hours for standard B2B SaaS sites
**Checkout:** https://pharos.dev/implementation

An automated build pipeline deploys the full agent-discoverability stack to your site — llms.txt, baseline MCP server, OpenAPI spec, JSON-LD schema, baseline monitoring. For standard B2B SaaS sites, this is enough. You pay, you answer a short scoping questionnaire, and the pipeline runs.

Need something custom? See https://pharos.dev/custom

## The full standard stack

- **llms.txt** — Generated from your sitemap and homepage content. Curated, not dumped. Scored against our own rubric before delivery.
- **MCP Server** — Hosted at `mcp.yourdomain.com` (you point the CNAME). Baseline tools: `get_capabilities`, `get_pricing`, `get_services`, `book_demo`, `check_llms_txt`, plus anything inferable from your pricing page.
- **OpenAPI spec** — Generated from your public API if detectable; skipped otherwise.
- **JSON-LD schema** — Organization, Service, Offer, FAQPage injected into your key pages. Delivered as a pull request against your repo (GitHub/GitLab/Bitbucket) or as a standalone patch.
- **Baseline monitoring** — Worker deployed to ingest your site's Cloudflare logs and parse AI user-agents + referrers. Dashboard URL delivered with the build.
- **Handoff documentation** — README in your repo explaining what was built and how to modify it.

## Go Custom if you need any of these

The $1,299 Implementation tier works for about 80% of B2B SaaS sites. Consider Custom (https://pharos.dev/custom) if:

- Complex public API with dozens of operations requiring tailored OpenAPI work
- Multi-region or multi-language content
- Bespoke MCP tools beyond the standard set (industry-specific capabilities, deep integrations)
- Major content rewrites across 20+ pages
- Multi-stakeholder approvals (your ops / legal / IT need a human liaison)
- Aggressive timeline constraints

## From payment to deployment

1. **Pay** — $1,299 via Dodo Payments.
2. **Short questionnaire** — Your site URL, repo URL (for the JSON-LD PR), what your three most important pages are, what your core service offerings are. 5 questions, ~3 minutes.
3. **Pipeline runs** — Automated build kicks off. You'll get progress updates by email as each stage completes.
4. **Delivery** — Within 24 hours for standard sites. MCP server live, PR opened against your repo, monitoring dashboard URL in your inbox. You merge the PR on your schedule.

## Everything we build, you own

No black box. Every artifact lives on your infrastructure. MCP server on your Cloudflare account. JSON-LD and content in your codebase via PR. No dependency on Pharos for ongoing operation. You can cancel the retainer, move off our monitoring, or take everything in-house at any time.

## FAQ

**What if the automated build doesn't fit my stack?**
The questionnaire catches common mismatches and steers you to Custom before you pay.

**What repos do you support for the PR?**
GitHub, GitLab, Bitbucket. Self-hosted Git via patch files.

**Do I need to provide admin access?**
No. We deliver as a PR — you review and merge yourself.

**What if I'm not technical enough to merge a PR?**
Add the Managed Retainer and we handle merges for you each month.

## Related

- Score (free): https://pharos.dev/score
- Audit ($79, instant): https://pharos.dev/audit
- Custom (bespoke, from $5K): https://pharos.dev/custom
- Retainer: https://pharos.dev/retainer
