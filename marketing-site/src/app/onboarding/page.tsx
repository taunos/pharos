// F3 D6.2: post-purchase onboarding form. Token-gated; validates the JWT
// from the welcome email before rendering. Form-submit handler at
// /api/onboarding/submit. See spec v3.2 §6.2.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyOnboardingToken, type OnboardingTokenEnv } from "@/lib/onboarding-token";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

// Force dynamic rendering: getCloudflareContext requires runtime env (not available
// during static prerender). Token verification + env access happens per-request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Set up your Astrant Standard monitoring",
  description: "Tell us what to monitor. Two minutes.",
};

const FIELD_CLASS =
  "mt-2 block w-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-base text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none";
const LABEL_CLASS = "block text-sm font-semibold text-[var(--color-fg)]";
const HINT_CLASS = "mt-1 text-sm text-[var(--color-muted)]";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const env = getCloudflareContext().env as unknown as OnboardingTokenEnv;
  const params = await searchParams;
  const token = params.t ?? "";
  const result = await verifyOnboardingToken(env, token);

  if (!result.ok) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main>
          <section className="mx-auto max-w-2xl px-6 py-20 sm:py-28">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              This setup link is no longer valid
            </h1>
            <p className="mt-6 text-lg text-[var(--color-muted)]">
              Your link may have expired (links are good for 7 days) or already been used.
            </p>
            <p className="mt-4 text-base text-[var(--color-muted)]">
              Reply to your welcome email to request a fresh link, or contact{" "}
              <a
                href="mailto:support@astrant.io"
                className="text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                support@astrant.io
              </a>
              .
            </p>
          </section>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-2xl px-6 py-20 sm:py-24">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Set up your Astrant Standard monitoring
          </h1>
          <p className="mt-6 text-lg text-[var(--color-muted)]">
            Tell us what to monitor. Setup takes about two minutes. You can update any of
            this later by replying to your monthly digest.
          </p>

          <form method="POST" action="/api/onboarding/submit" className="mt-10 space-y-6">
            <input type="hidden" name="t" value={token} />

            <div>
              <label htmlFor="brand_name" className={LABEL_CLASS}>
                Brand name
              </label>
              <p className={HINT_CLASS}>How your brand should be referenced in reports.</p>
              <input
                id="brand_name"
                type="text"
                name="brand_name"
                required
                maxLength={50}
                placeholder="e.g., HubSpot"
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label htmlFor="domain" className={LABEL_CLASS}>
                Primary domain
              </label>
              <p className={HINT_CLASS}>The root domain agents associate with your brand.</p>
              <input
                id="domain"
                type="text"
                name="domain"
                required
                placeholder="yourbrand.com"
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label htmlFor="category" className={LABEL_CLASS}>
                Category
              </label>
              <p className={HINT_CLASS}>
                So we can run category-appropriate citation probes.
              </p>
              <select
                id="category"
                name="category"
                required
                defaultValue=""
                className={FIELD_CLASS}
              >
                <option value="" disabled>
                  Choose a category…
                </option>
                <option value="saas">SaaS</option>
                <option value="ecommerce">E-commerce</option>
                <option value="fintech">Fintech</option>
                <option value="developer-tools">Developer tools</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="competitors_csv" className={LABEL_CLASS}>
                Competitors <span className="font-normal text-[var(--color-muted)]">(optional)</span>
              </label>
              <p className={HINT_CLASS}>
                Up to 5, comma-separated. We&rsquo;ll measure your cite-share relative to them.
              </p>
              <input
                id="competitors_csv"
                type="text"
                name="competitors_csv"
                placeholder="Salesforce, Pipedrive, Close"
                className={FIELD_CLASS}
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
              >
                Start monitoring
              </button>
            </div>
          </form>

          <p className="mt-10 text-sm text-[var(--color-muted)]">
            Your first monthly digest arrives after the next monthly cycle completes, covering
            data from your subscription start onward.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
