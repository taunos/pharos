# Custom Implementation

**Price:** From $5,000 (fixed quote after a $250-deposit scoping call — deposit is credited toward the final quote, not an extra fee)
**Delivery:** 2–4 weeks typical
**Fit check:** https://pharos.dev/custom

When the automated tiers don't fit — complex APIs, multi-region content, bespoke MCP tools, deep content rewrites, or multi-stakeholder engagements — we scope and build manually.

The /custom page hosts a 2-minute fit-check form. An LLM triage agent (Cloudflare Workers AI, deterministic) reads the submission and routes you to one of three outcomes: Standard Implementation ($1,299) if your needs are typical, Custom ($250 deposit + scoping call) if they genuinely exceed Standard, or a different path if Pharos isn't the right fit.

## When you need Custom

The standard Implementation ($1,299, https://pharos.dev/implementation) covers 80% of B2B SaaS sites. Custom exists for the other 20%:

- Complex public API (10+ operations needing tailored OpenAPI + custom MCP tools)
- Multi-region or multi-language content (content parity across markets)
- Industry-specific MCP tools (e.g. real-time inventory for e-commerce, booking availability for hospitality, quote generation for insurance)
- Major content rewrites (20+ pages or deep style-match requirements)
- Multi-stakeholder approvals (ops, legal, IT, or marketing teams that need a human liaison)
- Aggressive timelines (e.g. needed before a specific launch or event)
- Custom monitoring or reporting requirements
- Private/intranet MCP deployments

## How Custom works

1. **Fit check + scoping deposit** — Take the 2-minute fit check at https://pharos.dev/custom. If the triage agent confirms Custom fit, you book a scoping call by paying a $250 deposit via Dodo Payments. The deposit is fully credited toward your final fixed quote.
2. **Scoping call** (30 minutes) — You walk us through your site, API surface, team constraints, and timeline. We confirm fit and identify scope.
3. **Fixed quote** — Delivered within 48 hours of the scoping call. Includes deliverables list, timeline, and milestone schedule. You approve or negotiate. The $250 deposit is applied as a credit against this quote.
4. **Deposit + kickoff** — 50% of the agreed quote upfront (less the $250 already paid). Kickoff within a week.
5. **Execute** — Weekly progress updates. You have a direct Slack/email channel throughout.
6. **Handoff + final payment** — Same "you own everything" rule as standard Implementation. MCP on your infra, the build delivered as a Git-applicable patch (or, optionally for Custom-tier customers, opened as a PR via temporary deploy key / GitHub App if arranged during scoping), docs in your codebase.

## Why "from $5,000"?

$5K is the floor for a minimal custom engagement — roughly 40 hours of focused work. Most Custom builds land in the $8K–$20K range. Complex or multi-region engagements can run higher. Every quote is fixed before work starts — no hourly billing surprises.

## Why a $250 deposit to book the scoping call?

It's a seriousness filter. The fit-check form already routes most prospects to Standard or to a different path; only genuine Custom fits get to the scoping-call step. Asking for $250 (credited back) means we only take calls with prospects committed enough to put cash down. If you decide not to proceed after the scoping call, the deposit is non-refundable — it pays for the founder's time on a 30-minute call and the 48 hours of scoping work that produces the fixed quote.

## Common questions

**What's the $250 deposit for, and what happens if I don't proceed?**
It secures your scoping call slot and is credited toward your final fixed quote — not an extra fee. The deposit is non-refundable if you decide not to proceed, but that's deliberate: it filters for prospects genuinely committed to exploring the engagement, not a profit center on its own. We'd rather have $250 from serious prospects than spend free 30-minute slots on tire-kickers.

**How quickly will the scoping call be scheduled?**
Within one business day of the deposit clearing. We send a Cal.com link with available 30-minute slots over the following 3–5 business days. Most prospects book within 24 hours of receiving the link.

**What happens if my project actually fits Standard Implementation after the scoping call?**
We tell you, and credit your $250 deposit toward the Standard build instead of Custom. We'd rather lose Custom-tier margin than sell you a build you don't need — the trust is worth more long-term than the spread.

**Can the fit-check be wrong?**
It can. Edge cases sometimes route to Standard when they're actually Custom, or to "not a fit" when there's a real conversation worth having. If your situation feels different from what the recommendation says, email us — we read every override request, and the form is one input into the decision, not the decision itself.

**Do you sign NDAs before the scoping call?**
Yes. We use a standard mutual NDA we can send before the call, or sign yours if you have a preferred template. We regularly work with regulated industries (fintech, healthcare-adjacent) where NDA-first is the default.

**Can my CTO or security team join the scoping call?**
Yes, please bring them. Custom calls are often 3–4 people on the customer side (founder, CTO, sometimes security or compliance). 30 minutes works for an initial scoping conversation; for deeper technical reviews we'll schedule a follow-up.

## Related

- Score (free): https://pharos.dev/score
- Audit ($79, instant): https://pharos.dev/audit
- Implementation ($1,299, <24h automated): https://pharos.dev/implementation
- Retainer: https://pharos.dev/retainer
