import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Env, ScanTier } from "./types";
import { enforceScanLimits, limiterIdentity, proxyTrustKey } from "./ratelimit";
import { INVALID_SCAN_INPUT, scanUrlSchema } from "./scan-rpc";
import { runScan } from "./run-scan";
import { SCORING_VERSION } from "./version";
import { mountScoreAdmin } from "./score-admin";
import { mountCaptureOutbox, runCaptureWatchdog } from "./capture-outbox";
import { mountCaptureConsumerRpc } from "./capture-consumer-rpc";
import { mountPrivacyDelete } from "./privacy-delete";
import { runRetentionSweep, HANDLER_WALL_BUDGET_MS } from "./retention-sweep";
import { normalizeEmail } from "./email-normalize";
import { constantTimeEqual } from "./auth";

const VERSION = "0.2.0";

const ALLOWED_ORIGINS = new Set([
  "https://astrant.io",
  "https://www.astrant.io",
  "https://pharos-marketing.pharos-dev.workers.dev",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
]);

const app = new Hono<{ Bindings: Env }>();

app.use(
  "/api/*",
  cors({
    origin: (origin) => (origin && ALLOWED_ORIGINS.has(origin) ? origin : ""),
    allowMethods: ["POST", "GET", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "x-internal-fulfill-key",
      "x-internal-scanner-admin-key",
    ],
    maxAge: 86400,
  })
);

// TODO: Phase 2 of 2b — robots.txt pre-fetch and Disallow respect
// before invoking checks against an external site (TF-13 / roadmap §6.4).
// Current state: scanner runs on user submission without robots.txt check.

// Slice 2b admin endpoints (capture-email, pdf-generated, unsubscribe,
// delete-pii, by-email-internal, email read-back, state). All require
// INTERNAL_SCANNER_ADMIN_KEY (separate trust domain from INTERNAL_FULFILL_KEY).
mountScoreAdmin(app);

// P0-C2 Chunk C: scanner-owned deferred-capture outbox producer endpoint.
mountCaptureOutbox(app);

// P0-C2 Chunk E1: scanner-owned capture-consumer RPC / state machine.
mountCaptureConsumerRpc(app);

// P0-C2 Chunk G: gated privacy-delete integration + authenticated replay
// endpoint. PRIVACY_INTEGRATION_MODE is fail-closed 'off' (not set anywhere
// in this chunk) — the replay route 404s and both score-admin surfaces run
// legacy bytes until activation.
mountPrivacyDelete(app);

app.get("/health", (c) =>
  c.json({ ok: true, version: VERSION, scoring_version: SCORING_VERSION })
);

const scanBody = z.object({
  // Security pass 2026-11-04: only public http(s) hosts on 80/443 (no IP
  // literals, localhost/internal suffixes, single-label hosts, credentials,
  // other ports). Rejected with the existing 400 before any KV or D1 write.
  // E8: the schema is shared with the ScanRpc entrypoint (./scan-rpc).
  url: scanUrlSchema,
  email: z
    .string()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    .optional(),
  tier: z.enum(["free", "paid"]).optional(),
});

