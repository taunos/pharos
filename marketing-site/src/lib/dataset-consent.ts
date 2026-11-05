// Dataset spec v2 §4.3 / §7.0 item 1 — P2 consent capture + minimal rights
// registry. Tier-agnostic so Implementation checkout can reuse it; only the
// Audit checkout is wired today.
//
// Storage (SESSIONS KV):
// - The consent fields are stamped on the order's session record at checkout
//   creation (30-day TTL), so an abandoned checkout leaves no lasting record.
// - `rights:{tier}:{session_id}` (consent record) holds the P2 consent
//   evidence with NO TTL, written only once payment is confirmed, so it
//   outlives the order record (§4.1 rights registry). It never stores the
//   buyer email, the URL or any free text — only the flag, the text version
//   shown, the timestamp and the method.
// - `rights-optout:{tier}:{session_id}` (restriction) records a P1 opt-out,
//   NO TTL. Written only by recordP1OptOut; only ever created, never deleted
//   or rewritten by code. Initialization never reads or writes it, so no
//   in-flight consent write can erase an opt-out (no locking needed).
//
// FAIL-SAFE SEMANTICS. The consent write is best-effort and off the critical
// path: attempted on every paid dodo-webhook delivery and again when
// fulfillment marks the order ready, each scheduled (waitUntil or
// fire-and-forget) with a hard timeout, never awaited, never retried beyond
// those attempts. It can be lost. Readers (readRightsFlags / rightsFlagsFrom)
// apply, in order:
//   1. a restriction key exists → p1_opt_out = 1 AND consent_sellable = 0,
//      whatever the consent record says;
//   2. a missing or unreadable consent record → consent_sellable = 0 and no
//      recorded P1 opt-out beyond the default (internal learning allowed
//      under the LIA; opt-out requests honored via recordP1OptOut).
// Losing a record can therefore only under-include data, never over-include
// it. Every reader must go through readRightsFlags.

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

// The consent record. P1 opt-outs are NOT stored here (see restriction key).
export type RightsRecord = {
  tier: ConsentTier;
  // P2 licensed aggregates: explicit opt-in at checkout.
  consent_sellable: ConsentFlag;
  consent_text_version: string;
  consent_at: number;
  consent_method: "checkout_checkbox";
};

// P1 restriction (opt-out of internal learning).
export type OptOutRecord = {
  opted_out_at: number;
  method: "email_request";
};

export function rightsKey(tier: ConsentTier, sessionId: string): string {
  return `rights:${tier}:${sessionId}`;
}

export function optOutKey(tier: ConsentTier, sessionId: string): string {
  return `rights-optout:${tier}:${sessionId}`;
}

export type SessionConsentFields = {
  consent_sellable?: ConsentFlag;
  consent_text_version?: string;
  consent_at?: number;
};

// Builds the consent record from the consent fields stamped on a paid order's
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
  };
}

// Write-if-absent (KV read-then-write; not atomic, acceptable: concurrent
// writers write the same evidence). Never touches the restriction key. Never
// throws. Callers use scheduleRightsWrite, not this directly.
export async function writeRightsRecord(
  kv: KVNamespace,
  sessionId: string,
  record: RightsRecord,
): Promise<void> {
  try {
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
// The timeout does not cancel the underlying KV write: a late write can still
// land after it. Harmless, because the consent record never carries or
// overrides a P1 opt-out (restrictions live in their own key).
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

// The only way to interpret permissions (see FAIL-SAFE SEMANTICS above).
export function rightsFlagsFrom(
  consentRaw: string | null,
  optOutRaw: string | null,
): RightsFlags {
  if (optOutRaw !== null) return { consent_sellable: 0, p1_opt_out: 1 };
  if (!consentRaw) return { consent_sellable: 0, p1_opt_out: 0 };
  try {
    const r = JSON.parse(consentRaw) as Partial<RightsRecord>;
    return { consent_sellable: r.consent_sellable === 1 ? 1 : 0, p1_opt_out: 0 };
  } catch {
    return { consent_sellable: 0, p1_opt_out: 0 };
  }
}

export async function readRightsFlags(
  kv: KVNamespace,
  tier: ConsentTier,
  sessionId: string,
): Promise<RightsFlags> {
  const [consentRaw, optOutRaw] = await Promise.all([
    kv.get(rightsKey(tier, sessionId)),
    kv.get(optOutKey(tier, sessionId)),
  ]);
  return rightsFlagsFrom(consentRaw, optOutRaw);
}

// Record a P1 (internal learning) opt-out for one order, from a privacy@
// email request. Writes only the restriction key; never touches the consent
// record. Idempotent: an existing restriction (and its first timestamp) is
// kept. Works whether or not a consent record exists.
export async function recordP1OptOut(
  kv: KVNamespace,
  tier: ConsentTier,
  sessionId: string,
  now: number = Date.now(),
): Promise<void> {
  if ((await kv.get(optOutKey(tier, sessionId))) !== null) return;
  const record: OptOutRecord = { opted_out_at: now, method: "email_request" };
  await kv.put(optOutKey(tier, sessionId), JSON.stringify(record));
}
