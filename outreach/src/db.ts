// D1 helpers: control row, lease (D11), events, pause.
import { LEASE_MS } from "./clock";
import type { ControlRow, LeadState } from "./types";

export async function getControl(db: D1Database): Promise<ControlRow> {
  const c = await db.prepare("SELECT * FROM control WHERE id = 1").first<ControlRow>();
  if (!c) throw new Error("CONTROL_ROW_MISSING");
  return c;
}

/** Every handler takes this lease first; changes()=1 or exit. */
export async function takeLease(db: D1Database, now: number): Promise<string | null> {
  const id = crypto.randomUUID();
  const r = await db
    .prepare("UPDATE control SET tick_lease_until = ?, tick_lease_id = ? WHERE id = 1 AND tick_lease_until < ?")
    .bind(now + LEASE_MS, id, now)
    .run();
  return r.meta.changes === 1 ? id : null;
}

export async function releaseLease(db: D1Database, leaseId: string): Promise<void> {
  await db.prepare("UPDATE control SET tick_lease_until = 0 WHERE id = 1 AND tick_lease_id = ?").bind(leaseId).run();
}

export async function logEvent(db: D1Database, now: number, kind: string, leadId: string | null, detail?: Record<string, unknown>): Promise<void> {
  await db
    .prepare("INSERT INTO events (at, lead_id, kind, detail_json) VALUES (?, ?, ?, ?)")
    .bind(now, leadId, kind, detail ? JSON.stringify(detail) : null)
    .run();
}

export function eventStmt(db: D1Database, now: number, kind: string, leadId: string | null, detail?: Record<string, unknown>): D1PreparedStatement {
  return db
    .prepare("INSERT INTO events (at, lead_id, kind, detail_json) VALUES (?, ?, ?, ?)")
    .bind(now, leadId, kind, detail ? JSON.stringify(detail) : null);
}

/** Stop trip (§9.3): pause with a reason; stays paused until an Access-authenticated resume. */
export async function tripStop(db: D1Database, now: number, reason: string, detail?: Record<string, unknown>): Promise<boolean> {
  const r = await db
    .prepare(
      "UPDATE control SET paused = 1, pause_reason = ?, paused_at = COALESCE(CASE WHEN paused = 1 THEN paused_at END, ?), last_stop_trip_at = ? WHERE id = 1"
    )
    .bind(reason, now, now)
    .run();
  await logEvent(db, now, "stop_trip", null, { reason, ...(detail ?? {}) });
  return r.meta.changes === 1;
}

export async function resume(db: D1Database, now: number, by: string): Promise<void> {
  const c = await getControl(db);
  if (!c.paused) return;
  const add = c.ramp_start_at != null && c.paused_at != null && c.paused_at > c.ramp_start_at ? now - c.paused_at : 0;
  const stmts = [
    db
      .prepare("UPDATE control SET paused = 0, pause_reason = NULL, paused_at = NULL, ramp_paused_ms = ramp_paused_ms + ? WHERE id = 1 AND paused = 1")
      .bind(add),
    eventStmt(db, now, "resumed", null, { by_admin: by.length > 0, reason: c.pause_reason }),
  ];
  // E6: resuming acknowledges the data behind THIS stop only (stops.ts
  // stopAcknowledgedAt). No other stop is ever acknowledged implicitly.
  if (c.pause_reason) stmts.push(eventStmt(db, now, "stop_acknowledged", null, { reason: c.pause_reason }));
  await db.batch(stmts);
}

/** CAS lead transition. Returns true iff exactly one row moved from `from` to `to`. */
export async function moveLead(
  db: D1Database,
  now: number,
  leadId: string,
  from: LeadState | LeadState[],
  to: LeadState,
  reason: string | null = null
): Promise<boolean> {
  const froms = Array.isArray(from) ? from : [from];
  const terminal = ["replied", "bounced", "opted_out", "disqualified", "rejected", "closed"].includes(to);
  const r = await db
    .prepare(
      `UPDATE leads SET state = ?, state_reason = COALESCE(?, state_reason), updated_at = ?, terminal_at = CASE WHEN ? THEN ? ELSE terminal_at END
       WHERE id = ? AND state IN (${froms.map(() => "?").join(",")})`
    )
    .bind(to, reason, now, terminal ? 1 : 0, now, leadId, ...froms)
    .run();
  return r.meta.changes === 1;
}

export function moveLeadStmt(
  db: D1Database,
  now: number,
  leadId: string,
  from: LeadState[],
  to: LeadState,
  reason: string | null = null
): D1PreparedStatement {
  const terminal = ["replied", "bounced", "opted_out", "disqualified", "rejected", "closed"].includes(to);
  return db
    .prepare(
      `UPDATE leads SET state = ?, state_reason = COALESCE(?, state_reason), updated_at = ?, terminal_at = CASE WHEN ? THEN ? ELSE terminal_at END
       WHERE id = ? AND state IN (${from.map(() => "?").join(",")})`
    )
    .bind(to, reason, now, terminal ? 1 : 0, now, leadId, ...from);
}
