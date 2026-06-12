// F2 v6.1 D22 — return_url target for Dodo Implementation checkout.
// Customer pays → Dodo redirects → this page renders thank-you + expectation-setting copy.
// Mirrors F3.1's /onboarding/done shape per spec §22.

import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Thank you — Astrant Implementation",
  description: "Your Astrant Implementation patch arrives by email within 24 hours.",
  robots: { index: false, follow: false },
};

export default async function F2SuccessPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main>
        <section className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Thank you for your purchase
          </h1>

          <p className="mt-6 text-lg text-[var(--color-muted)]">
            Your Astrant Implementation patch arrives by email within 24 hours
            (typically within 5-15 minutes).
          </p>

          <div className="mt-10 border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
            <h2 className="text-xl font-semibold">Over the next 90 days</h2>
            <ul className="mt-4 flex flex-col gap-2 text-[var(--color-muted)]">
              <li>• <strong>Day 30</strong> — trajectory check-in audit</li>
              <li>• <strong>Day 60</strong> — trajectory check</li>
              <li>• <strong>Day 90</strong> — outcome audit + Standard continuation option</li>
            </ul>
            <p className="mt-4 text-sm text-[var(--color-muted)]">
              Citation-tracking probes run continuously across 4 major-model
              providers over the 90-day window.
            </p>
          </div>

          <p className="mt-8 text-[var(--color-muted)]">
            Reply to the delivery email with any questions.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
