// Score V3 — shared score-panel: large composite + result-forward dimension
// rows. Single source of truth for the /score sample panel AND the
// /score/[id] result page, so the demo and a real result render identically.
// Result-forward (D7): the per-dimension bar + score lead; the weight renders
// as a small secondary mono annotation, not a co-equal headline number.
//
// Pure presentational (no directive) — renders in server components and the
// client fallback shell alike. Reuses the Score V2 helpers.

import type { Composite, DimensionResult } from "@/lib/audit-types";
import { gradeColorClass, isDim6DemoPreview } from "@/lib/score-display";

// Dimension weights live in the scanner scoring map, not on DimensionResult.
// Mirror scanner/src/scoring.ts (D1–D6 / 15·20·10·20·15·20).
const DIM_WEIGHTS: Record<number, number> = {
  1: 15,
  2: 20,
  3: 10,
  4: 20,
  5: 15,
  6: 20,
};

function Bar({ score }: { score: number }) {
  const w = Math.max(0, Math.min(100, score));
  const color =
    score >= 70
      ? "bg-emerald-500"
      : score >= 60
        ? "bg-yellow-500"
        : score >= 40
          ? "bg-orange-500"
          : "bg-red-500";
  return (
    <div
      className="mt-2 h-1.5 w-full overflow-hidden bg-[var(--color-bg)]"
      role="progressbar"
      aria-valuenow={w}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function code(id: number) {
  return `D${id}`;
}

export default function ScorePanel({
  composite,
  dimensions,
  compact = false,
  // Home V2 — per-surface D6 presentation. "auto" (default) keeps /score and
  // /score/[id] fully unchanged: the D6 demo-preview row renders via the
  // isDim6DemoPreview discriminator. "auditNote" (homepage dogfood rail only)
  // drops the D6 row entirely and shows a one-line Audit upsell plus a
  // 5-dimension scope line under the grade. The composite is passed in
  // pre-computed (D6 already excluded) and is unchanged in both modes.
  dim6 = "auto",
}: {
  composite: Composite;
  dimensions: DimensionResult[];
  compact?: boolean;
  dim6?: "auto" | "auditNote";
}) {
  const rows =
    dim6 === "auditNote"
      ? dimensions.filter((d) => d.dimension_id !== 6)
      : dimensions;
  return (
    <div
      className={
        compact
          ? "grid gap-5"
          : "grid gap-10 lg:grid-cols-[auto_1fr] lg:items-start lg:gap-16"
      }
    >
      {/* Composite — the headline result. */}
      <div>
        <div className="flex items-baseline gap-2">
          <span
            className={
              compact
                ? "text-4xl font-bold tracking-tight"
                : "text-7xl font-bold tracking-tight sm:text-8xl"
            }
          >
            {composite.score}
          </span>
          <span
            className={
              compact
                ? "text-lg text-[var(--color-muted)]"
                : "text-2xl text-[var(--color-muted)]"
            }
          >
            /100
          </span>
        </div>
        <p
          className={`mt-2 font-mono ${compact ? "text-sm" : "text-lg"} ${gradeColorClass(composite.grade)}`}
        >
          Grade {composite.grade}
        </p>
        {dim6 === "auditNote" ? (
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Readiness across 5 technical dimensions.
          </p>
        ) : null}
      </div>

      {/* Dimension rows — result-forward; weight demoted to a small annotation. */}
      <div className="flex flex-col">
        {rows.map((d) => {
          const weight = DIM_WEIGHTS[d.dimension_id];
          const weightLabel = weight != null ? `${weight}%` : "";

          // Demo-preview row (Dim 6 on the free tier) — sniffed BEFORE the
          // generic na branch (early-precedence), identical to the result page.
          if (isDim6DemoPreview(d)) {
            return (
              <div
                key={d.dimension_id}
                className={`border-t border-[var(--color-border)] ${compact ? "py-2" : "py-4"}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-base font-semibold">
                    <span className="mr-2 font-mono text-xs text-[var(--color-muted)]">
                      {code(d.dimension_id)}
                    </span>
                    {d.dimension_name}
                    <span className="ml-2 border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[var(--color-accent)]">
                      Demo preview
                    </span>
                  </span>
                  <span className="font-mono text-xs text-[var(--color-muted)]">
                    {weightLabel}
                  </span>
                </div>
                <p className={`mt-1 italic text-[var(--color-muted)] ${compact ? "text-xs" : "text-sm"}`}>
                  Live with the $79 Audit
                </p>
              </div>
            );
          }

          // Whole-dimension N/A (e.g. content-only site → OpenAPI N/A).
          if (d.na) {
            return (
              <div
                key={d.dimension_id}
                className={`border-t border-[var(--color-border)] ${compact ? "py-2" : "py-4"}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-base font-semibold">
                    <span className="mr-2 font-mono text-xs text-[var(--color-muted)]">
                      {code(d.dimension_id)}
                    </span>
                    {d.dimension_name}
                    <span className="ml-2 border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted)]">
                      N/A
                    </span>
                  </span>
                  <span className="font-mono text-xs text-[var(--color-muted)]">
                    {weightLabel}
                  </span>
                </div>
                <p className={`mt-1 italic text-[var(--color-muted)] ${compact ? "text-xs" : "text-sm"}`}>
                  Doesn&apos;t apply to this site — dropped from the composite, no
                  penalty.
                </p>
              </div>
            );
          }

          // Scored row — score + grade lead; bar; weight as a small annotation.
          return (
            <div
              key={d.dimension_id}
              className={`border-t border-[var(--color-border)] ${compact ? "py-2" : "py-4"}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-base font-semibold">
                  <span className="mr-2 font-mono text-xs text-[var(--color-muted)]">
                    {code(d.dimension_id)}
                  </span>
                  {d.dimension_name}
                </span>
                <span className="flex items-baseline gap-2 whitespace-nowrap">
                  <span className="text-lg font-bold text-[var(--color-fg)]">
                    {d.score}
                  </span>
                  <span className={`font-mono text-sm ${gradeColorClass(d.grade)}`}>
                    {d.grade}
                  </span>
                  <span className="ml-1 font-mono text-xs text-[var(--color-muted)]">
                    {weightLabel}
                  </span>
                </span>
              </div>
              <Bar score={d.score} />
            </div>
          );
        })}
        {dim6 === "auditNote" ? (
          <p className="border-t border-[var(--color-border)] pt-3 text-sm italic text-[var(--color-muted)]">
            Citation Visibility &#8212; the 6th dimension &#8212; runs live in
            the $79 Audit.
          </p>
        ) : null}
      </div>
    </div>
  );
}
