// DraftsTransport (Bruno decision, 2026-11-04): the agent NEVER sends. It saves
// each approved email as a draft in the mailbox; Bruno sends it himself.
// Real sends are learned by reading the Sent folder (reconcileSent), so caps,
// follow-ups, stops and retention count what actually went out.
//
// Flow per message: queued → drafting (CAS claim) → in_drafts (mailbox draft
// exists) → sent (seen in Sent) | expired (not sent within DRAFT_EXPIRE_DAYS).
// createMailboxDraft() is the only caller of MailClient.createDraft for outreach
// emails (alerts and interested-reply drafts go to Bruno, see alerts.ts / inbound.ts).
import type { Alerter } from "./alerts";
import { DAY, SEND_UNKNOWN_AFTER_MS, addBusinessDays, startOfUtcDay } from "./clock";
import { makeOptoutToken } from "./crypto";
import { eventStmt, getControl, logEvent, tripStop } from "./db";
import { euExclusion } from "./eligibility";
import type { FactSheet } from "./facts";
import { MailboxError, type MailClient, type SentMail } from "./mail/types";
import { intEnv, mayCreateDrafts, modeOf } from "./mode";
import { finalizeBody, renderFollowup } from "./render";
import { isSuppressed } from "./suppression";
import type { Env, LeadRow, MessageRow } from "./types";
import { dailyCap, dnsWarmupDone } from "./warmup";

export const FOLLOWUP_BUSINESS_DAYS = 5; // OQ-6
export const MAX_CONSECUTIVE_ERRORS = 3;
export const MAX_SENT_PAGES = 4;

export type DraftDeps = { mail: MailClient; now: () => number; alert: Alerter };

export function draftExpireMs(env: Env): number {
  return intEnv(env.DRAFT_EXPIRE_DAYS, 14, 1, 90) * DAY;
}

/** Rows stuck in 'drafting' (crash between the draft call and the mark) become draft_unknown. */
export async function sweepStuckDrafting(env: Env, deps: DraftDeps): Promise<number> {
  const db = env.DB;
  const now = deps.now();
  const stuck = await db
    .prepare("SELECT id, lead_id FROM messages WHERE status = 'drafting' AND claimed_at < ?")
    .bind(now - SEND_UNKNOWN_AFTER_MS)
    .all<{ id: string; lead_id: string }>();
  let n = 0;
  for (const m of stuck.results ?? []) {
    const r = await db.batch([
      db.prepare("UPDATE messages SET status = 'draft_unknown', updated_at = ? WHERE id = ? AND status = 'drafting'").bind(now, m.id),
      eventStmt(db, now, "draft_unknown", m.lead_id, { message_id: m.id }),
    ]);
    if (r[0].meta.changes === 1) {
      n++;
      // Not resent and not redrafted: a duplicate draft could become a duplicate email.
      // If Bruno sends it, reconcileSent picks it up from the Sent folder.
      await deps.alert("Draft outcome unknown", `Message ${m.id}: a draft may or may not be in the mailbox. Check Drafts; send it or delete it. It is not recreated.`, m.lead_id);
    }
  }
  return n;
}

