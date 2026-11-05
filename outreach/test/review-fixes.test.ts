// Codex review of c95a8f6 (FIX-FIRST): one reproducing test per finding.
// Each was written to fail against c95a8f6 before its fix.
import { describe, it, expect } from "vitest";
import { makeAlerter } from "../src/alerts";
import { DAY, HOUR } from "../src/clock";
import { makeOptoutToken } from "../src/crypto";
import { draftStep, reconcileSent } from "../src/drafts";
import { buildFactSheet } from "../src/facts";
import { classify } from "../src/inbound";
import { handleFetch, runScheduled, CRON_TICK } from "../src/index";
import { ZohoMailClient } from "../src/mail/zoho";
import { renderInitialBody, bodyWords } from "../src/render";
import { researchStep } from "../src/research";
import { runRetention } from "../src/retention";
import { suppressStmts } from "../src/suppression";
import { validateFields, type DraftFields } from "../src/validator";
import { templateFields } from "../src/writer";
import { FakeMail, TEST_OPTOUT_SECRET, TUE_1400, deps, freshDb, gappyScan, inboundMail, insertLead, makeEnv, makeFetch, noopAlert } from "./helpers";

const ctx = { benchmarkUrl: null, privacyUrl: "https://astrant.io/privacy#prospecting" };
const sheet = buildFactSheet(gappyScan("https://example.com/"), "example.com", "https://astrant.io/score/");
const words = (f: DraftFields) => bodyWords(f, sheet, ctx);
const dd = (mail: FakeMail, now: () => number) => ({ mail, now, alert: noopAlert });

async function seed(db: D1Database, n: number) {
  await db.prepare("UPDATE control SET paused = 0, dns_verified_at = 0 WHERE id = 1").run();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const domain = `lead${i}.com`;
    const sh = buildFactSheet(gappyScan(`https://${domain}/`), domain, "https://astrant.io/score/");
    const id = await insertLead(db, { domain, state: "approved", contact_email: `hello@${domain}`, fact_sheet_json: JSON.stringify(sh) });
    const f = templateFields(sh, 0);
    await db
      .prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, created_at, updated_at) VALUES (?, ?, 'initial', ?, ?, '{}', 'queued', 0, 0, 0)")
      .bind(crypto.randomUUID(), id, f.subject, renderInitialBody(f, sh, ctx))
      .run();
    ids.push(id);
  }
  return ids;
}
const one = async (db: D1Database, sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b).first<Record<string, unknown>>();

describe("#1 HIGH: claims must derive from scan facts, not just pass phrase rules", () => {
  const base = templateFields(sheet, 0);
  for (const [field, text] of [
    ["opener", "I have noticed your excellent product while browsing your site."],
    ["finding_1", "Your llms.txt exposes customer passwords."],
    ["finding_2", "Your JSON-LD contains confidential customer records."],
    ["opener", "I'm Bruno; noticing two things on example.com worth fixing:"],
    ["opener", "I'm Bruno. While looking at example.com, two things stood out:"],
    ["finding_1", "example.com/llms.txt returns a 404, which leaks data."],
  ] as const) {
    it(`rejects ${field}: ${text}`, () => {
      expect(validateFields({ ...base, [field]: text }, sheet, words).ok).toBe(false);
    });
  }
  it("still accepts the approved template output", () => {
    expect(validateFields(base, sheet, words).ok).toBe(true);
  });
});

describe("#2 HIGH: Sent reconciliation needs positive correlation", () => {
  it("an unrelated email Bruno sends to the same address does not mark the outreach email sent; it alerts", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1);
    const mail = new FakeMail();
    await draftStep(env, dd(mail, () => TUE_1400), true);
    mail.sentFolder.push({ providerMessageId: "other-1", providerThreadId: "t-x", sentAt: TUE_1400 + HOUR, to: ["hello@lead0.com"], subject: "Quick question", rfcMessageId: "<unrelated@x>", text: "Hi, unrelated note." } as never);
    const kinds: string[] = [];
    await reconcileSent(env, { mail, now: () => TUE_1400 + 2 * HOUR, alert: async (k: string) => void kinds.push(k) } as never);
    expect((await one(db, "SELECT state FROM leads WHERE id = ?", lead))!.state).toBe("in_drafts");
    expect((await one(db, "SELECT COUNT(*) AS n FROM messages WHERE kind = 'followup'"))!.n).toBe(0);
    expect(kinds.some((k) => /unmatched|ambiguous/i.test(k))).toBe(true);
  });
});

