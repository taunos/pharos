// On-page rendering of the paid Audit report (/audit-results/[sessionId]).
//
// Content, wording and ordering come ONLY from buildAuditReportModel — the
// same model renderAuditHtml turns into the PDF — so the page and the PDF
// cannot drift. This file is markup + design-system styling only; do not add
// buyer-facing strings here, add them to AUDIT_REPORT_COPY.
//
// Split in three because the composite block sits above the download buttons
// (in the "Audit ready" card) and the rest of the report sits below them:
//   AuditReportHeader  → generated line, URL, composite, scope (PDF top block)
//   AuditReportSummary → executive summary (right after the card, as in the PDF)
//   AuditReportBody    → dimensions, gaps, JSON export, footer

import {
  AUDIT_REPORT_COPY as C,
  type AuditReportModel,
  type ScoreBand,
} from "@/lib/audit-report-model";
import { gradeColorClass } from "@/lib/score-display";

const BAND_BG: Record<ScoreBand, string> = {
  high: "bg-emerald-500",
  mid: "bg-yellow-500",
  low: "bg-orange-500",
  fail: "bg-red-500",
};

const H2 =
  "border-t border-[var(--color-border)] pt-8 text-2xl font-bold tracking-tight";

export function AuditReportHeader({ model }: { model: AuditReportModel }) {
  return (
    <div data-testid="audit-report-header">
      <p className="mt-2 font-mono text-xs text-[var(--color-muted)]">
        {model.generatedLabel}
      </p>
      <p className="mt-3 break-all font-mono text-sm text-[var(--color-fg)]">
        {model.url}
      </p>
      <div className="mt-3 flex items-baseline gap-4">
        <span className="text-5xl font-bold text-[var(--color-fg)]">
          {model.composite.score}
        </span>
        <span
          className={`font-mono text-2xl ${gradeColorClass(model.composite.grade)}`}
        >
          {model.composite.grade}
        </span>
      </div>
      <p className="mt-3 text-sm italic text-[var(--color-muted)]">
        {model.scopeNote}
      </p>
      <p className="mt-2 text-sm italic text-[var(--color-muted)]">
        {model.versionNote}
      </p>
    </div>
  );
}

export function AuditReportSummary({ model }: { model: AuditReportModel }) {
  return (
    <section data-testid="audit-report-summary" className="flex flex-col gap-3">
      <h2 className="text-2xl font-bold tracking-tight">{C.summaryHeading}</h2>
      {model.executiveSummary.map((s, i) => (
        <p key={i} className="text-lg leading-relaxed text-[var(--color-fg)]">
          {s}
        </p>
      ))}
    </section>
  );
}

