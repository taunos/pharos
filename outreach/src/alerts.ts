// Operator alerts. D9 forbids any send path, so an alert is an `events` row
// (kind 'alert', with its text, shown in /admin) plus, ONLY in gated/auto, a
// mailbox DRAFT addressed to OPERATOR_ALERT_TO. In off and dry_run nothing is
// written to the mailbox (Codex review #7); alerts live in D1 and /admin.
// Best effort: a failed draft never blocks handling.
import { logEvent } from "./db";
import type { MailClient } from "./mail/types";
import { mayCreateDrafts, modeOf } from "./mode";
import type { Env } from "./types";

export type Alerter = (kind: string, text: string, leadId?: string | null) => Promise<void>;

export function makeAlerter(env: Env, mail: MailClient | null, now: () => number): Alerter {
  return async (kind, text, leadId = null) => {
    // Texts name a domain at most, never an email address (events rule, spec section 5).
    await logEvent(env.DB, now(), "alert", leadId, { kind, text });
    if (!mail || !env.OPERATOR_ALERT_TO || !mayCreateDrafts(modeOf(env))) return;
    try {
      await mail.createDraft({ to: env.OPERATOR_ALERT_TO, subject: `[Astrant outreach] ${kind}`, text });
    } catch (e) {
      console.error("alert_draft_failed", kind, e instanceof Error ? e.message : String(e));
    }
  };
}