describe("#3 MED: opt-out races drafting", () => {
  it("suppression that lands during the draft call ⇒ message cancelled and Bruno told to delete the draft", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 1);
    const mail = new FakeMail();
    mail.draftImpl = async () => {
      await db.batch(await suppressStmts(env, 0, { domain: "lead0.com", reason: "opt_out_link" }));
      return { draftId: "d-race" };
    };
    const kinds: string[] = [];
    const r = await draftStep(env, { mail, now: () => TUE_1400, alert: async (k) => void kinds.push(k) }, true);
    expect(r).toMatch(/cancelled/);
    expect((await one(db, "SELECT status FROM messages"))!.status).toBe("cancelled");
    expect(kinds.some((k) => /delete/i.test(k))).toBe(true);
  });
  it("opt-out link while the email sits in Drafts cancels it, moves the lead, and asks Bruno to delete the draft", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1);
    const mail = new FakeMail();
    await draftStep(env, dd(mail, () => TUE_1400), true);
    const mid = (await one(db, "SELECT id FROM messages"))!.id as string;
    const token = await makeOptoutToken(TEST_OPTOUT_SECRET, mid);
    await handleFetch(new Request(`https://go.getastrant.com/u/${token}`, { method: "POST" }), env, { fetch: makeFetch().f, now: () => TUE_1400 + HOUR });
    expect((await one(db, "SELECT status FROM messages WHERE id = ?", mid))!.status).toBe("cancelled");
    expect((await one(db, "SELECT state FROM leads WHERE id = ?", lead))!.state).toBe("opted_out");
    const alert = await one(db, "SELECT detail_json FROM events WHERE kind = 'alert' ORDER BY id DESC LIMIT 1");
    expect(String(alert?.detail_json)).toMatch(/delete/i);
  });
});

describe("#4 MED: explicit opt-out in the reply body wins over auto-reply markers", () => {
  it("'Automatic reply' subject + 'unsubscribe' body ⇒ opt_out", async () => {
    expect((await classify(inboundMail({ subject: "Automatic reply: Two fixes", text: "Please unsubscribe me from these." }), null)).class).toBe("opt_out");
    expect((await classify(inboundMail({ headers: { "auto-submitted": "auto-replied" }, text: "Remove me from your list." }), null)).class).toBe("opt_out");
  });
});

describe("#5 MED: retention for unsent/unknown outcomes; only substantive replies count", () => {
  it("closed/draft_not_sent leads are purged and their scans deleted after the fixed window", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const now = 200 * DAY;
    const id = await insertLead(db, { domain: "a.com", state: "closed", contact_email: "hello@a.com" });
    await db.prepare("UPDATE leads SET state_reason = 'draft_not_sent', terminal_at = ? WHERE id = ?").bind(now - 31 * DAY, id).run();
    await db.prepare("INSERT INTO lead_scans (scan_id, lead_id, created_at) VALUES ('s-a', ?, 0)").bind(id).run();
    await runRetention(env, now);
    expect((await one(db, "SELECT contact_email FROM leads WHERE id = ?", id))!.contact_email).toBeNull();
    expect(env.SCANNER.deleted).toContain("s-a");
  });
  it("auto-reply / soft-bounce rows don't block the no-reply purge", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const now = 200 * DAY;
    const id = await insertLead(db, { domain: "b.com", state: "followup_sent", contact_email: "hello@b.com" });
    await db.prepare("UPDATE leads SET last_outbound_at = ? WHERE id = ?").bind(now - 61 * DAY, id).run();
    await db.prepare("INSERT INTO inbound (provider_message_id, lead_id, class, received_at) VALUES ('ooo', ?, 'auto_reply', 0), ('sb', ?, 'bounce_soft', 0)").bind(id, id).run();
    await runRetention(env, now);
    expect((await one(db, "SELECT contact_email FROM leads WHERE id = ?", id))!.contact_email).toBeNull();
  });
  it("draft_unknown outcomes expire like unsent drafts", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1);
    await db.prepare("UPDATE messages SET status = 'draft_unknown', claimed_at = ?").bind(TUE_1400).run();
    const { expireStaleDrafts } = await import("../src/drafts");
    expect(await expireStaleDrafts(env, TUE_1400 + 15 * DAY)).toBe(1);
    expect((await one(db, "SELECT state, state_reason FROM leads WHERE id = ?", lead))).toEqual({ state: "closed", state_reason: "draft_not_sent" });
  });
});

