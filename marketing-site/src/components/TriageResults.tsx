"use client";

import { HEADINGS, type Recommendation, type TriageCta } from "@/lib/triage";

export type TriageResultData = {
  recommendation: Recommendation;
  explanation: string;
  cta: TriageCta;
  cached: boolean;
};

export default function TriageResults({
  data,
  onReset,
}: {
  data: TriageResultData;
  onReset: () => void;
}) {
  const { recommendation, explanation, cta } = data;
  const isHighlight = recommendation !== "not_fit";

  // Logo + Foundation slice:
  // - rounded-lg/rounded-md stripped (decision 4).
  // - Highlight-card amber border replaced with shadow + full-opacity surface;
  //   the muted/non-highlight variant uses /60 surface — visual hierarchy
  //   preserved without --color-accent on a card border (decision 5).
  // - Highlight CTA fill keeps amber (primary CTA — recommended action).
  // - Non-highlight CTA hover-border demoted accent → fg.
  // - Status pill rounded-full retained (functional pill shape).
  const cardCls = isHighlight
    ? "border border-[var(--color-border)] bg-[var(--color-surface-2)] p-8 shadow-lg shadow-black/30"
    : "border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 p-8";

  const buttonCls = isHighlight
    ? "inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
    : "inline-flex border border-[var(--color-border)] bg-[var(--color-bg)] px-6 py-3 text-base font-semibold text-[var(--color-fg)] transition hover:border-[var(--color-fg)]";

  return (
    <div className="flex flex-col gap-6">
      <div className={cardCls}>
        {isHighlight ? (
          <div className="inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-mono text-emerald-400">
            Recommendation
          </div>
        ) : (
          <div className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1 text-xs font-mono text-[var(--color-muted)]">
            Honest take
          </div>
        )}
        <h3 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          {HEADINGS[recommendation]}
        </h3>
        <p className="mt-4 text-lg text-[var(--color-muted)]">{explanation}</p>
        <div className="mt-8">
          {cta.url.startsWith("mailto:") ? (
            <a href={cta.url} className={buttonCls}>
              {cta.label}
            </a>
          ) : (
            <a
              href={cta.url}
              target="_blank"
              rel="noreferrer"
              className={buttonCls}
            >
              {cta.label}
            </a>
          )}
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            {cta.description}
          </p>
        </div>
        <p className="mt-8 text-sm">
          <a
            href="mailto:contact@astrant.io?subject=Astrant%20fit%20check%20%E2%80%94%20override"
            className="text-[var(--color-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
          >
            Got a different read? Email us →
          </a>
        </p>
      </div>

      <p className="text-sm italic text-[var(--color-muted)]">
        This recommendation came from an automated analysis. If your situation
        is more nuanced than the form captured, the email link above goes
        straight to the founder.
      </p>

      <button
        type="button"
        onClick={onReset}
        className="self-start text-sm text-[var(--color-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
      >
        ← Start a new fit check
      </button>
    </div>
  );
}
