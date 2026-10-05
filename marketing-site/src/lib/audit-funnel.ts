// Test C-A (A2) — Audit purchase funnel record.
//
// KV `funnel:audit:{session_id}` in SESSIONS, written with NO TTL so the
// funnel survives the 30-day session expiry. Privacy: never stores the buyer
// email or the audited URL — only timestamps, status and the (UUID) source
// scan id. All writes are best-effort: a funnel failure never blocks checkout,
// payment handling or fulfillment.

export type FunnelStatus = "checkout_created" | "paid" | "ready" | "failed";

export type FunnelRecord = {
  created_at: number;
  source_scan_id: string | null;
  status: FunnelStatus;
  paid_at?: number;
  ready_at?: number;
  failed_at?: number;
};

export function funnelKey(sessionId: string): string {
  return `funnel:audit:${sessionId}`;
}

export async function createFunnelRecord(
  kv: KVNamespace,
  sessionId: string,
  sourceScanId: string | null,
): Promise<void> {
  const record: FunnelRecord = {
    created_at: Date.now(),
    source_scan_id: sourceScanId,
    status: "checkout_created",
  };
  try {
    await kv.put(funnelKey(sessionId), JSON.stringify(record));
  } catch {
    console.error(`AUDIT_FUNNEL_WRITE_FAILED session_id=${sessionId} status=checkout_created`);
  }
}

// Read-modify-write. Sessions with no funnel record (ap- / pre-C-A / smoke)
// are skipped — the funnel only tracks checkouts created via audit-create.
export async function updateFunnelStatus(
  kv: KVNamespace,
  sessionId: string,
  status: Exclude<FunnelStatus, "checkout_created">,
): Promise<void> {
  try {
    const raw = await kv.get(funnelKey(sessionId));
    if (!raw) return;
    const record = JSON.parse(raw) as FunnelRecord;
    const now = Date.now();
    const next: FunnelRecord = { ...record, status };
    if (status === "paid") next.paid_at = record.paid_at ?? now;
    if (status === "ready") next.ready_at = now;
    if (status === "failed") next.failed_at = now;
    await kv.put(funnelKey(sessionId), JSON.stringify(next));
  } catch {
    console.error(`AUDIT_FUNNEL_WRITE_FAILED session_id=${sessionId} status=${status}`);
  }
}
