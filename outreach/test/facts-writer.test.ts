import { describe, it, expect } from "vitest";
import { buildFactSheet, selectGaps } from "../src/facts";
import { draftEmail, fieldsFor, templateFields, WRITER_MODEL } from "../src/writer";
import { FakeAI, gappyScan } from "./helpers";
import type { ScanResult } from "../src/types";

const ctx = { benchmarkUrl: null, privacyUrl: "https://astrant.io/privacy#prospecting" };
const clone = (s: ScanResult): ScanResult => JSON.parse(JSON.stringify(s));

describe("gap selection (observation-only claims)", () => {
  it("picks the two provable observations: /llms.txt 404 and no JSON-LD block, each from its own request", () => {
    const gaps = selectGaps(gappyScan(), "example.com");
    expect(gaps.map((g) => g.id)).toEqual(["1.presence.not_found", "4.json_ld_present.none"]);
    expect(gaps[0].numbers).toEqual([404]);
    expect(gaps[0].canonical).toBe("When we requested example.com/llms.txt, the server answered with a 404 (not found).");
  });

  it("never uses Dim 2 (MCP), Dim 5, Dim 6, or model-scored sub-checks", () => {
    const ids = selectGaps(clone(gappyScan()), "example.com").map((g) => g.id);
    expect(ids.some((i) => /^(2|3|5|6)\./.test(i))).toBe(false);
    expect(ids.some((i) => i.includes("blockquote_eval") || i.includes("faq_schema"))).toBe(false);
  });

  it("a blocked /llms.txt request (403/429/5xx/no response) is not a finding", () => {
    for (const status of [403, 429, 500, 503, null]) {
      const s = clone(gappyScan());
      s.dimensions[0].sub_checks[0].evidence!.status = status;
      expect(selectGaps(s, "example.com").some((g) => g.id.startsWith("1.presence")), String(status)).toBe(false);
    }
  });

  it("Dim 4 gaps need same-response evidence; another dimension answering is not enough", () => {
    const s = clone(gappyScan());
    for (const sc of s.dimensions[3].sub_checks) sc.evidence = { status: 403, content_type: "text/html", parsed: false };
    expect(selectGaps(s, "example.com").some((i) => i.id.startsWith("4."))).toBe(false);
  });

  it("fewer than 2 provable observations ⇒ the fact sheet has < 2 (no draft for the lead)", () => {
    const s = clone(gappyScan());
    s.dimensions[0].sub_checks[0].evidence!.status = 503;
    expect(buildFactSheet(s, "example.com", "https://astrant.io/score/").gaps.length).toBeLessThan(2);
  });
});

describe("writer (§7.2)", () => {
  const sheet = buildFactSheet(gappyScan(), "example.com", "https://astrant.io/score/");

  it("the model only picks approved variants by number; findings are verbatim", async () => {
    const ai = new FakeAI();
    ai.responses.push({ response: JSON.stringify({ subject: 1, opener: 2 }) });
    const r = await draftEmail({ sheet, ctx, writerMode: "llm", ai, templateVariant: 0 });
    expect(r.ok && r.path).toBe("llm");
    if (r.ok) {
      expect(r.fields).toEqual(fieldsFor(sheet, 1, 2));
      expect(r.fields.finding_1).toBe(sheet.gaps[0].canonical);
    }
    expect(ai.calls).toBe(1);
  });

  it("free text from the model is never used (it isn't a valid pick)", async () => {
    const ai = new FakeAI();
    const free = { subject: "Two fixes", opener: "I have noticed your site", finding_1: "Your llms.txt exposes passwords", finding_2: "x" };
    ai.responses.push({ response: JSON.stringify(free) }, { response: JSON.stringify({ subject: 9, opener: 0 }) });
    const r = await draftEmail({ sheet, ctx, writerMode: "llm", ai, templateVariant: 0 });
    expect(r.ok && r.path).toBe("template");
    if (r.ok) expect(r.fields).toEqual(templateFields(sheet, 0));
  });

  it("retries once with the failed rules, then falls back to the template", async () => {
    const ai = new FakeAI();
    ai.responses.push({ response: "Sure! Here's your email." }, { response: JSON.stringify({ subject: "x", opener: "I noticed things", finding_1: "a", finding_2: "b" }) });
    const r = await draftEmail({ sheet, ctx, writerMode: "llm", ai, templateVariant: 1 });
    expect(r.ok && r.path).toBe("template");
    expect(ai.calls).toBe(2);
    expect(r.report.attempts.map((a) => a.path)).toEqual(["llm", "llm_retry"]);
    if (r.ok) expect(r.fields).toEqual(templateFields(sheet, 1));
  });

  it("model error goes straight to the template", async () => {
    const ai = { run: async () => { throw new Error("down"); } };
    const r = await draftEmail({ sheet, ctx, writerMode: "llm", ai, templateVariant: 0 });
    expect(r.ok && r.path).toBe("template");
  });

  it("no model call at all in template mode or when ai is null (mode gate)", async () => {
    const ai = new FakeAI();
    expect((await draftEmail({ sheet, ctx, writerMode: "template", ai, templateVariant: 0 })).ok).toBe(true);
    expect((await draftEmail({ sheet, ctx, writerMode: "llm", ai: null, templateVariant: 0 })).ok).toBe(true);
    expect(ai.calls).toBe(0);
  });

  it("uses the repo-wide fp8 model id", () => {
    expect(WRITER_MODEL).toBe("@cf/meta/llama-3.1-8b-instruct-fp8");
  });
});
