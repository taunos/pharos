# Terms of Service

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
