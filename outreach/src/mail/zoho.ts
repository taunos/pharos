// Zoho Mail REST client (inbox drain, original-message fetch, drafts).
//
// SEND IS NOT IMPLEMENTED. Zoho's REST send/reply APIs (2026-11-04 docs:
// /mail/help/api/post-send-an-email.html, post-reply-to-an-email.html) take
// no custom headers and no raw MIME, so they cannot set List-Unsubscribe /
// List-Unsubscribe-Post (RFC 8058), Message-ID, In-Reply-To or References.
// The send transport is a decision for Bruno (see the build report); until it
// is made, send() refuses. Never called with real credentials in this repo's tests.
import { addrOf, extractDsn, firstTextPlain, parseMime } from "./mime";
import { MailSendError, type DrainResult, type InboundMail, type MailClient, type OutboundMail, type SendResult } from "./types";

export type ZohoConfig = {
  accountsHost: string; // accounts.zoho.com
  apiHost: string; // mail.zoho.com
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fromAddress: string;
};

type Fetch = typeof fetch;
const PAGE = 50;

export class ZohoAuthError extends Error {}

export class ZohoMailClient implements MailClient {
  private token: { value: string; exp: number } | null = null;
  private accountId: string | null = null;
  private inboxFolderId: string | null = null;

  constructor(private cfg: ZohoConfig, private f: Fetch = fetch, private now: () => number = Date.now) {}

  readonly sendSupported = false;

