// Drafts-only transport: gates, the daily cap, idempotency, crash handling,
// the suppression re-check, body opt-out, and Sent-folder reconciliation.
import { describe, it, expect } from "vitest";
import { DAY, HOUR, MIN } from "../src/clock";
import { verifyOptoutToken } from "../src/crypto";
import { createMailboxDraft, draftStep, expireStaleDrafts, reconcileSent, sweepStuckDrafting } from "../src/drafts";
import { buildFactSheet } from "../src/facts";
import { MailboxError } from "../src/mail/types";
import { renderInitialBody } from "../src/render";
import { suppressStmts } from "../src/suppression";
import { templateFields } from "../src/writer";
import { FakeMail, TEST_OPTOUT_SECRET, TEST_POSTAL, TUE_1400, clock, freshDb, gappyScan, insertLead, makeEnv, noopAlert } from "./helpers";

const ctx = { benchmarkUrl: null, privacyUrl: "https://astrant.io/privacy#prospecting" };

async function seed(db: D1Database, n: number, notBefore: number) {
  await db.prepare("UPDATE control SET paused = 0, dns_verified_at = 0 WHERE id = 1").run();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const domain = `lead${i}.com`;
    const sheet = buildFactSheet(gappyScan(`https://${domain}/`), domain, "https://astrant.io/score/");
    const id = await insertLead(db, { domain, state: "approved", contact_email: `hello@${domain}`, fact_sheet_json: JSON.stringify(sheet) });
    const f = templateFields(sheet, 0);
    await db
      .prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, created_at, updated_at) VALUES (?, ?, 'initial', ?, ?, '{}', 'queued', ?, 0, 0)")
      .bind(crypto.randomUUID(), id, f.subject, renderInitialBody(f, sheet, ctx), notBefore + i)
      .run();
    ids.push(id);
  }
  return ids;
}
const dd = (mail: FakeMail, now: () => number) => ({ mail, now, alert: noopAlert });
const state = async (db: D1Database, id: string) => (await db.prepare("SELECT state FROM leads WHERE id = ?").bind(id).first<{ state: string }>())!.state;

describe("draft gates (no mode ever sends; drafts only in gated/auto)", () => {
  const cases: [string, Record<string, string | undefined>, string][] = [
    ["mode unset", { OUTREACH_MODE: undefined }, "gate:mode"],
    ["mode off", { OUTREACH_MODE: "off" }, "gate:mode"],
    ["mode dry_run (log only)", { OUTREACH_MODE: "dry_run" }, "gate:mode"],
    ["POSTAL_ADDRESS empty", { POSTAL_ADDRESS: "" }, "gate:postal_address_missing"],
    ["POSTAL_ADDRESS whitespace", { POSTAL_ADDRESS: "   " }, "gate:postal_address_missing"],
    ["POSTAL_ADDRESS unset", { POSTAL_ADDRESS: undefined }, "gate:postal_address_missing"],
    ["opt-out secret unset", { OPTOUT_HMAC_SECRET: undefined }, "gate:secrets_missing"],
  ];
  for (const [name, over, expected] of cases) {
    it(`no draft when ${name}`, async () => {
      const { db } = freshDb();
      const env = makeEnv(db, over as never);
      await seed(db, 1, 0);
      const mail = new FakeMail();
      expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe(expected);
      expect(mail.drafts).toEqual([]);
    });
  }
  it("gated and auto both create drafts", async () => {
    for (const mode of ["gated", "auto"]) {
      const { db } = freshDb();
      const env = makeEnv(db, { OUTREACH_MODE: mode });
      await seed(db, 1, 0);
      const mail = new FakeMail();
      expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("drafted:initial");
      expect(mail.drafts.length).toBe(1);
    }
  });
  it("no draft when the inbox didn't drain in this tick, when paused, or before DNS is marked verified (+ optional WARMUP_DAYS)", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 1, 0);
    const mail = new FakeMail();
    expect(await draftStep(env, dd(mail, () => TUE_1400), false)).toBe("gate:inbox_not_drained");
    await db.prepare("UPDATE control SET paused = 1").run();
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("gate:paused");
    await db.prepare("UPDATE control SET paused = 0, dns_verified_at = NULL").run();
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("gate:dns_not_verified");
    await db.prepare("UPDATE control SET dns_verified_at = ?").bind(TUE_1400 - 3 * DAY).run();
    expect(await draftStep({ ...env, WARMUP_DAYS: "14" }, dd(mail, () => TUE_1400), true)).toBe("gate:dns_not_verified");
    expect(mail.drafts).toEqual([]);
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("drafted:initial"); // WARMUP_DAYS default 0
  });
});

