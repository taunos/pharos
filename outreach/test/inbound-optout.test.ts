// S2 (inbound part), S6 opt-out, §9.1 classification + matching, MIME/DSN parsing.
import { describe, it, expect } from "vitest";
import { makeOptoutToken } from "../src/crypto";
import { handleFetch } from "../src/index";
import { classify, drainInbox, handleInbound } from "../src/inbound";
import { extractDsn, parseMime, stripQuoted } from "../src/mail/mime";
import { researchStep } from "../src/research";
import { isSuppressed } from "../src/suppression";
import { FakeMail, TEST_OPTOUT_SECRET, TUE_1400, freshDb, inboundMail, insertLead, makeEnv, makeFetch, noopAlert } from "./helpers";

const CRLF = String.fromCharCode(13, 10);

async function sentLead(db: D1Database, domain = "example.com") {
  const id = await insertLead(db, { domain, state: "sent", contact_email: `hello@${domain}`, fact_sheet_json: JSON.stringify({ score_url: "https://astrant.io/score/x" }) });
  const mid = crypto.randomUUID();
  await db
    .prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, rfc_message_id, provider_thread_id, sent_at, created_at, updated_at) VALUES (?, ?, 'initial', 's', 'b', '{}', 'sent', 0, ?, ?, 1, 0, 0)")
    .bind(mid, id, `<${mid}@getastrant.com>`, `thr-${domain}`)
    .run();
  await db
    .prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, created_at, updated_at) VALUES (?, ?, 'followup', 's', 'b', '{}', 'queued', 0, 0, 0)")
    .bind(crypto.randomUUID(), id)
    .run();
  return { id, mid, rfc: `<${mid}@getastrant.com>` };
}
const followupStatus = async (db: D1Database, lead: string) =>
  (await db.prepare("SELECT status FROM messages WHERE lead_id = ? AND kind = 'followup'").bind(lead).first<{ status: string }>())!.status;
const leadState = async (db: D1Database, lead: string) => (await db.prepare("SELECT state FROM leads WHERE id = ?").bind(lead).first<{ state: string }>())!.state;

describe("classification (rules first; safer branch when unsure)", () => {
  const c = (o: Parameters<typeof inboundMail>[0]) => classify(inboundMail(o), null);
  it("rules", async () => {
    expect((await c({ from: "mailer-daemon@x.com", dsn: { status: "5.1.1", finalRecipient: null, originalMessageId: null } })).class).toBe("bounce_hard");
    expect((await c({ from: "mailer-daemon@x.com", dsn: { status: "4.2.2", finalRecipient: null, originalMessageId: null } })).class).toBe("bounce_soft");
    expect((await c({ from: "postmaster@x.com" })).class).toBe("bounce_hard"); // unknown status ⇒ stop emailing
    expect((await c({ headers: { "auto-submitted": "auto-replied" } })).class).toBe("auto_reply");
    expect((await c({ subject: "Out of Office: back Monday" })).class).toBe("auto_reply");
    expect((await c({ text: "Please remove me from your list." })).class).toBe("opt_out");
    expect((await c({ text: "no thanks" })).class).toBe("opt_out");
    expect((await c({ text: "This is spam, reported." })).class).toBe("complaint");
    expect((await c({ text: "We're not interested at this time." })).class).toBe("not_interested");
    expect((await c({ text: "Tell me more about pricing?" })).class).toBe("needs_human"); // no model under off
  });
  it("our own quoted footer ('reply \"no thanks\"', 'unsubscribe') does not trigger opt-out", async () => {
    const text = `Sounds interesting, what does it cost?\n\nOn Tue, Bruno wrote:\n> Don't want these? https://go.getastrant.com/u/x or reply "no thanks".`;
    expect(stripQuoted(text)).toBe("Sounds interesting, what does it cost?");
    expect((await c({ text })).class).toBe("needs_human");
  });
  it("model below 0.7 confidence ⇒ needs_human; garbage ⇒ needs_human", async () => {
    const ai = { run: async () => ({ response: JSON.stringify({ class: "interested", confidence: 0.6 }) }) };
    expect((await classify(inboundMail({ text: "maybe" }), ai)).class).toBe("needs_human");
    const ai2 = { run: async () => ({ response: JSON.stringify({ class: "interested", confidence: 0.9 }) }) };
    expect((await classify(inboundMail({ text: "Yes, let's talk" }), ai2)).class).toBe("interested");
    const ai3 = { run: async () => ({ response: "nope" }) };
    expect((await classify(inboundMail({ text: "hmm" }), ai3)).class).toBe("needs_human");
  });
});

