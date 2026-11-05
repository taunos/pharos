// E6: resume acknowledges lifetime-count stops (watermark), and COMPLAINT_RE only
// matches hostile phrases.
import { describe, it, expect } from "vitest";
import { DAY, HOUR } from "../src/clock";
import { getControl, resume } from "../src/db";
import { classify } from "../src/inbound";
import { checkStops, evaluateStops } from "../src/stops";
import { TUE_1400, freshDb, inboundMail, insertLead, makeEnv, noopAlert } from "./helpers";

async function sends(db: D1Database, n: number, at: (i: number) => number, inboundClass?: (i: number) => string | null, handledAt?: (i: number) => number) {
  for (let i = 0; i < n; i++) {
    const id = await insertLead(db, { domain: `s${i}-${Math.round(at(i))}.com`, state: "sent" });
    await db
      .prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, sent_at, created_at, updated_at) VALUES (?, ?, 'initial', 's', 'b', '{}', 'sent', 0, ?, 0, 0)")
      .bind(crypto.randomUUID(), id, at(i))
      .run();
    const cls = inboundClass?.(i);
    if (cls) {
      const h = handledAt ? handledAt(i) : at(i);
      await db.prepare("INSERT INTO inbound (provider_message_id, lead_id, class, received_at, handled_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, cls, h, h).run();
    }
  }
}

describe("E6: a resume acknowledges the stop it resumes from", () => {
  it("complaints (first 200 sends): resume clears it; a new complaint after the resume trips again", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0, ramp_start_at = ?").bind(TUE_1400 - 3 * DAY).run();
    await sends(db, 10, () => TUE_1400 - 2 * HOUR, (i) => (i === 0 ? "complaint" : i === 1 ? "interested" : null));
    expect((await checkStops(env, TUE_1400 - HOUR, noopAlert))?.reason).toBe("complaints");
    await resume(db, TUE_1400 - HOUR + 1, "bruno@example.com");
    expect((await getControl(db)).paused).toBe(0);
    // Without the watermark the same lifetime complaint re-trips on the next tick.
    expect(await checkStops(env, TUE_1400, noopAlert)).toBeNull();
    expect((await getControl(db)).paused).toBe(0);
    // A fresh complaint after the resume still trips.
    await sends(db, 1, () => TUE_1400 - 30 * 60_000, () => "complaint");
    expect((await checkStops(env, TUE_1400, noopAlert))?.reason).toBe("complaints");
  });

  it("complaints after 200 sends: the rate window honours the watermark too", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0, ramp_start_at = ?").bind(TUE_1400 - 60 * DAY).run();
    await sends(db, 250, (i) => TUE_1400 - 20 * DAY + i * 60, (i) => (i === 249 ? "complaint" : i % 4 === 0 ? "interested" : null));
    expect((await checkStops(env, TUE_1400, noopAlert))?.reason).toBe("complaints");
    await resume(db, TUE_1400 + 1, "bruno@example.com");
    expect(await evaluateStops(env, TUE_1400 + 2)).toBeNull();
  });

  it("silent_failure: after a resume only sends made after it count", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0, ramp_start_at = ?").bind(TUE_1400 - 30 * DAY).run();
    await insertLead(db, { domain: "pool.com", state: "new" }); // a non-empty pool, so program_review stays out of it
    await sends(db, 40, (i) => TUE_1400 - 10 * DAY - i * HOUR);
    expect((await checkStops(env, TUE_1400, noopAlert))?.reason).toBe("silent_failure");
    await resume(db, TUE_1400 + 1, "bruno@example.com");
    expect(await evaluateStops(env, TUE_1400 + 2)).toBeNull();
    // 40 new silent sends after the resume (≥3 days old) trip it again.
    await sends(db, 40, (i) => TUE_1400 + 2 + i * 60);
    expect((await evaluateStops(env, TUE_1400 + 5 * DAY))?.reason).toBe("silent_failure");
  });

  it("program_review: after a resume, 100 new initials with 0 interest are needed", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0, ramp_start_at = ?").bind(TUE_1400 - 60 * DAY).run();
    await sends(db, 100, (i) => TUE_1400 - i * HOUR, (i) => (i % 5 === 0 ? "auto_reply" : null));
    expect((await checkStops(env, TUE_1400, noopAlert))?.reason).toBe("program_review");
    await resume(db, TUE_1400 + 1, "bruno@example.com");
    expect(await evaluateStops(env, TUE_1400 + 2)).toBeNull();
  });

  it("a resume acknowledges only the stop it resumed from, never another one", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0, ramp_start_at = ?").bind(TUE_1400 - 3 * DAY).run();
    await sends(db, 5, () => TUE_1400 - 2 * HOUR, (i) => (i === 0 ? "complaint" : null));
    // Paused for something else (e.g. provider_auth); resuming that must not acknowledge the complaint.
    await db.prepare("UPDATE control SET paused = 1, pause_reason = 'provider_auth', paused_at = ?").bind(TUE_1400 - HOUR).run();
    await resume(db, TUE_1400 - HOUR + 1, "bruno@example.com");
    expect((await evaluateStops(env, TUE_1400))?.reason).toBe("complaints");
  });
});

