// Report truthfulness r6 (1.5.1): FAQ rules accept short correct answers and
// do not claim relevance; malformed FAQ entries count as failing. (YAML node
// budget and duplicate keys: fixed-rules-1.5.0.test.ts.) Every fetch is stubbed.
import { describe, it, expect, vi, afterEach } from "vitest";
import { runDim4, faqRulesNote } from "./checks/dim4-structured";
import { runDim2 } from "./checks/dim2-mcp";
import type { DimensionResult, SubCheck } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const env = () => ({ CACHE: { get: async () => null, put: async () => {} } }) as never;
const ACME = "https://acme.com/";
const sub = (d: DimensionResult, id: string) => d.sub_checks.find((s) => s.id === id) as SubCheck;

async function faqFor(mainEntity: unknown[]): Promise<SubCheck> {
  const ld = { "@type": "FAQPage", mainEntity };
  const body = `<!doctype html><html><head><title>t</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>x</body></html>`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) =>
      String(u) === ACME
        ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
        : new Response("", { status: 404 })
    )
  );
  return sub(await runDim4(ACME, env()), "faq_schema");
}
const qa = (name: unknown, text?: unknown) =>
  text === undefined ? { "@type": "Question", name } : { "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } };

describe("1.5.1 faq_schema: short correct answers pass, in five languages", () => {
  it("\"30 euros.\" answers each question; 5 of 5, score 100", async () => {
    const f = await faqFor(
      ["Quanto custa?", "Was kostet es?", "Combien cela coûte ?", "¿Cuánto cuesta?", "How much is it?"].map((q) => qa(q, "30 euros."))
    );
    expect(f).toMatchObject({
      score: 100,
      passed: true,
      notes: "5 Q&A pair(s); 5 are phrased as questions and have an answer of reasonable length.",
    });
  });

  it("the note claims structure only, never that answers are relevant or direct", () => {
    const n = faqRulesNote(4, 4, 0);
    expect(n).toBe("4 Q&A pair(s); 4 are phrased as questions and have an answer of reasonable length.");
    expect(n).not.toMatch(/clear|direct|relevant|answers? (it|the question)/i);
  });
});

describe("1.5.1 faq_schema: malformed entries count in the denominator", () => {
  it("1 good pair + 5 unanswered Questions does not score 100, and the note says so", async () => {
    const f = await faqFor([qa("How do I start?", "Sign up on the site."), ...[1, 2, 3, 4, 5].map((i) => qa(`Question ${i}?`))]);
    expect(f.score).toBe(17);
    expect(f.passed).toBe(false);
    expect(f.notes).toBe(
      "6 Q&A pair(s); 1 is phrased as a question and has an answer of reasonable length. 5 entries are missing a question or an answer."
    );
  });

  it("a typed Question with an empty name, or with an empty answer text, is malformed", async () => {
    const f = await faqFor([qa("How do I start?", "Sign up."), qa("   ", "An answer."), qa("", "Another."), qa("What is it?", "")]);
    expect(f.score).toBe(25);
    expect(f.notes).toBe(
      "4 Q&A pair(s); 1 is phrased as a question and has an answer of reasonable length. 3 entries are missing a question or an answer."
    );
  });

  it("an entry not typed Question is not an FAQ item (not counted)", async () => {
    const f = await faqFor([qa("How do I start?", "Sign up."), { "@type": "Thing", name: "Footer" }]);
    expect(f).toMatchObject({ score: 100, notes: "1 Q&A pair(s); 1 is phrased as a question and has an answer of reasonable length." });
  });
});

describe("1.5.1 Dim 2 well_known: card absence is proven only by 404 / 410", () => {
  const run = async (cardStatus: number | "fail") => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        if (String(u).includes("/.well-known/mcp")) {
          if (cardStatus === "fail") throw new Error("network");
          return new Response("", { status: cardStatus });
        }
        return new Response("", { status: 404 });
      })
    );
    return sub(await runDim2(ACME, env()), "well_known");
  };

  it("404 at both addresses: absence proven", async () => {
    expect((await run(404)).evidence).toMatchObject({ card_absent_proven: true });
  });

  it("403, 500 or a failed request: absence not proven", async () => {
    for (const st of [403, 500, "fail"] as const) expect((await run(st)).evidence).toMatchObject({ card_absent_proven: false });
  });
});
