// Daily Browser Rendering invocation cap.
//
// Soft cap on Browser Rendering invocations from the scanner's Dim 5
// js_vs_no_js_render_diff sub-check. The cap is meant to detect runaway
// abuse, not to enforce a hard ceiling. Dignity hierarchy:
//
//   paid customers > free users > internal cap discipline
//
// Above-cap behavior at the call site:
// - Free-tier scanner: never invokes BR anyway; no impact.
// - Paid-tier scanner: degrades to static-fetch-only with a disclosed note
//   ("Browser Rendering daily cap reached; falling back to static signal.
//   Re-run tomorrow for full diff."). Still returns a useful answer.
// - Audit-fulfill PDF generation (separate writer): never degrades; we let
//   it overshoot the soft cap rather than fail a paying customer's audit.

const COST_PER_INVOCATION_USD = 0.05;
const DAILY_CAP_USD = 50;
export const DAILY_BR_INVOCATION_CAP = Math.floor(
  DAILY_CAP_USD / COST_PER_INVOCATION_USD
); // 1000

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function budgetKey(date: string = todayUtc()): string {
  return `br:budget:${date}`;
}

interface BudgetCounter {
  count: number;
}

export async function getDailyBrCount(kv: KVNamespace): Promise<number> {
  const raw = await kv.get(budgetKey());
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as BudgetCounter;
    return typeof parsed.count === "number" ? parsed.count : 0;
  } catch {
    return 0;
  }
}

export async function isOverDailyBrCap(kv: KVNamespace): Promise<boolean> {
  return (await getDailyBrCount(kv)) >= DAILY_BR_INVOCATION_CAP;
}

/**
 * Increment the daily BR counter. Best-effort: a KV failure here does NOT
 * block the BR call itself — the budget is for telemetry, not for blocking.
 * TTL ensures stale counters expire even if midnight rollover is missed.
 */
export async function incrementDailyBrCount(kv: KVNamespace): Promise<void> {
  const date = todayUtc();
  const key = budgetKey(date);
  try {
    const current = await getDailyBrCount(kv);
    const next: BudgetCounter = { count: current + 1 };
    await kv.put(key, JSON.stringify(next), {
      // 48h TTL: longer than 1 UTC day so the counter stays available for
      // post-mortem queries; shorter than indefinite so it eventually clears.
      expirationTtl: 60 * 60 * 48,
    });
  } catch (err) {
    console.error(
      `[br-budget] failed to increment counter: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
