// E5: an address on Astrant's other opt-out lists (marketing email_suppressions,
// /score/delete-me outreach_do_not_contact) never gets an outreach draft. Fail closed.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { buildFactSheet } from "../src/facts";
import { crossListStatus, marketingEmailHash } from "../src/cross-list";
import { draftStep } from "../src/drafts";
import { handleInbound } from "../src/inbound";
import { renderInitialBody } from "../src/render";
import { isSuppressed } from "../src/suppression";
import { templateFields } from "../src/writer";
import { hashEmailSha256 } from "../../marketing-site/src/lib/email-suppressions";
import { FakeMail, TUE_1400, freshDb, freshOptoutListsDb, gappyScan, inboundMail, insertLead, makeEnv, noopAlert } from "./helpers";

const ctx = { benchmarkUrl: null, privacyUrl: "https://astrant.io/privacy#prospecting" };
const dd = (mail: FakeMail, now: () => number) => ({ mail, now, alert: noopAlert });

async function seedOne(db: D1Database, domain = "lead0.com", email = `hello@${domain}`) {
  await db.prepare("UPDATE control SET paused = 0, dns_verified_at = 0 WHERE id = 1").run();
  const sheet = buildFactSheet(gappyScan(`https://${domain}/`), domain, "https://astrant.io/score/");
  const id = await insertLead(db, { domain, state: "approved", contact_email: email, fact_sheet_json: JSON.stringify(sheet) });
  const f = templateFields(sheet, 0);
  await db
    .prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, created_at, updated_at) VALUES (?, ?, 'initial', ?, ?, '{}', 'queued', 0, 0, 0)")
    .bind(crypto.randomUUID(), id, f.subject, renderInitialBody(f, sheet, ctx))
    .run();
  return id;
}
const msgStatus = async (db: D1Database) => (await db.prepare("SELECT status FROM messages WHERE kind = 'initial'").first<{ status: string }>())!.status;

describe("E5: hashing matches marketing exactly", () => {
  it("marketingEmailHash === marketing-site hashEmailSha256 (case and whitespace normalised)", async () => {
    for (const e of ["hello@acme.com", "  Hello@ACME.com ", "a.b+c@sub.example.co.uk"]) {
      expect(await marketingEmailHash(e)).toBe(await hashEmailSha256(e));
    }
    expect(await marketingEmailHash("Hello@Acme.com")).toBe(await marketingEmailHash("hello@acme.com"));
  });
});

