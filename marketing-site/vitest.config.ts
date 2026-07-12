import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal config: map the "@/" path alias (matching tsconfig) so route/module
// tests can import via the same specifier the app uses. Additive — existing
// relative-import tests are unaffected.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
