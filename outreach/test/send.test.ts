// S3 idempotency + S4 caps/gates + §8.3 send step.
import { describe, it, expect } from "vitest";
import { DAY, HOUR, MIN } from "../src/clock";
import { verifyOptoutToken } from "../src/crypto";
import { buildFactSheet } from "../src/facts";
import { MailSendError } from "../src/mail/types";
import { renderInitialBody } from "../src/render";
import { sendQueuedMessage, sendStep, sweepStuckSending } from "../src/send";
import { suppressStmts } from "../src/suppression";
import { templateFields } from "../src/writer";
import { FakeMail, TEST_OPTOUT_SECRET, TEST_POSTAL, TUE_1400, clock, freshDb, gappyScan, insertLead, makeEnv, noopAlert } from "./helpers";

const ctx = { benchmarkUrl: null, privacyUrl: "https://astrant.io/privacy#prospecting" };

async function seed(db: D1Database, n: number, notBefore: number, opts: { rampStart?: number } = {}) {
  await db.prepare("UPDATE control SET paused = 0, dns_verified_at = 0, ramp_start_at = ? WHERE id = 1").bind(opts.rampStart ?? TUE_1400 - 60 * DAY).run();
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

const sd = (mail: FakeMail, now: () => number) => ({ mail, now, alert: noopAlert });

describe("S4 gates", () => {
  const cases: [string, Record<string, string | undefined>, string][] = [
    ["mode unset", { OUTREACH_MODE: undefined }, "gate:mode"],
    ["mode off", { OUTREACH_MODE: "off" }, "gate:mode"],
    ["mode dry_run", { OUTREACH_MODE: "dry_run" }, "gate:mode"],
    ["POSTAL_ADDRESS empty", { POSTAL_ADDRESS: "" }, "gate:postal_address_missing"],
    ["POSTAL_ADDRESS whitespace", { POSTAL_ADDRESS: "   " }, "gate:postal_address_missing"],
    ["POSTAL_ADDRESS unset", { POSTAL_ADDRESS: undefined }, "gate:postal_address_missing"],
    ["opt-out secret unset", { OPTOUT_HMAC_SECRET: undefined }, "gate:secrets_missing"],
  ];
  for (const [name, over, expected] of cases) {
    it(`no send when ${name}`, async () => {
      const { db } = freshDb();
      const env = makeEnv(db, over as never);
      await seed(db, 1, 0);
      const mail = new FakeMail();
      expect(await sendStep(env, sd(mail, () => TUE_1400), true)).toBe(expected);
      expect(mail.sent).toEqual([]);
    });
  }
  it("no send when the transport can't set RFC 8058 headers (Zoho REST today)", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 1, 0);
    const mail = new FakeMail();
    mail.sendSupported = false;
    expect(await sendStep(env, sd(mail, () => TUE_1400), true)).toBe("gate:send_transport_unavailable");
  });
  it("no send when the inbox didn't drain to empty in this tick", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 1, 0);
    expect(await sendStep(env, sd(new FakeMail(), () => TUE_1400), false)).toBe("gate:inbox_not_drained");
  });
  it("no send when paused, on weekends, outside 13–21 UTC, or before the 14-day DNS wait", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 1, 0);
    const mail = new FakeMail();
    const sat = Date.UTC(2026, 10, 14, 15, 0);
    const sun = Date.UTC(2026, 10, 15, 15, 0);
    expect(await sendStep(env, sd(mail, () => sat), true)).toBe("gate:outside_window");
    expect(await sendStep(env, sd(mail, () => sun), true)).toBe("gate:outside_window");
    expect(await sendStep(env, sd(mail, () => Date.UTC(2026, 10, 10, 12, 59)), true)).toBe("gate:outside_window");
    expect(await sendStep(env, sd(mail, () => Date.UTC(2026, 10, 10, 21, 0)), true)).toBe("gate:outside_window");
    await db.prepare("UPDATE control SET paused = 1").run();
    expect(await sendStep(env, sd(mail, () => TUE_1400), true)).toBe("gate:paused");
    await db.prepare("UPDATE control SET paused = 0, dns_verified_at = ?").bind(TUE_1400 - 13 * DAY).run();
    expect(await sendStep(env, sd(mail, () => TUE_1400), true)).toBe("gate:dns_warmup");
    await db.prepare("UPDATE control SET dns_verified_at = NULL").run();
    expect(await sendStep(env, sd(mail, () => TUE_1400), true)).toBe("gate:dns_warmup");
    expect(mail.sent).toEqual([]);
  });
});

