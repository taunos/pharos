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

describe("S7 no-conversation guarantee (static)", () => {
  it("MailClient.send is called from exactly one place: sendQueuedMessage() in src/send.ts", () => {
    const sites: string[] = [];
    for (const f of SRC) {
      const lines = read(f).split("\n");
      lines.forEach((l, i) => {
        if (/\.send\s*\(/.test(l) && !/^\s*\/\//.test(l)) sites.push(`${f.replace(ROOT, "")}:${i + 1}`);
      });
    }
    expect(sites.length).toBe(1);
    expect(sites[0]).toMatch(/src[\\/]send\.ts:/);
    const src = read(join(ROOT, "src", "send.ts"));
    const fnStart = src.indexOf("export async function sendQueuedMessage(");
    const callAt = src.indexOf("deps.mail.send(");
    const nextFn = src.indexOf("\nexport ", fnStart + 10);
    expect(fnStart).toBeGreaterThan(0);
    expect(callAt).toBeGreaterThan(fnStart);
    expect(nextFn === -1 || callAt < nextFn).toBe(true);
  });
  it("the inbound/draft paths never reference a send", () => {
    for (const f of ["inbound.ts", "alerts.ts", "admin.ts", "optout.ts"]) expect(read(join(ROOT, "src", f))).not.toMatch(/\.send\s*\(/);
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

  it("send() refuses: the REST API can't set List-Unsubscribe; sendSupported is false", async () => {
    const z = new ZohoMailClient(cfg, zfetch({}).f);
    expect(z.sendSupported).toBe(false);
    await expect(z.send({} as never)).rejects.toThrow("SEND_TRANSPORT_UNDECIDED");
  });

  it("drains newest-first until the cursor, parses the original MIME, returns oldest-first", async () => {
    const raw = ["From: Jane <hello@acme.com>", "Subject: Re: Two fixes", "In-Reply-To: <m1@getastrant.com>", "Content-Type: text/plain", "", "no thanks", ""].join(String.fromCharCode(13, 10));
    const { f, calls } = zfetch({
      "/api/accounts/42/folders": { data: [{ folderId: "7", folderType: "Inbox" }] },
      "/messages/view": { data: [{ messageId: "200", receivedTime: "2000", threadId: "t" }, { messageId: "150", receivedTime: "1500" }, { messageId: "100", receivedTime: "900" }] },
      "/originalmessage": { data: { content: raw } },
      "/api/accounts": { data: [{ accountId: "42", primaryEmailAddress: "bruno@getastrant.com" }] },
    });
    const z = new ZohoMailClient(cfg, f);
    const r = await z.drainInbox("1000", 10);
    expect(r.caughtUp).toBe(true);
    expect(r.cursor).toBe("2000");
    expect(r.messages.map((m) => m.providerMessageId)).toEqual(["150", "200"]);
    expect(r.messages[0].headers["in-reply-to"]).toBe("<m1@getastrant.com>");
    expect(r.messages[0].from).toBe("hello@acme.com");
    expect(calls.some((c) => c.includes("Zoho-oauthtoken"))).toBe(false); // token goes in a header, not the URL
    expect(calls.filter((c) => c.startsWith("POST https://accounts.zoho.test/oauth/v2/token")).length).toBe(1);
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
