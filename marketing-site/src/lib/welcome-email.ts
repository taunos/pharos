// F3 D6.1 / F4.1.2: tier-agnostic welcome email. Sent by the dodo-webhook handler after
// CAS-claim of subscriptions.welcome_email_sent_at. See spec v3.2 §6.1 + §11.3.
// F-Fnd: optional foundingResult 4th-arg + 3 body variants (newly_assigned /
// already_founder+active / standard) + RFC 8058 List-Unsubscribe headers + pre-send
// suppression check via email_suppressions D1 table.

import { Resend } from "resend";
import { issueOnboardingToken, type OnboardingTokenEnv } from "./onboarding-token";
import { issueAccountLink } from "./account-link";
import type { AssignmentResult } from './founding-pricing';
import {
  isEmailSuppressed,
  mintUnsubscribeToken,
  buildUnsubscribeLink,
} from './email-suppressions';
import type { D1Database } from '@cloudflare/workers-types';
import {
  renderEmailLayout,
  escapeHtml,
  emailButton,
  emailLink,
  emailStack,
  emailList,
  EMAIL_PALETTE,
} from './email-layout';

type WelcomeBody = { text: string; html: string };

export interface WelcomeEmailEnv extends OnboardingTokenEnv {
  RESEND_API_KEY: string;
  ACCOUNT_LINK_SECRET: string;
  // F-Fnd Phase 3.0 widenings:
  CITATION_DB: D1Database;
  EMAIL_UNSUB_SIGNING_KEY: string;
  ASTRANT_BASE_URL: string;
}

