// S5 stops + resume, S9 admin auth, §9.5 batches + D8, D11 lease.
import { describe, it, expect, beforeEach } from "vitest";
import { _resetAccessCache } from "../src/access";
import { approveBatch, buildWeeklyBatch, expireBatches, autoApprovalAllowed } from "../src/batch";
import { b64url } from "../src/crypto";
import { DAY, HOUR, SEND_WINDOW_END_HOUR, SEND_WINDOW_START_HOUR } from "../src/clock";
import { getControl, takeLease } from "../src/db";
import { buildFactSheet } from "../src/facts";
import { handleFetch, runScheduled, CRON_DAILY, CRON_TICK } from "../src/index";
import { checkStops, evaluateStops } from "../src/stops";
import { FakeMail, TUE_1400, deps, freshDb, gappyScan, insertLead, makeEnv, makeFetch, noopAlert } from "./helpers";

const TEAM = "astrant.cloudflareaccess.com";
const AUD = "test-aud";

async function accessKit() {
  const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = { ...((await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey), kid: "k1" };
  const sign = async (payload: Record<string, unknown>, kid = "k1") => {
    const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
    const head = enc({ alg: "RS256", kid, typ: "JWT" });
    const body = enc(payload);
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${head}.${body}`)));
    return `${head}.${body}.${b64url(sig)}`;
  };
  const f = (async (u: RequestInfo | URL) =>
    String(u) === `https://${TEAM}/cdn-cgi/access/certs` ? Response.json({ keys: [jwk] }) : new Response("no", { status: 404 })) as typeof fetch;
  return { sign, f };
}

const goodPayload = (now: number) => ({ aud: [AUD], email: "taunos@gmail.com", exp: Math.floor(now / 1000) + 600, iss: `https://${TEAM}` });

describe("S9 /admin requires a valid Access JWT", () => {
  beforeEach(() => _resetAccessCache());
  const envFor = (db: D1Database) => makeEnv(db, { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, ADMIN_EMAIL: "taunos@gmail.com" });

  it("403 without a JWT, with garbage, wrong aud, expired, wrong issuer, wrong email, wrong key", async () => {
    const { db } = freshDb();
    const env = envFor(db);
    const kit = await accessKit();
    const other = await accessKit();
    const now = TUE_1400;
    const tokens: (string | null)[] = [
      null,
      "garbage",
      await kit.sign({ ...goodPayload(now), aud: ["other"] }),
      await kit.sign({ ...goodPayload(now), exp: Math.floor(now / 1000) - 1 }),
      await kit.sign({ ...goodPayload(now), iss: "https://evil.cloudflareaccess.com" }),
      await kit.sign({ ...goodPayload(now), email: "someone@else.com" }),
      await other.sign(goodPayload(now)),
      await kit.sign(goodPayload(now), "unknown-kid"),
    ];
    for (const t of tokens) {
      for (const path of ["/admin", "/admin/leads", "/admin/resume"]) {
        const req = new Request(`https://go.getastrant.com${path}`, { method: path.endsWith("resume") ? "POST" : "GET", headers: t ? { "Cf-Access-Jwt-Assertion": t } : {} });
        expect((await handleFetch(req, env, { fetch: kit.f, now: () => now })).status, `${path} ${t?.slice(0, 10)}`).toBe(403);
      }
    }
  });

  it("403 when Access vars are unset (fail closed), 200 with a valid JWT", async () => {
    const { db } = freshDb();
    const kit = await accessKit();
    const t = await kit.sign(goodPayload(TUE_1400));
    const unset = makeEnv(db);
    expect((await handleFetch(new Request("https://go.getastrant.com/admin", { headers: { "Cf-Access-Jwt-Assertion": t } }), unset, { fetch: kit.f, now: () => TUE_1400 })).status).toBe(403);
    const env = envFor(db);
    const r = await handleFetch(new Request("https://go.getastrant.com/admin", { headers: { "Cf-Access-Jwt-Assertion": t } }), env, { fetch: kit.f, now: () => TUE_1400 });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Outreach");
  });

  it("S5: resume only via an Access-authenticated POST with a valid CSRF token", async () => {
    const { db } = freshDb();
    const env = envFor(db);
    const kit = await accessKit();
    const t = await kit.sign(goodPayload(TUE_1400));
    const post = (csrf: string) =>
      handleFetch(
        new Request("https://go.getastrant.com/admin/resume", { method: "POST", headers: { "Cf-Access-Jwt-Assertion": t }, body: new URLSearchParams({ csrf }) }),
        env,
        { fetch: kit.f, now: () => TUE_1400 }
      );
    expect((await post("forged")).status).toBe(403);
    expect((await getControl(db)).paused).toBe(1);
    const page = await (await handleFetch(new Request("https://go.getastrant.com/admin", { headers: { "Cf-Access-Jwt-Assertion": t } }), env, { fetch: kit.f, now: () => TUE_1400 })).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(page)![1];
    expect((await post(csrf)).status).toBe(303);
    expect((await getControl(db)).paused).toBe(0);
  });
});

describe("S5 automatic stops", () => {
  async function sends(db: D1Database, n: number, at: (i: number) => number, inboundClass?: (i: number) => string | null) {
    for (let i = 0; i < n; i++) {
      const id = await insertLead(db, { domain: `s${i}.com`, state: "sent" });
      await db.prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, sent_at, created_at, updated_at) VALUES (?, ?, 'initial', 's', 'b', '{}', 'sent', 0, ?, 0, 0)").bind(crypto.randomUUID(), id, at(i)).run();
      const cls = inboundClass?.(i);
      if (cls) await db.prepare("INSERT INTO inbound (provider_message_id, lead_id, class, received_at, handled_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, cls, at(i), at(i)).run();
    }
  }
  const trip = async (db: D1Database, env: ReturnType<typeof makeEnv>, now: number) => {
    const v = await checkStops(env, now, noopAlert);
    const c = await getControl(db);
    return { reason: v?.reason ?? null, paused: c.paused, last: c.last_stop_trip_at };
  };

  it("hard bounces ≥2 in a day during ramp weeks 1–2", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0, ramp_start_at = ?").bind(TUE_1400 - 3 * DAY).run();
    await sends(db, 5, () => TUE_1400 - HOUR, (i) => (i < 2 ? "bounce_hard" : null));
    expect(await trip(db, env, TUE_1400)).toEqual({ reason: "hard_bounces_daily", paused: 1, last: TUE_1400 });
  });
  it("hard bounce rate ≥3% of last 100 after week 2", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0, ramp_start_at = ?").bind(TUE_1400 - 30 * DAY).run();
    // first real send > 14 days ago ⇒ rate rule, not the daily rule
    await sends(db, 100, (i) => TUE_1400 - 20 * DAY + i * HOUR, (i) => (i < 3 ? "bounce_hard" : i < 20 ? "auto_reply" : null));
    expect((await trip(db, env, TUE_1400)).reason).toBe("hard_bounce_rate");
  });
  it("any complaint in the first 200 sends", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await sends(db, 10, () => TUE_1400 - HOUR, (i) => (i === 0 ? "complaint" : null));
    expect((await trip(db, env, TUE_1400)).reason).toBe("complaints");
  });
  it("a complaint-classed email from a non-lead sender does not trip the stop", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db
      .prepare("INSERT INTO inbound (provider_message_id, lead_id, class, confidence, method, received_at) VALUES ('m-stranger', NULL, 'complaint', 1, 'rule', ?)")
      .bind(TUE_1400 - HOUR)
      .run();
    expect((await trip(db, env, TUE_1400)).reason).not.toBe("complaints");
  });
  it("opt-out + not-interested > 10% of last 50", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET ramp_start_at = ?").bind(TUE_1400 - 30 * DAY).run();
    await sends(db, 50, (i) => TUE_1400 - i * HOUR, (i) => (i < 6 ? (i % 2 ? "opt_out" : "not_interested") : "auto_reply"));
    expect((await trip(db, env, TUE_1400)).reason).toBe("opt_out_rate");
  });
  it("silent failure: 0 replies of any kind across the last 40 (≥3 days old) sends", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET ramp_start_at = ?").bind(TUE_1400 - 30 * DAY).run();
    await sends(db, 40, (i) => TUE_1400 - 4 * DAY - i * HOUR);
    expect((await trip(db, env, TUE_1400)).reason).toBe("silent_failure");
  });
  it("program kill: 100 initial sends, 0 interested/question ⇒ program_review", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET ramp_start_at = ?").bind(TUE_1400 - 60 * DAY).run();
    await sends(db, 100, (i) => TUE_1400 - i * HOUR, (i) => (i % 5 === 0 ? "auto_reply" : null));
    expect((await trip(db, env, TUE_1400)).reason).toBe("program_review");
  });
  it("healthy state does not trip", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0, ramp_start_at = ?").bind(TUE_1400 - 3 * DAY).run();
    await sends(db, 10, () => TUE_1400 - HOUR, (i) => (i === 0 ? "interested" : null));
    expect(await evaluateStops(env, TUE_1400)).toBeNull();
  });
  it("a provider auth failure on the inbox pauses (via the tick)", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0").run();
    const { ZohoAuthError } = await import("../src/mail/zoho");
    const mail = new FakeMail();
    mail.drainInbox = async () => {
      throw new ZohoAuthError("ZOHO_401");
    };
    await runScheduled(CRON_TICK, env, deps(env, { now: () => TUE_1400, mail }));
    expect((await getControl(db)).pause_reason).toBe("provider_auth");
  });
});

