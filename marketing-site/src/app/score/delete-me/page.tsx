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
            for 24 hours. Once confirmed, every Score scan record associated
            with that email is purged: PII fields cleared, captured email
            removed, gap-report PDF deleted from storage.
          </p>
          <p className="mt-3 text-sm italic text-[var(--color-muted)]">
            Anonymous scan records (with PII removed) may be retained for
            aggregate metrics. No identifying information remains. See our{" "}
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
