// Boundary-mapping constants for B1.3 v1.1 cron-fix.

export const ASTRANT_PROBE_SENTINEL = 'astrant';

// ASTRANT_BASELINE: per spec D25; probe_subject is literal brand-string 'Astrant'
// (matches shipped B1.3 v1.0 semantics at storage.ts:40 — slot 6 of probeOneTarget for the Astrant cycle).
export const ASTRANT_BASELINE = {
  customer_id: ASTRANT_PROBE_SENTINEL,
  probe_subject: 'Astrant',
  target_category: 'AEO tools',
};

export function isAstrantSentinel(s: string | null | undefined): boolean {
  return s === ASTRANT_PROBE_SENTINEL;
}

export function customerIdToProbeArg(s: string): string | null {
  return isAstrantSentinel(s) ? null : s;
}
