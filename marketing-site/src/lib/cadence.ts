// marketing-site/src/lib/cadence.ts
// F4.1: cadence helpers. Mirrored from citation-tracking/src/cadence.ts.

export type ProbeCadence = 'daily' | 'twice_weekly';

export function computeNextProbeAt(cadence: ProbeCadence, now: Date): number {
  const cronHourUtc = 2;
  const baseDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), cronHourUtc, 0, 0));

  if (cadence === 'daily') {
    return Math.floor((baseDate.getTime() + 86400 * 1000) / 1000);
  }

  const FIXED_DAYS = [1, 4];  // Mon + Thu (UTC days) per Bruno lock #15
  const currentDay = baseDate.getUTCDay();

  let daysAhead = 7;
  for (const targetDay of FIXED_DAYS) {
    let diff = (targetDay - currentDay + 7) % 7;
    if (diff === 0) diff = 7;
    if (diff < daysAhead) daysAhead = diff;
  }

  return Math.floor((baseDate.getTime() + daysAhead * 86400 * 1000) / 1000);
}
