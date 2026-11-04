// S2b mode gating + §6 research + §10.2 EU/EEA exclusion.
import { describe, it, expect } from "vitest";
import { euExclusion, isDenylisted, normalizeDomain } from "../src/eligibility";
import { runScheduled, runTick, CRON_TICK, CRON_WEEKLY } from "../src/index";
import { mayResearch, maySend, parseMode } from "../src/mode";
import { pickRoleAddress, extractEmails, researchStep, robotsDisallowsAll } from "../src/research";
import { FakeMail, TUE_1400, deps, freshDb, gappyScan, inboundMail, insertLead, makeEnv, makeFetch } from "./helpers";

describe("parseMode is fail-closed", () => {
  it("only exact values pass; everything else is off", () => {
    for (const v of [undefined, "", "OFF", "Gated", " gated", "on", "true", "send", "dry-run"]) expect(parseMode(v as string)).toBe("off");
    expect(parseMode("dry_run")).toBe("dry_run");
    expect(parseMode("gated")).toBe("gated");
    expect(parseMode("auto")).toBe("auto");
    expect(maySend("dry_run")).toBe(false);
    expect(mayResearch("off")).toBe(false);
  });
});

describe("S2b: under off (or unset), nothing third-party and no send", () => {
  for (const mode of ["off", undefined, "garbage"]) {
    it(`mode=${String(mode)}: no scan, no fetch, no model call, no send — inbox + opt-outs still handled`, async () => {
      const { db } = freshDb();
      const env = makeEnv(db, { OUTREACH_MODE: mode as string });
      await insertLead(db, { domain: "example.com" });
      const sent = await insertLead(db, { domain: "replier.com", state: "sent", contact_email: "hello@replier.com" });
      await db.prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, rfc_message_id, created_at, updated_at) VALUES ('m1', ?, 'initial', 's', 'b', '{}', 'sent', 0, '<m1@getastrant.com>', 0, 0)").bind(sent).run();
      await db.prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, created_at, updated_at) VALUES ('f1', ?, 'followup', 's', 'b', '{}', 'queued', 0, 0, 0)").bind(sent).run();
      await db.prepare("UPDATE control SET paused = 0, dns_verified_at = 0").run();
      const mail = new FakeMail();
      mail.inbox.push(inboundMail({ from: "hello@replier.com", headers: { "in-reply-to": "<m1@getastrant.com>" }, text: "Please unsubscribe us." }));
      const fx = makeFetch();
      const d = deps(env, { now: () => TUE_1400, mail, fetch: fx.f, ai: null });
      const r = await runScheduled(CRON_TICK, env, d);
      expect(r.research).toBe("skipped");
      expect(String(r.send)).toBe("gate:mode");
      expect(env.SCANNER.calls).toEqual([]);
      expect(fx.calls).toEqual([]);
      expect(env.AI.calls).toBe(0);
      expect(mail.sent).toEqual([]);
      // inbox handling still ran: opt-out processed, follow-up cancelled
      expect(mail.drainCalls).toBe(1);
      expect((await db.prepare("SELECT state FROM leads WHERE id = ?").bind(sent).first<{ state: string }>())?.state).toBe("opted_out");
      expect((await db.prepare("SELECT status FROM messages WHERE id = 'f1'").first<{ status: string }>())?.status).toBe("cancelled");
      // weekly batch build also does nothing
      const w = await runScheduled(CRON_WEEKLY, env, d);
      expect((w.batch as { status: string }).status).toBe("mode_off");
    });
  }

  it("paused blocks research but not inbox handling", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "gated" });
    await insertLead(db, { domain: "example.com" });
    const mail = new FakeMail();
    const r = await runTick(env, deps(env, { now: () => TUE_1400, mail }));
    expect(r.research).toBe("skipped"); // control starts paused
    expect(mail.drainCalls).toBe(1);
    expect(env.SCANNER.calls).toEqual([]);
  });
});

