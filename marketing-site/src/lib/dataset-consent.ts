// Dataset spec v2 §4.3 / §7.0 item 1 — P2 consent capture + minimal rights
// registry. Tier-agnostic so Implementation checkout can reuse it; only the
// Audit checkout is wired today.
//
// Storage (SESSIONS KV):
// - The consent fields are stamped on the order's session record (30-day TTL).
// - `rights:{tier}:{session_id}` holds the permission evidence with NO TTL, so
//   a later withdrawal can still be honored after the order record expires
//   (§4.1 rights registry). It never stores the buyer email, the URL or any
//   free text — only flags, the text version shown, timestamps and method.

// Exact approved checkbox text (Bruno, 2026-11-05). Changing a single
// character requires a new CONSENT_SELLABLE_TEXT_VERSION.
export const CONSENT_SELLABLE_TEXT =
  "Let Astrant include my project in aggregate statistics it publishes or licenses to other companies (e.g. \"7 companies that did X saw Y\"). My company is never named and no individual record is shared. Optional — doesn't affect your price or service. I can withdraw at any time.";

export const CONSENT_SELLABLE_TEXT_VERSION = "p2-sellable-v1-2026-11-05";

export type ConsentFlag = 0 | 1;

// Only a literal boolean `true` from the client counts as opt-in. Absent,
// unknown or any other value is 0. Never affects price or flow.
export function parseConsentSellable(raw: unknown): ConsentFlag {
  return raw === true ? 1 : 0;
}

export type ConsentTier = "audit" | "implementation";

export type RightsRecord = {
  tier: ConsentTier;
  // P2 licensed aggregates: explicit opt-in at checkout.
  consent_sellable: ConsentFlag;
  consent_text_version: string;
  consent_at: number;
  consent_method: "checkout_checkbox";
  // P1 internal learning: legitimate interest, on by default; 1 = opted out
  // (set from a privacy@ request via recordP1OptOut).
  p1_opt_out: ConsentFlag;
  p1_opt_out_at?: number;
};

export function rightsKey(tier: ConsentTier, sessionId: string): string {
  return `rights:${tier}:${sessionId}`;
}

export function buildRightsRecord(
  tier: ConsentTier,
  consentSellable: ConsentFlag,
  now: number,
): RightsRecord {
  return {
    tier,
    consent_sellable: consentSellable,
    consent_text_version: CONSENT_SELLABLE_TEXT_VERSION,
    consent_at: now,
    consent_method: "checkout_checkbox",
    p1_opt_out: 0,
  };
}

// Best-effort: a rights-registry failure never blocks checkout. The session
// record still carries the consent fields for its 30-day life.
export async function writeRightsRecord(
  kv: KVNamespace,
  sessionId: string,
  record: RightsRecord,
): Promise<void> {
  try {
    await kv.put(rightsKey(record.tier, sessionId), JSON.stringify(record));
  } catch {
    console.error(`RIGHTS_REGISTRY_WRITE_FAILED tier=${record.tier} session_id=${sessionId}`);
  }
}

// Record a P1 (internal learning) opt-out for one order. Returns false when
// the order has no rights record. Idempotent: the first opt-out time is kept.
export async function recordP1OptOut(
  kv: KVNamespace,
  tier: ConsentTier,
  sessionId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const raw = await kv.get(rightsKey(tier, sessionId));
  if (!raw) return false;
  const record = JSON.parse(raw) as RightsRecord;
  const next: RightsRecord = {
    ...record,
    p1_opt_out: 1,
    p1_opt_out_at: record.p1_opt_out_at ?? now,
  };
  await kv.put(rightsKey(tier, sessionId), JSON.stringify(next));
  return true;
}
