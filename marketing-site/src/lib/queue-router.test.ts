import { describe, it, expect, vi } from "vitest";
import { routeQueueBatch, type WorkerQueueEnv } from "./queue-router";

// Test C-A R2-9 — worker.ts `queue` routes on batch.queue.

function handlers() {
  return {
    auditFulfill: vi.fn(async () => undefined),
    auditFulfillDlq: vi.fn(async () => undefined),
    capture: vi.fn(async () => undefined),
  };
}
const env = {} as WorkerQueueEnv;
const batchFor = (queue: string) => ({ queue, messages: [] }) as unknown as MessageBatch<never>;

describe("routeQueueBatch", () => {
  it("astrant-audit-fulfill → audit fulfillment consumer only", async () => {
    const hs = handlers();
    await routeQueueBatch(batchFor("astrant-audit-fulfill"), env, hs);
    expect(hs.auditFulfill).toHaveBeenCalledTimes(1);
    expect(hs.auditFulfillDlq).not.toHaveBeenCalled();
    expect(hs.capture).not.toHaveBeenCalled();
  });

  it("astrant-audit-fulfill-dlq → DLQ consumer only", async () => {
    const hs = handlers();
    await routeQueueBatch(batchFor("astrant-audit-fulfill-dlq"), env, hs);
    expect(hs.auditFulfillDlq).toHaveBeenCalledTimes(1);
    expect(hs.auditFulfill).not.toHaveBeenCalled();
    expect(hs.capture).not.toHaveBeenCalled();
  });

  it.each(["astrant-capture", "something-else", ""])("%s → existing capture consumer", async (q) => {
    const hs = handlers();
    const b = batchFor(q);
    await routeQueueBatch(b, env, hs);
    expect(hs.capture).toHaveBeenCalledWith(b, env);
    expect(hs.auditFulfill).not.toHaveBeenCalled();
    expect(hs.auditFulfillDlq).not.toHaveBeenCalled();
  });

  it("propagates a handler throw (Queue retry semantics)", async () => {
    const hs = { ...handlers(), auditFulfill: vi.fn(async () => { throw new Error("x"); }) };
    await expect(routeQueueBatch(batchFor("astrant-audit-fulfill"), env, hs)).rejects.toThrow("x");
  });
});
