import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Env, ScanResult, ScanTier } from "./types";
import { compositeOf } from "./scoring";
import { checkRateLimit, urlHash } from "./ratelimit";
import { runDim1 } from "./checks/dim1-llmstxt";
import { runDim2 } from "./checks/dim2-mcp";
import { runDim4 } from "./checks/dim4-structured";
import { runDim5 } from "./checks/dim5-parsable";
import { SCORING_VERSION } from "./version";

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
    allowHeaders: ["Content-Type", "x-internal-fulfill-key"],
    maxAge: 86400,
  })
);

app.get("/health", (c) =>
  c.json({ ok: true, version: VERSION, scoring_version: SCORING_VERSION })
);

const scanBody = z.object({
  url: z.string().url(),
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
        error:
          "Invalid input: url must be a valid URL; email and tier optional",
      },
      400
    );
  }
  const { url, email } = parsed.data;
  const requestedTier: ScanTier = parsed.data.tier ?? "free";

  // Internal-auth gating for paid-tier requests. A misconfigured paid call
  // gracefully degrades to free rather than erroring — trust posture per
  // Slice 2a Task 3.
  let tier: ScanTier = "free";
  if (requestedTier === "paid") {
    const provided = c.req.header("x-internal-fulfill-key");
    if (
      c.env.INTERNAL_FULFILL_KEY &&
      provided &&
      provided === c.env.INTERNAL_FULFILL_KEY
    ) {
      tier = "paid";
    } else {
      console.error(
        "[scan] paid tier requested without valid internal-auth header; degrading to free"
      );
    }
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";

  const rl = await checkRateLimit(c.env, ip, url);
  if (!rl.allowed) return c.json({ ok: false, error: rl.reason }, 429);

  // Cache check (1h). Cache key incorporates SCORING_VERSION + tier so:
  //  - SCORING_VERSION bumps invalidate stale entries automatically.
  //  - Free vs paid scans of the same URL get distinct entries (different
  //    js_vs_no_js_render_diff signal).
  const hash = await urlHash(`${url}|${tier}`);
  const cacheKey = `scan:v${SCORING_VERSION}:${hash}`;
  const cached = await c.env.CACHE.get(cacheKey);
  if (cached) {
    try {
      const data = JSON.parse(cached) as ScanResult;
      return c.json(data);
    } catch {
      // fall through to fresh scan
    }
  }

  // Run dimensions in parallel.
  const startedAt = Date.now();
  const [d1, d2, d4, d5] = await Promise.all([
    runDim1(url, c.env),
    runDim2(url, c.env),
    runDim4(url, c.env),
    runDim5(url, c.env, tier),
  ]);
  const dimensions = [d1, d2, d4, d5];
  const composite = compositeOf(dimensions);
  const id = crypto.randomUUID();
  const created_at = startedAt;

  const result: ScanResult = {
    id,
    url,
    composite,
    dimensions,
    dimensions_scored: 4,
    dimensions_total: 6,
    created_at,
    scoring_version: SCORING_VERSION,
    tier,
  };

  // Persist to D1 (best-effort; don't fail the scan if D1 hiccups).
  try {
    await c.env.DB.prepare(
      `INSERT INTO scans (id, url, composite_score, composite_grade, dimensions_scored, dimensions_total, results_json, email, user_ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        url,
        composite.score,
        composite.grade,
        result.dimensions_scored,
        result.dimensions_total,
        JSON.stringify(result),
        email ?? null,
        ip,
        created_at
      )
      .run();
  } catch (e) {
    console.error("D1 insert failed:", e instanceof Error ? e.message : String(e));
  }

  // Cache for 1h
  await c.env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });

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

export default app;
