// 2026-11-10 release check, items 3 and 6 (deterministic input/output fixes;
// judge logic unchanged):
//   - RD-0103: the self-description given to the accuracy judge was a garbled
//     run-on fragment ("Tartine Bakery – Tartine is a thoughtful expression of
//     Home"): title cut at 60 chars, run on into the h1, line breaks flattened.
//   - RD-0122: the mix-up row note was cut mid-sentence at 1000 chars.
//   - RD-0123: "Average by model" read as a naming rate.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACCURACY_MODEL, judgeAccuracy } from "./accuracy-judge";
import { buildSiteReference, decodeBody, declaredCharset, fetchReferenceSources, REFERENCE_FIELD_BUDGETS } from "./reference";
import { aggregateCells } from "./orchestrator";
import { buildSubChecks, mixupRowNote } from "./runDim6";
import { citationCoverage } from "../audit-executive-summary";
import { DISPLAY_TEXT_MAX } from "../llm-safety";
import type { CellEnvelope, ModelId } from "./types";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const TARTINE_TITLE =
  "Tartine Bakery &#8211; Tartine is a thoughtful expression of modern craft through good food and warm experiences. We are a product of our communities and the people who make them.";

describe("self-description layout (RD-0103)", () => {
  it("tartine: the title keeps 120 chars, is marked as cut, and the h1 is on its own labelled line", () => {
    const r = buildSiteReference({ homepageHtml: `<title>${TARTINE_TITLE}</title><h1 class="entry-title">Home</h1>` });
    expect(r.verifiable).toBe(true);
    if (!r.verifiable) return;
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("From the homepage:");
    expect(lines[1]).toMatch(/^Title: Tartine Bakery – Tartine is a thoughtful expression of modern craft through good food and warm experiences\. .*\.\.\.$/);
    expect(lines[1].length).toBeLessThanOrEqual("Title: ".length + REFERENCE_FIELD_BUDGETS.title + 3);
    expect(lines[2]).toBe("Main heading: Home");
    expect(r.text).not.toContain("expression of Home");
  });

  it("the judge receives the reference with its line structure (v5 flattened it into one line)", async () => {
    const r = buildSiteReference({ homepageHtml: `<title>${TARTINE_TITLE}</title><h1>Home</h1>` });
    if (!r.verifiable) throw new Error("not verifiable");
    const prompts: string[] = [];
    const AI = { run: async (_m: string, i: { messages: Array<{ content: string }> }) => (prompts.push(i.messages[0].content), { response: "CORRECT" }) } as unknown as Ai;
    await judgeAccuracy({ AI }, "tartinebakery.com", r.text, "Tartine Bakery is a bakery in San Francisco.");
    expect(prompts[0]).toMatch(/>\nFrom the homepage:\nTitle: Tartine Bakery – .*\.\.\.\nMain heading: Home\n<\/site-description-/);
    expect(prompts[0]).toContain('one field per line; a field that ends with "..." was cut short');
    expect(ACCURACY_MODEL).toContain("70b");
  });

  it("text that did not decode fails closed (not verifiable)", () => {
    const fffd = String.fromCharCode(0xfffd);
    expect(buildSiteReference({ homepageHtml: `<title>S${fffd}o Paulo dental clinic for families</title>` })).toEqual({ verifiable: false, reason: "source_unreadable" });
  });

  it("windows-1252 / ISO-8859-1 pages decode; an unsupported charset or an undefined byte is unreadable", () => {
    const enc = (s: string) => [...new TextEncoder().encode(s)];
    const bytes = new Uint8Array([...enc('<meta charset="windows-1252"><title>S'), 0xe3, ...enc("o Paulo "), 0x96, ...enc(" Cl"), 0xed, ...enc("nica</title>")]);
    expect(declaredCharset(bytes, "text/html")).toBe("windows-1252");
    expect(decodeBody(bytes, "text/html")).toBe('<meta charset="windows-1252"><title>São Paulo – Clínica</title>');
    expect(decodeBody(new Uint8Array([0xe9]), "text/html; charset=ISO-8859-1")).toBe("é");
    expect(decodeBody(new TextEncoder().encode("é"), "text/html; charset=UTF-8")).toBe("é");
    expect(decodeBody(new TextEncoder().encode("é"), "text/html")).toBe("é");
    expect(decodeBody(new TextEncoder().encode("x"), "text/html; charset=shift_jis")).toBeNull();
    // ISO-8859-15 would read as windows-1252 with 8 letters swapped (0xBC is Œ, not ¼): fail closed.
    expect(decodeBody(new Uint8Array([0xbc]), "text/html; charset=ISO-8859-15")).toBeNull();
    expect(decodeBody(new Uint8Array([0x81]), "text/plain; charset=windows-1252")).toBeNull();
  });

  it("fetchReferenceSources decodes a latin-1 homepage by its header; an unsupported charset is source_unreadable", async () => {
    const latin = new Uint8Array([...new TextEncoder().encode("<title>Cl"), 0xed, ...new TextEncoder().encode("nica dental em S"), 0xe3, ...new TextEncoder().encode("o Paulo</title>")]);
    const make = (ct: string) => async (url: string) =>
      url.endsWith("/llms.txt") ? new Response("", { status: 404 }) : new Response(latin, { status: 200, headers: { "content-type": ct } });
    const ok = await fetchReferenceSources("https://acme.com.br/", make("text/html; charset=iso-8859-1"));
    expect(ok.homepageHtml).toBe("<title>Clínica dental em São Paulo</title>");
    expect(ok.failure).toBeUndefined();
    const bad = await fetchReferenceSources("https://acme.com.br/", make("text/html; charset=koi8-r"));
    expect(bad.failure).toBe("source_unreadable");
  });
});