export async function draftsTodayCount(db: D1Database, now: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE status IN ('drafting','in_drafts','sent','draft_unknown','expired') AND claimed_at >= ?")
    .bind(startOfUtcDay(now))
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export type DraftGate = { ok: true } | { ok: false; reason: string };

/** inboxCaughtUpThisTick must come from THIS tick's drain (no draft for someone who just replied). */
export async function draftGate(env: Env, now: number, inboxCaughtUpThisTick: boolean): Promise<DraftGate> {
  if (!mayCreateDrafts(modeOf(env))) return { ok: false, reason: "mode" };
  if (!(env.POSTAL_ADDRESS ?? "").trim()) return { ok: false, reason: "postal_address_missing" };
  if (!env.OPTOUT_HMAC_SECRET || !env.SUPPRESSION_HMAC_SECRET) return { ok: false, reason: "secrets_missing" };
  if (!inboxCaughtUpThisTick) return { ok: false, reason: "inbox_not_drained" };
  const c = await getControl(env.DB);
  if (c.paused) return { ok: false, reason: "paused" };
  if (!dnsWarmupDone(env, c, now)) return { ok: false, reason: "dns_not_verified" };
  if ((await draftsTodayCount(env.DB, now)) >= dailyCap(env)) return { ok: false, reason: "daily_cap" };
  return { ok: true };
}

/** At most one mailbox draft per call. */
export async function draftStep(env: Env, deps: DraftDeps, inboxCaughtUpThisTick: boolean): Promise<string> {
  const db = env.DB;
  const now = deps.now();
  const gate = await draftGate(env, now, inboxCaughtUpThisTick);
  if (!gate.ok) return `gate:${gate.reason}`;
  const msg = await db
    .prepare(
      `SELECT ms.* FROM messages ms JOIN leads l ON l.id = ms.lead_id
       WHERE ms.status = 'queued' AND ms.not_before <= ?
         AND ((ms.kind = 'initial' AND l.state = 'approved') OR (ms.kind = 'followup' AND l.state = 'sent'))
       ORDER BY ms.not_before LIMIT 1`
    )
    .bind(now)
    .first<MessageRow>();
  if (!msg) return "nothing_due";
  const claimId = crypto.randomUUID();
  const claim = await db
    .prepare("UPDATE messages SET status = 'drafting', claim_id = ?, claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
    .bind(claimId, now, now, msg.id)
    .run();
  if (claim.meta.changes !== 1) return "claim_lost";
  return createMailboxDraft(env, deps, msg.id, claimId);
}

/** The only function that creates an outreach draft. Takes a claimed messages row; kind ∈ {initial, followup}. */
export async function createMailboxDraft(env: Env, deps: DraftDeps, messageId: string, claimId: string): Promise<string> {
  const db = env.DB;
  const msg = await db.prepare("SELECT * FROM messages WHERE id = ? AND claim_id = ? AND status = 'drafting'").bind(messageId, claimId).first<MessageRow>();
  if (!msg || (msg.kind !== "initial" && msg.kind !== "followup")) return "not_claimed";
  const backToQueued = () =>
    db.prepare("UPDATE messages SET status = 'queued', claim_id = NULL, claimed_at = NULL, updated_at = ? WHERE id = ? AND claim_id = ? AND status = 'drafting'")
      .bind(deps.now(), msg.id, claimId)
      .run();
  const cancel = (reason: string) =>
    db.batch([
      db.prepare("UPDATE messages SET status = 'cancelled', updated_at = ? WHERE id = ? AND claim_id = ? AND status = 'drafting'").bind(deps.now(), msg.id, claimId),
      eventStmt(db, deps.now(), "draft_cancelled", msg.lead_id, { message_id: msg.id, reason }),
    ]);

  // Immediately before the provider call: re-read suppression, lead state, EU status and pause.
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(msg.lead_id).first<LeadRow>();
  const wantState = msg.kind === "initial" ? "approved" : "sent";
  if (!lead || lead.state !== wantState || !lead.contact_email) {
    await cancel("lead_state");
    return "cancelled:lead_state";
  }
  if (euExclusion(lead.domain, lead.country)) {
    await cancel("eu_eea_excluded");
    return "cancelled:eu";
  }
  if (await isSuppressed(env, { email: lead.contact_email, domain: lead.domain })) {
    await cancel("suppressed");
    return "cancelled:suppressed";
  }
  if ((await getControl(db)).paused) {
    await backToQueued();
    return "requeued:paused";
  }
  const postal = (env.POSTAL_ADDRESS ?? "").trim();
  if (!postal || !env.OPTOUT_HMAC_SECRET) {
    await backToQueued();
    return "requeued:config";
  }

  const base = env.PUBLIC_BASE_URL || "https://go.getastrant.com";
  const optoutUrl = `${base}/u/${await makeOptoutToken(env.OPTOUT_HMAC_SECRET, msg.id)}`;
  let inReplyTo: string | undefined;
  if (msg.kind === "followup") {
    const initial = await db
      .prepare("SELECT rfc_message_id FROM messages WHERE lead_id = ? AND kind = 'initial' AND status = 'sent'")
      .bind(msg.lead_id)
      .first<{ rfc_message_id: string | null }>();
    if (!initial) {
      await cancel("no_initial");
      return "cancelled:no_initial";
    }
    inReplyTo = initial.rfc_message_id ?? undefined; // threads the follow-up when the Sent copy gave us the Message-ID
  }
  let text: string;
  try {
    text = finalizeBody(msg.body_text, optoutUrl, postal);
  } catch {
    await cancel("unfilled_placeholder");
    return "cancelled:placeholder";
  }

  let result;
  try {
    result = await deps.mail.createDraft({ to: lead.contact_email, subject: msg.subject, text, inReplyTo, references: inReplyTo });
  } catch (e) {
    const now = deps.now();
    const auth = (e instanceof MailboxError && e.auth) || e?.constructor?.name === "ZohoAuthError";
    if (e instanceof MailboxError && e.definiteNotCreated && !auth) {
      if (msg.retry_count < 1) {
        await db
          .prepare("UPDATE messages SET status = 'queued', claim_id = NULL, claimed_at = NULL, retry_count = retry_count + 1, updated_at = ? WHERE id = ? AND claim_id = ? AND status = 'drafting'")
          .bind(now, msg.id, claimId)
          .run();
      } else {
        await cancel(`provider_rejected:${e.message.slice(0, 80)}`);
      }
      const r = await db
        .prepare("UPDATE control SET consecutive_send_errors = consecutive_send_errors + 1 WHERE id = 1 RETURNING consecutive_send_errors")
        .first<{ consecutive_send_errors: number }>();
      if ((r?.consecutive_send_errors ?? 0) >= MAX_CONSECUTIVE_ERRORS) {
        await tripStop(db, now, "provider_errors");
        await deps.alert("Outreach paused: mailbox errors", `Draft creation failed (${e.message.slice(0, 120)}). Paused.`);
      }
      return "provider_rejected";
    }
    if (auth) {
      await backToQueued();
      await tripStop(db, now, "provider_auth");
      await deps.alert("Outreach paused: mailbox auth failed", "The Zoho token was refused. Check the OAuth secrets, then resume in /admin.");
      return "provider_auth";
    }
    // Unknown outcome: the draft may exist. Never recreate it automatically.
    await db.batch([
      db.prepare("UPDATE messages SET status = 'draft_unknown', updated_at = ? WHERE id = ? AND claim_id = ? AND status = 'drafting'").bind(now, msg.id, claimId),
      eventStmt(db, now, "draft_unknown", lead.id, { message_id: msg.id }),
    ]);
    await deps.alert("Draft outcome unknown", `Message ${msg.id}: a draft may or may not be in the mailbox. Check Drafts; send it or delete it. It is not recreated.`, lead.id);
    return "draft_unknown";
  }

  const now = deps.now();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare("UPDATE messages SET status = 'in_drafts', mailbox_draft_id = ?, drafted_at = ?, updated_at = ? WHERE id = ? AND claim_id = ? AND status = 'drafting'")
      .bind(result.draftId, now, now, msg.id, claimId),
    db.prepare("UPDATE control SET consecutive_send_errors = 0, ramp_start_at = COALESCE(ramp_start_at, ?) WHERE id = 1").bind(startOfUtcDay(now)),
    eventStmt(db, now, msg.kind === "initial" ? "drafted_initial" : "drafted_followup", lead.id, { message_id: msg.id }),
  ];
  if (msg.kind === "initial") {
    stmts.push(db.prepare("UPDATE leads SET state = 'in_drafts', updated_at = ? WHERE id = ? AND state = 'approved'").bind(now, lead.id));
  }
  const out = await db.batch(stmts);
  if (out[0].meta.changes !== 1) await logEvent(db, now, "drafted_but_claim_lost", lead.id, { message_id: msg.id });
  return `drafted:${msg.kind}`;
}

/**
 * Reads the Sent folder and marks the matching in_drafts / expired / draft_unknown
 * message as sent (by recipient address, sent after the draft was created).
 * Runs in every mode: it only reads the mailbox. Returns the number reconciled.
 */
export async function reconcileSent(env: Env, deps: { mail: MailClient; now: () => number }): Promise<number> {
  const db = env.DB;
  const c = await getControl(db);
  const res = await deps.mail.listSent(c.sent_cursor, MAX_SENT_PAGES);
  let n = 0;
  for (const s of res.messages) n += await reconcileOne(env, deps.now(), s);
  await db.prepare("UPDATE control SET sent_cursor = ? WHERE id = 1").bind(res.cursor).run();
  return n;
}

async function reconcileOne(env: Env, now: number, s: SentMail): Promise<number> {
  const db = env.DB;
  // Idempotency: a Sent message is used at most once.
  if (await db.prepare("SELECT 1 AS x FROM messages WHERE provider_message_id = ?").bind(s.providerMessageId).first()) return 0;
  let done = 0;
  for (const to of s.to) {
    const m = await db
      .prepare(
        `SELECT ms.*, l.state AS lead_state, l.fact_sheet_json AS fact_sheet_json FROM messages ms JOIN leads l ON l.id = ms.lead_id
         WHERE l.contact_email = ? AND ms.status IN ('in_drafts','expired','draft_unknown') AND COALESCE(ms.drafted_at, ms.claimed_at, 0) <= ?
         ORDER BY CASE ms.kind WHEN 'followup' THEN 0 ELSE 1 END, ms.drafted_at LIMIT 1`
      )
      .bind(to, s.sentAt)
      .first<MessageRow & { lead_state: string; fact_sheet_json: string | null }>();
    if (!m) continue;
    const stmts: D1PreparedStatement[] = [
      db
        .prepare("UPDATE messages SET status = 'sent', sent_at = ?, provider_message_id = ?, provider_thread_id = ?, rfc_message_id = ?, updated_at = ? WHERE id = ? AND status = ?")
        .bind(s.sentAt, s.providerMessageId, s.providerThreadId, s.rfcMessageId, now, m.id, m.status),
      eventStmt(db, now, m.kind === "initial" ? "sent_initial" : "sent_followup", m.lead_id, { message_id: m.id }),
    ];
    if (m.kind === "initial") {
      stmts.push(
        db
          .prepare("UPDATE leads SET state = 'sent', last_outbound_at = ?, updated_at = ?, terminal_at = NULL, state_reason = NULL WHERE id = ? AND (state IN ('in_drafts','approved') OR (state = 'closed' AND state_reason = 'draft_not_sent'))")
          .bind(s.sentAt, now, m.lead_id)
      );
      const sheet = JSON.parse(m.fact_sheet_json ?? "null") as FactSheet | null;
      if (sheet) {
        const f = renderFollowup(m.subject, sheet, { benchmarkUrl: null, privacyUrl: env.PRIVACY_URL || "https://astrant.io/privacy#prospecting" });
        stmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO messages (id, lead_id, kind, batch_id, subject, body_text, validator_report_json, status, not_before, created_at, updated_at)
               VALUES (?, ?, 'followup', ?, ?, ?, ?, 'queued', ?, ?, ?)`
            )
            .bind(crypto.randomUUID(), m.lead_id, m.batch_id, f.subject, f.body, JSON.stringify({ path: "fixed_followup" }), addBusinessDays(s.sentAt, FOLLOWUP_BUSINESS_DAYS), now, now)
        );
      }
    } else {
      stmts.push(db.prepare("UPDATE leads SET state = 'followup_sent', last_outbound_at = ?, updated_at = ? WHERE id = ? AND state = 'sent'").bind(s.sentAt, now, m.lead_id));
    }
    const r = await db.batch(stmts);
    if (r[0].meta.changes === 1) done++;
    break; // one outreach message per Sent message
  }
  return done;
}

/** Daily: drafts Bruno never sent are expired; the lead closes (reconcileSent reopens it if he sends later). */
export async function expireStaleDrafts(env: Env, now: number): Promise<number> {
  const db = env.DB;
  const rows = await db
    .prepare("SELECT id, lead_id, kind FROM messages WHERE status = 'in_drafts' AND drafted_at < ?")
    .bind(now - draftExpireMs(env))
    .all<{ id: string; lead_id: string; kind: string }>();
  let n = 0;
  for (const m of rows.results ?? []) {
    const stmts = [
      db.prepare("UPDATE messages SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'in_drafts'").bind(now, m.id),
      eventStmt(db, now, "draft_expired", m.lead_id, { message_id: m.id }),
    ];
    if (m.kind === "initial") {
      stmts.push(
        db
          .prepare("UPDATE leads SET state = 'closed', state_reason = 'draft_not_sent', terminal_at = ?, updated_at = ? WHERE id = ? AND state = 'in_drafts'")
          .bind(now, now, m.lead_id)
      );
    }
    const r = await db.batch(stmts);
    if (r[0].meta.changes === 1) n++;
  }
  return n;
}
