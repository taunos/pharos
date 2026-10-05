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

**Last updated:** 2026-10-04
**Status:** v1 in good faith. [Subject to legal review pre-launch.]

This is the plain-English privacy policy for Astrant — Agent Discoverability for B2B SaaS. We try to write privacy policies the way we'd want one written for us: short, specific, and honest about what we collect and why.

## What we collect

When you use Astrant's free Score tool or any paid tier:

- **The URL you scan.** That's the whole point — we can't compute a discoverability score without it.
- **Your IP address.** Used for rate-limiting (preventing abuse) and aggregate traffic analytics. It is **not** stored in your scan record; it may appear in server tail logs (~7 days). Rate-limit counters use an HMAC-derived key rather than the raw IP and expire within approximately 25 hours.
- **Your User-Agent string.** Same uses as IP — rate-limiting and aggregate analytics. Stored in tail logs for ~7 days.
- **Your email address, if you submit one.** You'll only submit an email if you choose to: receive your gap-report PDF, buy an Audit, opt into monthly auto-rescan emails, contact support, or join the pre-launch waitlist (we'll notify you when paid tiers — Implementation, Custom, Standard, Pro — open for purchase). We don't email you for any reason you didn't explicitly ask for.
- **Sub-check results from the scan.** The structured data Astrant computes about your site — llms.txt presence, MCP server discoverability, JSON-LD schema completeness, etc. This is not your content; it's our analysis of your public technical surface.

## What we don't collect

- The full HTML of your pages. We fetch only what we need to compute checks.
- Browsing data, session recordings, or behavioral analytics.
- Anything from third parties (e.g., Google Analytics, Facebook Pixel) — we don't run external trackers on this site.

## What we do with what we collect

- **Compute your Astrant Score.** That's the primary use.
- **Send you the gap-report PDF you requested,** if you submitted an email.
- **Send monthly auto-rescan emails,** if you opted in (default: off, never auto-checked).
- **Deliver an Audit you bought:** we use the URL and email you submit to run the audit, email you the PDF, and handle support or refund requests.
- **Send a launch notification,** if you joined the pre-launch waitlist. One-shot transactional email when the tier you asked about opens for purchase.
- **Improve our scoring engine** in aggregate. We may use anonymized scan data (no email, no IP, no User-Agent — just URL+score+sub-check results) to calibrate our methodology over time. Disclosed here so it's not a surprise.

## What we don't do with what we collect

- We don't sell your data. Ever.
- We don't share it beyond the providers who run the service for us: Cloudflare (Workers / D1 / KV / R2, Workers AI, Browser Rendering); Resend, who delivers our transactional emails; OpenAI, Anthropic, Google and Perplexity, which receive your site's domain (never your email) in the prompts of a paid Audit's Citation Visibility check; and Profound, when our paid tiers eventually integrate with their citation-tracking API. These are processors, not partners — they hold data on our behalf, under contract.
- **Payments** are handled by Dodo Payments, our merchant of record. Dodo collects your payment details directly under its own privacy policy; we never see your card number. We receive your email, the purchase and its status.
- We don't run ads, advertising pixels, or affiliate tracking.

## Watermarking on PDF gap reports

PDF gap reports include a small watermark with the email address used to request them. This is an anti-abuse measure — if a report is shared without the requester's consent, the watermark identifies the original requester. The email is not visible in the PDF metadata or filename, only in the visual watermark on each page. By submitting your email to receive the PDF, you consent to having your email appear in the watermark on your copy.

## Email logging

When the system needs to log information about a transactional email (for example, to track abuse, debug delivery failures, or rate-limit deletion requests), the email is **hashed** with a server-side salt before it touches our logs. The same email always produces the same hash, so we can correlate abuse without storing plaintext PII in tail logs. Hashes are SHA-256 truncated to 16 characters; they are not reversible and not shared.

## Retention

- **Free Score scan records:** retained ~90 days, then deleted.
- **Email-opted-in scan records:** retained until you cancel the rescan opt-in (or submit a deletion request).
- **Tail logs (IP, User-Agent, hashed email):** retained ~7 days.
- **Retained scan records** (email, IP, unsubscribe token, and opt-in state removed) may be kept for calibration and aggregate metrics. The submitted URL and technical scan results remain — and because a URL can contain identifying information (names, tenant paths, query parameters), we don't claim these records are fully anonymous.
- **Audit orders:** the URL and email you submit are kept with your order for 30 days, then deleted automatically. Your Audit PDF and JSON are stored with no automatic expiry so your download link keeps working; email privacy@astrant.io to have them deleted. Anonymized Audit results (no email) may be kept for calibration, as described above.

## Your rights

You have the following rights, regardless of where you're located:

- **Access:** ask us what data we hold about you. Email privacy@astrant.io.
- **Correction:** if we have something wrong, tell us, and we'll fix it.
- **Deletion:** visit [\`/score/delete-me\`](/score/delete-me) to remove your personal data from every Score scan record associated with your email. We send a confirmation link valid for 24 hours; opening it shows a confirmation page, and only when you click Delete do we remove the stored email, IP address, unsubscribe token, opt-in state, and personalized report across every record for that email (not just the most recent). The submitted URL and technical scan results remain for calibration. If you've used Astrant from multiple email addresses, submit a request for each. For Audit orders and reports, email privacy@astrant.io.
- **Portability:** ask us for a JSON export of your data. Email privacy@astrant.io.
- **Unsubscribe:** every email we send has a one-click unsubscribe link in the header (RFC 8058) and a visible unsubscribe link in the body.

## Cookies

We don't set tracking cookies. We may set technical cookies for things like Cloudflare's bot-management and CSRF defenses, which are operational requirements, not analytics.

## Children

Astrant is not directed at children. If you're under 16, please don't use this service.

## International transfers

Our infrastructure runs on Cloudflare's global network. Your data may be processed in any region Cloudflare operates in, including the United States. Our email delivery (Resend) and the AI model providers used in a paid Audit are US-based, and Dodo Payments may process payment data outside your country. If you're in the EU/UK and want stronger guarantees about data residency, email privacy@astrant.io.

## Contact

- **Privacy questions:** [privacy@astrant.io](mailto:privacy@astrant.io)
- **General contact:** [contact@astrant.io](mailto:contact@astrant.io)

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
- **Subscriptions** (Standard $149/mo, Pro $899/mo): ongoing rescan + reporting.

The Audit is available now. Implementation, Custom and the subscriptions are still in pre-launch; active checkout availability is shown on each tier's page. Payments are processed by Dodo Payments, our merchant of record, and your purchase is also subject to Dodo's checkout terms.

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

## Robots.txt respect

We're committed to honoring robots.txt directives on the sites we scan. The robots.txt-respect logic is queued for an upcoming release. Until then, scans run on direct user submission only — we don't scrape proactively, and every scan is initiated by an explicit URL submission.

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

These terms are governed by the laws of the Federative Republic of Brazil.

## Changes to these terms

We'll update this page if we materially change the terms. Material changes will also be announced via email to anyone with an active rescan opt-in. Continued use of Astrant after a material change constitutes acceptance of the new terms.

## Contact

- **Terms questions:** [contact@astrant.io](mailto:contact@astrant.io)
- **Privacy questions:** [privacy@astrant.io](mailto:privacy@astrant.io)

## Severability

If any part of these terms is held unenforceable, the rest remains in effect.

---

*These terms are provided in good faith as our v1 disclosure. We're committed to keeping them honest, plain-spoken, and short. [Subject to legal review pre-launch — not yet a substitute for fully attorney-drafted terms.]*
`;
