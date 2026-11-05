// The ONLY place that writes to the mailbox (security round 2, #3). Every draft,
// whether an outreach email, a follow-up, a reply draft for Bruno or an alert
// for Bruno, passes a safety policy here first. A static test enforces that
// `.createDraft(` appears nowhere else in src/.
import type { MailClient, OutreachDraft } from "./mail/types";
import {
  ASTRANT_HOSTS, LINK_HOSTS, checkOutboundDraft, hasHtml, hasMarkdown, hasMixedScriptWord, hasUnsafeChars,
  isPublicHostname, safeHttpsUrl, schemeUrls, domainLikeTokens, MAX_BODY, MAX_SUBJECT,
} from "./safety";

export type DraftPolicy =
  /** An outreach email (initial or follow-up) to a lead: the full outbound gate. */
  | { kind: "outreach"; domain: string; postal: string; optoutUrl: string }
  /** A reply draft for Bruno to a lead: recipient must be the stored contact; astrant.io links only. */
  | { kind: "reply"; domain: string; contactEmail: string }
  /** An alert draft addressed to Bruno (OPERATOR_ALERT_TO). */
  | { kind: "alert"; operatorAddress: string };

export class DraftRefused extends Error {
  constructor(readonly reason: string) {
    super(`DRAFT_REFUSED:${reason}`);
  }
}

const MSGID_LIST_RE = /^(?:<[A-Za-z0-9!#$%&'*+\/=?^_`{|}~.@-]{3,250}>\s?){1,10}$/;

function checkThreading(d: OutreachDraft): string | null {
  for (const v of [d.inReplyTo, d.references]) {
    if (v === undefined) continue;
    if (v.length > 2000 || !MSGID_LIST_RE.test(v)) return "threading";
  }
  return null;
}

/** Shared checks for drafts that are not outreach emails (reply/alert). */
export function checkInternalDraft(d: OutreachDraft, opts: { to: string; allowBareDomain: (host: string) => boolean; allowLinkHost: (host: string) => boolean }): string | null {
  if (d.to !== opts.to || /[\r\n]/.test(d.to) || d.to.length > 254 || !/^[^\s@<>"]+@[a-z0-9.-]+$/.test(d.to)) return "recipient";
  if (!d.subject || d.subject.length > MAX_SUBJECT || /[\r\n]/.test(d.subject) || hasUnsafeChars(d.subject) || hasHtml(d.subject) || hasMixedScriptWord(d.subject)) return "subject";
  if (d.text.length > MAX_BODY || hasUnsafeChars(d.text) || hasHtml(d.text) || hasMixedScriptWord(d.text)) return "body";
  for (const part of [d.subject, d.text]) {
    for (const tok of schemeUrls(part)) {
      const u = safeHttpsUrl(tok);
      if (!u || !opts.allowLinkHost(u.hostname)) return "url";
    }
    for (const tok of domainLikeTokens(part)) if (!opts.allowBareDomain(tok)) return "domain_token";
  }
  if (hasMarkdown(d.text.replace(/https:\/\/\S+/g, " "))) return "markdown";
  return checkThreading(d);
}

export function checkDraft(d: OutreachDraft, p: DraftPolicy): string | null {
  if (p.kind === "outreach") {
    const r = checkOutboundDraft({ to: d.to, subject: d.subject, text: d.text, domain: p.domain, postal: p.postal, optoutUrl: p.optoutUrl });
    return r.ok ? checkThreading(d) : r.reason;
  }
  if (p.kind === "reply") {
    if (!isPublicHostname(p.domain) || !p.contactEmail.endsWith("@" + p.domain)) return "recipient";
    return checkInternalDraft(d, {
      to: p.contactEmail,
      allowBareDomain: (h) => h === p.domain || h === "www." + p.domain || ASTRANT_HOSTS.has(h),
      allowLinkHost: (h) => ASTRANT_HOSTS.has(h),
    });
  }
  // alert: texts name lead domains (validated hostnames) and reason codes, never outside free text.
  return checkInternalDraft(d, {
    to: p.operatorAddress,
    allowBareDomain: (h) => isPublicHostname(h),
    allowLinkHost: (h) => LINK_HOSTS.has(h),
  });
}

/** Throws DraftRefused when the policy rejects the draft; otherwise saves it (never sends). */
export async function gatedCreateDraft(mail: MailClient, d: OutreachDraft, p: DraftPolicy): Promise<{ draftId: string | null }> {
  const reason = checkDraft(d, p);
  if (reason) throw new DraftRefused(reason);
  return mail.createDraft(d);
}
