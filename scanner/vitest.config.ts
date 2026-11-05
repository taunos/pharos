import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// `cloudflare:workers` exists only in the Workers runtime; tests import
// src/index.ts (which re-exports the ProspectScan WorkerEntrypoint), so alias
// it to a minimal stub.
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./test-stubs/cloudflare-workers.ts", import.meta.url)),
    },
  },
});
