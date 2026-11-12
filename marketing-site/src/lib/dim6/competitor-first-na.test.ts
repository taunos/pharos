// Report truthfulness r2 (dim6:v4): with no competitor list the
// competitor-first check is N/A (no free points, never a gap), and the bank
// question set no longer asks every site for its "category of software".
import { describe, expect, it, vi } from "vitest";
import type { CellEnvelope, Dim6Result, ModelId } from "./types";
import { ALL_MODEL_IDS, DIM6_ENGINE_VERSION } from "./types";
import { DIM6_QUESTION_SET_VERSION } from "./question-set";

vi.mock("./orchestrator", () => ({
  runDim6Orchestrator: vi.fn(async (): Promise<Dim6Result> => {
    const cell = (modelId: ModelId, notes: string, score: number): CellEnvelope => ({
      query: { id: "q1", text: "q", rationale: null },
      modelId,
      result: { text: "t", score, unmeasurable: false, truncated: false, notes },
    });
    // dim6:v6 option A: 9 checkable answers per model (36 in all), above the
    // grading floor; one in three backed by the site's text.
    const cells = ALL_MODEL_IDS.flatMap((m) =>
      [0, 1, 2].flatMap(() => [
        cell(m, "score=100/100; judge=AFFIRM; accuracy=CORRECT; domain_named=true; url_referenced=true; context_relevant=true; no_competitor_first=true", 100),
        cell(m, "score=0/100; judge=DENY", 0),
        cell(m, "score=0/100; judge=DENY", 0),
      ])
    );
    return {
      score: 33,
      cells,
      perModelAverage: Object.fromEntries(ALL_MODEL_IDS.map((m) => [m, 33])) as Record<ModelId, number | null>,
      unmeasurableCount: 0,
      totalCells: cells.length,
      accuracyChecked: true,
    };
  }),
}));

import { scoreResponse } from "./parser";
import { runDim6Paid as runDim6PaidReal, COMPETITOR_FIRST_NA_NOTE, modelLabel } from "./runDim6";
import { citationCoverage } from "../audit-executive-summary";
import { generatePromptSet } from "./promptset";
import { buildRemediationGaps } from "../audit-pipeline";
import type { ScanResult } from "../audit-types";

const kv = () => {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) } as unknown as KVNamespace;
};

// dim6:v5: no network in tests. The orchestrator is mocked, so its fake
// result (accuracyChecked: true) decides the notes, not the 404 description.
const noSite = async () => new Response("", { status: 404 });
const runDim6Paid: typeof runDim6PaidReal = (env, ...rest) =>
  runDim6PaidReal({ siteFetch: noSite, ...(env as object) } as unknown as typeof env, ...rest);

