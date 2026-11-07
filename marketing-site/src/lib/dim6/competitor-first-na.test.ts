// Report truthfulness r2 (dim6:v4): with no competitor list the
// competitor-first check is N/A (no free points, never a gap), and the bank
// question set no longer asks every site for its "category of software".
import { describe, expect, it, vi } from "vitest";
import type { CellEnvelope, Dim6Result, ModelId } from "./types";
import { ALL_MODEL_IDS, DIM6_ENGINE_VERSION } from "./types";
import { DIM6_QUESTION_SET_VERSION } from "./question-set";

vi.mock("./orchestrator", () => ({
  runDim6Orchestrator: vi.fn(async (): Promise<Dim6Result> => {
    const cell = (notes: string, score: number): CellEnvelope => ({
      query: { id: "q1", text: "q", rationale: null },
      modelId: "openai:gpt-4o",
      result: { text: "t", score, unmeasurable: false, truncated: false, notes },
    });
    const cells = [
      cell("score=100/100; judge=AFFIRM; domain_named=true; url_referenced=true; context_relevant=true; no_competitor_first=true", 100),
      cell("score=0/100; judge=DENY", 0),
      cell("score=0/100; judge=DENY", 0),
    ];
    return {
      score: 33,
      cells,
      perModelAverage: Object.fromEntries(ALL_MODEL_IDS.map((m) => [m, 33])) as Record<ModelId, number | null>,
      unmeasurableCount: 0,
      totalCells: cells.length,
    };
  }),
}));

import { scoreResponse } from "./parser";
import { runDim6Paid, COMPETITOR_FIRST_NA_NOTE } from "./runDim6";
import { generatePromptSet } from "./promptset";
import { llmEnrichGaps, type AuditEnv } from "../audit-pipeline";
import type { ScanResult } from "../audit-types";

const kv = () => {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) } as unknown as KVNamespace;
};

describe("dim6:v4 competitor-first N/A", () => {
  it("engine and question-set versions are bumped", () => {
    expect(DIM6_ENGINE_VERSION).toBe("dim6:v4");
    expect(DIM6_QUESTION_SET_VERSION).toBe("dim6-qs:v2");
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
    const env = { SESSIONS: { get: async () => null, put: async () => {} } } as unknown as AuditEnv;
    const gaps = await llmEnrichGaps(env, scan, "sess");
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