describe("S2 inbound actions", () => {
  const d = (mail = new FakeMail()) => ({ mail, ai: null, alert: noopAlert, now: () => TUE_1400 });

  it("every matched inbound except auto_reply and bounce_soft cancels the queued follow-up", async () => {
    const cases: [Parameters<typeof inboundMail>[0], boolean][] = [
      [{ headers: { "auto-submitted": "auto-replied" } }, false],
      [{ from: "mailer-daemon@mx.com", dsn: { status: "4.4.1", finalRecipient: "hello@example.com", originalMessageId: null } }, false],
      [{ from: "mailer-daemon@mx.com", dsn: { status: "5.1.1", finalRecipient: "hello@example.com", originalMessageId: null } }, true],
      [{ text: "unsubscribe" }, true],
      [{ text: "this is spam" }, true],
      [{ text: "not interested" }, true],
      [{ text: "What would this cost?" }, true],
    ];
    for (const [o, cancels] of cases) {
      const { db } = freshDb();
      const env = makeEnv(db);
      const l = await sentLead(db);
      await handleInbound(env, d(), inboundMail({ headers: { "in-reply-to": l.rfc, ...(o.headers ?? {}) }, ...o, ...(o.headers ? { headers: { "in-reply-to": l.rfc, ...o.headers } } : {}) }));
      expect(await followupStatus(db, l.id), JSON.stringify(o)).toBe(cancels ? "cancelled" : "queued");
    }
  });

  it("a DSN with no thread headers still matches via the embedded Message-ID, else Final-Recipient", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const a = await sentLead(db, "a.com");
    const b = await sentLead(db, "b.com");
    await handleInbound(env, d(), inboundMail({ from: "mailer-daemon@mx.net", subject: "Undeliverable", dsn: { status: "5.1.1", finalRecipient: null, originalMessageId: a.rfc } }));
    expect(await leadState(db, a.id)).toBe("bounced");
    await handleInbound(env, d(), inboundMail({ from: "mailer-daemon@mx.net", subject: "Undeliverable", dsn: { status: "5.1.1", finalRecipient: "hello@b.com", originalMessageId: null } }));
    expect(await leadState(db, b.id)).toBe("bounced");
    expect(await isSuppressed(env, { email: "hello@b.com", domain: "unrelated.com" })).toBe(true);
  });

  it("an unmatched DSN is needs_human and pauses sending", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0").run();
    await handleInbound(env, d(), inboundMail({ from: "mailer-daemon@mx.net", dsn: { status: "5.1.1", finalRecipient: "who@nowhere.com", originalMessageId: "<zzz@x>" } }));
    expect(await db.prepare("SELECT paused, pause_reason FROM control").first()).toEqual({ paused: 1, pause_reason: "unmatched_dsn" });
    expect((await db.prepare("SELECT class FROM inbound").first<{ class: string }>())!.class).toBe("needs_human");
  });

  it("opt-out reply suppresses email and domain and requests scan deletion; re-poll inserts nothing new", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const l = await sentLead(db);
    await db.prepare("INSERT INTO lead_scans (scan_id, lead_id, created_at) VALUES ('s1', ?, 0)").bind(l.id).run();
    const m = inboundMail({ providerThreadId: "thr-example.com", text: "Please stop emailing us" });
    await handleInbound(env, d(), m);
    await handleInbound(env, d(), m);
    expect(await leadState(db, l.id)).toBe("opted_out");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM inbound").first<{ n: number }>())!.n).toBe(1);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM suppression").first<{ n: number }>())!.n).toBe(2);
    expect((await db.prepare("SELECT delete_requested_at FROM lead_scans").first<{ delete_requested_at: number }>())!.delete_requested_at).toBe(TUE_1400);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'inbound_opt_out'").first<{ n: number }>())!.n).toBe(1);
  });

  it("interested reply: a threaded mailbox DRAFT for Bruno (nothing can send) + alert", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const l = await sentLead(db);
    const mail = new FakeMail();
    const ai = { run: async () => ({ response: JSON.stringify({ class: "interested", confidence: 0.95 }) }) };
    await handleInbound(env, { mail, ai, alert: noopAlert, now: () => TUE_1400 }, inboundMail({ headers: { "in-reply-to": l.rfc, "message-id": "<their-1@example.com>" }, text: "Yes, I'd like to talk." }));
    expect(mail.drafts.length).toBe(1);
    expect(mail.drafts[0].inReplyTo).toBe("<their-1@example.com>");
    expect(mail.drafts[0].to).toBe("hello@example.com");
    expect(await leadState(db, l.id)).toBe("replied");
    expect((await db.prepare("SELECT draft_id FROM inbound").first<{ draft_id: string }>())!.draft_id).toBe("d-1");
  });

  it("drainInbox records inbox_caught_up_at only when the provider drained to empty", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const mail = new FakeMail();
    mail.caughtUp = false;
    expect(await drainInbox(env, d(mail))).toBe(false);
    expect((await db.prepare("SELECT inbox_caught_up_at FROM control").first<{ inbox_caught_up_at: number | null }>())!.inbox_caught_up_at).toBeNull();
    mail.caughtUp = true;
    expect(await drainInbox(env, d(mail))).toBe(true);
    expect((await db.prepare("SELECT inbox_caught_up_at FROM control").first<{ inbox_caught_up_at: number }>())!.inbox_caught_up_at).toBe(TUE_1400);
  });
});