export async function sendWelcomeEmail(
  env: WelcomeEmailEnv,
  subscriptionId: string,
  customerEmail: string,
  foundingResult: AssignmentResult | null = null,
): Promise<void> {

  // F-Fnd OQ3 path (b): pre-send suppression check.
  if (await isEmailSuppressed(env, customerEmail)) {
    console.warn(JSON.stringify({
      kind: 'welcome_email_suppressed',
      subscription_id: subscriptionId,
      timestamp: Date.now(),
    }));
    return;
  }

  const token = await issueOnboardingToken(env, subscriptionId);
  const onboardingLink = `https://astrant.io/onboarding?t=${token}`;
  const accountLink = await issueAccountLink(env, subscriptionId, "https://astrant.io");

  // F-Fnd OQ3 path (b): mint signed unsubscribe token + build link.
  const unsubToken = await mintUnsubscribeToken(env, customerEmail);
  const unsubscribeLink = buildUnsubscribeLink(env.ASTRANT_BASE_URL, unsubToken);

  const resend = new Resend(env.RESEND_API_KEY);

  let body: WelcomeBody;
  let subject: string;

  if (foundingResult?.kind === 'newly_assigned') {
    const tierEntries = Object.entries(foundingResult.foundingTierLocks);
    const [, tierPriceCents] = tierEntries[0];
    body = buildFoundingWelcomeBody({
      foundingOrderSeq: foundingResult.foundingOrderSeq,
      tierPriceCents,
      onboardingLink,
      accountLink,
      unsubscribeLink,
    });
    subject = `Welcome, Founding Member #${foundingResult.foundingOrderSeq}!`;
  } else if (foundingResult?.kind === 'already_founder' && foundingResult.founding_status === 'active') {
    const tierEntries = Object.entries(foundingResult.foundingTierLocks);
    const [, tierPriceCents] = tierEntries[0];
    body = buildFounderActiveBackBody({
      foundingOrderSeq: foundingResult.foundingOrderSeq,
      tierPriceCents,
      accountLink,
      unsubscribeLink,
    });
    subject = "Welcome back to Astrant";
  } else {
    body = buildStandardWelcomeBody({
      onboardingLink,
      accountLink,
      unsubscribeLink,
    });
    // F4.1 D14: tier-agnostic subject. buildStandardWelcomeBody fires for ALL non-Founders
    // (both Standard + Pro tiers); tier-specific welcome is F4.2 territory per Bruno lock #12.
    subject = "Astrant is active — set up your monitoring";
  }

  await resend.emails.send({
    from: "Astrant <reports@astrant.io>",
    to: customerEmail,
    replyTo: "contact@astrant.io",
    subject,
    text: body.text,
    html: body.html,
    headers: {
      'List-Unsubscribe': `<${unsubscribeLink}>, <mailto:unsubscribe@astrant.io?subject=unsubscribe-${unsubToken}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

function unsubscribeFooterHtml(lead: string, unsubscribeLink: string): string {
  return `${escapeHtml(lead)} To unsubscribe from future welcome and account emails: ${emailLink(unsubscribeLink, "Unsubscribe", EMAIL_PALETTE.muted)}`;
}

function buildFoundingWelcomeBody(args: {
  foundingOrderSeq: number;
  tierPriceCents: number;
  onboardingLink: string;
  accountLink: string;
  unsubscribeLink: string;
}): WelcomeBody {
  const tierPriceDollars = Math.floor(args.tierPriceCents / 100);
  const heading = `Welcome — you're Founding Member #${args.foundingOrderSeq}`;
  const intro = `You've claimed one of the 30 Founding-cohort slots. Your subscription price of $${tierPriceDollars}/mo is locked at this rate for as long as your subscription remains active. If you cancel, your Founding pricing is permanently forfeited — re-subscribing later returns you to current rates.`;
  const points = [
    "Your locked rate applies to your current tier. If you upgrade, that tier's price at the time of upgrade also locks for you (sticky-locks).",
    "The 30-slot cohort is cumulative. Once 30 unique customers have claimed Founding slots, the offer closes permanently — even if some Founders later cancel.",
    "Founder identity persists in your /account page whether your subscription is active or cancelled.",
  ];
  const lead = "You're receiving this welcome email because you started a subscription with Astrant.";
  const text = `${heading}.

${intro}

Get started: ${args.onboardingLink}
Manage your subscription: ${args.accountLink}

A few things to know about Founding pricing:

${points.map((pt) => `  - ${pt}`).join("\n")}

Questions? Reply to this email — it reaches a person.

—Astrant

—
${lead} To unsubscribe from future welcome and account emails: ${args.unsubscribeLink}
`;
  const html = renderEmailLayout({
    preheader: `${heading}.`,
    heading,
    cards: [
      emailStack([
        escapeHtml(intro),
        `${emailLink(args.onboardingLink, "Get started")}<br />${emailLink(args.accountLink, "Manage your subscription")}`,
      ]),
      emailStack(["A few things to know about Founding pricing:", emailList(points.map(escapeHtml))]),
      emailStack(["Questions? Reply to this email — it reaches a person.", "—Astrant"]),
    ],
    footerHtmlLinesTrusted: [unsubscribeFooterHtml(lead, args.unsubscribeLink)],
    footerLines: [],
  });
  return { text, html };
}

function buildFounderActiveBackBody(args: {
  foundingOrderSeq: number;
  tierPriceCents: number;
  accountLink: string;
  unsubscribeLink: string;
}): WelcomeBody {
  const tierPriceDollars = Math.floor(args.tierPriceCents / 100);
  const heading = `Welcome back, Founding Member #${args.foundingOrderSeq}`;
  const intro = `Your Founding pricing of $${tierPriceDollars}/mo continues to apply for as long as your subscription remains active. Your Founder identity persists across subscription lifecycle events.`;
  const lead = "You're receiving this email because you have an active Astrant subscription.";
  const text = `${heading}.

${intro}

Manage your subscription: ${args.accountLink}

—Astrant

—
${lead} To unsubscribe from future welcome and account emails: ${args.unsubscribeLink}
`;
  const html = renderEmailLayout({
    preheader: `${heading}.`,
    heading,
    cards: [
      emailStack([
        escapeHtml(intro),
        emailLink(args.accountLink, "Manage your subscription"),
        "—Astrant",
      ]),
    ],
    footerHtmlLinesTrusted: [unsubscribeFooterHtml(lead, args.unsubscribeLink)],
    footerLines: [],
  });
  return { text, html };
}

// buildStandardWelcomeBody preserves V3 V-read existing body content + appends unsubscribe footer.
// Variable rename per v8.1 L3: existing ${onboardingUrl} -> ${args.onboardingLink};
// existing ${accountUrl} -> ${args.accountLink}.
// E1: the text part no longer carries raw Markdown (`**Next step**`,
// `[Set up monitoring](…)`); the HTML part renders them as bold + a button.
function buildStandardWelcomeBody(args: {
  onboardingLink: string;
  accountLink: string;
  unsubscribeLink: string;
}): WelcomeBody {
  const heading = "Welcome to Astrant";
  const intro =
    "Your monthly citation-monitoring subscription is active. Once you complete onboarding, your first artifact — a 6-dimension AEO audit of your domain — arrives within 24 hours (usually within 10 minutes). Monthly citation-tracking digests then deliver on the 1st of each month.";
  const nextStep = "tell us what to monitor. The setup form takes about 2 minutes:";
  const choices = [
    "The brand name agents should be citing for you",
    "Your primary domain",
    "Your category (so we can run category-appropriate citation probes)",
    "Up to 5 competitors to compare against (optional)",
  ];
  const expiry = "This link is good for 7 days. If you need a fresh link, reply to this email.";
  const lead = "You're receiving this welcome email because you started a subscription with Astrant.";
  const text = `${heading}.

${intro}

Next step: ${nextStep}

Set up monitoring: ${args.onboardingLink}

You'll choose:
${choices.map((c) => `- ${c}`).join("\n")}

${expiry}

Manage your subscription anytime: ${args.accountLink}

—Astrant

—
${lead} To unsubscribe from future welcome and account emails: ${args.unsubscribeLink}
`;
  const html = renderEmailLayout({
    preheader: `${heading}.`,
    heading,
    cards: [
      emailStack([
        escapeHtml(intro),
        `<strong>Next step</strong>: ${escapeHtml(nextStep)}`,
        emailButton("Set up monitoring", args.onboardingLink),
      ]),
      emailStack(["You'll choose:", emailList(choices.map(escapeHtml)), escapeHtml(expiry)]),
      emailStack([`${emailLink(args.accountLink, "Manage your subscription")} anytime.`, "—Astrant"]),
    ],
    footerHtmlLinesTrusted: [unsubscribeFooterHtml(lead, args.unsubscribeLink)],
    footerLines: [],
  });
  return { text, html };
}
