// Active-customer ceiling (B1.3 v1.1 MAX_PROBE_TARGETS env binding, default 30).
// A missing or non-numeric value falls back to the default: a bare parseInt
// would yield NaN, and `count >= NaN` is always false, silently removing the cap.
// "0" is honoured (no new customers).
export const DEFAULT_MAX_PROBE_TARGETS = 30;

export function parseMaxProbeTargets(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_PROBE_TARGETS;
}