describe("E6: COMPLAINT_RE matches hostile phrases only", () => {
  const cls = async (text: string) => (await classify(inboundMail({ text }), null)).class;
  it.each([
    "Your email landed in spam but I'm interested",
    "Found this in my spam folder. Can you tell me more?",
    "It's in spam, FYI. What does the audit cost?",
    "This went to spam but I'd like to talk.",
    "Your email was marked as spam by our filter, but send me the report.",
    "We reported a 20% lift last quarter. How does yours compare?",
    "We handle abuse detection for marketplaces; does this apply to us?",
  ])("not a complaint: %s", async (text) => {
    expect(await cls(text)).not.toBe("complaint");
  });
  it.each([
    "This is spam.",
    "this is spam, reported.",
    "Spam.",
    "Quit spamming us.", // ("Stop spamming" is an opt_out: OPT_OUT_RE runs first by design)
    "You spammer.",
    "I've reported you.",
    "Reporting you to your provider.",
    "I marked this as spam.",
    "This email is unsolicited spam",
    "it's spam",
    "Filing an abuse report with your host.",
    "Is this a scam?",
  ])("complaint: %s", async (text) => {
    expect(await cls(text)).toBe("complaint");
  });
});

describe("E6 (Codex r1): the complaint watermark is commit order, not wall time", () => {
  it("a complaint whose handling started before the resume but committed after it still trips", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0, ramp_start_at = ?").bind(TUE_1400 - 3 * DAY).run();
    await sends(db, 3, () => TUE_1400 - 2 * HOUR, (i) => (i === 0 ? "complaint" : null));
    expect((await checkStops(env, TUE_1400 - HOUR, noopAlert))?.reason).toBe("complaints");
    await resume(db, TUE_1400, "bruno@example.com");
    // handled_at (captured before classification) is older than the resume; the row commits after it.
    const id = await insertLead(db, { domain: "late.com", state: "sent" });
    await db.prepare("INSERT INTO inbound (provider_message_id, lead_id, class, received_at, handled_at) VALUES ('late', ?, 'complaint', ?, ?)").bind(id, TUE_1400 - 5000, TUE_1400 - 5000).run();
    expect((await evaluateStops(env, TUE_1400 + 1000))?.reason).toBe("complaints");
  });
});

describe("E7 (Codex r1): an unparsed delivery report is never an auto_reply", () => {
  it("delivery report from a non-mailer-daemon sender with Auto-Submitted ⇒ needs_human", async () => {
    const m = inboundMail({ from: "bounces@mx.example.net", headers: { "auto-submitted": "auto-generated" }, deliveryReport: true, dsn: null });
    expect((await classify(m, null)).class).toBe("needs_human");
  });
});

