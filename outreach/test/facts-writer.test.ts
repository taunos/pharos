import { describe, it, expect } from "vitest";
import { buildFactSheet, homepageAnswered, selectGaps } from "../src/facts";
import { draftEmail, templateFields, WRITER_MODEL } from "../src/writer";
import { FakeAI, gappyScan } from "./helpers";
import type { ScanResult } from "../src/types";

const ctx = { benchmarkUrl: null, privacyUrl: "https://astrant.io/privacy#prospecting" };
const clone = (s: ScanResult): ScanResult => JSON.parse(JSON.stringify(s));

describe("gap selection (§7.1, D6)", () => {
  it("picks deterministic gaps from dims 1/4/5, one per dimension, ranked by weight × (100 − score)", () => {
    const gaps = selectGaps(gappyScan(), "example.com");
    expect(gaps.map((g) => g.id)).toEqual(["1.presence.not_found", "4.json_ld_present.none", "5.markdown_negotiation.none"]);
    expect(gaps[0].numbers).toEqual([404]);
    expect(gaps[0].canonical).toBe("example.com/llms.txt returns a 404, so there is no llms.txt file for AI assistants to read.");
  });

  it("never uses Dim 2 (MCP) or Dim 6 (citation), nor model-scored sub-checks", () => {
    const s = clone(gappyScan());
    const ids = selectGaps(s, "example.com").map((g) => g.id);
    expect(ids.some((i) => i.startsWith("2.") || i.startsWith("6."))).toBe(false);
    expect(ids.some((i) => i.includes("blockquote_eval") || i.includes("faq_schema"))).toBe(false);
  });

  it("drops fetch failures (403/429/5xx/timeout) — a blocked request tells us nothing", () => {
    const s = clone(gappyScan());
    s.dimensions[0].sub_checks[0].notes = "status=403";
    expect(selectGaps(s, "example.com").some((g) => g.id.startsWith("1.presence"))).toBe(false);
    s.dimensions[0].sub_checks[0].notes = "fetch failed";
    expect(selectGaps(s, "example.com").some((g) => g.id.startsWith("1.presence"))).toBe(false);
  });

  it("Dim 4 gaps need proof the homepage answered (Dim 5 HTML fallback reached)", () => {
    const s = clone(gappyScan());
    s.dimensions[4].sub_checks[0].notes = "Site did not respond to markdown or HTML requests.";
    s.dimensions[4].sub_checks[0].score = 0;
    expect(homepageAnswered(s)).toBe(false);
    const ids = selectGaps(s, "example.com").map((g) => g.id);
    expect(ids.some((i) => i.startsWith("4."))).toBe(false);
    expect(ids.some((i) => i.startsWith("5."))).toBe(false);
  });

  it("spec_compliance is only claimed about a file that exists", () => {
    const s = clone(gappyScan());
    // presence fails (404) → spec_compliance is not a separate claim even though it failed
    expect(selectGaps(s, "example.com").some((g) => g.id.startsWith("1.spec_compliance"))).toBe(false);
    s.dimensions[0].sub_checks[0] = { ...s.dimensions[0].sub_checks[0], score: 100, passed: true, notes: 'status=200, content-type="text/plain"' };
    expect(selectGaps(s, "example.com").map((g) => g.id)).toContain("1.spec_compliance.both");
  });

  it("fewer than 2 valid gaps ⇒ the fact sheet has < 2 (lead is disqualified upstream)", () => {
    const s = clone(gappyScan());
    s.dimensions[0].sub_checks[0].notes = "status=503";
    s.dimensions[4].sub_checks[0] = { ...s.dimensions[4].sub_checks[0], passed: true, score: 100, notes: "Accept: text/markdown returns text/markdown (directly)." };
    s.dimensions[3].sub_checks[0].notes = "weird";
    expect(buildFactSheet(s, "example.com", "https://astrant.io/score/").gaps.length).toBeLessThan(2);
  });
});

describe("writer (§7.2)", () => {
  const sheet = buildFactSheet(gappyScan(), "example.com", "https://astrant.io/score/");

  it("uses the model output when it validates", async () => {
    const ai = new FakeAI();
    ai.responses.push({
      response: JSON.stringify({
        subject: "Two fixes for example.com",
        opener: "I'm Bruno, I build Astrant. Two things on example.com are worth fixing:",
        finding_1: "example.com/llms.txt returns a 404, so there's no llms.txt for AI assistants.",
        finding_2: "The example.com homepage has no JSON-LD, so it doesn't describe your product in machine-readable form.",
      }),
    });
    const r = await draftEmail({ sheet, ctx, writerMode: "llm", ai, templateVariant: 0 });
    expect(r.ok && r.path).toBe("llm");
    expect(ai.calls).toBe(1);
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