describe("dim6:v4 competitor-first N/A", () => {
  it("engine and question-set versions are bumped", () => {
    expect(DIM6_ENGINE_VERSION).toBe("dim6:v6");
    expect(DIM6_QUESTION_SET_VERSION).toBe("dim6-qs:v3");
  });

  it("no competitor list: the cell score gets no free competitor points (renormalized over 90)", () => {
    const t = "https://acme.com";
    expect(scoreResponse("acme.com is great, see https://acme.com/x", t).score).toBe(100);
    expect(scoreResponse(`${"x".repeat(400)} acme.com`, t).score).toBe(Math.round((40 * 100) / 90));
    expect(scoreResponse("nothing relevant", t).score).toBe(0);
  });

  it("with a competitor list the competitor term is still scored", () => {
    const t = "https://acme.com";
    expect(scoreResponse(`${"x".repeat(400)} acme.com`, t, ["rival.com"]).score).toBe(50);
    expect(scoreResponse(`rival.com then ${"x".repeat(400)} acme.com`, t, ["rival.com"]).score).toBe(40);
  });

  it("runDim6Paid without competitors: the sub-check is N/A with a plain note, not 33/100", async () => {
    const r = await runDim6Paid({ cacheKv: kv() } as never, "https://acme.com/");
    const c = r.dimension.sub_checks.find((s) => s.id === "citation_no_competitor_first_rate")!;
    expect(c).toMatchObject({ na: true, score: 0, passed: false, notes: COMPETITOR_FIRST_NA_NOTE });
    expect(c.notes).not.toMatch(/passes by default/);
  });

  it("runDim6Paid notes are plain English and round-trip through citationCoverage", async () => {
    const r = await runDim6Paid({ cacheKv: kv() } as never, "https://acme.com/", {}, ["rival.com"]);
    const notes = Object.fromEntries(r.dimension.sub_checks.map((s) => [s.id, s.notes]));
    expect(notes.citation_domain_named_rate).toBe(
      "33% of the answers we could check against your site named your site (by its domain or the name your site gives itself) and were backed by your site's text. Of the 36 answers we could check against your site, 12 were backed by your site's text, 0 linked your site to a different named person or business, and 24 did not show that the model knew your site. We count your domain and the name your site gives itself; other brand names, nicknames or translations are not counted. 36 of 36 test answers came back from the 4 AI models, and 36 of those could be checked against your site's text and are counted in this score. Average answer score by model (0 to 100): ChatGPT 33, Claude 33, Gemini 33, Perplexity 33.",
    );
    expect(notes.citation_url_referenced_rate).toBe(
      "33% of the answers we could check against your site included a link to your site and either were backed by your site's text, or gave your homepage address when asked for it.",
    );
    expect(notes.citation_context_relevant_rate).toBe(
      "33% of the answers we could check against your site were backed by your site's text and named your site (by its domain or its own name) in the first half of the answer, rather than only at the end.",
    );
    expect(notes.citation_no_competitor_first_rate).toBe("33% of the answers we could check against your site did not name a competitor before your domain.");
    for (const n of Object.values(notes)) expect(n).not.toMatch(/cells|target (domain|host)|openai=|n\/a/);
    expect(notes.citation_uncheckable_answers).toBe("All 36 test answers that came back could be checked against your site's text. This row is for information and is not counted in your score.");
    expect(citationCoverage(r.dimension as never)).toEqual({ measurableCells: 36, totalCells: 36, measuredModels: 4, totalModels: 4 });
  });

  it("modelLabel maps provider prefixes and keeps an unknown one", () => {
    expect(ALL_MODEL_IDS.map(modelLabel)).toEqual(["ChatGPT", "Claude", "Gemini", "Perplexity"]);
    expect(modelLabel("mistral:large")).toBe("mistral");
  });

  it("runDim6Paid with competitors: the sub-check is scored", async () => {
    const r = await runDim6Paid({ cacheKv: kv() } as never, "https://acme.com/", {}, ["rival.com"]);
    const c = r.dimension.sub_checks.find((s) => s.id === "citation_no_competitor_first_rate")!;
    expect(c.na).toBeUndefined();
    expect(c.score).toBe(33);
  });

  it("the N/A competitor-first sub-check never becomes a gap", async () => {
    const r = await runDim6Paid({ cacheKv: kv() } as never, "https://acme.com/");
    const scan = {
      id: "s",
      url: "https://acme.com/",
      composite: { score: 33, grade: "F" },
      dimensions_scored: 6,
      dimensions_total: 6,
      dimensions_applicable: 1,
      created_at: 0,
      dimensions: [r.dimension],
    } as unknown as ScanResult;
    const gaps = buildRemediationGaps(scan);
    expect(gaps.map((g) => g.check_id)).not.toContain("citation_no_competitor_first_rate");
    expect(gaps.length).toBeGreaterThan(0);
  });
});

describe("bank q_bank_8 is business-type neutral", () => {
  it("does not ask for a software category", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Generator unavailable => pure bank.
    const env = { AI: { run: async () => { throw new Error("down"); } } } as never;
    const set = await generatePromptSet(env, "https://bakery.example/");
    expect(set.source).toBe("bank");
    const q8 = set.queries.find((q) => q.id === "q_bank_8")!;
    expect(q8.text).toBe("In one sentence, what kind of business is bakery.example, and what category does it belong to?");
    expect(q8.text).not.toMatch(/software/i);
  });
});
