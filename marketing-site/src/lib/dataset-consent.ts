// Dataset spec v2 §4.3 / §7.0 item 1 — P2 consent capture + minimal rights
// registry. Tier-agnostic so Implementation checkout can reuse it; only the
// Audit checkout is wired today.
//
// Storage (SESSIONS KV):
// - The consent fields are stamped on the order's session record at checkout
//   creation (30-day TTL), so an abandoned checkout leaves no lasting record.
// - `rights:{tier}:{session_id}` holds the permission evidence with NO TTL,
//   written only once payment is confirmed, so a later withdrawal can still be
//   honored after the order record expires (§4.1 rights registry). It never
//   stores the buyer email, the URL or any free text — only flags, the text
//   version shown, timestamps and method.
//
// FAIL-SAFE SEMANTICS. The rights write is best-effort and off the critical
// path: attempted on every paid dodo-webhook delivery and again when
// fulfillment marks the order ready, each scheduled (waitUntil or
// fire-and-forget) with a hard timeout, never awaited, never retried beyond
// those attempts. It can be lost. A MISSING rights record therefore means
// consent_sellable = 0 (never in any licensed/published aggregate) and no
// recorded P1 opt-out beyond the default (internal learning allowed under the
// LIA; an opt-out request is still honored via recordP1OptOut, which creates
// the record if absent). Losing a record can only under-include data, never
// over-include it. Every reader must go through readRightsFlags.

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
  // "none": created by an opt-out request for an order with no record.
  consent_method: "checkout_checkbox" | "none";
  // P1 internal learning: legitimate interest, on by default; 1 = opted out
  // (set from a privacy@ request via recordP1OptOut).
  p1_opt_out: ConsentFlag;
  p1_opt_out_at?: number;
};

export function rightsKey(tier: ConsentTier, sessionId: string): string {
  return `rights:${tier}:${sessionId}`;
}

export type SessionConsentFields = {
  consent_sellable?: ConsentFlag;
  consent_text_version?: string;
  consent_at?: number;
};

// Builds the rights record from the consent fields stamped on a paid order's
// session. Returns null for sessions created before the consent UI existed:
// no text was shown, so there is no evidence to record.
export function buildRightsRecord(
  tier: ConsentTier,
  session: SessionConsentFields,
): RightsRecord | null {
  if (
    typeof session.consent_text_version !== "string" ||
    typeof session.consent_at !== "number"
  ) {
    return null;
  }
  return {
    tier,
    consent_sellable: session.consent_sellable === 1 ? 1 : 0,
    consent_text_version: session.consent_text_version,
    consent_at: session.consent_at,
    consent_method: "checkout_checkbox",
    p1_opt_out: 0,
  };
}

// Write-if-absent (KV read-then-write; not atomic, acceptable here). Never
// throws. Callers use scheduleRightsWrite, not this directly.
export async function writeRightsRecord(
  kv: KVNamespace,
  sessionId: string,
  record: RightsRecord,
): Promise<void> {
  try {
    // Never overwrite: a webhook replay must not reset a recorded opt-out.
    if (await kv.get(rightsKey(record.tier, sessionId))) return;
    await kv.put(rightsKey(record.tier, sessionId), JSON.stringify(record));
  } catch {
    console.error(`RIGHTS_REGISTRY_WRITE_FAILED tier=${record.tier} session_id=${sessionId}`);
  }
}

export const RIGHTS_WRITE_TIMEOUT_MS = 2000;

// Schedules the write off the critical path: handed to waitUntil when the
// caller has an execution context, else fire-and-forget. Capped at
// RIGHTS_WRITE_TIMEOUT_MS; the returned promise is for tests only and always
// resolves. Callers must NOT await it on a response or delivery path.
export function scheduleRightsWrite(
  kv: KVNamespace,
  sessionId: string,
  record: RightsRecord,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.error(`RIGHTS_REGISTRY_WRITE_TIMEOUT tier=${record.tier} session_id=${sessionId}`);
      resolve();
    }, RIGHTS_WRITE_TIMEOUT_MS);
  });
  const p = Promise.race([writeRightsRecord(kv, sessionId, record), timeout])
    .catch(() => {})
    .finally(() => clearTimeout(timer));
  if (waitUntil) {
    try {
      waitUntil(p);
    } catch {
      // No usable context: the promise still runs fire-and-forget.
    }
  }
  return p;
}

export type RightsFlags = { consent_sellable: ConsentFlag; p1_opt_out: ConsentFlag };

// The only way to read permissions. Absent or unreadable record → consent 0,
// no recorded opt-out (see FAIL-SAFE SEMANTICS above).
export function rightsFlagsFrom(raw: string | null): RightsFlags {
  if (!raw) return { consent_sellable: 0, p1_opt_out: 0 };
  try {
    const r = JSON.parse(raw) as Partial<RightsRecord>;
    return {
      consent_sellable: r.consent_sellable === 1 ? 1 : 0,
      p1_opt_out: r.p1_opt_out === 1 ? 1 : 0,
    };
  } catch {
    return { consent_sellable: 0, p1_opt_out: 0 };
  }
}

export async function readRightsFlags(
  kv: KVNamespace,
  tier: ConsentTier,
  sessionId: string,
): Promise<RightsFlags> {
  return rightsFlagsFrom(await kv.get(rightsKey(tier, sessionId)));
}

// Record a P1 (internal learning) opt-out for one order. If the order has no
// rights record (lost write, or pre-consent-UI order), one is created with
// consent_sellable 0, so the opt-out is never lost. Idempotent: the first
// opt-out time is kept.
export async function recordP1OptOut(
  kv: KVNamespace,
  tier: ConsentTier,
  sessionId: string,
  now: number = Date.now(),
): Promise<void> {
  const raw = await kv.get(rightsKey(tier, sessionId));
  const record: RightsRecord = raw
    ? (JSON.parse(raw) as RightsRecord)
    : {
        tier,
        consent_sellable: 0,
        consent_text_version: "",
        consent_at: 0,
        consent_method: "none",
        p1_opt_out: 0,
      };
  const next: RightsRecord = {
    ...record,
    p1_opt_out: 1,
    p1_opt_out_at: record.p1_opt_out_at ?? now,
  };
  await kv.put(rightsKey(tier, sessionId), JSON.stringify(next));
}
