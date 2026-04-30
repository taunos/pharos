// Inlined privacy + terms markdown for the /privacy and /terms server-rendered
// pages. OpenNext's Cloudflare Workers runtime does not reliably resolve
// `readFileSync(path.join(process.cwd(), "public", ...))` — process.cwd() in
// the Worker doesn't point at the bundle root, so the page module 500'd at
// runtime when we tried to load the .md from disk. Inlining the content
// here makes the page render purely from JS.
//
// MUST stay in sync with `public/privacy.md` and `public/terms.md` (those
// are the canonical raw-served files for `/privacy.md` and `/terms.md`
// content-negotiation paths and for `<link rel="alternate" type="text/markdown">`
// references). When you edit one, edit both.

export const PRIVACY_MD = `# Privacy Policy

**Last updated:** 2026-04-30
**Status:** v1 in good faith. [Subject to legal review pre-launch.]

This is the plain-English privacy policy for Astrant — Agent Discoverability for B2B SaaS. We try to write privacy policies the way we'd want one written for us: short, specific, and honest about what we collect and why.

## What we collect

When you use Astrant's free Score tool or any paid tier:

- **The URL you scan.** That's the whole point — we can't compute a discoverability score without it.
- **Your IP address.** Used for rate-limiting (preventing abuse) and aggregate traffic analytics. Stored in tail logs for ~7 days.
- **Your User-Agent string.** Same uses as IP — rate-limiting and aggregate analytics. Stored in tail logs for ~7 days.
- **Your email address, if you submit one.** You'll only submit an email if you choose to: either to receive your gap-report PDF, opt into monthly auto-rescan emails, or contact support. We don't email you for any reason you didn't explicitly ask for.
- **Sub-check results from the scan.** The structured data Astrant computes about your site — llms.txt presence, MCP server discoverability, JSON-LD schema completeness, etc. This is not your content; it's our analysis of your public technical surface.

## What we don't collect

- The full HTML of your pages. We fetch only what we need to compute checks.
- Browsing data, session recordings, or behavioral analytics.
- Anything from third parties (e.g., Google Analytics, Facebook Pixel) — we don't run external trackers on this site.

## What we do with what we collect

- **Compute your Astrant Score.** That's the primary use.
- **Send you the gap-report PDF you requested,** if you submitted an email.
- **Send monthly auto-rescan emails,** if you opted in (default: off, never auto-checked).
- **Improve our scoring engine** in aggregate. We may use anonymized scan data (no email, no IP, no User-Agent — just URL+score+sub-check results) to calibrate our methodology over time. Disclosed here so it's not a surprise.

## What we don't do with what we collect

- We don't sell your data. Ever.
- We don't share it beyond our infrastructure providers (Cloudflare, who runs our Workers / D1 / KV / R2; Resend, who delivers our transactional emails; and Profound, when our paid tiers eventually integrate with their citation-tracking API). These are processors, not partners — they hold data on our behalf, under contract.
- We don't run ads, advertising pixels, or affiliate tracking.

## Watermarking on PDF gap reports

PDF gap reports include a small watermark with the email address used to request them. This is an anti-abuse measure — if a report is shared without the requester's consent, the watermark identifies the original requester. The email is not visible in the PDF metadata or filename, only in the visual watermark on each page. By submitting your email to receive the PDF, you consent to having your email appear in the watermark on your copy.

## Email logging

When the system needs to log information about a transactional email (for example, to track abuse, debug delivery failures, or rate-limit deletion requests), the email is **hashed** with a server-side salt before it touches our logs. The same email always produces the same hash, so we can correlate abuse without storing plaintext PII in tail logs. Hashes are SHA-256 truncated to 16 characters; they are not reversible and not shared.

## Retention

- **Free Score scan records:** retained ~90 days, then deleted.
- **Email-opted-in scan records:** retained until you cancel the rescan opt-in (or submit a deletion request).
- **Tail logs (IP, User-Agent, hashed email):** retained ~7 days.
- **Anonymous scan records** (with all PII removed) may be retained longer for aggregate metrics. No identifying information remains.

## Your rights

You have the following rights, regardless of where you're located:

- **Access:** ask us what data we hold about you. Email privacy@astrant.io.
- **Correction:** if we have something wrong, tell us, and we'll fix it.
- **Deletion:** visit [\`/score/delete-me\`](/score/delete-me) to delete every Score scan record associated with your email. We send a confirmation link valid for 24 hours. When you confirm, we delete every scan record associated with the email address you submit, not just the most recent one. If you've used Astrant from multiple email addresses, you'll need to submit a deletion request for each.
- **Portability:** ask us for a JSON export of your data. Email privacy@astrant.io.
- **Unsubscribe:** every email we send has a one-click unsubscribe link in the header (RFC 8058) and a visible unsubscribe link in the body.

## Cookies

We don't set tracking cookies. We may set technical cookies for things like Cloudflare's bot-management and CSRF defenses, which are operational requirements, not analytics.

## Children

Astrant is not directed at children. If you're under 16, please don't use this service.

## International transfers

Our infrastructure runs on Cloudflare's global network. Your data may be processed in any region Cloudflare operates in, including the United States. Our email delivery (Resend) is US-based. If you're in the EU/UK and want stronger guarantees about data residency, email privacy@astrant.io.

## Contact

- **Privacy questions:** [privacy@astrant.io](mailto:privacy@astrant.io)
- **General contact:** [hello@astrant.io](mailto:hello@astrant.io)

## Changes

We'll update this page if we materially change how we handle data. Material changes will also be announced via email to anyone with an active rescan opt-in.

---

*This policy is provided in good faith as our v1 disclosure. We're committed to keeping it honest, plain-spoken, and short. [Subject to legal review pre-launch — not yet a substitute for a fully attorney-drafted policy.]*
`;

