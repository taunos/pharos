// Operator alerts. D9 forbids any send path besides initial/follow-up, so an
// alert is an `events` row plus a mailbox DRAFT addressed to OPERATOR_ALERT_TO
// (Bruno sees it in the outreach mailbox). Best effort: a failed draft never
// blocks handling.
import { logEvent } from "./db";
import type { MailClient } from "./mail/types";
import type { Env } from "./types";

export type Alerter = (kind: string, text: string, leadId?: string | null) => Promise<void>;

export function makeAlerter(env: Env, mail: MailClient | null, now: () => number): Alerter {
  return async (kind, text, leadId = null) => {
    await logEvent(env.DB, now(), "alert", leadId, { kind });
    if (!mail || !env.OPERATOR_ALERT_TO) return;
    try {
      await mail.createDraft({ to: env.OPERATOR_ALERT_TO, subject: `[Astrant outreach] ${kind}`, text });
    } catch (e) {
      console.error("alert_draft_failed", kind, e instanceof Error ? e.message : String(e));
    }
  };
}
