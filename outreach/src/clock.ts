// Time helpers (UTC). All timestamps are epoch milliseconds.
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// §4 timing order: max tick work (≤3 min) < LEASE_MS < SEND_UNKNOWN_AFTER_MS < 2 × tick interval (30 min).
export const LEASE_MS = 10 * MIN;
export const SEND_UNKNOWN_AFTER_MS = 29 * MIN;
export const TICK_INTERVAL_MS = 15 * MIN;

export const SEND_WINDOW_START_HOUR = 13; // 13:00 UTC
export const SEND_WINDOW_END_HOUR = 21; // 21:00 UTC (exclusive)

export function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}

export function isWeekday(ms: number): boolean {
  const d = new Date(ms).getUTCDay();
  return d >= 1 && d <= 5;
}

/** ISO-8601 week label, e.g. "2026-W45". */
export function isoWeek(ms: number): string {
  const d = new Date(startOfUtcDay(ms));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Adds N business days (Mon–Fri), keeping the time of day. */
export function addBusinessDays(ms: number, n: number): number {
  let t = ms;
  let left = n;
  while (left > 0) {
    t += DAY;
    if (isWeekday(t)) left--;
  }
  return t;
}
