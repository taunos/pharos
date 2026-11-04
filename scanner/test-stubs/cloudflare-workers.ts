// Test-only stub for the `cloudflare:workers` runtime module (vitest runs in
// Node, where that module does not exist). Mirrors the shape we use.
export class WorkerEntrypoint<E = unknown> {
  protected ctx: unknown;
  protected env: E;
  constructor(ctx: unknown, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}
