// §10.3 retention + §6.2 scan-row deletion (daily job, every mode).
import { DAY } from "./clock";
import { logEvent } from "./db";
import { processScanDeletions } from "./suppression";
import type { Env } from "./types";

export const NO_REPLY_PURGE_MS = 60 * DAY; // contact fields, after last outbound with no reply
export const TERMINAL_REPLY_PURGE_MS = 30 * DAY; // contact fields, after a terminal reply
export const SCAN_DELETE_AFTER_MS = 90 * DAY; // scan rows, after the last send with no reply
export const FOLLOWUP_CLOSE_MS = 14 * DAY; // followup_sent → closed

export async function runRetention(env: Env, now: number): Promise<Record<string, number>> {
  const db = env.DB;
  const out: Record<string, number> = {};

  // followup_sent with no reply for 14 days → closed.
  out.closed = (
    await db
      .prepare("UPDATE leads SET state = 'closed', terminal_at = ?, updated_at = ? WHERE state = 'followup_sent' AND last_outbound_at < ?")
      .bind(now, now, now - FOLLOWUP_CLOSE_MS)
      .run()
  ).meta.changes;

  // Contact fields: 60 days after last outbound with no reply; 30 days after a terminal reply.
  out.purged_no_reply = (
    await db
      .prepare(
        `UPDATE leads SET contact_email = NULL, contact_source_url = NULL, updated_at = ?
         WHERE contact_email IS NOT NULL AND last_outbound_at IS NOT NULL AND last_outbound_at < ?
           AND state IN ('sent','followup_sent','closed') AND id NOT IN (SELECT lead_id FROM inbound WHERE lead_id IS NOT NULL)`
      )
      .bind(now, now - NO_REPLY_PURGE_MS)
      .run()
  ).meta.changes;
  out.purged_terminal = (
    await db
      .prepare(
        `UPDATE leads SET contact_email = NULL, contact_source_url = NULL, updated_at = ?
         WHERE contact_email IS NOT NULL AND state IN ('replied','bounced','opted_out','disqualified','rejected') AND terminal_at < ?`
      )
      .bind(now, now - TERMINAL_REPLY_PURGE_MS)
      .run()
  ).meta.changes;

  // Scan rows: 90 days after the last send for leads that closed with no reply.
  out.scan_delete_requested = (
    await db
      .prepare(
        `UPDATE lead_scans SET delete_requested_at = ? WHERE delete_requested_at IS NULL AND deleted_at IS NULL
           AND lead_id IN (SELECT id FROM leads WHERE state IN ('closed','followup_sent','sent') AND last_outbound_at < ?)`
      )
      .bind(now, now - SCAN_DELETE_AFTER_MS)
      .run()
  ).meta.changes;
  out.scans_deleted = await processScanDeletions(env, now, 50);

  await logEvent(db, now, "retention", null, out);
  return out;
}