describe("MIME / DSN parsing", () => {
  it("extracts status, Final-Recipient and the embedded original Message-ID from a multipart/report", () => {
    const raw = [
      "From: Mail Delivery System <mailer-daemon@mx.example.net>",
      "Subject: Undelivered Mail Returned to Sender",
      'Content-Type: multipart/report; report-type=delivery-status; boundary="BB"',
      "",
      "--BB",
      "Content-Type: text/plain",
      "",
      "Your message could not be delivered.",
      "--BB",
      "Content-Type: message/delivery-status",
      "",
      "Reporting-MTA: dns; mx.example.net",
      "",
      "Final-Recipient: rfc822; Hello@Acme.com",
      "Action: failed",
      "Status: 5.1.1",
      "--BB",
      "Content-Type: text/rfc822-headers",
      "",
      "Message-ID: <abc-123@getastrant.com>",
      "Subject: Two fixes for acme.com",
      "--BB--",
      "",
    ].join(CRLF);
    const p = parseMime(raw);
    expect(extractDsn(p)).toEqual({ status: "5.1.1", finalRecipient: "hello@acme.com", originalMessageId: "<abc-123@getastrant.com>" });
  });
  it("plain replies have no DSN; quoted-printable decodes", () => {
    const raw = ["From: a@b.com", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", "No thanks =E2=80=94 we're set.", ""].join(CRLF);
    const p = parseMime(raw);
    expect(extractDsn(p)).toBeNull();
    expect(p.body.trim()).toBe("No thanks — we're set.");
  });
});

describe("S6 opt-out link", () => {
  async function setup() {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "off" });
    const l = await sentLead(db);
    const token = await makeOptoutToken(TEST_OPTOUT_SECRET, l.mid);
    const fetchApp = (method: string) =>
      handleFetch(new Request(`https://go.getastrant.com/u/${token}`, { method, ...(method === "POST" ? { body: "List-Unsubscribe=One-Click", headers: { "Content-Type": "application/x-www-form-urlencoded" } } : {}) }), env, {
        fetch: makeFetch().f,
        now: () => TUE_1400,
      });
    return { db, env, l, fetchApp };
  }
  it("GET changes nothing (link scanners prefetch)", async () => {
    const { db, l, fetchApp } = await setup();
    const r = await fetchApp("GET");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Stop emails from Astrant to this address?");
    expect(await leadState(db, l.id)).toBe("sent");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM suppression").first<{ n: number }>())!.n).toBe(0);
  });
  it("POST (RFC 8058 one-click) suppresses email + domain, cancels the follow-up — even under off", async () => {
    const { db, env, l, fetchApp } = await setup();
    const r = await fetchApp("POST");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Done. You won&#39;t hear from us again.");
    expect(await leadState(db, l.id)).toBe("opted_out");
    expect(await followupStatus(db, l.id)).toBe("cancelled");
    expect(await isSuppressed(env, { email: "hello@example.com", domain: "x.org" })).toBe(true);
    expect(await isSuppressed(env, { domain: "example.com" })).toBe(true);
  });
  it("a suppressed domain is never queued again, including after re-import", async () => {
    const { db, env, fetchApp } = await setup();
    await fetchApp("POST");
    await db.prepare("DELETE FROM leads").run(); // deletion request removes the lead row; only the hash is kept
    const id = await insertLead(db, { domain: "example.com" });
    const res = await researchStep({ ...env, OUTREACH_MODE: "dry_run" }, { fetch: makeFetch().f, now: () => TUE_1400 });
    expect(res).toBe("suppressed");
    expect(await leadState(db, id)).toBe("disqualified");
    expect(env.SCANNER.calls).toEqual([]);
  });
  it("forged / tampered tokens are rejected", async () => {
    const { env } = await setup();
    const tok = await makeOptoutToken("other-secret", "m");
    const r = await handleFetch(new Request(`https://go.getastrant.com/u/${tok}`, { method: "POST" }), env, { fetch: makeFetch().f, now: () => 1 });
    expect(r.status).toBe(404);
  });
});
