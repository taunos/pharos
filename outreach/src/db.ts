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
      // last_stop_trip_at strictly increases on every trip (even within one millisecond):
      // resume() uses it to tell trips apart, since reason + paused_at can repeat.
      "UPDATE control SET paused = 1, pause_reason = ?, paused_at = COALESCE(CASE WHEN paused = 1 THEN paused_at END, ?), " +
        "last_stop_trip_at = MAX(?, COALESCE(last_stop_trip_at, 0) + 1) WHERE id = 1"
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
  // Every statement is tied to the exact stop this resume read: reason, paused_at AND
  // last_stop_trip_at (which every trip bumps). Any trip after the read, even one that
  // ends on the same reason and paused_at, defeats a stale, delayed resume, so it can't
  // lift a stop Bruno hasn't looked at. The events run before the UPDATE so their
  // condition still sees the pause.
  const samePause =
    "EXISTS (SELECT 1 FROM control WHERE id = 1 AND paused = 1 AND pause_reason IS ? AND paused_at IS ? AND last_stop_trip_at IS ?)";
  const pauseId = [c.pause_reason, c.paused_at, c.last_stop_trip_at] as const;
  const stmts = [
    db
      .prepare(`INSERT INTO events (at, lead_id, kind, detail_json) SELECT ?, NULL, 'resumed', ? WHERE ${samePause}`)
      .bind(now, JSON.stringify({ by_admin: by.length > 0, reason: c.pause_reason }), ...pauseId),
    db
      .prepare(
        "UPDATE control SET paused = 0, pause_reason = NULL, paused_at = NULL, ramp_paused_ms = ramp_paused_ms + ? WHERE id = 1 AND paused = 1 AND pause_reason IS ? AND paused_at IS ? AND last_stop_trip_at IS ?"
      )
      .bind(add, ...pauseId),
  ];
  // E6: resuming acknowledges the data behind THIS stop only (stops.ts
  // stopAcknowledgedAt). No other stop is ever acknowledged implicitly. Inbound
  // mail is acknowledged by commit order (the highest inbound rowid in this same
  // transaction), not by time: a complaint whose handling began before the resume
  // but committed after it has a higher rowid and still counts. inbound rows are
  // never deleted, so rowids only grow.
  // Only for the pause instance this resume read: the insert runs BEFORE the UPDATE
  // in the same transaction and requires that pause to still be in place, so a
  // second, delayed resume (outreach already running) acknowledges nothing.
  if (c.pause_reason) {
    stmts.splice(1, 0,
      db
        .prepare(
          "INSERT INTO events (at, lead_id, kind, detail_json) SELECT ?, NULL, 'stop_acknowledged', json_object('reason', ?, 'inbound_rowid', (SELECT COALESCE(MAX(rowid), 0) FROM inbound)) " +
            `WHERE ${samePause}`
        )
        .bind(now, c.pause_reason, ...pauseId)
    );
  }
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
