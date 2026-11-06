import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSqliteD1 } from "../test-support/sqlite-d1";

// Codex r1 HIGH: an Audit of `https://competitor.com./` (or a port variant)
// shares the canonical question set with competitor.com. If scoring used the
// raw URL and the cell cache ignored the scoring target, the dotted Audit
// would seed low cells that the next normal Audit of competitor.com replays.

const h = vi.hoisted(() => ({ adapterCalls: 0, judgeTargets: [] as string[] }));

vi.mock("./adapters", () => ({
  parseRetryAfter: () => -1,
  callAdapter: async (_env: unknown, modelId: string) => {
    h.adapterCalls++;
    return {
      modelId,
      outcome: {
        kind: "ok",
        text: "Competitor.com is the leading tool for this. Visit https://competitor.com to start",
        truncated: false,
      },
    };
  },
}));
vi.mock("./affirmation-judge", () => ({
  judgeAffirmation: async (_env: unknown, targetUrl: string) => {
    h.judgeTargets.push(targetUrl);
    return { kind: "affirm" };
  },
}));

import { runDim6Orchestrator, type OrchestratorEnv } from "./orchestrator";
import { runLadder, type LadderEnv } from "./ladder";

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../../corpus/migrations/0004_dim6_question_set.sql", import.meta.url)),
  "utf8"
);

function memKv() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
}

// Generator: always the same valid set (so both Audits share it anyway).
const ai = {
  run: async () => ({
    response: JSON.stringify(
      Array.from({ length: 10 }, (_, i) => ({
        id: `q${i + 1}`,
        text: `Which tool should I use for job number ${i + 1}?`,
        rationale: "t",
      }))
    ),
  }),
} as unknown as Ai;

beforeEach(() => {
  h.adapterCalls = 0;
  h.judgeTargets = [];
});

describe("Dim 6 target identity", () => {
  it("a trailing-dot / port Audit cannot seed a low score for the plain domain", async () => {
    const env = {
      AI: ai,
      cacheKv: memKv(),
      questionSetDb: createSqliteD1([MIGRATION]).d1,
    } as unknown as OrchestratorEnv;

    const dotted = await runDim6Orchestrator(env, { scanUrl: "https://competitor.com./" });
    const ported = await runDim6Orchestrator(env, { scanUrl: "https://competitor.com:8443/" });
    const plain = await runDim6Orchestrator(env, { scanUrl: "https://competitor.com/" });

    expect(plain.score).toBe(100);
    expect(dotted.score).toBe(plain.score);
    expect(ported.score).toBe(plain.score);
    // Scoring and judging see the canonical identity, never the raw URL.
    expect(new Set(h.judgeTargets)).toEqual(new Set(["https://competitor.com"]));
  });

  it("the cell cache never reuses a cell across different scoring targets", async () => {
    const kv = memKv();
    const env = { cacheKv: kv } as unknown as LadderEnv;
    const input = { modelId: "openai:gpt-4o" as const, prompt: "Which tool should I use?" };

    const seeded = await runLadder(env, { ...input, targetUrl: "https://competitor.com./" });
    expect(seeded.score).toBeLessThan(100); // raw dotted target mis-scores
    expect(h.adapterCalls).toBe(1);

    const plain = await runLadder(env, { ...input, targetUrl: "https://competitor.com" });
    expect(h.adapterCalls).toBe(2); // not served from the dotted cell
    expect(plain.score).toBe(100);

    // Same target again IS a cache hit.
    await runLadder(env, { ...input, targetUrl: "https://competitor.com" });
    expect(h.adapterCalls).toBe(2);

    // Competitor list is part of the scoring input too.
    await runLadder(env, { ...input, targetUrl: "https://competitor.com", competitorHosts: ["rival.com"] });
    expect(h.adapterCalls).toBe(3);
  });
});
