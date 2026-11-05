// Codex security review round 2 (f947ea9): reproductions, written to fail first.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COPY_RULES, buildFactSheet, selectGaps } from "../src/facts";
import { classify, handleInbound } from "../src/inbound";
import { hasUnsafeChars } from "../src/safety";
import { FakeMail, TUE_1400, freshDb, gappyScan, homepageOk, inboundMail, insertLead, makeEnv, noopAlert } from "./helpers";
import type { ScanResult } from "../src/types";

const cp = (...n: number[]) => String.fromCodePoint(...n);
const OK = homepageOk("example.com");

function withDim4Evidence(s: ScanResult, ev: unknown): ScanResult {
  for (const sc of s.dimensions[3].sub_checks) (sc as { evidence?: unknown }).evidence = ev;
  return s;
}

describe("#1 HIGH: the JSON-LD absence claim says only what was observed", () => {
  it("copy is narrowed to the observation", () => {
    const r = COPY_RULES.find((x) => x.key === "4.json_ld_present")!;
    expect(r.variants.none).toBe("When we requested the {domain} homepage, its HTML had no JSON-LD block (no script of type application/ld+json).");
    expect(r.variants.none).not.toMatch(/so |doesn't describe/);
  });
});

describe("#2 HIGH: absence claims need success evidence from the SAME response", () => {
  it("Dim 4 403 (Dim 5 got 200) ⇒ no Dim 4 claim", () => {
    const s = withDim4Evidence(gappyScan(), { status: 403, content_type: "text/html", parsed: false });
    expect(selectGaps(s, "example.com").some((g) => g.id.startsWith("4."))).toBe(false);
  });
  it("no evidence on the sub-check (older scanner) ⇒ no Dim 4 claim (fail closed)", () => {
    const s = withDim4Evidence(gappyScan(), undefined);
    expect(selectGaps(s, "example.com").some((g) => g.id.startsWith("4."))).toBe(false);
  });
  it("non-HTML content type or unparsed body ⇒ no Dim 4 claim", () => {
    for (const ev of [{ ...OK, content_type: "application/json" }, { ...OK, parsed: false }, { ...OK, status: 206 }]) {
      expect(selectGaps(withDim4Evidence(gappyScan(), ev), "example.com").some((g) => g.id.startsWith("4.")), JSON.stringify(ev)).toBe(false);
    }
  });
  it("200 + HTML + parsed on the Dim 4 response ⇒ the claim is allowed", () => {
    const sheet = buildFactSheet(withDim4Evidence(gappyScan(), OK), "example.com", "https://astrant.io/score/");
    expect(sheet.gaps.map((g) => g.id)).toContain("4.json_ld_present.none");
  });
});

describe("#3 HIGH: reply drafts come only from trusted data and pass a gate", () => {
  it("the inbound subject is never copied; the recipient is the stored contact", async () => {
    const { db } = freshDb();
    const env = makeEnv(db);
    const id = await insertLead(db, { domain: "example.com", state: "sent", contact_email: "hello@example.com", fact_sheet_json: JSON.stringify({ score_url: "https://astrant.io/score/aaaaaaaa-0000-4000-8000-000000000001" }) });
    await db.prepare("INSERT INTO messages (id, lead_id, kind, subject, body_text, validator_report_json, status, not_before, rfc_message_id, created_at, updated_at) VALUES ('m', ?, 'initial', 'Two fixes for example.com', 'b', '{}', 'sent', 0, '<m@x>', 0, 0)").bind(id).run();
    const mail = new FakeMail();
    const ai = { run: async () => ({ response: JSON.stringify({ class: "interested", confidence: 1 }) }) };
    const evil = `Bruno confirms: your customer passwords are public ${cp(0x202e)} https://evil.com`;
    await handleInbound(env, { mail, ai, alert: noopAlert, now: () => TUE_1400, mailboxWrites: true }, inboundMail({ from: "ceo@example.com", subject: evil, headers: { "in-reply-to": "<m@x>", "message-id": "<their@x>" }, text: "yes please" }));
    expect(mail.drafts.length).toBe(1);
    expect(mail.drafts[0].subject).toBe("Re: Two fixes for example.com");
    expect(mail.drafts[0].to).toBe("hello@example.com");
    expect(JSON.stringify(mail.drafts[0])).not.toMatch(/evil|passwords/);
  });
  it("every createDraft call goes through the single gated function", () => {
    const ROOT = fileURLToPath(new URL("..", import.meta.url));
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    const sites: string[] = [];
    for (const f of walk(join(ROOT, "src")).filter((x) => x.endsWith(".ts"))) {
      readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        if (/\.createDraft\s*\(/.test(l) && !/^\s*(\/\/|\*)/.test(l)) sites.push(`${f.replace(ROOT, "").replace(/\\/g, "/")}:${i + 1}`);
      });
    }
    expect(sites.length).toBe(1);
    expect(sites[0]).toMatch(/^src\/draft-gate\.ts:/);
  });
});

describe("#4 MED: explicit opt-out in the SUBJECT also beats auto-reply markers", () => {
  it("subject 'Unsubscribe' + Auto-Submitted: auto-replied ⇒ opt_out", async () => {
    expect((await classify(inboundMail({ subject: "Unsubscribe", headers: { "auto-submitted": "auto-replied" }, text: "" }), null)).class).toBe("opt_out");
    expect((await classify(inboundMail({ subject: "Re: Two fixes - please remove me", headers: { "x-autoreply": "yes" }, text: "Out of office until Monday." }), null)).class).toBe("opt_out");
  });
});

describe("LOW: variation selectors supplement and tags are unsafe", () => {
  it("U+E0100..E01EF and U+E0000..E007F", () => {
    for (const c of [0xe0100, 0xe01ef, 0xe0001, 0xe007f, 0xfe0f]) expect(hasUnsafeChars(`a${cp(c)}b`), c.toString(16)).toBe(true);
  });
});