describe("S4 caps with a simulated clock", () => {
  for (const [label, rampOffsetDays, cap] of [
    ["ramp week 1", 0, 5],
    ["ramp week 2", 7, 10],
    ["ramp week 3", 14, 15],
    ["ramp week 4", 21, 20],
    ["week 5+ (STEADY_CAP=15)", 40, 15],
  ] as const) {
    it(`${label}: at most ${cap} per day, every 15-min tick of the day`, async () => {
      const { db } = freshDb();
      const day = Date.UTC(2026, 10, 10); // Tuesday
      const env = makeEnv(db);
      await seed(db, 40, 0, { rampStart: day - rampOffsetDays * DAY });
      const mail = new FakeMail();
      for (let t = day; t < day + DAY; t += 15 * MIN) await sendStep(env, sd(mail, () => t + 7 * MIN), true);
      expect(mail.sent.length).toBe(cap);
    });
  }
  it("DAILY_CAP_MAX is a hard ceiling and the ramp hasn't started ⇒ 0", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { DAILY_CAP_MAX: "3", STEADY_CAP: "25" });
    const day = Date.UTC(2026, 10, 10);
    await seed(db, 40, 0, { rampStart: day - 60 * DAY });
    const mail = new FakeMail();
    for (let t = day; t < day + DAY; t += 15 * MIN) await sendStep(env, sd(mail, () => t + 7 * MIN), true);
    expect(mail.sent.length).toBe(3);
    const { db: db2 } = freshDb();
    const env2 = makeEnv(db2);
    await seed(db2, 5, 0);
    await db2.prepare("UPDATE control SET ramp_start_at = NULL").run();
    expect(await sendStep(env2, sd(new FakeMail(), () => TUE_1400), true)).toBe("gate:daily_cap");
  });
  it("a week of ticks never exceeds the cap any day and sends nothing on the weekend", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { STEADY_CAP: "25" });
    const mon = Date.UTC(2026, 10, 9);
    await seed(db, 200, 0, { rampStart: mon - 60 * DAY });
    const mail = new FakeMail();
    const perDay = new Map<number, number>();
    let t = mon;
    const now = () => t;
    mail.sendImpl = async (m) => {
      const d = Math.floor(t / DAY);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
      return { rfcMessageId: m.messageId, providerMessageId: null, providerThreadId: null };
    };
    for (; t < mon + 7 * DAY; t += 15 * MIN) await sendStep(env, sd(mail, now), true);
    for (const [d, n] of perDay) {
      expect(n).toBeLessThanOrEqual(25);
      const wd = new Date(d * DAY).getUTCDay();
      expect(wd >= 1 && wd <= 5).toBe(true);
    }
    expect([...perDay.values()].reduce((a, b) => a + b, 0)).toBe(125);
  });
});

