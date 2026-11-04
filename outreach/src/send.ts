// §8.3 send step: idempotent, crash-safe. sendQueuedMessage() is the ONLY
// caller of MailClient.send (D9 / S7, enforced by test/static.test.ts).
import type { Alerter } from "./alerts";
import { SEND_UNKNOWN_AFTER_MS, addBusinessDays, inSendWindow, startOfUtcDay } from "./clock";
import { makeOptoutToken } from "./crypto";
import { eventStmt, getControl, logEvent, tripStop } from "./db";
import { euExclusion } from "./eligibility";
import type { FactSheet } from "./facts";
import { MailSendError, type MailClient, type OutboundMail } from "./mail/types";
import { maySend, modeOf } from "./mode";
import { finalizeBody, renderFollowup } from "./render";
import { isSuppressed } from "./suppression";
import type { Env, LeadRow, MessageRow } from "./types";
import { dailyCap, dnsWarmupDone } from "./warmup";

export const FOLLOWUP_BUSINESS_DAYS = 5; // OQ-6
export const MAX_CONSECUTIVE_SEND_ERRORS = 3;

export type SendDeps = { mail: MailClient; now: () => number; alert: Alerter };

/** Step 8: rows stuck in 'sending' (crash between provider call and mark-sent) become send_unknown. Never resent. */
export async function sweepStuckSending(env: Env, deps: SendDeps): Promise<number> {
  const db = env.DB;
  const now = deps.now();
  const stuck = await db
    .prepare("SELECT id, lead_id FROM messages WHERE status = 'sending' AND claimed_at < ?")
    .bind(now - SEND_UNKNOWN_AFTER_MS)
    .all<{ id: string; lead_id: string }>();
  let n = 0;
  for (const m of stuck.results ?? []) {
    const r = await db.batch([
      db.prepare("UPDATE messages SET status = 'send_unknown', updated_at = ? WHERE id = ? AND status = 'sending'").bind(now, m.id),
      db
        .prepare("UPDATE leads SET state = 'send_unknown', updated_at = ? WHERE id = ? AND state IN ('approved','sent')")
        .bind(now, m.lead_id),
      eventStmt(db, now, "send_unknown", m.lead_id, { message_id: m.id }),
    ]);
    if (r[0].meta.changes === 1) {
      n++;
      await tripStop(db, now, "send_unknown", { message_id: m.id });
      await deps.alert("Send outcome unknown: sending paused", `Message ${m.id} may or may not have gone out. Check the Sent folder and resolve it in /admin.`, m.lead_id);
    }
  }
  return n;
}

