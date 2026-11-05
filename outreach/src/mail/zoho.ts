// Zoho Mail REST client: inbox drain, Sent-folder reconciliation, drafts.
// DraftsTransport: there is no send method (see ./types.ts). Every POST this
// client makes is a save-draft call with mode="draft" (enforced by a static test).
//
// Docs used (2026-11-04): /mail/help/api/get-emails-list.html,
// get-original-message.html, post-save-draft-template.html (mode, inReplyTo,
// refHeader), get-all-folder-details.html (folderType Inbox/Sent/Drafts).
// Never called with real credentials in this repo's tests.
import { addrOf, extractDsn, firstTextPlain, parseMime } from "./mime";
import { MailboxError, type DrainResult, type InboundMail, type IsKnown, type MailClient, type OutreachDraft, type SentMail, type SentResult } from "./types";

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
/** Rows re-read before the saved position each tick, so up to this many deletions/moves between ticks can't cause a skip. */
export const OVERLAP = 25;
export const MAX_RAW_CHARS = 1_000_000;

/** Cursor = persisted pagination progress: next 1-based start index in oldest-first order. */
type WalkCursor = { s: number };
export function parseCursor(c: string | null): WalkCursor {
  if (!c) return { s: 1 };
  try {
    const j = JSON.parse(c) as Partial<WalkCursor>;
    if (j && typeof j === "object" && Number.isInteger(j.s) && (j.s as number) >= 1) return { s: j.s as number };
  } catch {
    // legacy/garbage cursor: start over; handlers dedupe by message id
  }
  return { s: 1 };
}

export class ZohoAuthError extends Error {}

type ListRow = {
  messageId: string;
  threadId?: string;
  receivedTime?: string;
  sentDateInGMT?: string;
  fromAddress?: string;
  toAddress?: string;
  subject?: string;
};

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** Zoho returns toAddress like `"rebecca"<rebecca@zylker.com>`, possibly several, comma-separated and HTML-escaped. */
export function parseAddressList(v: string | undefined): string[] {
  if (!v) return [];
  const s = decodeEntities(v);
  const out = new Set<string>();
  for (const m of s.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) out.add(m[0].toLowerCase());
  return [...out];
}

export class ZohoMailClient implements MailClient {
  private token: { value: string; exp: number } | null = null;
  private accountId: string | null = null;
  private folders: Record<string, string> | null = null;

