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
