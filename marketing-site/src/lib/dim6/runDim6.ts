// Slice 3b Dim 6 — runDim6 (Task 11) — ties orchestrator output to
// the SubCheck/DimensionResult shape audit-fulfill expects to splice into
// the scan result.
//
// Two callers:
//   - audit-fulfill (PAID path): replaces the scanner's free-tier demo Dim 6
//     with a real audit. Calls runDim6Paid().
//   - scanner free-tier branch (FREE path): scanner has its own standalone
//     module — does NOT import this file. See scanner/src/checks/dim6-citation.ts.
//
// Daily soft cap (locked decision 8): 100 paid audits/day, KV-tracked under
// `dim6:budget:<YYYY-MM-DD>`. When exceeded, runDim6Paid returns the same
// na:true demo-preview shape the free-tier emits, with a note about the cap.

import { runDim6Orchestrator, type OrchestratorEnv } from "./orchestrator";
import {
  ALL_MODEL_IDS,
  DIM6_ENGINE_VERSION,
  type CellEnvelope,
  type Dim6Result,
} from "./types";
import { DIM6_DISCLOSURE } from "./disclosure";

export interface Dim6SubCheck {
  id: string;
  name: string;
  weight: number;
  score: number;
  passed: boolean;
  notes: string;
  na?: boolean;
}

export interface Dim6Dimension {
  dimension_id: 6;
  dimension_name: "Citation Visibility";
  score: number;
  grade: string;
  sub_checks: Dim6SubCheck[];
  na?: boolean;
  // Cells are NOT placed on the public dimension shape (would leak raw model
  // text into the per-scan JSON). Audit-fulfill consumes them separately for
  // the corpus write.
}

export interface RunDim6Result {
  dimension: Dim6Dimension;
  cells: CellEnvelope[]; // for the corpus writer
  raw: Dim6Result | null; // null when we short-circuited (free or daily-cap)
  // Test C-A R2-4: true ONLY for the daily-cap short-circuit, so the paid
  // fulfillment can defer instead of shipping a partial report as ready.
  capped: boolean;
}

const DAILY_CAP = 100;