describe("E5: draft-time check", () => {
  it("an address that unsubscribed from marketing email gets no draft, and is copied to the local suppression list", async () => {
    const { db } = freshDb();
    const lists = freshOptoutListsDb();
    const env = makeEnv(db, { OPTOUT_LISTS_DB: lists.db });
    await lists.db.prepare("INSERT INTO email_suppressions (email_hash, suppressed_at, reason) VALUES (?, 1, 'user-unsubscribe')").bind(await hashEmailSha256("Hello@Lead0.com")).run();
    await seedOne(db);
    const mail = new FakeMail();
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("cancelled:suppressed");
    expect(mail.drafts).toEqual([]);
    expect(await msgStatus(db)).toBe("cancelled");
    expect(await isSuppressed(env, { email: "hello@lead0.com", domain: "unrelated.com" })).toBe(true);
  });

  it("an address that used /score/delete-me gets no draft", async () => {
    const { db } = freshDb();
    const lists = freshOptoutListsDb();
    const env = makeEnv(db, { OPTOUT_LISTS_DB: lists.db });
    await lists.db.prepare("INSERT INTO outreach_do_not_contact (email_hash, created_at, source) VALUES (?, 1, 'score-delete-me')").bind(await hashEmailSha256("hello@lead0.com")).run();
    await seedOne(db);
    const mail = new FakeMail();
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("cancelled:suppressed");
    expect(mail.drafts).toEqual([]);
  });

  it("someone else on the list doesn't block this lead", async () => {
    const { db } = freshDb();
    const lists = freshOptoutListsDb();
    const env = makeEnv(db, { OPTOUT_LISTS_DB: lists.db });
    await lists.db.prepare("INSERT INTO email_suppressions (email_hash, suppressed_at) VALUES (?, 1)").bind(await hashEmailSha256("other@lead0.com")).run();
    await seedOne(db);
    const mail = new FakeMail();
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("drafted:initial");
    expect(mail.drafts.length).toBe(1);
  });

  it("fail closed: no binding ⇒ the gate refuses every draft", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OPTOUT_LISTS_DB: undefined });
    await seedOne(db);
    const mail = new FakeMail();
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("gate:optout_lists_missing");
    expect(mail.drafts).toEqual([]);
  });

  it("fail closed: a list that can't be read (missing table / D1 error) ⇒ requeued, no draft, one alert a day", async () => {
    const { db } = freshDb();
    const broken = freshOptoutListsDb();
    broken.sqlite.exec("DROP TABLE outreach_do_not_contact"); // e.g. migration 0017 not applied yet
    const env = makeEnv(db, { OPTOUT_LISTS_DB: broken.db });
    await seedOne(db);
    const mail = new FakeMail();
    const alerts: string[] = [];
    const deps = { mail, now: () => TUE_1400, alert: async (k: string) => void alerts.push(k) };
    expect(await draftStep(env, deps, true)).toBe("requeued:optout_lists_unavailable");
    expect(await draftStep(env, { ...deps, now: () => TUE_1400 + 60_000 }, true)).toBe("requeued:optout_lists_unavailable");
    expect(mail.drafts).toEqual([]);
    expect(await msgStatus(db)).toBe("queued");
    expect(alerts.filter((k) => k.startsWith("Opt-out lists unreachable")).length).toBe(1);
  });

  it("crossListStatus: no email ⇒ unavailable (never 'clear')", async () => {
    const env = makeEnv(freshDb().db);
    expect(await crossListStatus(env, null)).toBe("unavailable");
    expect(await crossListStatus(env, "  ")).toBe("unavailable");
  });

  it("an opt-out landing while the draft is being saved: draft cancelled and Bruno asked to delete it", async () => {
    const { db } = freshDb();
    const lists = freshOptoutListsDb();
    const env = makeEnv(db, { OPTOUT_LISTS_DB: lists.db });
    await seedOne(db);
    const mail = new FakeMail();
    mail.draftImpl = async () => {
      await lists.db.prepare("INSERT INTO email_suppressions (email_hash, suppressed_at) VALUES (?, 1)").bind(await hashEmailSha256("hello@lead0.com")).run();
      return { draftId: "d-race" };
    };
    expect(await draftStep(env, dd(mail, () => TUE_1400), true)).toBe("cancelled:after_create");
  });
});

describe("E5: reply drafts", () => {
  it("no reply draft to an interested lead whose address is on the marketing list", async () => {
    const { db } = freshDb();
    const lists = freshOptoutListsDb();
    const env = makeEnv(db, { OPTOUT_LISTS_DB: lists.db });
    const id = await insertLead(db, { domain: "example.com", state: "sent", contact_email: "hello@example.com", fact_sheet_json: JSON.stringify({ score_url: "https://astrant.io/score/x" }) });
    const mid = crypto.randomUUID();
    await db
      .prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, rfc_message_id, provider_thread_id, sent_at, created_at, updated_at) VALUES (?, ?, 'initial', 's', 'b', '{}', 'sent', 0, ?, 'thr', 1, 0, 0)")
      .bind(mid, id, `<${mid}@getastrant.com>`)
      .run();
    await lists.db.prepare("INSERT INTO email_suppressions (email_hash, suppressed_at) VALUES (?, 1)").bind(await hashEmailSha256("hello@example.com")).run();
    const mail = new FakeMail();
    const ai = { run: async () => ({ response: JSON.stringify({ class: "interested", confidence: 0.95 }) }) };
    await handleInbound(env, { mail, ai, alert: noopAlert, now: () => TUE_1400, mailboxWrites: true }, inboundMail({ providerThreadId: "thr", text: "Yes, let's talk." }));
    expect(mail.drafts).toEqual([]);
  });
});

