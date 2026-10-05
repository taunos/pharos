// Test C-B: which waitlist a /api/waitlist capture came from. Only these
// values are stored; anything else (or absent) keeps the historical "waitlist".
const WAITLIST_SOURCES = ["audit", "other_plans"] as const;
export type WaitlistSource = (typeof WAITLIST_SOURCES)[number] | "waitlist";

export function waitlistSource(raw: unknown): WaitlistSource {
  return typeof raw === "string" && (WAITLIST_SOURCES as readonly string[]).includes(raw)
    ? (raw as WaitlistSource)
    : "waitlist";
}
