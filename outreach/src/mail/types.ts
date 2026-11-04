// Provider-neutral mailbox client. The ONLY caller of `send` is
// sendQueuedMessage() in src/send.ts (D9 / S7, enforced by a static test).

export type OutboundMail = {
  fromAddress: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  /** Caller-chosen RFC 5322 Message-ID, e.g. "<uuid@getastrant.com>". */
  messageId: string;
  inReplyTo?: string;
  references?: string;
  /** RFC 8058: List-Unsubscribe + List-Unsubscribe-Post: List-Unsubscribe=One-Click. */
  listUnsubscribe: string;
  listUnsubscribePost: "List-Unsubscribe=One-Click";
  /** Provider thread / message ids of the message this replies to (follow-up). */
  replyToProviderMessageId?: string;
};

export type SendResult = {
  rfcMessageId: string;
  providerMessageId: string | null;
  providerThreadId: string | null;
};

export class MailSendError extends Error {
  constructor(
    message: string,
    /** True only when the provider definitely did NOT send (4xx validation). */
    readonly definiteNotSent: boolean,
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

export type DrainResult = { messages: InboundMail[]; caughtUp: boolean; cursor: string | null };

export interface MailClient {
  /** False until a send transport that can set the RFC 8058 headers exists; the send gate refuses. */
  readonly sendSupported: boolean;
  send(m: OutboundMail): Promise<SendResult>;
  /** Drains inbox messages newer than `cursor`, newest-last, up to maxPages. */
  drainInbox(cursor: string | null, maxPages: number): Promise<DrainResult>;
  /** Saves a draft in the mailbox (never sends). */
  createDraft(d: { to: string; subject: string; text: string; inReplyToProviderMessageId?: string }): Promise<{ draftId: string | null }>;
}
