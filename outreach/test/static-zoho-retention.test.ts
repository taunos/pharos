// S7 no-conversation guarantee + Phase-1 code inspection, Zoho client (mocked
// fetch only, never real credentials), §10.3 retention.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZohoAuthError, ZohoMailClient } from "../src/mail/zoho";
import { runRetention } from "../src/retention";
import { DAY } from "../src/clock";
import { freshDb, insertLead, makeEnv } from "./helpers";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const SRC = files(join(ROOT, "src")).filter((f) => f.endsWith(".ts"));
const read = (f: string) => readFileSync(f, "utf8");

describe("S7 / drafts-only guarantee (static): nothing in this Worker can send", () => {
  it("the MailClient interface has no send method and no source calls .send(", () => {
    const types = read(join(ROOT, "src", "mail", "types.ts"));
    const iface = types.slice(types.indexOf("export interface MailClient"));
    expect(iface).not.toMatch(/\bsend\s*\(/);
    expect(iface).toMatch(/createDraft\(/);
    for (const f of SRC) {
      const code = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
      expect(code, f).not.toMatch(/\.send\s*\(/);
      expect(code, f).not.toMatch(/cloudflare:sockets|smtp/i);
    }
  });
  it("every Zoho POST is either the OAuth token refresh or a save-draft with mode=\"draft\"", () => {
    const z = read(join(ROOT, "src", "mail", "zoho.ts"));
    const posts = [...z.matchAll(/method:\s*"POST"/g)].length;
    expect(posts).toBe(2);
    expect(z).toMatch(/oauth\/v2\/token`, \{ method: "POST"/);
    const fn = z.slice(z.indexOf("async createDraft("), z.indexOf("export function zohoFromEnv"));
    expect(fn).toMatch(/mode: "draft"/);
    expect(fn).toMatch(/method: "POST"/);
    expect(z).not.toMatch(/mode: "(?!draft")/);
  });
  it("outreach drafts are created only by createMailboxDraft(); other createDraft callers write to Bruno or reply drafts", () => {
    const sites: string[] = [];
    for (const f of SRC) {
      read(f).split("\n").forEach((l, i) => {
        if (/\.createDraft\s*\(/.test(l)) sites.push(`${f.replace(ROOT, "").replace(/\\/g, "/")}:${i + 1}`);
      });
    }
    const files = sites.map((x) => x.split(":")[0]).sort();
    expect(files).toEqual(["src/alerts.ts", "src/drafts.ts", "src/inbound.ts"]);
    const d = read(join(ROOT, "src", "drafts.ts"));
    const start = d.indexOf("export async function createMailboxDraft(");
    const call = d.indexOf("deps.mail.createDraft(");
    const next = d.indexOf("\nexport ", start + 10);
    expect(call > start && (next === -1 || call < next)).toBe(true);
  });
});

describe("Phase 1 code inspection", () => {
  it("no ctx.waitUntil anywhere (scheduled handlers await)", () => {
    for (const f of SRC) expect(read(f), f).not.toMatch(/\.waitUntil\s*\(/);
  });
  it("no literal control characters in source (String.fromCharCode only)", () => {
    for (const f of [...SRC, ...files(join(ROOT, "test")), join(ROOT, "migrations", "0001_init.sql"), join(ROOT, "wrangler.jsonc")]) {
      const s = read(f);
      // allow \n and \r\n line endings and tabs; nothing else below 0x20, no DEL
      expect(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(s), f).toBe(false);
    }
  });
  it("wrangler.jsonc declares no secret values and defaults to off", () => {
    const w = read(join(ROOT, "wrangler.jsonc"));
    for (const name of ["POSTAL_ADDRESS", "OPTOUT_HMAC_SECRET", "SUPPRESSION_HMAC_SECRET", "MAIL_OAUTH_CLIENT_ID", "MAIL_OAUTH_CLIENT_SECRET", "MAIL_OAUTH_REFRESH_TOKEN"]) {
      expect(new RegExp(`"${name}"\\s*:`).test(w), name).toBe(false);
    }
    expect(w).toMatch(/"OUTREACH_MODE":\s*"off"/);
    expect(w).toMatch(/"entrypoint":\s*"ProspectScan"/);
  });
});

describe("Zoho client (mocked fetch; never real credentials)", () => {
  const cfg = { accountsHost: "accounts.zoho.test", apiHost: "mail.zoho.test", clientId: "cid", clientSecret: "csec", refreshToken: "rt", fromAddress: "bruno@getastrant.com" };
  function zfetch(pages: Record<string, unknown>, opts: { tokenStatus?: number } = {}) {
    const calls: string[] = [];
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.startsWith("https://accounts.zoho.test/oauth/v2/token")) {
        return opts.tokenStatus ? new Response("{}", { status: opts.tokenStatus }) : Response.json({ access_token: "at", expires_in: 3600 });
      }
      for (const [k, v] of Object.entries(pages)) if (url.includes(k)) return Response.json(v);
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    return { f, calls };
  }

  it("drains oldest-first from the saved position, parses the original MIME, and persists progress", async () => {
    const raw = ["From: Jane <hello@acme.com>", "Subject: Re: Two fixes", "In-Reply-To: <m1@getastrant.com>", "Content-Type: text/plain", "", "no thanks", ""].join(String.fromCharCode(13, 10));
    const { f, calls } = zfetch({
      "/api/accounts/42/folders": { data: [{ folderId: "7", folderType: "Inbox", folderName: "Inbox" }, { folderId: "8", folderType: "Sent", folderName: "Sent" }] },
      "/messages/view": { data: [{ messageId: "100", receivedTime: "900" }, { messageId: "150", receivedTime: "1500" }, { messageId: "200", receivedTime: "2000", threadId: "t" }] },
      "/originalmessage": { data: { content: raw } },
      "/api/accounts": { data: [{ accountId: "42", primaryEmailAddress: "bruno@getastrant.com" }] },
    });
    const z = new ZohoMailClient(cfg, f);
    const r = await z.drainInbox(null, 10, async (id) => id === "100");
    expect(r.caughtUp).toBe(true);
    expect(r.cursor).toBe(JSON.stringify({ s: 4 }));
    expect(r.messages.map((m) => m.providerMessageId)).toEqual(["150", "200"]); // "100" already known: not re-fetched
    expect(calls.some((c) => c.includes("sortorder=true"))).toBe(true);
    expect(r.messages[0].headers["in-reply-to"]).toBe("<m1@getastrant.com>");
    expect(r.messages[0].from).toBe("hello@acme.com");
    expect(calls.some((c) => c.includes("Zoho-oauthtoken"))).toBe(false); // token goes in a header, not the URL
    expect(calls.filter((c) => c.startsWith("POST https://accounts.zoho.test/oauth/v2/token")).length).toBe(1);
  });

  it("listSent reads the Sent folder with recipients and the real Message-ID; createDraft posts mode=draft with threading", async () => {
    const raw = ["From: Bruno <bruno@getastrant.com>", "To: \"Acme\" <Hello@Acme.com>", "Subject: Two fixes for acme.com", "Message-ID: <real-9@mx.zohomail.com>", "", "body", ""].join(String.fromCharCode(13, 10));
    const posts: string[] = [];
    const base = zfetch({
      "/api/accounts/42/folders": { data: [{ folderId: "7", folderType: "Inbox", folderName: "Inbox" }, { folderId: "8", folderType: "Sent", folderName: "Sent" }] },
      "/messages/view": { data: [{ messageId: "300", sentDateInGMT: "3000", threadId: "t9", toAddress: "&quot;Acme&quot;&lt;hello@acme.com&gt;" }] },
      "/originalmessage": { data: { content: raw } },
      "/api/accounts/42/messages": { data: { messageId: "draft-1" } },
      "/api/accounts": { data: [{ accountId: "42", primaryEmailAddress: "bruno@getastrant.com" }] },
    });
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && String(u).includes("/messages")) posts.push(String(init.body));
      return base.f(u, init);
    }) as typeof fetch;
    const z = new ZohoMailClient(cfg, f);
    const s = await z.listSent(null, 2);
    expect(s.messages).toEqual([{ providerMessageId: "300", providerThreadId: "t9", sentAt: 3000, to: ["hello@acme.com"], subject: "Two fixes for acme.com", rfcMessageId: "<real-9@mx.zohomail.com>", text: expect.stringMatching(/^body\s*$/) }]);
    expect(base.calls.some((c) => c.includes("folderId=8") && c.includes("includeto=true"))).toBe(true);
    const d = await z.createDraft({ to: "hello@acme.com", subject: "Re: x", text: "t", inReplyTo: "<real-9@mx.zohomail.com>", references: "<real-9@mx.zohomail.com>" });
    expect(d.draftId).toBe("draft-1");
    const body = JSON.parse(posts[0]);
    expect(body).toMatchObject({ mode: "draft", mailFormat: "plaintext", toAddress: "hello@acme.com", inReplyTo: "<real-9@mx.zohomail.com>", refHeader: "<real-9@mx.zohomail.com>" });
  });

  it("token refresh failure is an auth error (pauses via the tick)", async () => {
    const z = new ZohoMailClient(cfg, zfetch({}, { tokenStatus: 400 }).f);
    await expect(z.drainInbox(null, 1)).rejects.toBeInstanceOf(ZohoAuthError);
  });
});

describe("§10.3 retention", () => {
  it("purges contact fields at 60 days (no reply) / 30 days (terminal reply), closes followups after 14 days, requests scan deletion at 90 days", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const now = 200 * DAY;
    const noReply = await insertLead(db, { domain: "a.com", state: "followup_sent", contact_email: "hello@a.com" });
    await db.prepare("UPDATE leads SET last_outbound_at = ? WHERE id = ?").bind(now - 61 * DAY, noReply).run();
    const recent = await insertLead(db, { domain: "b.com", state: "sent", contact_email: "hello@b.com" });
    await db.prepare("UPDATE leads SET last_outbound_at = ? WHERE id = ?").bind(now - 5 * DAY, recent).run();
    const replied = await insertLead(db, { domain: "c.com", state: "replied", contact_email: "hello@c.com" });
    await db.prepare("UPDATE leads SET terminal_at = ? WHERE id = ?").bind(now - 31 * DAY, replied).run();
    const old = await insertLead(db, { domain: "d.com", state: "closed", contact_email: null });
    await db.prepare("UPDATE leads SET last_outbound_at = ? WHERE id = ?").bind(now - 91 * DAY, old).run();
    await db.prepare("INSERT INTO lead_scans (scan_id, lead_id, created_at) VALUES ('s-old', ?, 0)").bind(old).run();
    const r = await runRetention(env, now);
    const get = async (id: string) => db.prepare("SELECT state, contact_email FROM leads WHERE id = ?").bind(id).first();
    expect(await get(noReply)).toEqual({ state: "closed", contact_email: null });
    expect(await get(recent)).toEqual({ state: "sent", contact_email: "hello@b.com" });
    expect(await get(replied)).toEqual({ state: "replied", contact_email: null });
    expect(r.scans_deleted).toBe(1);
    expect(env.SCANNER.deleted).toEqual(["s-old"]);
  });
});