  async send(_m: OutboundMail): Promise<SendResult> {
    throw new MailSendError("SEND_TRANSPORT_UNDECIDED", true, false);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > this.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({
      refresh_token: this.cfg.refreshToken,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: "refresh_token",
    });
    const res = await this.f(`https://${this.cfg.accountsHost}/oauth/v2/token`, { method: "POST", body });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !j.access_token) throw new ZohoAuthError(`ZOHO_TOKEN_REFRESH_FAILED:${res.status}:${j.error ?? ""}`);
    this.token = { value: j.access_token, exp: this.now() + (j.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const tok = await this.accessToken();
    const res = await this.f(`https://${this.cfg.apiHost}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Zoho-oauthtoken ${tok}`, Accept: "application/json" },
    });
    if (res.status === 401) throw new ZohoAuthError(`ZOHO_401:${path.split("?")[0]}`);
    if (!res.ok) throw new Error(`ZOHO_HTTP_${res.status}`);
    return (await res.json()) as T;
  }

  private async ids(): Promise<{ accountId: string; inboxFolderId: string }> {
    if (!this.accountId) {
      const j = await this.api<{ data: { accountId: string; primaryEmailAddress?: string; emailAddress?: { mailId: string }[] }[] }>("/api/accounts");
      const want = this.cfg.fromAddress.toLowerCase();
      const acct =
        j.data.find((a) => (a.primaryEmailAddress ?? "").toLowerCase() === want) ??
        j.data.find((a) => (a.emailAddress ?? []).some((e) => e.mailId.toLowerCase() === want));
      if (!acct) throw new Error("ZOHO_ACCOUNT_NOT_FOUND");
      this.accountId = String(acct.accountId);
    }
    if (!this.inboxFolderId) {
      const j = await this.api<{ data: { folderId: string; folderType?: string; folderName?: string }[] }>(`/api/accounts/${this.accountId}/folders`);
      const inbox = j.data.find((x) => x.folderType === "Inbox") ?? j.data.find((x) => (x.folderName ?? "").toLowerCase() === "inbox");
      if (!inbox) throw new Error("ZOHO_INBOX_NOT_FOUND");
      this.inboxFolderId = String(inbox.folderId);
    }
    return { accountId: this.accountId, inboxFolderId: this.inboxFolderId };
  }

  /**
   * Lists newest-first and walks pages until it reaches a message at or before
   * the cursor (receivedTime ms). caughtUp=false when maxPages ran out first.
   */
  async drainInbox(cursor: string | null, maxPages: number): Promise<DrainResult> {
    const { accountId, inboxFolderId } = await this.ids();
    const since = cursor ? Number(cursor) : 0;
    type Row = { messageId: string; threadId?: string; receivedTime: string; fromAddress?: string; subject?: string };
    const fresh: Row[] = [];
    let caughtUp = false;
    for (let page = 0; page < maxPages; page++) {
      const q = new URLSearchParams({
        folderId: inboxFolderId,
        start: String(page * PAGE + 1),
        limit: String(PAGE),
        sortBy: "date",
        sortorder: "false",
      });
      const j = await this.api<{ data: Row[] }>(`/api/accounts/${accountId}/messages/view?${q}`);
      const rows = j.data ?? [];
      let reachedOld = false;
      for (const r of rows) {
        if (Number(r.receivedTime) < since) {
          reachedOld = true;
          break;
        }
        fresh.push(r);
      }
      if (reachedOld || rows.length < PAGE) {
        caughtUp = true;
        break;
      }
    }
    fresh.sort((a, b) => Number(a.receivedTime) - Number(b.receivedTime));
    const messages: InboundMail[] = [];
    for (const r of fresh) {
      const orig = await this.api<{ data: { content: string } }>(`/api/accounts/${accountId}/messages/${r.messageId}/originalmessage`);
      const p = parseMime(orig.data?.content ?? "");
      messages.push({
        providerMessageId: String(r.messageId),
        providerThreadId: r.threadId ? String(r.threadId) : null,
        receivedAt: Number(r.receivedTime),
        from: addrOf(p.headers["from"] ?? r.fromAddress),
        subject: p.headers["subject"] ?? r.subject ?? "",
        headers: p.headers,
        text: firstTextPlain(p),
        dsn: extractDsn(p),
      });
    }
    // Cursor only advances over what was fully fetched; if not caught up the
    // newest-first walk restarts next tick and INSERT OR IGNORE dedupes.
    const maxSeen = fresh.reduce((m, r) => Math.max(m, Number(r.receivedTime)), since);
    return { messages, caughtUp, cursor: caughtUp ? String(maxSeen) : cursor };
  }

  /** Zoho "save draft": same POST as send with mode=draft [verify against the live API before relying on it]. */
  async createDraft(d: { to: string; subject: string; text: string }): Promise<{ draftId: string | null }> {
    const { accountId } = await this.ids();
    const j = await this.api<{ data?: { messageId?: string } }>(`/api/accounts/${accountId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAddress: this.cfg.fromAddress,
        toAddress: d.to,
        subject: d.subject,
        content: d.text,
        mailFormat: "plaintext",
        mode: "draft",
      }),
    });
    return { draftId: j.data?.messageId ? String(j.data.messageId) : null };
  }
}

export function zohoFromEnv(env: {
  ZOHO_ACCOUNTS_HOST?: string;
  ZOHO_MAIL_API_HOST?: string;
  MAIL_OAUTH_CLIENT_ID?: string;
  MAIL_OAUTH_CLIENT_SECRET?: string;
  MAIL_OAUTH_REFRESH_TOKEN?: string;
  MAIL_FROM?: string;
}): ZohoMailClient | null {
  if (!env.MAIL_OAUTH_CLIENT_ID || !env.MAIL_OAUTH_CLIENT_SECRET || !env.MAIL_OAUTH_REFRESH_TOKEN || !env.MAIL_FROM) return null;
  return new ZohoMailClient({
    accountsHost: env.ZOHO_ACCOUNTS_HOST || "accounts.zoho.com",
    apiHost: env.ZOHO_MAIL_API_HOST || "mail.zoho.com",
    clientId: env.MAIL_OAUTH_CLIENT_ID,
    clientSecret: env.MAIL_OAUTH_CLIENT_SECRET,
    refreshToken: env.MAIL_OAUTH_REFRESH_TOKEN,
    fromAddress: env.MAIL_FROM,
  });
}
