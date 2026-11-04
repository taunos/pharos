// Operator alerts. D9 forbids any send path, so an alert is an `events` row
// (kind 'alert', with its text, shown in /admin) plus, ONLY in gated/auto, a
// mailbox DRAFT addressed to OPERATOR_ALERT_TO. In off and dry_run nothing is
// written to the mailbox (Codex review #7); alerts live in D1 and /admin.
// Best effort: a failed draft never blocks handling.
import { logEvent } from "./db";
import type { MailClient } from "./mail/types";
import { mayCreateDrafts, modeOf } from "./mode";
import type { Env } from "./types";

import { startOfUtcDay } from "./clock";

export type Alerter = (kind: string, text: string, leadId?: string | null) => Promise<void>;

/** A flood (e.g. hostile replies) must not fill the mailbox with alert drafts: beyond this, /admin only. */
export const MAX_ALERT_DRAFTS_PER_DAY = 20;

export function makeAlerter(env: Env, mail: MailClient | null, now: () => number): Alerter {
  return async (kind, text, leadId = null) => {
    // Texts name a domain at most, never an email address (events rule, spec section 5).
    await logEvent(env.DB, now(), "alert", leadId, { kind, text });
    if (!mail || !env.OPERATOR_ALERT_TO || !mayCreateDrafts(modeOf(env))) return;
    const today = (await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'alert_draft' AND at >= ?").bind(startOfUtcDay(now())).first<{ n: number }>())?.n ?? 0;
    if (today >= MAX_ALERT_DRAFTS_PER_DAY) return;
    try {
      await logEvent(env.DB, now(), "alert_draft", leadId);
      await mail.createDraft({ to: env.OPERATOR_ALERT_TO, subject: `[Astrant outreach] ${kind.replace(/[\r\n]+/g, " ").slice(0, 100)}`, text });
    } catch (e) {
      console.error("alert_draft_failed", kind, e instanceof Error ? e.message : String(e));
    }
  };
}
