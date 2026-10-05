// P0-C2 Chunk D — custom OpenNext Worker entrypoint.
//
// `opennextjs-cloudflare build` emits a FETCH-ONLY worker at .open-next/worker.js.
// The deferred-capture Queue consumer (Chunk E) needs a `queue` handler, which a
// generated worker cannot carry — so wrangler's `main` points HERE. This wrapper
// forwards `fetch` unchanged, adds `queue`, and re-exports the OpenNext runtime
// Durable Object / cache classes verbatim.
//
// `.open-next/*` is generated at wrangler-bundle time and excluded from tsconfig;
// the @ts-expect-error lines mirror OpenNext's own generated-file suppression
// (see .open-next/worker.js).

// @ts-expect-error generated at build time (.open-next excluded from tsconfig)
import generatedHandler from "./.open-next/worker.js";
// @ts-expect-error generated at build time
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
import { routeQueueBatch, type WorkerQueueEnv, type WorkerQueueMessage } from "./src/lib/queue-router";

export default {
  // Forward the Next/OpenNext request handler unchanged.
  fetch: generatedHandler.fetch,

  // Test C-A: routes on batch.queue (src/lib/queue-router.ts) —
  // astrant-audit-fulfill / astrant-audit-fulfill-dlq → Audit fulfillment
  // consumers; anything else → the P0-C2 Chunk E2 deferred-capture consumer,
  // unchanged. Expected outcomes are acked inside the handlers; unexpected
  // failures throw so Queue automatic retry / DLQ semantics apply. Missing
  // bindings/secrets fail closed.
  async queue(batch: MessageBatch<WorkerQueueMessage>, env: WorkerQueueEnv): Promise<void> {
    await routeQueueBatch(batch, env);
  },
} satisfies ExportedHandler<WorkerQueueEnv, WorkerQueueMessage>;
