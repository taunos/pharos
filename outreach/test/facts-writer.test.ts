import { describe, it, expect } from "vitest";
import { buildFactSheet, selectGaps } from "../src/facts";
import { draftEmail, templateFields } from "../src/writer";
import { OPENER } from "../src/copy";
import { readFileSync } from "node:fs";
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

describe("writer (§7.2): deterministic, no model", () => {
  const sheet = buildFactSheet(gappyScan(), "example.com", "https://astrant.io/score/");

  it("rotates the 3 approved subjects; opener and findings are the approved text verbatim", async () => {
    const subjects = new Set<string>();
    for (let v = 0; v < 6; v++) {
      const r = await draftEmail({ sheet, ctx, templateVariant: v });
      expect(r.ok && r.path).toBe("rotation");
      if (r.ok) {
        subjects.add(r.fields.subject);
        expect(r.fields).toEqual(templateFields(sheet, v));
        expect(r.fields.opener).toBe(OPENER.replace("{domain}", "example.com"));
        expect(r.fields.finding_1).toBe(sheet.gaps[0].canonical);
      }
    }
    expect(subjects.size).toBe(3);
  });

  it("a long domain skips subjects over 60 characters", async () => {
    const d = "a-fairly-long-company-name-for-tests.com"; // 40 chars: "{d}: two things worth fixing" is 66
    const s = buildFactSheet(gappyScan(`https://${d}/`), d, "https://astrant.io/score/");
    const r = await draftEmail({ sheet: s, ctx, templateVariant: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields.subject.length).toBeLessThanOrEqual(60);
      expect(r.fields.subject).toBe(`A quick note on ${d}`);
    }
    // A domain so long that every subject exceeds 60 chars gets no draft (fails closed).
    const huge = "a-really-really-long-company-name-for-testing-subjects.com";
    const h = buildFactSheet(gappyScan(`https://${huge}/`), huge, "https://astrant.io/score/");
    expect((await draftEmail({ sheet: h, ctx, templateVariant: 0 })).ok).toBe(false);
  });

  it("the writer has no model input at all (static)", () => {
    const src = readFileSync(new URL("../src/writer.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\.run\(|AiBinding|ai:/);
  });
});
