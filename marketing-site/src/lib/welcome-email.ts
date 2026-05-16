// F3 D6.1: AutoPilot welcome email. Sent by the dodo-webhook handler after
// CAS-claim of subscriptions.welcome_email_sent_at. See spec v3.2 §6.1 + §11.3.

import { Resend } from "resend";
import { issueOnboardingToken, type OnboardingTokenEnv } from "./onboarding-token";

export interface WelcomeEmailEnv extends OnboardingTokenEnv {
  RESEND_API_KEY: string;
}

export async function sendWelcomeEmail(
  env: WelcomeEmailEnv,
  subscriptionId: string,
  customerEmail: string,
): Promise<void> {
  const token = await issueOnboardingToken(env, subscriptionId);
  const onboardingUrl = `https://astrant.io/onboarding?t=${token}`;
  const resend = new Resend(env.RESEND_API_KEY);
  const body = `Welcome to Astrant AutoPilot.

Your monthly citation-monitoring subscription is active. Once you complete onboarding, your first artifact — a 6-dimension AEO audit of your domain — arrives within 24 hours (usually within 10 minutes). Monthly citation-tracking digests then deliver on the 1st of each month.

**Next step**: tell us what to monitor. The setup form takes about 2 minutes:

[Set up monitoring](${onboardingUrl})

You'll choose:
- The brand name agents should be citing for you
- Your primary domain
- Your category (so we can run category-appropriate citation probes)
- Up to 5 competitors to compare against (optional)

This link is good for 7 days. If you need a fresh link, reply to this email.

—Astrant`;
  await resend.emails.send({
    from: "Astrant AutoPilot <reports@astrant.io>",
    to: customerEmail,
    subject: "Astrant AutoPilot is active — set up your monitoring",
    text: body,
  });
}
