import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { METHODOLOGY_CALIBRATION_MD } from "@/lib/methodology-content";

// Slice A2 — Publishing Bundle. Public calibration record for Dim 6.
//
// Claims-level only per feedback_published_claims_vs_private_techniques.md.
// Source content: pharos-publishing-bundle-content.md (OneDrive workspace);
// inlined via @/lib/methodology-content per the OpenNext/CWD constraint
// described in legal-content.ts.
//
// Route choice: /methodology/calibration (NOT /methodology) avoids IA
// collision with the existing /score/methodology page (per-score dimension
// rubric, customer-facing). Top-level /methodology is a hub stub that
// redirects here until additional methodology surfaces are added.

export const metadata: Metadata = {
  title: "Calibration Methodology — Astrant",
  description:
    "How Astrant's Dim 6 (Citation Audit) is calibrated. Multi-pass methodology against a corpus of control domains, with operational discipline practices and known limits at engine version dim6:v3.",
};

export default function MethodologyCalibrationPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <article className="prose prose-invert mx-auto max-w-3xl px-6 py-16 prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-4xl prose-h1:sm:text-5xl prose-h2:mt-12 prose-h2:text-2xl prose-h3:mt-8 prose-h3:text-xl prose-p:text-[var(--color-muted)] prose-li:text-[var(--color-muted)] prose-strong:text-[var(--color-fg)] prose-a:text-[var(--color-fg)] prose-a:no-underline hover:prose-a:underline prose-code:bg-[var(--color-surface)] prose-code:px-1 prose-table:text-sm prose-th:text-[var(--color-fg)] prose-td:text-[var(--color-muted)]">
          <ReactMarkdown>{METHODOLOGY_CALIBRATION_MD}</ReactMarkdown>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