describe("D11 lease", () => {
  it("only one handler at a time; a stale lease can be taken over after LEASE_MS", async () => {
    const { db } = freshDb();
    expect(await takeLease(db, 1000)).not.toBeNull();
    expect(await takeLease(db, 2000)).toBeNull();
    const env = makeEnv(db);
    expect(await runScheduled(CRON_DAILY, env, deps(env, { now: () => 3000 }))).toEqual({ lease: "busy" });
    expect(await takeLease(db, 1000 + 10 * 60_000 + 1)).not.toBeNull();
  });
  it("handlers release the lease", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "off" });
    await runScheduled(CRON_DAILY, env, deps(env, { now: () => TUE_1400 }));
    await runScheduled(CRON_TICK, env, deps(env, { now: () => TUE_1400 + 1 }));
    expect(await takeLease(db, TUE_1400 + 2)).not.toBeNull();
  });
});

describe("§9.5 batches", () => {
  async function contactLeads(db: D1Database, n: number, scannedAt: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const domain = `c${i}.com`;
      const sheet = buildFactSheet(gappyScan(`https://${domain}/`), domain, "https://astrant.io/score/");
      ids.push(await insertLead(db, { domain, state: "contact_found", contact_email: `hello@${domain}`, scanned_at: scannedAt, fact_sheet_json: JSON.stringify(sheet) }));
    }
    return ids;
  }
  const MON_0905 = Date.UTC(2026, 10, 9, 9, 5);
  const bd = (env: ReturnType<typeof makeEnv>, now: number) => ({ ai: null, fetch: makeFetch().f, now: () => now, alert: noopAlert, random: () => 0.5 });

  it("dry_run builds drafts (no sends), approval is refused in dry_run", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "dry_run" });
    await db.prepare("UPDATE control SET paused = 0, dns_verified_at = 0").run();
    await contactLeads(db, 3, MON_0905 - DAY);
    const r = await buildWeeklyBatch(env, bd(env, MON_0905));
    expect(r.status).toBe("pending_approval");
    expect(r.drafted).toBe(3);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'draft'").first<{ n: number }>())!.n).toBe(3);
    expect(await approveBatch(env, { batchId: r.batchId!, rejectedLeadIds: [], now: MON_0905, by: "admin" })).toEqual({ ok: false, reason: "mode" });
  });

  it("gated: the batch is approved on build (Bruno's send click is the gate); not_before is in-window and ≤ the daily cap", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "gated", DRAFTS_PER_DAY: "3" });
    await db.prepare("UPDATE control SET paused = 0").run();
    await contactLeads(db, 8, MON_0905 - DAY);
    const r = await buildWeeklyBatch(env, bd(env, MON_0905));
    expect(r.status).toBe("auto_approved");
    expect(r.drafted).toBe(8);
    const rows = (await db.prepare("SELECT not_before FROM messages WHERE status = 'queued'").all<{ not_before: number }>()).results!;
    expect(rows.length).toBe(8);
    const perDay = new Map<number, number>();
    for (const { not_before } of rows) {
      const h = new Date(not_before).getUTCHours();
      expect(h >= SEND_WINDOW_START_HOUR && h < SEND_WINDOW_END_HOUR).toBe(true);
      const d = Math.floor(not_before / DAY);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(3);
    expect((await getControl(db)).approved_batches).toBe(1);
    expect(await approveBatch(env, { batchId: r.batchId!, rejectedLeadIds: [], now: MON_0905 + HOUR, by: "admin" })).toEqual({ ok: false, reason: "not_pending" });
  });

  it("admin reject still works on a pending batch (approval needs gated/auto)", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "dry_run" });
    await db.prepare("UPDATE control SET paused = 0").run();
    const ids = await contactLeads(db, 2, MON_0905 - DAY);
    const r = await buildWeeklyBatch(env, bd(env, MON_0905));
    const gated = makeEnv(db, { OUTREACH_MODE: "gated" });
    expect(await approveBatch(gated, { batchId: r.batchId!, rejectedLeadIds: [ids[0]], now: MON_0905 + HOUR, by: "admin", random: () => 0.5 })).toEqual({ ok: true, queued: 1, rejected: 1 });
    expect((await db.prepare("SELECT state FROM leads WHERE id = ?").bind(ids[0]).first<{ state: string }>())!.state).toBe("rejected");
  });

  it("expired batch: leads return to contact_found; the redraft updates the same message row in place", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "dry_run" });
    await db.prepare("UPDATE control SET paused = 0").run();
    const [id] = await contactLeads(db, 1, MON_0905 - DAY);
    const r1 = await buildWeeklyBatch(env, bd(env, MON_0905));
    const row1 = await db.prepare("SELECT id, subject FROM messages WHERE lead_id = ?").bind(id).first<{ id: string; subject: string }>();
    expect(await expireBatches(env, MON_0905 + 73 * HOUR)).toBe(1);
    expect((await db.prepare("SELECT state FROM leads WHERE id = ?").bind(id).first<{ state: string }>())!.state).toBe("contact_found");
    await db.prepare("UPDATE leads SET scanned_at = ? WHERE id = ?").bind(MON_0905 + 6 * DAY, id).run();
    const r2 = await buildWeeklyBatch(env, bd(env, MON_0905 + 7 * DAY));
    expect(r2.batchId).not.toBe(r1.batchId);
    const rows = (await db.prepare("SELECT id, batch_id FROM messages WHERE lead_id = ?").bind(id).all<{ id: string; batch_id: string }>()).results!;
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(row1!.id);
    expect(rows[0].batch_id).toBe(r2.batchId);
  });

  it("stale scans (>7 days + slack) are not drafted; suppressed and EU leads are dropped", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "gated" });
    await db.prepare("UPDATE control SET paused = 0").run();
    await contactLeads(db, 1, MON_0905 - 9 * DAY);
    const eu = await insertLead(db, { domain: "acme.com", state: "contact_found", contact_email: "hello@acme.com", country: "DE", scanned_at: MON_0905, fact_sheet_json: "{}" });
    const r = await buildWeeklyBatch(env, bd(env, MON_0905));
    expect(r.drafted).toBe(0);
    expect((await db.prepare("SELECT state, state_reason FROM leads WHERE id = ?").bind(eu).first())).toEqual({ state: "disqualified", state_reason: "eu_eea_excluded" });
  });

  it("auto-approval on build happens in gated and auto only (dry_run is log only)", async () => {
    const { db } = freshDb();
    expect(autoApprovalAllowed(makeEnv(db, { OUTREACH_MODE: "gated" }))).toBe(true);
    expect(autoApprovalAllowed(makeEnv(db, { OUTREACH_MODE: "auto" }))).toBe(true);
    expect(autoApprovalAllowed(makeEnv(db, { OUTREACH_MODE: "dry_run" }))).toBe(false);
    expect(autoApprovalAllowed(makeEnv(db, { OUTREACH_MODE: undefined }))).toBe(false);
  });

  it("batch build makes no model call even with Workers AI bound", async () => {
    const { db } = freshDb();
    const env = makeEnv(db, { OUTREACH_MODE: "gated" });
    await db.prepare("UPDATE control SET paused = 0").run();
    await contactLeads(db, 3, MON_0905 - DAY);
    const r = await buildWeeklyBatch(env, { ...bd(env, MON_0905), ai: env.AI });
    expect(r.drafted).toBe(3);
    expect(env.AI.calls).toBe(0);
    expect((await getControl(db)).drafting_paused).toBe(0);
  });
});