function todayKey(): string {
  const now = new Date();
  // YYYY-MM-DD UTC
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "A-";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

// Sub-check signatures locked per spec §2.3 — Profound-swap path emits these
// SAME ids/names so the only field that changes is `source` ("diy" vs
// "profound") at the corpus row level. Don't rename.
const SUBCHECK_IDS = {
  domain_named_rate: "citation_domain_named_rate",
  url_referenced_rate: "citation_url_referenced_rate",
  context_relevant_rate: "citation_context_relevant_rate",
  no_competitor_first_rate: "citation_no_competitor_first_rate",
} as const;

// Compute per-cell breakdown rates by re-parsing the structured notes the
// ladder emitted. Notes shape: "score=X/100; domain_named=true; ...".
// Less brittle than re-running the parser here.
function rateOf(cells: CellEnvelope[], flag: string): number {
  const measurable = cells.filter((c) => !c.result.unmeasurable);
  if (measurable.length === 0) return 0;
  const trues = measurable.filter((c) =>
    c.result.notes.includes(`${flag}=true`)
  ).length;
  return Math.round((trues / measurable.length) * 100);
}

/** dim6:v4: competitor-first sub-check note when no competitor list was given. */
export const COMPETITOR_FIRST_NA_NOTE =
  "Not measured: this Audit doesn't take a competitor list yet, so there is nothing to compare against. Weight redistributed across the other Citation Visibility checks.";

function buildSubChecks(result: Dim6Result, hasCompetitorList: boolean): Dim6SubCheck[] {
  const cells = result.cells;
  const measurableCount = cells.length - result.unmeasurableCount;

  const dnRate = rateOf(cells, "domain_named");
  const urlRate = rateOf(cells, "url_referenced");
  const ctxRate = rateOf(cells, "context_relevant");
  const compRate = rateOf(cells, "no_competitor_first");

  const summary = `${measurableCount}/${cells.length} cells measurable across ${ALL_MODEL_IDS.length} models. Per-model averages: ${ALL_MODEL_IDS.map(
    (m) => `${m.split(":")[0]}=${result.perModelAverage[m] ?? "n/a"}`
  ).join(", ")}.`;

  return [
    {
      id: SUBCHECK_IDS.domain_named_rate,
      name: "Models name your domain",
      weight: 40,
      score: dnRate,
      passed: dnRate >= 70,
      notes: `${dnRate}% of measurable cells named the target domain. ${summary}`,
    },
    {
      id: SUBCHECK_IDS.url_referenced_rate,
      name: "Models cite your URL",
      weight: 30,
      score: urlRate,
      passed: urlRate >= 70,
      notes: `${urlRate}% of measurable cells included at least one URL on the target host.`,
    },
    {
      id: SUBCHECK_IDS.context_relevant_rate,
      name: "Models treat your domain as the principal answer",
      weight: 20,
      score: ctxRate,
      passed: ctxRate >= 70,
      notes: `${ctxRate}% of measurable cells positioned the target domain in the first half of the response (vs a footer-style mention).`,
    },
    // dim6:v4: N/A without a competitor list (the cell scores give it no
    // points either, see parser.ts), so it is never a gap. With no list the
    // old rate was really the AFFIRM rate (DENY cells carry no flag).
    hasCompetitorList
      ? {
          id: SUBCHECK_IDS.no_competitor_first_rate,
          name: "Competitor-first check (not measured)",
          weight: 10,
          score: compRate,
          passed: compRate >= 70,
          notes: `${compRate}% of measurable cells avoided a competitor-first mention.`,
        }
      : {
          id: SUBCHECK_IDS.no_competitor_first_rate,
          name: "Competitor-first check (not measured)",
          weight: 10,
          score: 0,
          passed: false,
          notes: COMPETITOR_FIRST_NA_NOTE,
          na: true,
        },
  ];
}

/**
 * Build the DAILY-CAP-EXCEEDED dimension. Distinct note from free-tier so
 * audit-fulfill can flag the customer (and re-queue for tomorrow) cleanly.
 */
function buildDailyCapDim6(): Dim6Dimension {
  return {
    dimension_id: 6,
    dimension_name: "Citation Visibility",
    score: 0,
    grade: gradeFor(0),
    na: true,
    sub_checks: [
      {
        id: "dim6_daily_cap_exceeded",
        name: "Citation Visibility (daily cap)",
        weight: 1,
        score: 0,
        passed: false,
        notes:
          "Citation Visibility audit hit Astrant's daily soft cap (100 paid audits/day). " +
          "Your audit will run automatically tomorrow and an updated PDF will be emailed " +
          "when it's ready. The other 5 dimensions are scored normally below.",
        na: true,
      },
    ],
  };
}

/**
 * Test C-A R2-4: non-incrementing peek at the paid Dim 6 daily budget, so the
 * paid fulfillment can defer BEFORE spending a scan + LLM calls. Same key and
 * threshold as runDim6Paid's own check (which stays authoritative for races).
 */
export async function isDim6CapReached(kv: KVNamespace): Promise<boolean> {
  const rawCount = await kv.get(`dim6:budget:${todayKey()}`);
  const count = rawCount ? parseInt(rawCount, 10) : 0;
  return Number.isFinite(count) && count >= DAILY_CAP;
}

export interface Dim6PaidEnv extends OrchestratorEnv {
  // Same KV used for the Dim 6 cell cache; we also use it for the daily-cap
  // counter. Distinct key prefix `dim6:budget:` so cache eviction never
  // bumps the counter.
}

/**
 * Run a paid Dim 6 audit. Returns:
 *   - { dimension: na:true (daily-cap), cells: [], raw: null } when over the cap
 *   - { dimension: real, cells: full, raw: Dim6Result } on a successful run
 *   - { dimension: na:true (all unmeasurable), cells: full, raw: Dim6Result }
 *     when every cell came back unmeasurable (network-pocalypse). Composite
 *     drops the dim cleanly via na:true.
 */
export async function runDim6Paid(
  env: Dim6PaidEnv,
  scanUrl: string,
  signals: { homepageHtml?: string | null; titleTag?: string | null } = {},
  competitorHosts: string[] = []
): Promise<RunDim6Result> {
  // Daily-cap check.
  const budgetKey = `dim6:budget:${todayKey()}`;
  const rawCount = await env.cacheKv.get(budgetKey);
  const count = rawCount ? parseInt(rawCount, 10) : 0;
  if (Number.isFinite(count) && count >= DAILY_CAP) {
    console.warn(
      `[dim6/runDim6Paid] daily cap reached (${count}/${DAILY_CAP}); short-circuiting to na:true`
    );
    return {
      dimension: buildDailyCapDim6(),
      cells: [],
      raw: null,
      capped: true,
    };
  }
  // Increment BEFORE the call so concurrent requests under the cap can't
  // both squeak through. Best-effort.
  try {
    await env.cacheKv.put(budgetKey, String(count + 1), {
      // 36 hour TTL — long enough to span daylight saving / clock skew.
      expirationTtl: 36 * 60 * 60,
    });
  } catch {
    // KV write failure is non-fatal — we'll just slightly over-spend.
  }

  const result = await runDim6Orchestrator(env, {
    scanUrl,
    signals,
    competitorHosts,
  });

  // Every cell unmeasurable → na:true.
  if (result.score === null) {
    return {
      dimension: {
        dimension_id: 6,
        dimension_name: "Citation Visibility",
        score: 0,
        grade: gradeFor(0),
        na: true,
        sub_checks: [
          {
            id: "dim6_all_unmeasurable",
            name: "Citation Visibility (unmeasurable)",
            weight: 1,
            score: 0,
            passed: false,
            notes: `All ${result.totalCells} cells came back unmeasurable (network or provider failures). Dimension dropped from composite. ${DIM6_DISCLOSURE.engineLine}`,
            na: true,
          },
        ],
      },
      cells: result.cells,
      raw: result,
      capped: false,
    };
  }

  const subChecks = buildSubChecks(result, competitorHosts.length > 0);
  const score = result.score; // already aggregated 0-100

  return {
    dimension: {
      dimension_id: 6,
      dimension_name: "Citation Visibility",
      score,
      grade: gradeFor(score),
      sub_checks: subChecks,
    },
    cells: result.cells,
    raw: result,
    capped: false,
  };
}

export { DIM6_ENGINE_VERSION };
