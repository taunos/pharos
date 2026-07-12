// P0-C2 pre-deploy integration coverage for the tier dual-write.
// Exercises the REAL POST /api/scan persistence path (cache miss → run →
// INSERT) with the external dimension checks mocked, and asserts the EXACT D1
// bind value for the tier column AND the serialized results_json.$.tier — not
// just the response body.
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({
  dim: (id: number) => ({
    dimension_id: id,
    dimension_name: "dim" + id,
    score: 50,
    grade: "C",
    sub_checks: [],
    na: false,
  }),
}));

// Mock the external checks (each fetches the target site / uses AI).
vi.mock("./checks/dim1-llmstxt", () => ({ runDim1: async () => h.dim(1) }));
vi.mock("./checks/dim2-mcp", () => ({ runDim2: async () => h.dim(2) }));
vi.mock("./checks/dim3-openapi", () => ({ runDim3: async () => h.dim(3) }));
vi.mock("./checks/dim4-structured", () => ({ runDim4: async () => h.dim(4) }));
vi.mock("./checks/dim5-parsable", () => ({ runDim5: async () => h.dim(5) }));
vi.mock("./checks/dim6-citation", () => ({ runDim6: async () => h.dim(6) }));

import app from "./index";

const FULFILL_KEY = "valid-internal-fulfill-key";

function makeEnv() {
  let captured: unknown[] | null = null;
  const env = {
    RATE_LIMIT_HASH_SECRET: "rl-secret",
    INTERNAL_FULFILL_KEY: FULFILL_KEY,
    AI: { run: async () => ({}) },
    // CACHE.get → null forces a cache miss (scan cache key) AND a fresh
    // rate-limit window; put is a no-op.
    CACHE: { get: async () => null, put: async () => {} },
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              run: async () => {
                if (String(sql).includes("INSERT INTO scans")) captured = args;
                return { success: true, meta: { changes: 1 } };
              },
              first: async () => null,
              all: async () => ({ results: [] }),
            };
          },
          first: async () => null,
        };
      },
    },
  };
  return { env, getInsertBind: () => captured };
}

async function runScan(env: unknown, opts: { tier?: string; key?: string }) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.key) headers["x-internal-fulfill-key"] = opts.key;
  const body: Record<string, unknown> = { url: "https://example.com" };
  if (opts.tier) body.tier = opts.tier;
  const req = new Request("https://scanner.astrant.io/api/scan", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const res = await app.fetch(req, env as never);
  return res;
}

// Response tier, results_json.$.tier (INSERT bind[6]), and the tier column
// (INSERT bind[8]) must all agree.
async function assertAllThree(env: ReturnType<typeof makeEnv>, res: Response, expected: string) {
  const body = (await res.json()) as { tier?: string };
  const bind = env.getInsertBind();
  expect(res.status).toBe(200);
  expect(bind).not.toBeNull();
  expect(body.tier).toBe(expected); // response JSON
  expect(JSON.parse(bind![6] as string).tier).toBe(expected); // results_json.$.tier
  expect(bind![8]).toBe(expected); // D1 tier column bind
}

describe("POST /api/scan — tier dual-write (real persistence path, cache miss)", () => {
  it("default free request → response, results_json, and D1 column all 'free'", async () => {
    const env = makeEnv();
    const res = await runScan(env.env, {});
    await assertAllThree(env, res, "free");
  });

  it("requested paid + valid internal fulfill key → all three 'paid'", async () => {
    const env = makeEnv();
    const res = await runScan(env.env, { tier: "paid", key: FULFILL_KEY });
    await assertAllThree(env, res, "paid");
  });

  it("requested paid + invalid key → degrades to 'free' (all three)", async () => {
    const env = makeEnv();
    const res = await runScan(env.env, { tier: "paid", key: "wrong-key" });
    await assertAllThree(env, res, "free");
  });
});