export const TERMS_MD = `# Terms of Service

**Last updated:** 2026-04-30
**Status:** v1 in good faith. [Subject to legal review pre-launch.]

These are the plain-English terms for using Astrant — Agent Discoverability for B2B SaaS. We've tried to write them like we'd want them written for us: specific, short, and honest about what's on offer.

## The service

Astrant provides agent-discoverability tooling for B2B SaaS websites:

- **Score** (free): a URL-input scan that returns a 0–100 composite score across multiple dimensions of agent discoverability, with optional gap-report PDF delivery via email.
- **Audit** ($79, instant): a deeper automated audit with per-gap remediation guidance.
- **Implementation** ($1,299, <24h delivery): an automated build of llms.txt, MCP server, OpenAPI spec, JSON-LD schema, and baseline monitoring, delivered as a Git-applicable patch.
- **Custom** (from $4,999): bespoke human-led builds for complex APIs, multi-region content, or unusual MCP tool needs.
- **Subscriptions** (AutoPilot $149/mo, Concierge $899/mo): ongoing rescan + reporting.

Some of these tiers are still in pre-launch verification at the time you're reading this. Active checkout availability is shown on each tier's page.

## "As-is" service

Astrant is provided "as-is," without warranty of any kind. Scores are estimates, not guarantees. We work hard to make them useful and accurate, but they reflect our methodology at a point in time, against our public rubric, run on our infrastructure. They are not a substitute for professional consultation on your specific situation, and we make no claims about what business outcomes (traffic, conversions, AI-attributed referrals) the scores will or won't predict.

## What you can use Astrant for

- **Sites you have authority to scan.** That includes your own sites and sites you have explicit permission to analyze. You agree not to use Astrant to scan sites you don't have authority over.
- **Analysis, planning, and improvement of your own agent discoverability.** That's the intended use.

## What you can't use Astrant for

- Mass-scanning random sites you don't have a relationship with.
- Reverse-engineering our methodology to white-label without permission.
- Anything illegal in the jurisdiction you're operating from.
- Spamming the service to drive up our infrastructure costs (rate limits exist for a reason).

## Robots.txt respect [Phase 2 of Slice 2b]

We're committed to honoring robots.txt directives on the sites we scan. As of this writing, the robots.txt-respect logic ships in Phase 2 of Slice 2b (it's a TODO comment in the scanner, with the implementation queued). Until then, scans run on direct user submission. We don't scrape proactively — every scan is initiated by an explicit URL submission.

## Rate limits and abuse

We rate-limit per-IP and per-URL on the free Score scanner to prevent abuse. Specific limits aren't published (they may shift), but a normal user running a few scans a day will never hit them. If you hit a rate limit, the service will return HTTP 429 and tell you when to retry.

## Pricing and refunds

- **Free tier (Score):** stays free.
- **Paid tiers (Audit, Implementation, Custom, Subscriptions):** prices listed are current at the time of this writing. We reserve the right to change pricing for new purchases; existing subscriptions stay at their original price for the current billing cycle.
- **Refund policy for Audit:** full refund, no questions, first 30 days. We'd rather have your feedback than your $79.
- **Refund policy for Implementation, Custom, Subscriptions:** documented on each tier's checkout page; varies by tier.

## Liability cap

To the maximum extent permitted by applicable law, our total liability to you for any claim arising from your use of Astrant is capped at the amount you paid us in the 12 months preceding the claim, or $100, whichever is greater. This includes claims for direct, indirect, special, consequential, or any other damages.

## Indemnification

You agree to indemnify and hold us harmless from any claims arising from your misuse of Astrant — including, but not limited to, scans you ran on sites you didn't have authority to analyze.

## Governing law

[Subject to legal review pre-launch — currently provided in good faith without a specific governing-law selection. We'll update this section before commercial launch with the actual jurisdiction.]

## Changes to these terms

We'll update this page if we materially change the terms. Material changes will also be announced via email to anyone with an active rescan opt-in. Continued use of Astrant after a material change constitutes acceptance of the new terms.

## Contact

- **Terms questions:** [hello@astrant.io](mailto:hello@astrant.io)
- **Privacy questions:** [privacy@astrant.io](mailto:privacy@astrant.io)

## Severability

If any part of these terms is held unenforceable, the rest remains in effect.

---

*These terms are provided in good faith as our v1 disclosure. We're committed to keeping them honest, plain-spoken, and short. [Subject to legal review pre-launch — not yet a substitute for fully attorney-drafted terms.]*
`;
