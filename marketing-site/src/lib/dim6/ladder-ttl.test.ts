import { describe, expect, it, vi, beforeEach } from "vitest";

// Dim 6 cell-cache TTL (24 h): an entry older than the TTL is never reused,
// and fresh writes carry expirationTtl = CACHE_TTL_SEC.

const h = vi.hoisted(() => ({ calls: 0 }));

vi.mock("./adapters", () => ({
  parseRetryAfter: () => -1,
  callAdapter: async (_env: unknown, modelId: string) => {
    h.calls++;
    return {
      modelId,
      outcome: { kind: "ok", text: "Example.com is a tool for examples. https://example.com", truncated: false },
    };
  },
}));
vi.mock("./affirmation-judge", () => ({
  judgeAffirmation: async () => ({ kind: "affirm" }),
}));

import { runLadder, CACHE_TTL_SEC, type LadderEnv } from "./ladder";
import { DIM6_ENGINE_VERSION } from "./types";

const PROMPT = "What does example.com do?";
const MODEL = "openai:gpt-4o" as const;

async function keyFor(prompt: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prompt));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${DIM6_ENGINE_VERSION}:${MODEL}:${hex}`;
}

function fakeKv(seed: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const put = vi.fn(async (k: string, v: string, _o?: { expirationTtl?: number }) => {
    store.set(k, v);
  });
  const kv = { get: async (k: string) => store.get(k) ?? null, put } as unknown as KVNamespace;
  return { kv, put };
}

const cached = (cached_at: number) => ({
  text: "OLD ANSWER",
  score: 100,
  unmeasurable: false,
  truncated: false,
  notes: "old",
  cached_at,
});

const run = (kv: KVNamespace) =>
  runLadder({ cacheKv: kv } as unknown as LadderEnv, {
    modelId: MODEL,
    prompt: PROMPT,
    targetUrl: "https://example.com",
  });

beforeEach(() => {
  h.calls = 0;
});

describe("dim6 ladder cache TTL", () => {
  it("is 24 hours", () => {
    expect(CACHE_TTL_SEC).toBe(24 * 60 * 60);
  });

  it("writes a fresh cell with expirationTtl = 24 h", async () => {
    const { kv, put } = fakeKv();
    const cell = await run(kv);
    expect(cell.unmeasurable).toBe(false);
    expect(h.calls).toBe(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe(await keyFor(PROMPT));
    expect(put.mock.calls[0][2]).toEqual({ expirationTtl: 24 * 60 * 60 });
  });

  it("does not reuse a cell older than the TTL (e.g. written under the old 30-day TTL)", async () => {
    const { kv, put } = fakeKv({
      [await keyFor(PROMPT)]: cached(Date.now() - CACHE_TTL_SEC * 1000 - 1000),
    });
    const cell = await run(kv);
    expect(h.calls).toBe(1);
    expect(cell.text).not.toBe("OLD ANSWER");
    expect(put).toHaveBeenCalledTimes(1); // replaced with the fresh answer
  });

  it("does not reuse a cell with no cached_at", async () => {
    const entry: Record<string, unknown> = cached(0);
    delete entry.cached_at;
    const { kv } = fakeKv({ [await keyFor(PROMPT)]: entry });
    await run(kv);
    expect(h.calls).toBe(1);
  });

  it("still reuses a cell inside the TTL (covers queue retries of one fulfillment)", async () => {
    const { kv, put } = fakeKv({ [await keyFor(PROMPT)]: cached(Date.now() - 60 * 60 * 1000) });
    const cell = await run(kv);
    expect(h.calls).toBe(0);
    expect(cell.text).toBe("OLD ANSWER");
    expect(put).not.toHaveBeenCalled();
  });
});