describe("E6 (Codex r2): a delayed second resume acknowledges nothing", () => {
  it("two overlapping resumes: a complaint between them still trips", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0, ramp_start_at = ?").bind(TUE_1400 - 3 * DAY).run();
    await sends(db, 3, () => TUE_1400 - 2 * HOUR, (i) => (i === 0 ? "complaint" : null));
    expect((await checkStops(env, TUE_1400 - HOUR, noopAlert))?.reason).toBe("complaints");
    // Both requests read the paused control row before either commits.
    const { getControl: gc } = await import("../src/db");
    const snapshot = await gc(db);
    await resume(db, TUE_1400, "bruno@example.com"); // request 1 commits
    const id = await insertLead(db, { domain: "new.com", state: "sent" });
    await db.prepare("INSERT INTO inbound (provider_message_id, lead_id, class, received_at, handled_at) VALUES ('new-c', ?, 'complaint', ?, ?)").bind(id, TUE_1400 + 10, TUE_1400 + 10).run();
    // request 2 commits later, acting on its stale read of the same pause (served by the proxy)
    const db2 = new Proxy(db, {
      get(t, k) {
        if (k === "prepare") {
          return (sql: string) => {
            const st = (t as D1Database).prepare(sql);
            if (/^SELECT \* FROM control/.test(sql)) return { ...st, first: async () => snapshot, bind: st.bind.bind(st) } as unknown as D1PreparedStatement;
            return st;
          };
        }
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === "function" ? (v as Function).bind(t) : v;
      },
    });
    await resume(db2 as D1Database, TUE_1400 + 20, "bruno@example.com");
    expect((await evaluateStops(env, TUE_1400 + 30))?.reason).toBe("complaints");
  });
});

describe("E7 (Codex r2): explicit opt-out text wins over the bounce-sender fallback", () => {
  it("a human 'unsubscribe' from postmaster@ is an opt_out", async () => {
    expect((await classify(inboundMail({ from: "postmaster@example.com", text: "Please unsubscribe me." }), null)).class).toBe("opt_out");
  });
});

describe("E6 (Codex r3): a stale resume never lifts a newer stop", () => {
  it("request 1 resumes complaints, provider_auth trips, the delayed request 2 leaves provider_auth in place", async () => {
    const { db } = freshDb();
    await db.prepare("UPDATE control SET paused = 1, pause_reason = 'complaints', paused_at = ? WHERE id = 1").bind(TUE_1400 - HOUR).run();
    const { getControl: gc, tripStop } = await import("../src/db");
    const stale = await gc(db);
    await resume(db, TUE_1400, "bruno@example.com");
    await tripStop(db, TUE_1400 + 5, "provider_auth");
    const db2 = new Proxy(db, {
      get(t, k) {
        if (k === "prepare") {
          return (sql: string) => {
            const st = (t as D1Database).prepare(sql);
            if (/^SELECT \* FROM control/.test(sql)) return { ...st, first: async () => stale, bind: st.bind.bind(st) } as unknown as D1PreparedStatement;
            return st;
          };
        }
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === "function" ? (v as Function).bind(t) : v;
      },
    });
    await resume(db2 as D1Database, TUE_1400 + 10, "bruno@example.com");
    expect(await db.prepare("SELECT paused, pause_reason FROM control").first()).toEqual({ paused: 1, pause_reason: "provider_auth" });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'resumed'").first<{ n: number }>())!.n).toBe(1);
  });
});

describe("E7 (Codex r3): an unmatched, unparsed delivery report still alerts Bruno", () => {
  it("truncated DSN from postmaster@ that matches no lead ⇒ alert, no pause", async () => {
    const { handleInbound } = await import("../src/inbound");
    const { FakeMail } = await import("./helpers");
    const { db } = freshDb();
    const env = makeEnv(db);
    await db.prepare("UPDATE control SET paused = 0").run();
    const alerts: string[] = [];
    await handleInbound(env, { mail: new FakeMail(), ai: null, alert: async (k: string) => void alerts.push(k), now: () => TUE_1400 }, inboundMail({ from: "postmaster@mx.net", subject: "Delivery Status Notification", deliveryReport: true, dsn: null }));
    expect(alerts).toContain("Unmatched bounce");
    expect((await getControl(db)).paused).toBe(0);
  });
});