describe("§8.3 send step", () => {
  it("sends with RFC 8058 headers, opt-out token, postal address; queues the follow-up 5 business days later", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1, 0);
    const mail = new FakeMail();
    expect(await sendStep(env, sd(mail, () => TUE_1400), true)).toBe("sent:initial");
    const m = mail.sent[0];
    expect(m.to).toBe("hello@lead0.com");
    expect(m.listUnsubscribePost).toBe("List-Unsubscribe=One-Click");
    expect(m.listUnsubscribe).toMatch(/^<https:\/\/go\.getastrant\.com\/u\/[A-Za-z0-9_-]+>, <mailto:bruno@getastrant\.com\?subject=unsubscribe>$/);
    expect(m.text).toContain(TEST_POSTAL);
    expect(m.text).not.toMatch(/\{[a-z_]+\}/);
    expect(m.messageId).toMatch(/^<[0-9a-f-]+@getastrant\.com>$/);
    const token = /\/u\/([A-Za-z0-9_-]+)>/.exec(m.listUnsubscribe)![1];
    const msgRow = await db.prepare("SELECT id, status, rfc_message_id FROM messages WHERE lead_id = ? AND kind = 'initial'").bind(lead).first<{ id: string; status: string; rfc_message_id: string }>();
    expect(await verifyOptoutToken(TEST_OPTOUT_SECRET, token)).toBe(msgRow!.id);
    expect(msgRow!.status).toBe("sent");
    expect(m.text).toContain(`https://go.getastrant.com/u/${token}`);
    const f = await db.prepare("SELECT status, not_before, subject FROM messages WHERE lead_id = ? AND kind = 'followup'").bind(lead).first<{ status: string; not_before: number; subject: string }>();
    expect(f!.status).toBe("queued");
    expect(f!.not_before).toBe(TUE_1400 + 7 * DAY); // Tue + 5 business days = next Tue
    expect(f!.subject.startsWith("Re: ")).toBe(true);
    expect((await db.prepare("SELECT state FROM leads WHERE id = ?").bind(lead).first<{ state: string }>())!.state).toBe("sent");

    // follow-up: same thread headers
    const later = TUE_1400 + 7 * DAY + HOUR;
    expect(await sendStep(env, sd(mail, () => later), true)).toBe("sent:followup");
    expect(mail.sent[1].inReplyTo).toBe(msgRow!.rfc_message_id);
    expect(mail.sent[1].references).toBe(msgRow!.rfc_message_id);
    expect((await db.prepare("SELECT state FROM leads WHERE id = ?").bind(lead).first<{ state: string }>())!.state).toBe("followup_sent");
  });

  it("S3: replaying a tick never sends twice; UNIQUE(lead_id, kind) holds", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1, 0);
    const mail = new FakeMail();
    await sendStep(env, sd(mail, () => TUE_1400), true);
    for (let i = 0; i < 5; i++) await sendStep(env, sd(mail, () => TUE_1400 + i * MIN), true);
    expect(mail.sent.length).toBe(1);
    await expect(
      db.prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, created_at, updated_at) VALUES ('dup', ?, 'initial', 's', 'b', '{}', 'queued', 0, 0, 0)").bind(lead).run()
    ).rejects.toThrow(/UNIQUE/);
  });

  it("S3: two concurrent claimers — only one wins the CAS and sends", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 1, 0);
    const mail = new FakeMail();
    const r = await Promise.all([sendStep(env, sd(mail, () => TUE_1400), true), sendStep(env, sd(mail, () => TUE_1400), true)]);
    expect(mail.sent.length).toBe(1);
    expect(r.filter((x) => x === "sent:initial").length).toBe(1);
  });

  it("S3: crash between provider OK and mark-sent ⇒ send_unknown after 30 min, never resent, sending paused", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 2, 0);
    const c = clock(TUE_1400);
    // Simulate the crash: claim and leave it in 'sending'.
    await db.prepare("UPDATE messages SET status = 'sending', claim_id = 'c1', claimed_at = ? WHERE lead_id = ?").bind(c.now(), lead).run();
    const mail = new FakeMail();
    c.add(20 * MIN);
    expect(await sweepStuckSending(env, sd(mail, c.now))).toBe(0); // still inside the lease window
    c.add(15 * MIN);
    expect(await sweepStuckSending(env, sd(mail, c.now))).toBe(1);
    expect((await db.prepare("SELECT status FROM messages WHERE lead_id = ?").bind(lead).first<{ status: string }>())!.status).toBe("send_unknown");
    expect((await db.prepare("SELECT state FROM leads WHERE id = ?").bind(lead).first<{ state: string }>())!.state).toBe("send_unknown");
    expect((await db.prepare("SELECT paused, pause_reason FROM control").first())).toEqual({ paused: 1, pause_reason: "send_unknown" });
    expect(await sendStep(env, sd(mail, c.now), true)).toBe("gate:paused");
    expect(mail.sent).toEqual([]);
  });

  it("an exception with unknown outcome ⇒ send_unknown, not a retry", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 1, 0);
    const mail = new FakeMail();
    mail.sendImpl = async () => {
      throw new Error("socket reset");
    };
    expect(await sendStep(env, sd(mail, () => TUE_1400), true)).toBe("send_unknown");
    expect((await db.prepare("SELECT paused FROM control").first<{ paused: number }>())!.paused).toBe(1);
  });

  it("definite 4xx: back to queued once, then cancelled; 3 consecutive errors pause; auth error pauses at once", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 3, 0);
    const mail = new FakeMail();
    mail.sendImpl = async () => {
      throw new MailSendError("400 bad", true, false);
    };
    expect(await sendStep(env, sd(mail, () => TUE_1400), true)).toBe("provider_rejected");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'queued' AND retry_count = 1").first<{ n: number }>())!.n).toBe(1);
    await sendStep(env, sd(mail, () => TUE_1400 + MIN), true);
    await sendStep(env, sd(mail, () => TUE_1400 + 2 * MIN), true);
    expect((await db.prepare("SELECT paused, pause_reason FROM control").first())).toEqual({ paused: 1, pause_reason: "provider_errors" });

    const { db: db2 } = freshDb();
    const env2 = makeEnv(db2);
    await seed(db2, 1, 0);
    const mail2 = new FakeMail();
    mail2.sendImpl = async () => {
      throw new MailSendError("401", true, true);
    };
    await sendStep(env2, sd(mail2, () => TUE_1400), true);
    expect((await db2.prepare("SELECT paused, pause_reason FROM control").first())).toEqual({ paused: 1, pause_reason: "provider_auth" });
  });

  it("re-checks suppression immediately before the provider call (suppressed after queueing ⇒ cancelled)", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await seed(db, 1, 0);
    await db.batch(await suppressStmts(env, 0, { domain: "lead0.com", reason: "manual" }));
    const mail = new FakeMail();
    expect(await sendStep(env, sd(mail, () => TUE_1400), true)).toBe("cancelled:suppressed");
    expect(mail.sent).toEqual([]);
  });

  it("an EU country set after queueing cancels at send time", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1, 0);
    await db.prepare("UPDATE leads SET country = 'DE' WHERE id = ?").bind(lead).run();
    const mail = new FakeMail();
    expect(await sendStep(env, sd(mail, () => TUE_1400), true)).toBe("cancelled:eu");
    expect(mail.sent).toEqual([]);
  });

  it("sendQueuedMessage refuses an unclaimed row (no arbitrary sends)", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const [lead] = await seed(db, 1, 0);
    const id = (await db.prepare("SELECT id FROM messages WHERE lead_id = ?").bind(lead).first<{ id: string }>())!.id;
    const mail = new FakeMail();
    expect(await sendQueuedMessage(env, sd(mail, () => TUE_1400), id, "forged-claim")).toBe("not_claimed");
    expect(mail.sent).toEqual([]);
  });
});
