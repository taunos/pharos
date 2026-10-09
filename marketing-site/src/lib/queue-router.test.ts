import { describe, it, expect, vi } from "vitest";
import { routeQueueBatch, type WorkerQueueEnv } from "./queue-router";

// Test C-A R2-9 — worker.ts `queue` routes on batch.queue.
// Slice Q — astrant-fulfill / astrant-fulfill-dlq route to the generic consumers.

function handlers() {
  return {
    auditFulfill: vi.fn(async () => undefined),
    auditFulfillDlq: vi.fn(async () => undefined),
    fulfill: vi.fn(async () => undefined),
    fulfillDlq: vi.fn(async () => undefined),
    capture: vi.fn(async () => undefined),
  };
}
const env = {} as WorkerQueueEnv;
const batchFor = (queue: string) => ({ queue, messages: [] }) as unknown as MessageBatch<never>;

const onlyCalled = (hs: ReturnType<typeof handlers>, name: keyof ReturnType<typeof handlers>) => {
  for (const [k, fn] of Object.entries(hs)) {
    expect(fn).toHaveBeenCalledTimes(k === name ? 1 : 0);
  }
};

describe("routeQueueBatch", () => {
  it("astrant-audit-fulfill → audit fulfillment consumer only", async () => {
    const hs = handlers();
    await routeQueueBatch(batchFor("astrant-audit-fulfill"), env, hs);
    onlyCalled(hs, "auditFulfill");
  });

  it("astrant-audit-fulfill-dlq → DLQ consumer only", async () => {
    const hs = handlers();
    await routeQueueBatch(batchFor("astrant-audit-fulfill-dlq"), env, hs);
    onlyCalled(hs, "auditFulfillDlq");
  });

  it("Slice Q: astrant-fulfill → generic fulfillment consumer only", async () => {
    const hs = handlers();
    const b = batchFor("astrant-fulfill");
    await routeQueueBatch(b, env, hs);
    onlyCalled(hs, "fulfill");
    expect(hs.fulfill).toHaveBeenCalledWith(b, env);
  });

  it("Slice Q: astrant-fulfill-dlq → generic DLQ consumer only", async () => {
    const hs = handlers();
    await routeQueueBatch(batchFor("astrant-fulfill-dlq"), env, hs);
    onlyCalled(hs, "fulfillDlq");
  });

  it.each(["astrant-capture", "something-else", ""])("%s → existing capture consumer (logged fallthrough)", async (q) => {
    const hs = handlers();
    const b = batchFor(q);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await routeQueueBatch(b, env, hs);
    expect(err.mock.calls.some((c) => String(c[0]).startsWith(`QUEUE_ROUTER_FALLTHROUGH queue=${q} `))).toBe(true);
    err.mockRestore();
    expect(hs.capture).toHaveBeenCalledWith(b, env);
    onlyCalled(hs, "capture");
  });

  it("propagates a handler throw (Queue retry semantics)", async () => {
    const hs = { ...handlers(), auditFulfill: vi.fn(async () => { throw new Error("x"); }) };
    await expect(routeQueueBatch(batchFor("astrant-audit-fulfill"), env, hs)).rejects.toThrow("x");
    const hs2 = { ...handlers(), fulfill: vi.fn(async () => { throw new Error("y"); }) };
    await expect(routeQueueBatch(batchFor("astrant-fulfill"), env, hs2)).rejects.toThrow("y");
  });
});
