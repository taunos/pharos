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
import { captureQueueHandler, type CaptureConsumerEnv, type CaptureJobMessage } from "./src/lib/capture-queue-consumer";

export default {
  // Forward the Next/OpenNext request handler unchanged.
  fetch: generatedHandler.fetch,

  // P0-C2 Chunk E2: the real deferred-capture Queue consumer. Expected outcomes
  // are acked inside the handler; unexpected failures throw so Queue automatic
  // retry / DLQ semantics apply. Missing bindings/secrets fail closed.
  async queue(batch: MessageBatch<CaptureJobMessage>, env: CaptureConsumerEnv): Promise<void> {
    await captureQueueHandler(batch, env);
  },
} satisfies ExportedHandler<CaptureConsumerEnv, CaptureJobMessage>;