describe("daily cap (default 10 drafts/day, DAILY_CAP_MAX ceiling)", () => {
  it("every 15-min tick of a day yields at most 10 drafts", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { DRAFTS_PER_DAY: undefined });
    const day = Date.UTC(2026, 10, 10);
    await seed(db, 40, 0);
    const mail = new FakeMail();
    for (let t = day; t < day + DAY; t += 15 * MIN) await draftStep(env, dd(mail, () => t + 7 * MIN), true);
    expect(mail.drafts.length).toBe(10);
    // next day: 10 more
    for (let t = day + DAY; t < day + 2 * DAY; t += 15 * MIN) await draftStep(env, dd(mail, () => t + 7 * MIN), true);
    expect(mail.drafts.length).toBe(20);
  });
  it("DRAFTS_PER_DAY is configurable and DAILY_CAP_MAX is a hard ceiling", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { DRAFTS_PER_DAY: "50", DAILY_CAP_MAX: "3" });
    const day = Date.UTC(2026, 10, 10);
    await seed(db, 10, 0);
    const mail = new FakeMail();
    for (let t = day; t < day + DAY; t += 15 * MIN) await draftStep(env, dd(mail, () => t + 7 * MIN), true);
    expect(mail.drafts.length).toBe(3);
  });
});

