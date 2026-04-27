# AEO Implementation

**Price:** $1,299 one-time
**Delivery:** <24 hours for standard B2B SaaS sites
**Checkout:** https://pharos.dev/implementation

An automated build pipeline generates your full agent-discoverability stack and emails it within 24 hours as a Git-applicable patch file. Your developer applies it with `git am` in about five minutes, reviews the diff in your repo's normal workflow, and merges when ready. We don't ask for any access to your repo or infrastructure — the patch works entirely from your developer's local environment.

Need something custom? See https://pharos.dev/custom

## The full standard stack

- **llms.txt** — Generated from your sitemap and homepage content. Curated, not dumped. Scored against our own rubric before delivery.
- **MCP Server** — Hosted at `mcp.yourdomain.com` (you point the CNAME). Baseline tools: `get_capabilities`, `get_pricing`, `get_services`, `book_demo`, `check_llms_txt`, plus anything inferable from your pricing page.
- **OpenAPI spec** — Generated from your public API if detectable; skipped otherwise.
- **JSON-LD schema** — Organization, Service, Offer, FAQPage injected into your key pages. Delivered as part of the Git-applicable patch you receive via email.
- **Baseline monitoring** — Worker deployed to ingest your site's Cloudflare logs and parse AI user-agents + referrers. Dashboard URL delivered with the build.
- **Handoff documentation** — README included in the patch, explaining what was built and how to modify it. Lands in your repo when your team applies the patch.

## Go Custom if you need any of these

The $1,299 Implementation tier works for about 80% of B2B SaaS sites. Consider Custom (https://pharos.dev/custom) if:

- Complex public API with dozens of operations requiring tailored OpenAPI work
- Multi-region or multi-language content
- Bespoke MCP tools beyond the standard set (industry-specific capabilities, deep integrations)
- Major content rewrites across 20+ pages
- Multi-stakeholder approvals (your ops / legal / IT need a human liaison)
- Aggressive timeline constraints
- You'd prefer us to open the PR directly via deploy key or GitHub App rather than receive a patch (this is a Custom-tier option)

## From payment to deployment

1. **Pay** — $1,299 via Dodo Payments.
2. **Short questionnaire** — Your site URL, what your three most important pages are, what your core service offerings are, and a delivery email for the patch. 5 questions, ~3 minutes. No repo URL needed — we don't touch your code.
3. **Pipeline runs** — Automated build kicks off. You'll get progress updates by email as each stage completes.
4. **Delivery** — Within 24 hours for standard sites. MCP server live, monitoring dashboard URL in your inbox, plus a Git-applicable patch file your developer applies with `git am` in about five minutes. You review the diff in your repo's normal workflow and merge when ready — no access to your repo or infrastructure required from us.

## Everything we build, you own

No black box. Every artifact lives on your infrastructure. MCP server on your Cloudflare account. JSON-LD and content in your codebase via the patch your team applied. No dependency on Pharos for ongoing operation. You can cancel the retainer, move off our monitoring, or take everything in-house at any time.

## FAQ

**What if the automated build doesn't fit my stack?**
The questionnaire catches common mismatches and steers you to Custom before you pay.

**Which Git providers do you support?**
All of them. We deliver a Git-applicable patch file that works for GitHub, GitLab, Bitbucket, Azure DevOps, and self-hosted Git. Your team applies it locally with `git am` and reviews via your normal PR workflow. We never need direct access to your repo.

**Do you need write access to my repo?**
No. The patch-file delivery model means we never touch your code directly. Many B2B security teams prefer this — fewer external service accounts with repo access is a security improvement, not a limitation. (If you're on the Custom tier and want us to open the PR for you, that can be arranged during the scoping call with a temporary deploy key.)

**What if my team isn't comfortable applying patches?**
Add the Concierge subscription and we handle the patch-application + merge workflow each month, plus ongoing optimization.

## Related

- Score (free): https://pharos.dev/score
- Audit ($79, instant): https://pharos.dev/audit
- Custom (bespoke, from $4,999): https://pharos.dev/custom
- Subscriptions: https://pharos.dev/subscriptions
