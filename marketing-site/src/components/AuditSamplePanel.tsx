// Audit V2 — labelled static sample-report panel for the /audit hero right column.
// Pure presentational, all literals (no fetch, no real-data dependency — I6).
// Deliberately re-implements the score-bar/row markup rather than importing
// ScorePanel: ScorePanel renders no per-dimension remediation, and forcing a
// remediation slot into it would mean a render-prop/fork on a component live on
// three other pages. The minor <Bar> duplication is the cheaper, lower-coupling
// call for a single static sample (NIT-1). Do NOT extract a shared primitive.
//
// The panel shows a *generic placeholder domain* (sample-saas.example — RFC-2606
// reserved, unregistrable) under an explicit "Sample report" chip — never
// astrant.io, never an unlabelled mock (LOW-1 / I6). The scored D6 row is
// accurate to the v0 deliverable: the paid Audit genuinely ships a one-time
// Citation Visibility snapshot (audit-fulfill → runDim6Paid → splicePaidDim6).

const COMPOSITE = { score: 64, grade: "C" };

// Mid-range, imperfect, visible gaps — a sample that finds real, fixable
// problems sells the remediation deliverable. Composite is exact for these
// rows: 55·15 + 45·20 + 85·10 + 70·20 + 80·15 + 60·20 = 6375 / 100 = 63.75 → 64.
const ROWS = [
  {
    id: 1,
    name: "llms.txt Quality",
    score: 55,
    fix: "Add a curated llms.txt with a blockquote summary",
    effort: "~2h",
  },
  {
    id: 2,
    name: "MCP Discoverability",
    score: 45,
    fix: "Deploy an MCP server at mcp.your-domain",
    effort: "~1d",
  },
  {
    id: 3,
    name: "OpenAPI Catalog",
    score: 85,
    fix: "Strong — keep the catalog current",
    effort: "maintain",
  },
  {
    id: 4,
    name: "Structured Capability",
    score: 70,
    fix: "Add Service + Offer JSON-LD on /pricing",
    effort: "~2h",
  },
  {
    id: 5,
    name: "Agent-Parsable Content",
    score: 80,
    fix: "Render pricing as text, not images",
    effort: "~1h",
  },
  {
    id: 6,
    name: "Citation Visibility",
    score: 60,
    fix: "Add a comparison/FAQ page agents can lift a citation from",
    effort: "~3h",
  },
];

function barColor(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 60) return "bg-yellow-500";
  if (score >= 40) return "bg-orange-500";
  return "bg-red-500";
}

function gradeColorClass(grade: string): string {
  if (grade.startsWith("A")) return "text-emerald-400";
  if (grade.startsWith("B")) return "text-emerald-300";
  if (grade === "C") return "text-yellow-400";
  if (grade === "D") return "text-orange-400";
  return "text-red-400";
}

function Bar({ score }: { score: number }) {
  const w = Math.max(0, Math.min(100, score));
  return (
    <div
      className="mt-2 h-1.5 w-full overflow-hidden bg-[var(--color-bg)]"
      role="progressbar"
      aria-valuenow={w}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full ${barColor(score)}`} style={{ width: `${w}%` }} />
    </div>
  );
}

export default function AuditSamplePanel() {
  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-5">
      {/* Header strip — sample label + placeholder domain + composite. */}
      <div className="flex items-center justify-between gap-3">
        {/* Status chip — rounded-full retained per the design-system carve-out
            (status chips are the shape token; cards/panels stay radius-free). */}
        <span className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-0.5 text-xs font-mono uppercase tracking-wider text-[var(--color-muted)]">
          Sample report
        </span>
        <span className="font-mono text-xs text-[var(--color-muted)]">
          sample-saas.example
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-4xl font-bold tracking-tight">
          {COMPOSITE.score}
        </span>
        <span className="text-lg text-[var(--color-muted)]">/100</span>
        <span
          className={`ml-2 font-mono text-sm ${gradeColorClass(COMPOSITE.grade)}`}
        >
          Grade {COMPOSITE.grade}
        </span>
      </div>

      {/* Six per-dimension rows — score bar + short effort-tagged remediation. */}
      <div className="mt-5 flex flex-col">
        {ROWS.map((d) => (
          <div
            key={d.id}
            className="border-t border-[var(--color-border)] py-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold">
                <span className="mr-2 font-mono text-xs text-[var(--color-muted)]">
                  D{d.id}
                </span>
                {d.name}
              </span>
              <span className="whitespace-nowrap font-mono text-sm">
                <span className="font-bold text-[var(--color-fg)]">
                  {d.score}
                </span>
                <span className="text-[var(--color-muted)]">/100</span>
              </span>
            </div>
            <Bar score={d.score} />
            <p className="mt-1.5 text-xs text-[var(--color-muted)]">
              {d.fix}{" "}
              <span className="font-mono text-[var(--color-dim)]">
                · {d.effort}
              </span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
