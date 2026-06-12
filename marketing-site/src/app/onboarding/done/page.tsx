// F3: post-submit confirmation page. Reached via 303 redirect from /api/onboarding/submit.
// F3.2 D9.3: when ?s=&sig= continuation token present, renders the "Manage your subscription anytime" link.

import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Astrant Standard monitoring — set up",
  description: "Your monitoring configuration is saved.",
};

export default async function OnboardingDonePage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; sig?: string }>;
}) {
  const params = await searchParams;
  const accountUrl =
    params.s && params.sig
      ? `/account?s=${encodeURIComponent(params.s)}&sig=${encodeURIComponent(params.sig)}`
      : null;

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-2xl px-6 py-20 sm:py-28">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            You&rsquo;re set up
          </h1>
          <p className="mt-6 text-lg text-[var(--color-muted)]">
            Astrant Standard is monitoring your citation share starting now. Your first
            monthly digest will arrive after the next monthly cycle completes — partial
            month for the first delivery, full months from then on.
          </p>

          <div className="mt-10 border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
            <h2 className="text-lg font-semibold">What happens next</h2>
            <ul className="mt-4 space-y-3 text-base text-[var(--color-muted)]">
              <li>
                <strong className="text-[var(--color-fg)]">Daily probes</strong> — we query
                4 AI providers (ChatGPT, Claude, Perplexity, Gemini) once per day across 15
                category-appropriate prompts to measure when agents cite your brand.
              </li>
              <li>
                <strong className="text-[var(--color-fg)]">Monthly digest</strong> — on the
                1st of each month, a citation-tracking report lands in your inbox as a PDF
                plus inline HTML body. Covers cite-share trend, competitor comparison, and
                vocabulary-association signals.
              </li>
              <li>
                <strong className="text-[var(--color-fg)]">Want to change something?</strong>{" "}
                Reply to any monthly digest, or email{" "}
                <a
                  href="mailto:support@astrant.io"
                  className="text-[var(--color-accent)] underline-offset-2 hover:underline"
                >
                  support@astrant.io
                </a>
                .
              </li>
            </ul>
          </div>

          <p className="mt-10 text-sm text-[var(--color-muted)]">
            You can close this tab. We&rsquo;ll reach out by email when your first digest
            ships.
          </p>

          {accountUrl && (
            <p className="mt-6 text-sm text-[var(--color-muted)]">
              <a
                href={accountUrl}
                className="text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                Manage your subscription anytime
              </a>{" "}
              — cancel, reactivate, or view your subscription status.
            </p>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
