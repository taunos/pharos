// §9.3 automatic stops + the program kill criterion. Each trip pauses (tripStop)
// and stays paused until an Access-authenticated resume in /admin.
import type { Alerter } from "./alerts";
import { DAY, startOfUtcDay } from "./clock";
import { getControl, tripStop } from "./db";
import type { Env } from "./types";

type SentRow = { lead_id: string; sent_at: number };

async function lastSends(db: D1Database, n: number): Promise<SentRow[]> {
  const r = await db
    .prepare("SELECT lead_id, sent_at FROM messages WHERE status = 'sent' ORDER BY sent_at DESC LIMIT ?")
    .bind(n)
    .all<SentRow>();
  return r.results ?? [];
}

// Distinct leads among the `n` most recent sends (optionally sent before `before`
// and after `sentAfter`) with an inbound of one of `classes` (any class when null),
// optionally handled after `inboundAfter`. The send window is a subquery, not bound
// lead ids: D1 rejects more than 100 bound parameters, and the 100/300-send windows
// bind more than that.
async function countInboundForRecentSends(
  db: D1Database,
  n: number,
  before: number | null,
  classes: string[] | null,
  opts: { sentAfter?: number; inboundAfter?: number } = {}
): Promise<number> {
  const cls = classes ? ` AND class IN (${classes.map(() => "?").join(",")})` : "";
  const sentAfter = opts.sentAfter ?? 0;
  const inboundAfter = opts.inboundAfter ?? 0;
  const win =
    `SELECT lead_id FROM messages WHERE status = 'sent'${before === null ? "" : " AND sent_at < ?"}` +
    `${sentAfter > 0 ? " AND sent_at > ?" : ""} ORDER BY sent_at DESC LIMIT ?`;
  const r = await db
    .prepare(`SELECT COUNT(DISTINCT lead_id) AS n FROM inbound WHERE lead_id IN (${win})${cls}${inboundAfter > 0 ? " AND handled_at > ?" : ""}`)
    .bind(
      ...(before === null ? [] : [before]),
      ...(sentAfter > 0 ? [sentAfter] : []),
      n,
      ...(classes ?? []),
      ...(inboundAfter > 0 ? [inboundAfter] : [])
    )
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * E6: when Bruno last resumed from `reason` (0 = never). The lifetime-count stops
 * (complaints, silent_failure, program_review) count only data after it, so a
 * resume doesn't re-trip on what it just acknowledged. Kept as 'stop_acknowledged'
 * events written by resume() (no control column, so no migration).
 */
export async function stopAcknowledgedAt(db: D1Database, reason: string): Promise<number> {
  const r = await db
    .prepare("SELECT MAX(at) AS t FROM events WHERE kind = 'stop_acknowledged' AND json_extract(detail_json, '$.reason') = ?")
    .bind(reason)
    .first<{ t: number | null }>();
  return r?.t ?? 0;
}

export type StopVerdict = { reason: string; detail: Record<string, unknown> } | null;

export async function evaluateStops(env: Env, now: number): Promise<StopVerdict> {
  const db = env.DB;
  // Hard bounces: ≥2 in one day during the first 2 weeks of real sends; ≥3% of the last 100 sends after.
  // "Sends" are messages Bruno actually sent (status 'sent', learned from the Sent folder).
  const first = (await db.prepare("SELECT MIN(sent_at) AS t FROM messages WHERE status = 'sent'").first<{ t: number | null }>())?.t ?? null;
  const inEarlyRamp = first == null || now - first < 14 * DAY;
  if (inEarlyRamp) {
    const r = await db
      .prepare("SELECT COUNT(*) AS n FROM inbound WHERE class = 'bounce_hard' AND lead_id IS NOT NULL AND handled_at >= ?")
      .bind(startOfUtcDay(now))
      .first<{ n: number }>();
    if ((r?.n ?? 0) >= 2) return { reason: "hard_bounces_daily", detail: { n: r?.n } };
  } else {
    const last100 = await lastSends(db, 100);
    const b = await countInboundForRecentSends(db, 100, null, ["bounce_hard"]);
    if (last100.length > 0 && b / Math.max(last100.length, 100) >= 0.03) return { reason: "hard_bounce_rate", detail: { b, n: last100.length } };
  }

  // Complaints: ≥1 in the first 200 sends; ≥0.3% of the last 300 after (i.e. ≥1 in 300).
  // Both count only complaints handled after the last resume from this stop (E6).
  const complaintsAck = await stopAcknowledgedAt(db, "complaints");
  const total = (await db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'sent'").first<{ n: number }>())?.n ?? 0;
  const complaints =
    total <= 200
      ? // Only complaints from leads we wrote to. Unmatched mail (newsletters, the
        // Zoho welcome email, any stranger) must not be able to stop the agent.
        // Live false trip 2026-11-05: a pre-existing inbox email matched the rule.
        (
          await db
            .prepare("SELECT COUNT(*) AS n FROM inbound WHERE class = 'complaint' AND lead_id IS NOT NULL AND (? = 0 OR handled_at > ?)")
            .bind(complaintsAck, complaintsAck)
            .first<{ n: number }>()
        )?.n ?? 0
      : await countInboundForRecentSends(db, 300, null, ["complaint"], { inboundAfter: complaintsAck });
  if (complaints >= 1 && (total <= 200 || complaints / 300 >= 0.003)) return { reason: "complaints", detail: { complaints, total } };

  // Opt-out + not-interested > 10% of the last 50 sends (evaluated once ≥20 sends exist).
  const last50 = await lastSends(db, 50);
  if (last50.length >= 20) {
    const o = await countInboundForRecentSends(db, 50, null, ["opt_out", "not_interested"]);
    if (o / last50.length > 0.1) return { reason: "opt_out_rate", detail: { o, n: last50.length } };
  }

  // Silent-failure proxy: 0 replies of any kind across the last 40 sends (each at least 3 days old).
  // After a resume from this stop, only sends made after the resume count (E6).
  const silentAck = await stopAcknowledgedAt(db, "silent_failure");
  const old40 = (
    await db
      .prepare("SELECT lead_id, sent_at FROM messages WHERE status = 'sent' AND sent_at < ? AND sent_at > ? ORDER BY sent_at DESC LIMIT 40")
      .bind(now - 3 * DAY, silentAck)
      .all<SentRow>()
  ).results ?? [];
  if (old40.length >= 40 && (await countInboundForRecentSends(db, 40, now - 3 * DAY, null, { sentAfter: silentAck })) === 0) {
    return { reason: "silent_failure", detail: { n: 40 } };
  }

  // (send_unknown is gone: the agent never sends. A draft_unknown only alerts; see drafts.ts.)

  // Program kill criterion: after 100 initial sends, or when the pool is exhausted, 0 interested/question ⇒ review.
  // After a resume from this stop, sends and replies count from the resume on (E6).
  const reviewAck = await stopAcknowledgedAt(db, "program_review");
  const initials =
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM messages WHERE kind = 'initial' AND status = 'sent' AND sent_at > ?")
        .bind(reviewAck)
        .first<{ n: number }>()
    )?.n ?? 0;
  const pool =
    (await db
      .prepare("SELECT COUNT(*) AS n FROM leads WHERE state IN ('new','scored','contact_found','drafted','approved') AND (icp_ok IS NULL OR icp_ok = 1)")
      .first<{ n: number }>())?.n ?? 0;
  if (initials >= 100 || (initials > 0 && pool === 0)) {
    const good =
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM inbound WHERE class IN ('interested','question') AND (? = 0 OR handled_at > ?)")
          .bind(reviewAck, reviewAck)
          .first<{ n: number }>()
      )?.n ?? 0;
    if (good === 0) return { reason: "program_review", detail: { initials, pool } };
  }
  return null;
}

/** Trips at most once per reason while already paused for it. */
export async function checkStops(env: Env, now: number, alert: Alerter): Promise<StopVerdict> {
  const v = await evaluateStops(env, now);
  if (!v) return null;
  const c = await getControl(env.DB);
  if (c.paused && c.pause_reason === v.reason) return v;
  await tripStop(env.DB, now, v.reason, v.detail);
  await alert(`Outreach paused: ${v.reason}`, `Automatic stop: ${v.reason}. Resume only from /admin after checking.`);
  return v;
}