describe("draft step", () => {
  it("drafts the email with the body opt-out link + reply line + postal address; no custom headers exist", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1, 0);
    const mail = new FakeMail();
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("drafted:initial");
    const d = mail.drafts[0];
    expect(d.to).toBe("hello@lead0.com");
    expect(Object.keys(d).sort()).toEqual(["inReplyTo", "references", "subject", "text", "to"]);
    expect(d.inReplyTo).toBeUndefined();
    expect(d.text).toContain(TEST_POSTAL);
    expect(d.text).toContain('Or reply "unsubscribe" and I\'ll stop.');
    expect(d.text).not.toMatch(/\{[a-z_]+\}/);
    const token = /https:\/\/go\.getastrant\.com\/u\/([A-Za-z0-9_-]+)/.exec(d.text)![1];
    const msg = await db.prepare("SELECT id, status, mailbox_draft_id FROM messages WHERE lead_id = ?").bind(lead).first<{ id: string; status: string; mailbox_draft_id: string }>();
    expect(await verifyOptoutToken(TEST_OPTOUT_SECRET, token)).toBe(msg!.id);
    expect(msg!.status).toBe("in_drafts");
    expect(msg!.mailbox_draft_id).toBe("d-1");
    expect(await state(db, lead)).toBe("in_drafts");
  });

  it("replaying ticks never drafts twice; concurrent claimers draft once", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 1, 0);
    const mail = new FakeMail();
    await Promise.all([draftStep(env, dd(mail, () => TUE_1400), true), draftStep(env, dd(mail, () => TUE_1400), true)]);
    for (let i = 0; i < 5; i++) await draftStep(env, dd(mail, () => TUE_1400 + i * MIN), true);
    expect(mail.drafts.length).toBe(1);
  });

  it("crash between the draft call and the mark ⇒ draft_unknown after 29 min, never recreated", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1, 0);
    const c = clock(TUE_1400);
    await db.prepare("UPDATE messages SET status = 'drafting', claim_id = 'c1', claimed_at = ? WHERE lead_id = ?").bind(c.now(), lead).run();
    const mail = new FakeMail();
    c.add(20 * MIN);
    expect(await sweepStuckDrafting(env, dd(mail, c.now))).toBe(0);
    c.add(15 * MIN);
    expect(await sweepStuckDrafting(env, dd(mail, c.now))).toBe(1);
    expect((await db.prepare("SELECT status FROM messages WHERE lead_id = ?").bind(lead).first<{ status: string }>())!.status).toBe("draft_unknown");
    expect(await draftStep(env, dd(mail, c.now), true)).toBe("nothing_due");
    expect(mail.drafts).toEqual([]);
  });

  it("unknown provider outcome ⇒ draft_unknown; definite 4xx retries once then cancels; 3 in a row pause; auth pauses", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 1, 0);
    const mail = new FakeMail();
    mail.draftImpl = async () => {
      throw new Error("socket reset");
    };
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("draft_unknown");

    const { db: db2 } = freshDb();
    const env2 = makeEnv(db2);
    await seed(db2, 3, 0);
    const m2 = new FakeMail();
    m2.draftImpl = async () => {
      throw new MailboxError("ZOHO_HTTP_400", true, false);
    };
    expect(await draftStep(env2, dd(m2, () => TUE_1400), true)).toBe("provider_rejected");
    expect((await db2.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'queued' AND retry_count = 1").first<{ n: number }>())!.n).toBe(1);
    await draftStep(env2, dd(m2, () => TUE_1400 + MIN), true);
    await draftStep(env2, dd(m2, () => TUE_1400 + 2 * MIN), true);
    expect(await db2.prepare("SELECT paused, pause_reason FROM control").first()).toEqual({ paused: 1, pause_reason: "provider_errors" });

    const { db: db3 } = freshDb();
    const env3 = makeEnv(db3);
    await seed(db3, 1, 0);
    const m3 = new FakeMail();
    const { ZohoAuthError } = await import("../src/mail/zoho");
    m3.draftImpl = async () => {
      throw new ZohoAuthError("ZOHO_401");
    };
    expect(await draftStep(env3, dd(m3, () => TUE_1400), true)).toBe("provider_auth");
    expect(await db3.prepare("SELECT paused, pause_reason FROM control").first()).toEqual({ paused: 1, pause_reason: "provider_auth" });
    expect((await db3.prepare("SELECT status FROM messages").first<{ status: string }>())!.status).toBe("queued");
  });

  it("re-checks suppression and EU status immediately before the draft call", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [a, b] = await seed(db, 2, 0);
    await db.batch(await suppressStmts(env, 0, { domain: "lead0.com", reason: "manual" }));
    await db.prepare("UPDATE leads SET country = 'DE' WHERE id = ?").bind(b).run();
    const mail = new FakeMail();
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("cancelled:suppressed");
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("cancelled:eu");
    expect(mail.drafts).toEqual([]);
    void a;
  });

  it("createMailboxDraft refuses an unclaimed row", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1, 0);
    const id = (await db.prepare("SELECT id FROM messages WHERE lead_id = ?").bind(lead).first<{ id: string }>())!.id;
    const mail = new FakeMail();
    expect(await createMailboxDraft(env, dd(mail, () => TUE_1400), id, "forged")).toBe("not_claimed");
    expect(mail.drafts).toEqual([]);
  });
});