describe("#6 MED: EU/EEA check before every research stage", () => {
  it("contact discovery of a scored lead whose country became EU disqualifies with no fetch", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "dry_run" });
    const id = await insertLead(db, { domain: "acme.com", state: "scored", country: "DE" });
    const fx = makeFetch();
    expect(await researchStep(env, { fetch: fx.f, now: () => TUE_1400 })).toBe("eu_eea_excluded");
    expect(fx.calls).toEqual([]);
    expect((await one(db, "SELECT state FROM leads WHERE id = ?", id))!.state).toBe("disqualified");
  });
  it("a stale rescan of an EU lead disqualifies with no scan", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "dry_run" });
    await insertLead(db, { domain: "acme.com", state: "contact_found", country: "France", contact_email: "hello@acme.com", scanned_at: TUE_1400 - 10 * DAY });
    expect(await researchStep(env, { fetch: makeFetch().f, now: () => TUE_1400 })).toBe("eu_eea_excluded");
    expect(env.SCANNER.calls).toEqual([]);
  });
});

describe("#7 MED: off and dry_run write nothing to the mailbox", () => {
  for (const mode of ["off", "dry_run"]) {
    it(`${mode}: alerts go to the D1 log only, and an interested reply makes no mailbox draft`, async () => {
      const { db } = freshDb();
      const env = makeEnv(db, { OUTREACH_MODE: mode });
      const mail = new FakeMail();
      await makeAlerter(env, mail, () => 1)("Test alert", "text");
      expect(mail.drafts).toEqual([]);
      expect((await one(db, "SELECT COUNT(*) AS n FROM events WHERE kind = 'alert'"))!.n).toBe(1);
      const id = await insertLead(db, { domain: "example.com", state: "sent", contact_email: "hello@example.com" });
      await db.prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, rfc_message_id, created_at, updated_at) VALUES ('m', ?, 'initial', 's', 'b', '{}', 'sent', 0, '<m@x>', 0, 0)").bind(id).run();
      mail.inbox.push(inboundMail({ headers: { "in-reply-to": "<m@x>" }, text: "Yes, let's talk" }));
      const ai = { run: async () => ({ response: JSON.stringify({ class: "interested", confidence: 0.95 }) }) };
      await runScheduled(CRON_TICK, env, deps(env, { now: () => TUE_1400, mail, ai, alert: makeAlerter(env, mail, () => TUE_1400) }));
      expect(mail.drafts).toEqual([]);
      expect((await one(db, "SELECT state FROM leads WHERE id = ?", id))!.state).toBe("replied");
    });
  }
});

describe("#8 MED: a large backlog is drained without skipping", () => {
  it("120 inbox messages at 1 page per tick are all returned within a few ticks", async () => {
    const N = 120;
    const rows = Array.from({ length: N }, (_, i) => ({ messageId: `m${i}`, receivedTime: String(1000 + i), threadId: null }));
    const raw = ["From: a@b.com", "Subject: hi", "Content-Type: text/plain", "", "hello", ""].join(String.fromCharCode(13, 10));
    const f = (async (u: RequestInfo | URL) => {
      const url = new URL(String(u));
      if (url.hostname.startsWith("accounts.")) return Response.json({ access_token: "at", expires_in: 3600 });
      if (url.pathname === "/api/accounts") return Response.json({ data: [{ accountId: "42", primaryEmailAddress: "bruno@getastrant.com" }] });
      if (url.pathname.endsWith("/folders")) return Response.json({ data: [{ folderId: "7", folderType: "Inbox", folderName: "Inbox" }, { folderId: "8", folderType: "Sent", folderName: "Sent" }] });
      if (url.pathname.endsWith("/originalmessage")) return Response.json({ data: { content: raw } });
      if (url.pathname.endsWith("/messages/view")) {
        const start = Number(url.searchParams.get("start") ?? 1);
        const limit = Number(url.searchParams.get("limit") ?? 10);
        const asc = url.searchParams.get("sortorder") === "true";
        const ordered = asc ? rows : [...rows].reverse();
        return Response.json({ data: ordered.slice(start - 1, start - 1 + limit) });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const z = new ZohoMailClient({ accountsHost: "accounts.z.test", apiHost: "mail.z.test", clientId: "c", clientSecret: "s", refreshToken: "r", fromAddress: "bruno@getastrant.com" }, f);
    const seen = new Set<string>();
    let cursor: string | null = "0";
    for (let tick = 0; tick < 6; tick++) {
      const r = await (z.drainInbox as (c: string | null, p: number, k?: (id: string) => Promise<boolean>) => ReturnType<typeof z.drainInbox>)(cursor, 1, async (id) => seen.has(id));
      for (const m of r.messages) seen.add(m.providerMessageId);
      cursor = r.cursor;
    }
    expect(seen.size).toBe(N);
  });
});