describe("E5: OPTOUT_LISTS_DB is read-only and used in one place", () => {
  it("only src/cross-list.ts references it, and only with SELECT", () => {
    const dir = new URL("../src/", import.meta.url);
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
    const users = files.filter((f) => readFileSync(new URL(f, dir), "utf8").includes("OPTOUT_LISTS_DB")).map((f) => f.replace(/\\/g, "/"));
    expect(users.sort()).toEqual(["cross-list.ts", "drafts.ts", "types.ts"]);
    // drafts.ts only checks presence; types.ts declares it. No statement there.
    for (const f of ["drafts.ts", "types.ts"]) expect(readFileSync(new URL(f, dir), "utf8")).not.toMatch(/OPTOUT_LISTS_DB\s*\.\s*(prepare|batch|exec)/);
    const src = readFileSync(new URL("cross-list.ts", dir), "utf8");
    const sqls = [...src.matchAll(/\.prepare\(\s*"([^"]*)"/g)].map((m) => m[1]);
    const listSqls = sqls.filter((s) => /email_suppressions|outreach_do_not_contact/.test(s));
    expect(listSqls.length).toBeGreaterThan(0);
    for (const s of listSqls) expect(s).toMatch(/^SELECT /);
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b[^"]*(email_suppressions|outreach_do_not_contact)/);
    expect(src).not.toMatch(/OPTOUT_LISTS_DB[\s\S]*\.(batch|exec)\(/);
  });

  it("wrangler.jsonc binds OPTOUT_LISTS_DB to pharos-citation-tracking (same id as marketing-site CITATION_DB)", () => {
    const w = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const m = readFileSync(new URL("../../marketing-site/wrangler.jsonc", import.meta.url), "utf8");
    const id = /"binding":\s*"CITATION_DB",\s*"database_name":\s*"pharos-citation-tracking",\s*"database_id":\s*"([0-9a-f-]+)"/.exec(m)?.[1];
    expect(id).toBeTruthy();
    expect(w).toMatch(new RegExp(`"binding":\\s*"OPTOUT_LISTS_DB",\\s*"database_name":\\s*"pharos-citation-tracking",\\s*"database_id":\\s*"${id}"`));
  });
});

describe("E5 (Codex r1): reply drafts re-check right before and after the provider call", () => {
  async function interestedLead(db: D1Database) {
    const id = await insertLead(db, { domain: "example.com", state: "sent", contact_email: "hello@example.com", fact_sheet_json: JSON.stringify({ score_url: "https://astrant.io/score/x" }) });
    const mid = crypto.randomUUID();
    await db
      .prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, rfc_message_id, provider_thread_id, sent_at, created_at, updated_at) VALUES (?, ?, 'initial', 's', 'b', '{}', 'sent', 0, ?, 'thr', 1, 0, 0)")
      .bind(mid, id, `<${mid}@getastrant.com>`)
      .run();
    return id;
  }

  it("an opt-out processed while the reply was being classified ⇒ no reply draft", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const id = await interestedLead(db);
    const mail = new FakeMail();
    // The /u/ opt-out lands during the model call: lead opted_out + suppressed.
    const ai = {
      run: async () => {
        await db.prepare("UPDATE leads SET state = 'opted_out' WHERE id = ?").bind(id).run();
        return { response: JSON.stringify({ class: "interested", confidence: 0.95 }) };
      },
    };
    await handleInbound(env, { mail, ai, alert: noopAlert, now: () => TUE_1400, mailboxWrites: true }, inboundMail({ providerThreadId: "thr", text: "Yes, let's talk." }));
    expect(mail.drafts).toEqual([]);
  });

  it("a marketing unsubscribe landing during the provider call ⇒ Bruno is told to delete the draft, not that it's ready", async () => {
    const { db } = freshDb();
    const lists = freshOptoutListsDb();
    const env = makeEnv(db, { OPTOUT_LISTS_DB: lists.db });
    await interestedLead(db);
    const mail = new FakeMail();
    mail.draftImpl = async () => {
      await lists.db.prepare("INSERT INTO email_suppressions (email_hash, suppressed_at) VALUES (?, 1)").bind(await hashEmailSha256("hello@example.com")).run();
      return { draftId: "d-race" };
    };
    const alerts: string[] = [];
    const ai = { run: async () => ({ response: JSON.stringify({ class: "interested", confidence: 0.95 }) }) };
    await handleInbound(env, { mail, ai, alert: async (k: string) => void alerts.push(k), now: () => TUE_1400, mailboxWrites: true }, inboundMail({ providerThreadId: "thr", text: "Yes, let's talk." }));
    expect(alerts).toContain("Delete the draft to example.com");
    expect(alerts.some((k) => k.startsWith("Interested reply"))).toBe(false);
    expect((await db.prepare("SELECT draft_id FROM inbound").first<{ draft_id: string | null }>())!.draft_id).toBeNull();
  });
});