app.post("/api/scan", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const parsed = scanBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        ok: false,
        error: INVALID_SCAN_INPUT,
      },
      400
    );
  }
  const { url } = parsed.data;
  // F-01: normalize email at storage entry so D1 always holds the canonical
  // form. Marketing-site applies the same normalization at its entry points;
  // this defense-in-depth ensures direct scanner callers (e.g. MCP tools or
  // tests) get identical behavior.
  const email = parsed.data.email ? normalizeEmail(parsed.data.email) : undefined;
  const requestedTier: ScanTier = parsed.data.tier ?? "free";

  // Internal-auth gating for paid-tier requests. A misconfigured paid call
  // gracefully degrades to free rather than erroring — trust posture per
  // Slice 2a Task 3.
  let tier: ScanTier = "free";
  if (requestedTier === "paid") {
    const provided = c.req.header("x-internal-fulfill-key");
    // F-03: constant-time comparison.
    if (
      c.env.INTERNAL_FULFILL_KEY &&
      provided &&
      constantTimeEqual(provided, c.env.INTERNAL_FULFILL_KEY)
    ) {
      tier = "paid";
    } else {
      console.error(
        "[scan] paid tier requested without valid internal-auth header; degrading to free"
      );
    }
  }

  // Authenticated paid calls (audit-fulfill from the marketing Worker, which
  // forwards no client IP, so every Audit would share one IP key) skip both
  // rate limits. URL validation above still applies to them. Everything else,
  // including paid requests degraded to free, goes through both limits.
  if (tier !== "paid") {
    // E11: x-astrant-proxy-key is checked against SCAN_PROXY_KEY (transition
    // fallback: INTERNAL_FULFILL_KEY while SCAN_PROXY_KEY is unset).
    const ip = limiterIdentity(
      proxyTrustKey(c.env),
      c.req.header("CF-Connecting-IP"),
      c.req.header("x-astrant-proxy-key"),
      c.req.header("x-astrant-client-ip")
    );

    const limited = await enforceScanLimits(c.env, ip, url);
    if (limited) return c.json(limited.body, limited.status);
  }

  // Outreach slice: the scan body lives in runScan (./run-scan) so the
  // ProspectScan RPC entrypoint can share it. The public route's behaviour is
  // unchanged: same cache read/write, same INSERT bytes, same swallowed insert
  // error.
  const result = await runScan(c.env, url, tier, {
    email,
    useCache: true,
    throwOnInsertFail: false,
  });
  return c.json(result);
});

app.get("/api/scan/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT results_json FROM scans WHERE id = ?`).bind(id).first<{
    results_json: string;
  }>();
  if (!row) return c.json({ ok: false, error: "not found" }, 404);
  try {
    return c.json(JSON.parse(row.results_json));
  } catch {
    return c.json({ ok: false, error: "stored result corrupted" }, 500);
  }
});

app.get("/", (c) =>
  c.text(
    [
      `Astrant Scanner v${VERSION} (scoring v${SCORING_VERSION})`,
      "",
      "Endpoints:",
      "  POST /api/scan    {url, email?, tier?}  → run a scan",
      "  GET  /api/scan/:id                     → fetch saved scan",
      "  GET  /health",
      "",
      "More: https://astrant.io/score",
    ].join("\n")
  )
);

// Outreach slice: Service-Binding-only RPC entrypoint for pharos-outreach.
// Named export next to the default object export; reachable only through a
// Service Binding, so nothing new is exposed on scanner.astrant.io.
export { ProspectScan } from "./prospect-scan";

// E8: Service-Binding-only RPC entrypoint for pharos-mcp's score_url, keyed on
// the end-user IP the caller passes. Not reachable on scanner.astrant.io.
export { ScanRpc } from "./scan-rpc";

// P0-C2 Chunk C: expose fetch (unchanged) + a DORMANT scheduled handler for the
// capture-outbox watchdog. No cron trigger is declared in wrangler.jsonc in this
// chunk, so `scheduled` never fires in production yet; it stays testable via
// runCaptureWatchdog. `app.fetch` remains the request entrypoint (existing tests
// call the default export's .fetch).
export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> =>
    app.fetch(req, env, ctx),
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    // P0-C2 F2: the 15-min platform limit binds the WHOLE invocation, so the
    // shared wall deadline is established here, before the watchdog (D12).
    // The retention call is unconditional — mode gating (off|dry_run|enforce,
    // fail-closed off) lives solely inside runRetentionSweep (D1). No cron
    // trigger is declared in wrangler.jsonc, so this stays unreachable in
    // production until activation.
    const handlerDeadline = Date.now() + HANDLER_WALL_BUDGET_MS;         // FIRST statement (new)
    await runCaptureWatchdog(env, { now: Date.now() });                  // existing line — BYTE-UNCHANGED
    await runRetentionSweep(env, { now: Date.now(), deadlineMs: handlerDeadline });   // new
  },
};
