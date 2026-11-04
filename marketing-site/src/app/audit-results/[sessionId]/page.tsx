import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AuditResultsPoller from "@/components/AuditResultsPoller";

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
            Astrant · AEO Audit
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
            Your audit
          </h1>
          <AuditResultsPoller
            sessionId={sessionId}
            intro={
              <p className="mt-6 text-lg text-[var(--color-muted)]">
                Hold tight — we&apos;re scanning your site, generating remediation
                guidance for each gap, and rendering your PDF. Usually about 60
                seconds. We&apos;ll also email you the PDF.
              </p>
            }
          />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
