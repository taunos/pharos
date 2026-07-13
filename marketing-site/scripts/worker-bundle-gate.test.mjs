// P0-C2 Chunk D — gate analyzer unit tests, including the required fetch-only
// NEGATIVE CONTROL. Fixtures mirror the esbuild `var X = {...}; export { X as
// default }` output shape.
import { describe, it, expect } from "vitest";
import { analyzeBundle, entryPointFromMetafile, evaluateGate } from "./worker-bundle-gate.mjs";

const FETCH_QUEUE = `
var worker_default2 = {
  fetch: generated_default.fetch,
  async queue(batch) {
    batch.retryAll();
    throw new Error("not implemented");
  }
};
export {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
  worker_default2 as default
};
`;

const FETCH_ONLY = `
var worker_default = {
  async fetch(request, env, ctx) {
    return new Response("ok");
  }
};
export {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
  worker_default as default
};
`;

const MISSING_NAMED = `
var w = { async fetch() {}, async queue(b) {} };
export { DOQueueHandler, w as default };
`;

const META_CUSTOM = { outputs: { "dir/worker.js": { entryPoint: "worker.ts", inputs: {} } } };
const META_GENERATED = { outputs: { "dir/worker.js": { entryPoint: ".open-next/worker.js", inputs: {} } } };

describe("analyzeBundle", () => {
  it("resolves fetch + callable queue + named exports from a fetch+queue bundle", () => {
    const a = analyzeBundle(FETCH_QUEUE);
    expect(a.defaultFound).toBe(true);
    expect(a.hasFetch).toBe(true);
    expect(a.hasQueue).toBe(true);
    expect(a.queueCallable).toBe(true);
    expect(a.namedExports.sort()).toEqual(["BucketCachePurge", "DOQueueHandler", "DOShardedTagCache"]);
  });

  it("NEGATIVE CONTROL: a fetch-only default export has no queue", () => {
    const a = analyzeBundle(FETCH_ONLY);
    expect(a.hasFetch).toBe(true);
    expect(a.hasQueue).toBe(false);
    expect(a.queueCallable).toBe(false);
  });
});

describe("entryPointFromMetafile", () => {
  it("reads the worker.js output entryPoint", () => {
    expect(entryPointFromMetafile(META_CUSTOM)).toBe("worker.ts");
    expect(entryPointFromMetafile(META_GENERATED)).toBe(".open-next/worker.js");
  });
});

describe("evaluateGate", () => {
  it("passes for custom entrypoint + fetch/queue + named exports", () => {
    const r = evaluateGate({ bundleSource: FETCH_QUEUE, metafile: META_CUSTOM });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("FAILS on a fetch-only bundle (the negative control)", () => {
    const r = evaluateGate({ bundleSource: FETCH_ONLY, metafile: META_CUSTOM });
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toContain("no `queue`");
  });

  it("FAILS when the entryPoint is the generated fetch-only worker", () => {
    const r = evaluateGate({ bundleSource: FETCH_QUEUE, metafile: META_GENERATED });
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toContain("generated fetch-only worker");
  });

  it("FAILS when an OpenNext named export is missing", () => {
    const r = evaluateGate({ bundleSource: MISSING_NAMED, metafile: META_CUSTOM });
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/missing OpenNext named export/);
  });
});