describe("§10.2 EU/EEA exclusion", () => {
  it("excludes every EU-27 + EEA ccTLD and .eu, keeps .uk/.com/.io", () => {
    for (const t of ["de", "at", "fr", "it", "es", "nl", "be", "ie", "pl", "se", "dk", "fi", "pt", "gr", "cz", "ro", "hu", "bg", "hr", "si", "sk", "lt", "lv", "ee", "lu", "mt", "cy", "no", "is", "li", "eu"]) {
      expect(euExclusion(`acme.${t}`, null), t).toBe("eu_eea_tld");
    }
    expect(euExclusion("acme.co.uk", null)).toBeNull();
    expect(euExclusion("acme.com", null)).toBeNull();
    expect(euExclusion("acme.io", "US")).toBeNull();
    expect(euExclusion("acme.io", "GB")).toBeNull();
  });
  it("excludes a known EU/EEA company country (code or name) on any TLD", () => {
    expect(euExclusion("acme.com", "DE")).toBe("eu_eea_country");
    expect(euExclusion("acme.io", "de")).toBe("eu_eea_country");
    expect(euExclusion("acme.io", "Germany")).toBe("eu_eea_country");
    expect(euExclusion("acme.io", "EL")).toBe("eu_eea_country");
    expect(euExclusion("acme.io", "Norway")).toBe("eu_eea_country");
  });
  it("research disqualifies an EU lead before any fetch or scan", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "dry_run" });
    const a = await insertLead(db, { domain: "acme.de" });
    const fx = makeFetch();
    expect(await researchStep(env, { fetch: fx.f, now: () => TUE_1400 })).toBe("eu_eea_excluded");
    const b = await insertLead(db, { domain: "acme.com", country: "France" });
    expect(await researchStep(env, { fetch: fx.f, now: () => TUE_1400 })).toBe("eu_eea_excluded");
    expect(fx.calls).toEqual([]);
    expect(env.SCANNER.calls).toEqual([]);
    for (const id of [a, b]) {
      const r = await db.prepare("SELECT state, state_reason FROM leads WHERE id = ?").bind(id).first();
      expect(r).toEqual({ state: "disqualified", state_reason: "eu_eea_excluded" });
    }
  });
});