function cell(modelId: ModelId, id: string, notes: string, text: string, score = 0): CellEnvelope {
  return { query: { id, text: "q", rationale: null }, modelId, result: { text, score, unmeasurable: false, truncated: false, notes } };
}
const WRONG = "score=0/100; judge=AFFIRM; accuracy=WRONG; misidentified=true";
const long = (s: string) => `${s} ${"and it goes on with many more words about it ".repeat(12)}`;

describe("report cells (RD-0122, RD-0123)", () => {
  it("the mix-up row note always fits the report cell and ends with its whole closing sentence", () => {
    const models: ModelId[] = ["openai:gpt-4o", "anthropic:claude-sonnet", "google:gemini-2.5-flash", "perplexity:sonar"];
    const cells = models.flatMap((m, i) => [cell(m, `q${i}`, WRONG, long(`${"W".repeat(9)} acme.com is someone else entirely`)), cell(m, `q${i + 5}`, WRONG, long("acme.com is another business"))]);
    const note = mixupRowNote(cells, "acme.com", 40, 8, 0);
    expect(note.length).toBeLessThanOrEqual(DISPLAY_TEXT_MAX);
    expect(note.startsWith("8 of the 40 scored answers linked your site to a different named person or business")).toBe(true);
    expect(note).toMatch(/This row is for information and is not counted again in your score\.$/);
    expect(note).toContain(" said: \"");
  });

  it("the saved 2026-11-10 resend row (1039 chars) now fits", () => {
    const cells = [
      cell("openai:gpt-4o", "q9", WRONG, "As of the latest information available, Resend.com offers various types of support to its customers, typically including: 1. **Documentation**: Comprehensive guides and documentation to help users understand and utilize the platform effectively. 2. **Email Support**: Customers can reach out via email."),
      cell("perplexity:sonar", "q9", WRONG, "Resend offers several customer-support options: - **Email and ticket support**, with first-response and follow-up response SLAs.[1][3] - **Dedicated Slack support** for eligible plans, providing direct access to Resend engineers.[1][3]"),
      cell("openai:gpt-4o", "q10", WRONG, "As of my last update, Resend.com is not widely recognized as a major company. It's possible that it could be a smaller business or a startup that hasn't gained significant public attention."),
    ];
    const row = buildSubChecks(aggregateCells(cells, true), false, "resend.com").find((s) => s.id === "citation_misidentified_answers")!;
    expect(row.notes.length).toBeLessThanOrEqual(DISPLAY_TEXT_MAX);
    expect(row.notes).toMatch(/This row is for information and is not counted again in your score\.$/);
  });

  it("the per-model average says it is an answer score; the coverage parser reads the new and the old label", () => {
    const cells = [cell("perplexity:sonar", "q1", "score=100/100; judge=AFFIRM; accuracy=CORRECT; domain_named=true; url_referenced=true; context_relevant=true; no_competitor_first=true", "acme.com", 100)];
    const subs = buildSubChecks(aggregateCells(cells, true), false, "acme.com");
    expect(subs[0].notes).toMatch(/Average answer score by model \(0 to 100\): ChatGPT not measured, Claude not measured, Gemini not measured, Perplexity 100\.$/);
    const dim = (notes: string) => ({ dimension_id: 6, sub_checks: [{ id: "citation_domain_named_rate", notes }] }) as never;
    expect(citationCoverage(dim(subs[0].notes))).toEqual({ measurableCells: 1, totalCells: 1, measuredModels: 1, totalModels: 4 });
    expect(citationCoverage(dim("10% x. 3 of 4 test answers could be scored, across 4 AI models. Average by model: ChatGPT 1, Claude not measured, Gemini 2, Perplexity 3."))).toEqual({
      measurableCells: 3,
      totalCells: 4,
      measuredModels: 3,
      totalModels: 4,
    });
  });
});
