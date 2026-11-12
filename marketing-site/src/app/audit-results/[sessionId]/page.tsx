import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AuditResultsPoller from "@/components/AuditResultsPoller";
import AuditIntakeForm from "@/components/AuditIntakeForm";
import { isIntakeSessionId } from "@/lib/dataset-intake";
import { AUDIT_REVIEW_HOLD_RUNNING_INTRO } from "@/lib/audit-review-hold";

export const metadata: Metadata = {
  title: "Your Astrant Audit — Astrant",
  robots: { index: false, follow: false },
};

export default async function AuditResultsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-3xl px-6 py-20">
          <div className="inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm font-mono text-emerald-400">
            Astrant Score v1 · Audit report
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
            Your audit
          </h1>
          <AuditResultsPoller
            sessionId={sessionId}
            intro={
              <p className="mt-6 text-lg text-[var(--color-muted)]">
                Hold tight — we&apos;re scanning your site, generating remediation
                guidance for each gap, and rendering your PDF. Usually 2–4
                minutes. We&apos;ll also email you the PDF.
              </p>
            }
            heldIntro={
              <p className="mt-6 text-lg text-[var(--color-muted)]">
                {AUDIT_REVIEW_HOLD_RUNNING_INTRO}
              </p>
            }
            afterPaid={
              isIntakeSessionId(sessionId) ? (
                <AuditIntakeForm sessionId={sessionId} />
              ) : null
            }
          />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
