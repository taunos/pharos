import { describe, expect, it, vi } from "vitest";
import { cellCacheKey, runLadder, type LadderEnv } from "./ladder";

function fakeKv(seed: Record<string, unknown>) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const put = vi.fn(async (k: string, v: string) => {
    store.set(k, v);
  });
  const kv = { get: async (k: string) => store.get(k) ?? null, put } as unknown as KVNamespace;
  return { kv, put };
}

const PROMPT = "What does example.com do?";
const MODEL = "openai:gpt-4o" as const;

describe("dim6 ladder cache: failures are never replayed", () => {
  it("ignores a cached unmeasurable cell and does not cache the new failure", async () => {
    const key = await cellCacheKey(MODEL, PROMPT, "https://example.com");
    const { kv, put } = fakeKv({
      [key]: {
        text: null,
        score: 0,
        unmeasurable: true,
        truncated: false,
        notes: "POISONED: credit balance is too low",
        cached_at: 1,
      },
    });
    // No OPENAI_API_KEY → adapter client_error → a fresh unmeasurable cell.
    const env = { cacheKv: kv } as unknown as LadderEnv;
    const cell = await runLadder(env, { modelId: MODEL, prompt: PROMPT, targetUrl: "https://example.com" });

    expect(cell.unmeasurable).toBe(true);
    expect(cell.notes).not.toContain("POISONED");
    expect(put).not.toHaveBeenCalled();
  });

  it("still serves a cached measured cell", async () => {
    const key = await cellCacheKey(MODEL, PROMPT, "https://example.com");
    const { kv, put } = fakeKv({
      [key]: {
        text: "Example does things.",
        score: 50,
        unmeasurable: false,
        truncated: false,
        notes: "measured",
        cached_at: Date.now(),
      },
    });
    const env = { cacheKv: kv } as unknown as LadderEnv;
    const cell = await runLadder(env, { modelId: MODEL, prompt: PROMPT, targetUrl: "https://example.com" });

    expect(cell).toMatchObject({ unmeasurable: false, score: 50, notes: "measured" });
    expect(put).not.toHaveBeenCalled();
  });
});
