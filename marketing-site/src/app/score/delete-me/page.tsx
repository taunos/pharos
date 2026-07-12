import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import DeleteMeForm from "@/components/score/DeleteMeForm";

export const metadata: Metadata = {
  title: "Delete my data — Astrant",
  description:
    "Submit your email to delete every Score scan record associated with it. We'll send you a confirmation link valid for 24 hours.",
  robots: { index: false, follow: false },
};

export default function DeleteMePage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-2xl px-6 py-20">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Delete my data
          </h1>
          <p className="mt-6 text-lg text-[var(--color-muted)]">
            Submit your email below. We&apos;ll send a confirmation link valid
            for 24 hours. Opening it shows a confirmation page; only when you
            click Delete do we remove your personal data from every Score scan
            record associated with that email — the stored email, IP address,
            unsubscribe token, opt-in state, and personalized report are deleted.
          </p>
          <p className="mt-3 text-sm italic text-[var(--color-muted)]">
            The submitted URL and technical scan results remain for calibration
            — because a URL can contain identifying information, we don&apos;t
            claim the retained record is fully anonymous. See our{" "}
            {/* Logo + Foundation slice: link demoted accent → fg. */}
            <a
              className="text-[var(--color-fg)] underline-offset-4 hover:underline"
              href="/privacy"
            >
              Privacy Policy
            </a>{" "}
            for full details.
          </p>
          <div className="mt-10">
            <DeleteMeForm />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