export async function sentTodayCount(db: D1Database, now: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE status IN ('sending','sent','send_unknown') AND claimed_at >= ?")
    .bind(startOfUtcDay(now))
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export type SendGate = { ok: true } | { ok: false; reason: string };

/** Step 1. inboxCaughtUpThisTick must come from THIS tick's drain. */
export async function sendGate(env: Env, now: number, inboxCaughtUpThisTick: boolean, mail: MailClient): Promise<SendGate> {
  if (!maySend(modeOf(env))) return { ok: false, reason: "mode" };
  if (!mail.sendSupported) return { ok: false, reason: "send_transport_unavailable" };
  if (!(env.POSTAL_ADDRESS ?? "").trim()) return { ok: false, reason: "postal_address_missing" };
  if (!env.OPTOUT_HMAC_SECRET || !env.SUPPRESSION_HMAC_SECRET) return { ok: false, reason: "secrets_missing" };
  if (!inboxCaughtUpThisTick) return { ok: false, reason: "inbox_not_drained" };
  if (!inSendWindow(now)) return { ok: false, reason: "outside_window" };
  const c = await getControl(env.DB);
  if (c.paused) return { ok: false, reason: "paused" };
  if (!dnsWarmupDone(c, now)) return { ok: false, reason: "dns_warmup" };
  if ((await sentTodayCount(env.DB, now)) >= dailyCap(env, c, now)) return { ok: false, reason: "daily_cap" };
  return { ok: true };
}

/** Steps 1–3 then sendQueuedMessage. At most one send per call. */
export async function sendStep(env: Env, deps: SendDeps, inboxCaughtUpThisTick: boolean): Promise<string> {
  const db = env.DB;
  const now = deps.now();
  const gate = await sendGate(env, now, inboxCaughtUpThisTick, deps.mail);
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
    .prepare("UPDATE messages SET status = 'sending', claim_id = ?, claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
    .bind(claimId, now, now, msg.id)
    .run();
  if (claim.meta.changes !== 1) return "claim_lost";
  return sendQueuedMessage(env, deps, msg.id, claimId);
}

function domainOfAddress(a: string): string {
  return a.slice(a.lastIndexOf("@") + 1);
}

/** The only function that may call MailClient.send. Takes a claimed messages row id; kind ∈ {initial, followup}. */
export async function sendQueuedMessage(env: Env, deps: SendDeps, messageId: string, claimId: string): Promise<string> {
  const db = env.DB;
  const msg = await db.prepare("SELECT * FROM messages WHERE id = ? AND claim_id = ? AND status = 'sending'").bind(messageId, claimId).first<MessageRow>();
  if (!msg || (msg.kind !== "initial" && msg.kind !== "followup")) return "not_claimed";
  const backToQueued = () =>
    db.prepare("UPDATE messages SET status = 'queued', claim_id = NULL, claimed_at = NULL, updated_at = ? WHERE id = ? AND claim_id = ? AND status = 'sending'")
      .bind(deps.now(), msg.id, claimId)
      .run();
  const cancel = (reason: string) =>
    db.batch([
      db.prepare("UPDATE messages SET status = 'cancelled', updated_at = ? WHERE id = ? AND claim_id = ? AND status = 'sending'").bind(deps.now(), msg.id, claimId),
      eventStmt(db, deps.now(), "send_cancelled", msg.lead_id, { message_id: msg.id, reason }),
    ]);

  // Step 4: immediately before the provider call, re-read suppression, lead state and pause.
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
  const c = await getControl(db);
  if (c.paused) {
    await backToQueued();
    return "requeued:paused";
  }
  const postal = (env.POSTAL_ADDRESS ?? "").trim();
  if (!postal || !env.OPTOUT_HMAC_SECRET) {
    await backToQueued();
    return "requeued:config";
  }

  const fromAddr = env.MAIL_FROM || "bruno@getastrant.com";
  const base = env.PUBLIC_BASE_URL || "https://go.getastrant.com";
  const optoutUrl = `${base}/u/${await makeOptoutToken(env.OPTOUT_HMAC_SECRET, msg.id)}`;
  const rfcId = `<${msg.id}@${domainOfAddress(fromAddr)}>`;
  let inReplyTo: string | undefined;
  let replyToProviderMessageId: string | undefined;
  if (msg.kind === "followup") {
    const initial = await db
      .prepare("SELECT rfc_message_id, provider_message_id FROM messages WHERE lead_id = ? AND kind = 'initial' AND status = 'sent'")
      .bind(msg.lead_id)
      .first<{ rfc_message_id: string | null; provider_message_id: string | null }>();
    if (!initial) {
      await cancel("no_initial");
      return "cancelled:no_initial";
    }
    inReplyTo = initial.rfc_message_id ?? undefined;
    replyToProviderMessageId = initial.provider_message_id ?? undefined;
  }
  let text: string;
  try {
    text = finalizeBody(msg.body_text, optoutUrl, postal);
  } catch {
    await cancel("unfilled_placeholder");
    return "cancelled:placeholder";
  }
  const mail: OutboundMail = {
    fromAddress: fromAddr,
    fromName: env.MAIL_FROM_NAME || "Bruno at Astrant",
    to: lead.contact_email,
    subject: msg.subject,
    text,
    messageId: rfcId,
    inReplyTo,
    references: inReplyTo,
    listUnsubscribe: `<${optoutUrl}>, <mailto:${fromAddr}?subject=unsubscribe>`,
    listUnsubscribePost: "List-Unsubscribe=One-Click",
    replyToProviderMessageId,
  };

  // Step 5. Nothing else runs between the step-4 checks and this call.
  let result;
  try {
    result = await deps.mail.send(mail);
  } catch (e) {
    const now = deps.now();
    if (e instanceof MailSendError && e.definiteNotSent) {
      // Step 7: back to queued once, then cancelled.
      if (msg.retry_count < 1) {
        await db
          .prepare("UPDATE messages SET status = 'queued', claim_id = NULL, claimed_at = NULL, retry_count = retry_count + 1, updated_at = ? WHERE id = ? AND claim_id = ? AND status = 'sending'")
          .bind(now, msg.id, claimId)
          .run();
      } else {
        await cancel(`provider_rejected:${e.message.slice(0, 80)}`);
      }
      const r = await db
        .prepare("UPDATE control SET consecutive_send_errors = consecutive_send_errors + 1 WHERE id = 1 RETURNING consecutive_send_errors")
        .first<{ consecutive_send_errors: number }>();
      if (e.auth || (r?.consecutive_send_errors ?? 0) >= MAX_CONSECUTIVE_SEND_ERRORS) {
        await tripStop(db, now, e.auth ? "provider_auth" : "provider_errors");
        await deps.alert("Sending paused: provider errors", `Send failed (${e.message.slice(0, 120)}). Sending is paused.`);
      }
      return "provider_rejected";
    }
    // Unknown outcome: the provider may have sent it. Never resend automatically.
    await db.batch([
      db.prepare("UPDATE messages SET status = 'send_unknown', updated_at = ? WHERE id = ? AND claim_id = ? AND status = 'sending'").bind(now, msg.id, claimId),
      db.prepare("UPDATE leads SET state = 'send_unknown', updated_at = ? WHERE id = ? AND state = ?").bind(now, lead.id, wantState),
      eventStmt(db, now, "send_unknown", lead.id, { message_id: msg.id }),
    ]);
    await tripStop(db, now, e instanceof MailSendError && e.auth ? "provider_auth" : "send_unknown");
    await deps.alert("Send outcome unknown: sending paused", `Message ${msg.id} may or may not have gone out. Check the Sent folder and resolve it in /admin.`, lead.id);
    return "send_unknown";
  }

  // Step 6: one D1 batch.
  const now = deps.now();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        "UPDATE messages SET status = 'sent', sent_at = ?, provider_message_id = ?, provider_thread_id = ?, rfc_message_id = ?, updated_at = ? WHERE id = ? AND claim_id = ? AND status = 'sending'"
      )
      .bind(now, result.providerMessageId, result.providerThreadId, result.rfcMessageId || rfcId, now, msg.id, claimId),
    db
      .prepare("UPDATE leads SET state = ?, last_outbound_at = ?, updated_at = ? WHERE id = ? AND state = ?")
      .bind(msg.kind === "initial" ? "sent" : "followup_sent", now, now, lead.id, wantState),
    db.prepare("UPDATE control SET consecutive_send_errors = 0 WHERE id = 1"),
    eventStmt(db, now, msg.kind === "initial" ? "sent_initial" : "sent_followup", lead.id, { message_id: msg.id }),
  ];
  if (msg.kind === "initial") {
    const sheet = JSON.parse(lead.fact_sheet_json ?? "null") as FactSheet | null;
    if (sheet) {
      const f = renderFollowup(msg.subject, sheet, { benchmarkUrl: null, privacyUrl: env.PRIVACY_URL || "https://astrant.io/privacy#prospecting" });
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO messages (id, lead_id, kind, batch_id, subject, body_text, validator_report_json, status, not_before, created_at, updated_at)
             VALUES (?, ?, 'followup', ?, ?, ?, ?, 'queued', ?, ?, ?)`
          )
          .bind(crypto.randomUUID(), lead.id, msg.batch_id, f.subject, f.body, JSON.stringify({ path: "fixed_followup" }), addBusinessDays(now, FOLLOWUP_BUSINESS_DAYS), now, now)
      );
    }
  }
  const out = await db.batch(stmts);
  if (out[0].meta.changes !== 1) await logEvent(db, now, "sent_but_claim_lost", lead.id, { message_id: msg.id });
  return `sent:${msg.kind}`;
}