describe("§6 research", () => {
  it("robots.txt: disallow / for * disqualifies; other agents or a fetch error do not", () => {
    expect(robotsDisallowsAll("User-agent: *\nDisallow: /")).toBe(true);
    expect(robotsDisallowsAll("User-agent: *\nDisallow: /admin")).toBe(false);
    expect(robotsDisallowsAll("User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /")).toBe(false);
    expect(robotsDisallowsAll("User-agent: Foo\nUser-agent: *\nDisallow: /")).toBe(true);
    expect(robotsDisallowsAll("User-agent: *\nDisallow: /\nAllow: /")).toBe(false);
  });

  it("role-address picking: own domain only, allowlist, preference order, drops support/privacy/etc", () => {
    expect(pickRoleAddress(["jane@acme.com", "support@acme.com", "hello@acme.com", "founders@acme.com"], "acme.com")).toBe("founders@acme.com");
    expect(pickRoleAddress(["info@acme.com", "marketing@acme.com"], "acme.com")).toBe("marketing@acme.com");
    expect(pickRoleAddress(["hello@other.com", "privacy@acme.com", "jane.doe@acme.com"], "acme.com")).toBeNull();
    expect(extractEmails('<a href="mailto:Hello@Acme.com?subject=x">x</a> contact&#64;acme.com')).toEqual(expect.arrayContaining(["hello@acme.com", "contact@acme.com"]));
  });

  it("new → scored → contact_found via the Service Binding, with lead_scans recorded", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "dry_run" });
    const id = await insertLead(db, { domain: "example.com" });
    const fx = makeFetch({ "https://example.com/contact": { status: 200, body: '<a href="mailto:hello@example.com">x</a>' } });
    expect(await researchStep(env, { fetch: fx.f, now: () => TUE_1400 })).toBe("scan_scored");
    expect(env.SCANNER.calls).toEqual(["https://example.com/"]);
    expect(await researchStep(env, { fetch: fx.f, now: () => TUE_1400 })).toBe("contact_found");
    const l = await db.prepare("SELECT state, contact_email, contact_source_url, scan_id FROM leads WHERE id = ?").bind(id).first();
    expect(l).toEqual({ state: "contact_found", contact_email: "hello@example.com", contact_source_url: "https://example.com/contact", scan_id: "aaaaaaaa-0000-4000-8000-000000000001" });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM lead_scans").first<{ n: number }>())?.n).toBe(1);
  });

  it("icp_ok must be 1; denylist and robots disqualify; scan errors retry once then disqualify", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "dry_run" });
    await insertLead(db, { domain: "unreviewed.com", icp_ok: null });
    const fx = makeFetch({ "https://blocked.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /", ct: "text/plain" } });
    expect(await researchStep(env, { fetch: fx.f, now: () => TUE_1400 })).toBe("idle");
    await insertLead(db, { domain: "salesforce.com" });
    expect(await researchStep(env, { fetch: fx.f, now: () => TUE_1400 })).toBe("icp_denylist");
    await insertLead(db, { domain: "blocked.com" });
    expect(await researchStep(env, { fetch: fx.f, now: () => TUE_1400 })).toBe("robots_disallow");
    const e = await insertLead(db, { domain: "flaky.com" });
    env.SCANNER.fail = true;
    expect(await researchStep(env, { fetch: fx.f, now: () => TUE_1400 })).toBe("scan_error");
    expect((await db.prepare("SELECT state FROM leads WHERE id = ?").bind(e).first<{ state: string }>())?.state).toBe("new");
    expect(await researchStep(env, { fetch: fx.f, now: () => TUE_1400 })).toBe("scan_error");
    expect((await db.prepare("SELECT state, state_reason FROM leads WHERE id = ?").bind(e).first())).toEqual({ state: "disqualified", state_reason: "scan_error" });
    expect(env.SCANNER.calls.length).toBe(2);
  });

  it("< 2 gaps disqualifies and requests deletion of the public scan row", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "dry_run" });
    const id = await insertLead(db, { domain: "good.com" });
    env.SCANNER.next = (u) => {
      const scan = gappyScan(u);
      scan.dimensions[0].sub_checks[0].notes = "status=503";
      scan.dimensions[3].sub_checks[0].notes = "weird";
      return scan;
    };
    expect(await researchStep(env, { fetch: makeFetch().f, now: () => TUE_1400 })).toBe("scan_lt_2_gaps");
    expect(await db.prepare("SELECT state, state_reason FROM leads WHERE id = ?").bind(id).first()).toEqual({ state: "disqualified", state_reason: "lt_2_gaps" });
    expect((await db.prepare("SELECT delete_requested_at FROM lead_scans").first<{ delete_requested_at: number }>())?.delete_requested_at).toBe(TUE_1400);
  });

  it("daily prospect scan budget is enforced", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "dry_run", PROSPECT_SCANS_PER_DAY: "1" });
    await insertLead(db, { domain: "a.com" });
    await insertLead(db, { domain: "b.com" });
    expect(await researchStep(env, { fetch: makeFetch().f, now: () => TUE_1400 })).toBe("scan_scored");
    // a.com is now scored → contact step (no contact) runs first, then budget blocks b.com
    expect(await researchStep(env, { fetch: makeFetch().f, now: () => TUE_1400 })).toBe("no_contact");
    expect(await researchStep(env, { fetch: makeFetch().f, now: () => TUE_1400 })).toBe("scan_budget_exhausted");
  });

  it("normalizeDomain / denylist", () => {
    expect(normalizeDomain("https://www.Acme.com/pricing")).toBe("acme.com");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(isDenylisted("docs.stripe.com")).toBe(true);
  });
});
