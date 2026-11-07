// F2 (2026-11-07 evaluation): llama-3.1-8b omitted the closing "]" in 16 of
// 16 generator outputs, so every Audit fell back to the bank. The parser now
// accepts that shape, while every question is still validated.
import { describe, expect, it, vi } from "vitest";
import { generatePromptSet, isValidQuestionSet, tryParseQueries } from "./promptset";

const q = (i: number, text = `What does example.com offer, in one sentence? (${i})`) =>
  JSON.stringify({ id: `q${i}`, text, rationale: "Probes recognition." });
const ten = Array.from({ length: 10 }, (_, i) => q(i + 1));

describe("tryParseQueries", () => {
  it("parses a well-formed array", () => {
    expect(tryParseQueries(`[${ten.join(",")}]`)).toHaveLength(10);
  });

  it("accepts output missing the closing ]", () => {
    const out = tryParseQueries(`[${ten.join(",\n")}\n`);
    expect(out).toHaveLength(10);
    expect(out[9]).toEqual({ id: "q10", text: "What does example.com offer, in one sentence? (10)", rationale: "Probes recognition." });
  });

  it("drops a final object cut off mid-way, keeps the complete ones", () => {
    const raw = `Here you go:\n[${ten.slice(0, 9).join(",")},{"id":"q10","text":"What does exa`;
    expect(tryParseQueries(raw).map((x) => x.id)).toEqual(ten.slice(0, 9).map((_, i) => `q${i + 1}`));
  });

  it("is string-aware: braces and brackets inside text don't split objects", () => {
    const raw = `[${q(1, "Is {example.com} a [known] name? Yes or no.")},${q(2)}`;
    expect(tryParseQueries(raw).map((x) => x.text)).toEqual(["Is {example.com} a [known] name? Yes or no.", q(2).match(/"text":"([^"]+)"/)![1]]);
  });

  it("skips a malformed object and keeps going", () => {
    const raw = `[{"id":"q1","text":oops},${q(2)},${q(3)}`;
    expect(tryParseQueries(raw).map((x) => x.id)).toEqual(["q2", "q3"]);
  });

  it("still returns nothing without an array start", () => {
    expect(tryParseQueries(q(1))).toEqual([]);
    expect(tryParseQueries("")).toEqual([]);
  });

  it("strict validation still applies to each question", () => {
    const tooLong = q(1, `${"word ".repeat(45)}?`);
    const raw = `[${[tooLong, ...ten.slice(1)].join(",")}`;
    const parsed = tryParseQueries(raw);
    expect(parsed).toHaveLength(10);
    expect(isValidQuestionSet(parsed)).toBe(false);
  });
});

describe("generatePromptSet with a model that drops the closing ]", () => {
  it("uses the generated questions instead of the bank", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const prompts: string[] = [];
    const env = {
      AI: {
        run: async (_m: string, input: { messages: { content: string }[] }) => {
          prompts.push(input.messages[0].content);
          return { response: `[${ten.join(",\n")}` };
        },
      },
    } as never;
    const set = await generatePromptSet(env, "https://rachel.example");
    expect(set.source).toBe("generated");
    expect(isValidQuestionSet(set.queries)).toBe(true);
    // Business-type neutral prompt: no software category, an explicit "unknown".
    expect(prompts[0]).not.toMatch(/software category/i);
    expect(prompts[0]).toContain("BUSINESS TYPE: unknown.");
    expect(prompts[0]).toContain("Do not assume a business type");
    expect(prompts[0]).not.toMatch(/buyer-intent search in the category/);
  });
});
