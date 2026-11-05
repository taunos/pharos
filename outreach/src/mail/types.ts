// Provider-neutral mailbox client: DRAFTS ONLY (Bruno decision, 2026-11-04).
//
// Zoho Mail's usage policy excludes automated email, so the agent never
// sends. It saves each email as a draft in the mailbox, and Bruno sends it
// himself from his mail client. There is deliberately NO send method on this
// interface: no code path in this Worker can send an email.
//
// Drafts can't carry custom headers, so List-Unsubscribe / List-Unsubscribe-Post
// (RFC 8058, spec §8.1) are impossible; the opt-out is a link + a reply
// instruction in the body. Threading IS possible: Zoho's save-draft API takes
// inReplyTo + refHeader.

export type OutreachDraft = {
  to: string;
  subject: string;
  text: string;
  /** RFC 5322 Message-ID of the message this replies to, e.g. "<abc@x>". */
  inReplyTo?: string;
  /** Space-separated Message-IDs, oldest first. */
  references?: string;
};

export type DraftResult = { draftId: string | null };

export class MailboxError extends Error {
  constructor(
    message: string,
    /** True only when the provider definitely did NOT create the draft (4xx validation). */
    readonly definiteNotCreated: boolean,
    /** Auth/token failure: immediate stop (§9.3). */
    readonly auth: boolean
  ) {
    super(message);
  }
}

export type InboundMail = {
  providerMessageId: string;
  providerThreadId: string | null;
  receivedAt: number;
  from: string;
  subject: string;
  headers: Record<string, string>; // lowercased names; last value wins
  text: string; // text/plain body, decoded
  dsn: { status: string | null; finalRecipient: string | null; originalMessageId: string | null } | null;
};

/** A message Bruno sent from the mailbox (read from the Sent folder). */
export type SentMail = {
  providerMessageId: string;
  providerThreadId: string | null;
  sentAt: number;
  to: string[]; // lowercased addresses
  subject: string;
  rfcMessageId: string | null;
  /** Decoded text/plain body (used to find the draft's opt-out token). */
  text: string;
};

export type DrainResult = { messages: InboundMail[]; caughtUp: boolean; cursor: string | null };
export type SentResult = { messages: SentMail[]; caughtUp: boolean; cursor: string | null };

/** Returns true when a message id was already handled (skips fetching it again). */
export type IsKnown = (providerMessageId: string) => Promise<boolean>;

export interface MailClient {
  /** Inbox messages after the saved cursor, oldest first, up to maxPages; progress persists in the cursor. */
  drainInbox(cursor: string | null, maxPages: number, isKnown?: IsKnown): Promise<DrainResult>;
  /** Sent-folder messages after the saved cursor, oldest first, up to maxPages; progress persists in the cursor. */
  listSent(cursor: string | null, maxPages: number, isKnown?: IsKnown): Promise<SentResult>;
  /** Saves a draft in the mailbox. Never sends. */
  createDraft(d: OutreachDraft): Promise<DraftResult>;
}