function ScoreBar({ pct, band }: { pct: number; band: ScoreBand }) {
  return (
    <div
      className="mt-2 h-1.5 w-full overflow-hidden bg-[var(--color-bg)]"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full ${BAND_BG[band]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Grid instead of <table>: four columns don't fit 375px. On mobile each row
// is "name · score · weight" with the notes underneath; from sm up it is the
// PDF's four-column layout with the column headings shown.
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1 sm:grid-cols-[28%_9%_9%_minmax(0,1fr)]";

function Dimension({ d }: { d: AuditReportModel["dimensions"][number] }) {
  if (d.kind === "na") {
    return (
      <section
        data-testid="audit-report-dimension"
        className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-lg font-semibold text-[var(--color-fg)]">
            {d.name}{" "}
            <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-dim)]">
              {d.unmeasured ? C.naLabelUnmeasured : C.naLabel}
            </span>
          </h3>
          <span className="font-mono text-sm italic text-[var(--color-dim)]">
            {d.unmeasured ? C.naGradeUnmeasured : C.naGrade}
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{d.note}</p>
      </section>
    );
  }
  return (
    <section
      data-testid="audit-report-dimension"
      className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 text-lg font-semibold text-[var(--color-fg)]">
          {d.name}
        </h3>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="text-2xl font-bold text-[var(--color-fg)]">
            {d.score}
          </span>
          <span className={`font-mono text-base ${gradeColorClass(d.grade)}`}>
            {d.grade}
          </span>
        </span>
      </div>
      <ScoreBar pct={d.barPct} band={d.band} />
      <div role="table" aria-label={d.name} className="mt-4 text-sm">
        <div role="rowgroup" className="hidden sm:block">
          <div
            role="row"
            className={`${ROW_GRID} border-b border-[var(--color-border)] pb-2 font-mono text-xs uppercase tracking-wider text-[var(--color-dim)]`}
          >
            {C.checkColumns.map((h) => (
              <span key={h} role="columnheader">
                {h}
              </span>
            ))}
          </div>
        </div>
        <div role="rowgroup">
          {d.checks.map((s) => (
            <div
              key={s.id}
              role="row"
              data-testid="audit-report-check"
              className={`${ROW_GRID} border-b border-[var(--color-rule)] py-2.5 last:border-b-0`}
            >
              <span role="cell" className="font-medium text-[var(--color-fg)]">
                {s.name}
              </span>
              <span
                role="cell"
                className="whitespace-nowrap font-mono text-[var(--color-muted)]"
              >
                {s.scoreLabel}
              </span>
              <span
                role="cell"
                className="whitespace-nowrap font-mono text-[var(--color-muted)]"
              >
                {s.weightLabel}
              </span>
              <span
                role="cell"
                className="col-span-3 break-words text-[var(--color-muted)] sm:col-span-1"
              >
                {s.notes}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AuditReportBody({ model }: { model: AuditReportModel }) {
  const [f1, f2] = C.footer;
  return (
    <div data-testid="audit-report-body" className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h2 className={H2}>{C.dimensionsHeading}</h2>
        {model.dimensions.map((d) => (
          <Dimension key={d.id} d={d} />
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={H2}>{C.gapsHeading}</h2>
        <p className="text-[var(--color-muted)]">{C.gapsIntro}</p>
        {model.gaps.length === 0 ? (
          <p className="italic text-[var(--color-muted)]">{C.gapsEmpty}</p>
        ) : (
          model.gaps.map((g) => (
            <article
              key={g.key}
              data-testid="audit-report-gap"
              className="border-l-2 border-red-400 bg-red-500/10 p-4 sm:p-5"
            >
              <header className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <h3 className="min-w-0 text-lg font-semibold text-[var(--color-fg)]">
                  {g.checkName}
                </h3>
                <div className="flex shrink-0 flex-wrap gap-x-3 font-mono text-xs text-[var(--color-muted)]">
                  <span>{g.dimensionName}</span>
                  <span>{g.metaLabel}</span>
                </div>
              </header>
              <p className="mt-3 break-words text-sm text-[var(--color-muted)]">
                <strong className="text-[var(--color-fg)]">{C.findingLabel}</strong>{" "}
                {g.finding}
              </p>
              <p className="mt-2 break-words text-[var(--color-fg)]">
                <strong>{C.remediationLabel}</strong> {g.remediation}
              </p>
            </article>
          ))
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={H2}>{C.jsonHeading}</h2>
        <p className="text-[var(--color-muted)]">{C.jsonIntro}</p>
        {/* Collapsed by default: it is long and the same bytes are one click
            away as a download. Summary text is the PDF heading's subject,
            so no new copy. */}
        <details className="border border-[var(--color-border)] bg-[var(--color-surface)]">
          <summary className="cursor-pointer px-4 py-3 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)] hover:text-[var(--color-fg)]">
            JSON
          </summary>
          <pre
            data-testid="audit-report-json"
            className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words border-t border-[var(--color-border)] p-4 font-mono text-xs text-[var(--color-muted)]"
          >
            {model.jsonExport}
          </pre>
        </details>
      </section>

      <footer className="border-t border-[var(--color-rule)] pt-6 text-sm text-[var(--color-muted)]">
        {f1.before}
        <a className="text-[var(--color-fg)] underline" href={f1.href}>
          {f1.label}
        </a>
        . {f2.before}
        <a className="text-[var(--color-fg)] underline" href={f2.href}>
          {f2.label}
        </a>
        .
      </footer>
    </div>
  );
}