  // Default wraps the global fetch: stored bare and called as this.f(), Workers
  // throws "Illegal invocation" (this !== globalThis). Live bug 2026-11-05.
  constructor(private cfg: ZohoConfig, private f: Fetch = (i, init) => fetch(i, init), private now: () => number = Date.now) {}

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
    if (!res.ok) throw new MailboxError(`ZOHO_HTTP_${res.status}`, res.status >= 400 && res.status < 500, false);
    return (await res.json()) as T;
  }

  private async ids(): Promise<{ accountId: string; folders: Record<string, string> }> {
    if (!this.accountId) {
      const j = await this.api<{ data: { accountId: string; primaryEmailAddress?: string; emailAddress?: { mailId: string }[] }[] }>("/api/accounts");
      const want = this.cfg.fromAddress.toLowerCase();
      const acct =
        j.data.find((a) => (a.primaryEmailAddress ?? "").toLowerCase() === want) ??
        j.data.find((a) => (a.emailAddress ?? []).some((e) => e.mailId.toLowerCase() === want));
      if (!acct) throw new Error("ZOHO_ACCOUNT_NOT_FOUND");
      this.accountId = String(acct.accountId);
    }
    if (!this.folders) {
      const j = await this.api<{ data: { folderId: string; folderType?: string; folderName?: string }[] }>(`/api/accounts/${this.accountId}/folders`);
      const byType: Record<string, string> = {};
      // Prefer the system folder whose name equals its type (custom folders can also carry type "Inbox").
      for (const x of j.data) {
        const t = x.folderType ?? "";
        if (t && !(t in byType) && (x.folderName ?? "").toLowerCase() === t.toLowerCase()) byType[t] = String(x.folderId);
      }
      for (const x of j.data) if (x.folderType && !(x.folderType in byType)) byType[x.folderType] = String(x.folderId);
      if (!byType.Inbox) throw new Error("ZOHO_INBOX_NOT_FOUND");
      if (!byType.Sent) throw new Error("ZOHO_SENT_NOT_FOUND");
      this.folders = byType;
    }
    return { accountId: this.accountId, folders: this.folders };
  }

  /**
   * Oldest-first walk (sortorder=true) from the saved position, re-reading OVERLAP
   * rows before it. New mail only appends at the end, so nothing is skipped when
   * the backlog is larger than maxPages: the next tick resumes where this one
   * stopped. Already-handled ids (isKnown) are not fetched again.
   */
  private async walk(folderId: string, cursor: string | null, maxPages: number, includeTo: boolean, isKnown?: IsKnown) {
    const { accountId } = await this.ids();
    let s = Math.max(1, parseCursor(cursor).s - OVERLAP);
    const fresh: ListRow[] = [];
    const seen = new Set<string>();
    let caughtUp = false;
    for (let page = 0; page < maxPages; page++) {
      const q = new URLSearchParams({
        folderId,
        start: String(s),
        limit: String(PAGE),
        sortBy: "date",
        sortorder: "true",
        ...(includeTo ? { includeto: "true" } : {}),
      });
      const j = await this.api<{ data: ListRow[] }>(`/api/accounts/${accountId}/messages/view?${q}`);
      const rows = j.data ?? [];
      if (rows.length === 0 && page === 0 && s > 1) {
        // Even the OVERLAP re-read is past the end: more than OVERLAP messages were
        // archived/deleted since the last tick, so the saved position no longer exists
        // and new mail now sits below it. Restart from the top; seen/isKnown dedupe.
        s = 1;
        continue;
      }
      for (const r of rows) {
        const id = String(r.messageId);
        if (seen.has(id)) continue;
        seen.add(id);
        if (isKnown && (await isKnown(id))) continue;
        fresh.push(r);
      }
      if (rows.length < PAGE) {
        caughtUp = true;
        s += rows.length;
        break;
      }
      s += PAGE;
    }
    return { accountId, fresh, caughtUp, cursor: JSON.stringify({ s } satisfies WalkCursor) };
  }

  private async original(accountId: string, messageId: string) {
    const orig = await this.api<{ data: { content: string } }>(`/api/accounts/${accountId}/messages/${messageId}/originalmessage`);
    // Hostile mail can be huge: parse at most MAX_RAW_CHARS (headers and the first text part fit easily).
    return parseMime(String(orig.data?.content ?? "").slice(0, MAX_RAW_CHARS));
  }

  async drainInbox(cursor: string | null, maxPages: number, isKnown?: IsKnown): Promise<DrainResult> {
    const { folders } = await this.ids();
    const w = await this.walk(folders.Inbox, cursor, maxPages, false, isKnown);
    const messages: InboundMail[] = [];
    for (const r of w.fresh) {
      const p = await this.original(w.accountId, r.messageId);
      messages.push({
        providerMessageId: String(r.messageId),
        providerThreadId: r.threadId ? String(r.threadId) : null,
        receivedAt: Number(r.receivedTime ?? 0),
        from: addrOf(p.headers["from"] ?? r.fromAddress),
        subject: p.headers["subject"] ?? r.subject ?? "",
        headers: p.headers,
        text: firstTextPlain(p),
        dsn: extractDsn(p),
      });
    }
    return { messages, caughtUp: w.caughtUp, cursor: w.cursor };
  }

  async listSent(cursor: string | null, maxPages: number, isKnown?: IsKnown): Promise<SentResult> {
    const { folders } = await this.ids();
    const w = await this.walk(folders.Sent, cursor, maxPages, true, isKnown);
    const messages: SentMail[] = [];
    for (const r of w.fresh) {
      // The original message gives the real Message-ID (needed to thread the follow-up
      // and to match replies via In-Reply-To) and the authoritative To header.
      const p = await this.original(w.accountId, r.messageId);
      messages.push({
        providerMessageId: String(r.messageId),
        providerThreadId: r.threadId ? String(r.threadId) : null,
        sentAt: Number(r.sentDateInGMT ?? r.receivedTime ?? 0),
        to: parseAddressList(p.headers["to"] ?? r.toAddress),
        subject: p.headers["subject"] ?? r.subject ?? "",
        rfcMessageId: p.headers["message-id"] ?? null,
        text: firstTextPlain(p),
      });
    }
    return { messages, caughtUp: w.caughtUp, cursor: w.cursor };
  }

  /** Zoho save-draft: POST .../messages with mode="draft" (+ inReplyTo/refHeader to thread it). */
  async createDraft(d: OutreachDraft): Promise<{ draftId: string | null }> {
    const { accountId } = await this.ids();
    const body: Record<string, string> = {
      fromAddress: this.cfg.fromAddress,
      toAddress: d.to,
      subject: d.subject,
      content: d.text,
      mailFormat: "plaintext",
      encoding: "UTF-8",
      mode: "draft",
    };
    if (d.inReplyTo) body.inReplyTo = d.inReplyTo;
    if (d.references) body.refHeader = d.references;
    const j = await this.api<{ data?: { messageId?: string } }>(`/api/accounts/${accountId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // The response shape isn't documented; keep the id when present.
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