describe("Sent-folder reconciliation (what Bruno actually sent)", () => {
  it("marks the lead sent, stores the real Message-ID, queues a follow-up, and the follow-up draft is threaded", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1, 0);
    const mail = new FakeMail();
    await draftStep(env, dd(mail, () => TUE_1400), true);
    // Nothing sent yet ⇒ nothing reconciled.
    expect(await reconcileSent(env, { mail, now: () => TUE_1400 + HOUR })).toBe(0);
    expect(await state(db, lead)).toBe("in_drafts");
    mail.bruno_sends(0, TUE_1400 + 2 * HOUR, "<real-1@mail.zoho.com>");
    expect(await reconcileSent(env, { mail, now: () => TUE_1400 + 3 * HOUR })).toBe(1);
    expect(await state(db, lead)).toBe("sent");
    const init = await db.prepare("SELECT status, rfc_message_id, sent_at FROM messages WHERE lead_id = ? AND kind = 'initial'").bind(lead).first();
    expect(init).toEqual({ status: "sent", rfc_message_id: "<real-1@mail.zoho.com>", sent_at: TUE_1400 + 2 * HOUR });
    const f = await db.prepare("SELECT status, not_before, subject FROM messages WHERE lead_id = ? AND kind = 'followup'").bind(lead).first<{ status: string; not_before: number; subject: string }>();
    expect(f!.status).toBe("queued");
    expect(f!.not_before).toBe(TUE_1400 + 2 * HOUR + 7 * DAY);
    // follow-up draft, threaded under the real Message-ID
    const later = f!.not_before + MIN;
    expect(await draftStep(env, dd(mail, () => later), true)).toBe("drafted:followup");
    expect(mail.drafts[1].inReplyTo).toBe("<real-1@mail.zoho.com>");
    expect(mail.drafts[1].subject.startsWith("Re: ")).toBe(true);
    mail.bruno_sends(1, later + HOUR);
    await reconcileSent(env, { mail, now: () => later + 2 * HOUR });
    expect(await state(db, lead)).toBe("followup_sent");
  });

  it("is idempotent and ignores Sent mail that matches no draft (Bruno's own mail)", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 1, 0);
    const mail = new FakeMail();
    await draftStep(env, dd(mail, () => TUE_1400), true);
    mail.bruno_sends(0, TUE_1400 + HOUR);
    const dup = mail.sentFolder[0];
    mail.sentFolder.push({ ...dup }, { providerMessageId: "x", providerThreadId: null, sentAt: TUE_1400 + HOUR, to: ["friend@example.org"], subject: "lunch", rfcMessageId: null, text: "see you" });
    expect(await reconcileSent(env, { mail, now: () => TUE_1400 + 2 * HOUR })).toBe(1);
    mail.sentFolder.push({ ...dup });
    expect(await reconcileSent(env, { mail, now: () => TUE_1400 + 3 * HOUR })).toBe(0);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'sent'").first<{ n: number }>())!.n).toBe(1);
  });

  it("drafts never sent expire after DRAFT_EXPIRE_DAYS (lead closes); a late send still reconciles", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1, 0);
    const mail = new FakeMail();
    await draftStep(env, dd(mail, () => TUE_1400), true);
    expect(await expireStaleDrafts(env, TUE_1400 + 13 * DAY)).toBe(0);
    expect(await expireStaleDrafts(env, TUE_1400 + 15 * DAY)).toBe(1);
    expect(await db.prepare("SELECT state, state_reason FROM leads WHERE id = ?").bind(lead).first()).toEqual({ state: "closed", state_reason: "draft_not_sent" });
    mail.bruno_sends(0, TUE_1400 + 16 * DAY);
    expect(await reconcileSent(env, { mail, now: () => TUE_1400 + 16 * DAY })).toBe(1);
    expect(await state(db, lead)).toBe("sent");
  });
});

describe("full tick in gated mode", () => {
  it("drains the inbox, reconciles Sent, then creates at most one draft; a second tick reconciles Bruno's send", async () => {
    const { runScheduled, CRON_TICK } = await import("../src/index");
    const { deps } = await import("./helpers");
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "gated" });
    const [lead] = await seed(db, 2, 0);
    const mail = new FakeMail();
    const r1 = await runScheduled(CRON_TICK, env, deps(env, { now: () => TUE_1400, mail, ai: null }));
    expect(r1.inbox_caught_up).toBe(true);
    expect(r1.draft).toBe("drafted:initial");
    expect(mail.drafts.length).toBe(1);
    mail.bruno_sends(0, TUE_1400 + HOUR);
    const r2 = await runScheduled(CRON_TICK, env, deps(env, { now: () => TUE_1400 + 2 * HOUR, mail, ai: null }));
    expect(r2.reconciled).toBe(1);
    expect(r2.draft).toBe("drafted:initial");
    expect(await state(db, lead)).toBe("sent");
  });
});
