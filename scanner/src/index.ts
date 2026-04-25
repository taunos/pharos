import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Env, ScanResult } from "./types";
import { compositeOf } from "./scoring";
import { checkRateLimit, urlHash } from "./ratelimit";
import { runDim1 } from "./checks/dim1-llmstxt";
import { runDim2 } from "./checks/dim2-mcp";
import { runDim4 } from "./checks/dim4-structured";

const VERSION = "0.1.0";

const ALLOWED_ORIGINS = new Set([
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
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);

app.get("/health", (c) => c.json({ ok: true, version: VERSION }));

const scanBody = z.object({
  url: z.string().url(),
  email: z
    .string()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    .optional(),
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
    return c.json({ ok: false, error: "Invalid input: url must be a valid URL; email optional" }, 400);
  }
  const { url, email } = parsed.data;
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";

  const rl = await checkRateLimit(c.env, ip, url);
  if (!rl.allowed) return c.json({ ok: false, error: rl.reason }, 429);

  // Cache check (1h)
  const hash = await urlHash(url);
  const cacheKey = `cache:${hash}`;
  const cached = await c.env.CACHE.get(cacheKey);
  if (cached) {
    try {
      const data = JSON.parse(cached) as ScanResult;
      return c.json(data);
    } catch {
      // fall through to fresh scan
    }
  }

  // Run dimensions in parallel
  const startedAt = Date.now();
  const [d1, d2, d4] = await Promise.all([
    runDim1(url, c.env),
    runDim2(url, c.env),
    runDim4(url, c.env),
  ]);
  const dimensions = [d1, d2, d4];
  const composite = compositeOf(dimensions);
  const id = crypto.randomUUID();
  const created_at = startedAt;

  const result: ScanResult = {
    id,
    url,
    composite,
    dimensions,
    dimensions_scored: 3,
    dimensions_total: 6,
    created_at,
  };

  // Persist to D1 (best-effort; don't fail the scan if D1 hiccups)
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
      `Pharos Scanner v${VERSION}`,
      "",
      "Endpoints:",
      "  POST /api/scan    {url, email?}  → run a scan",
      "  GET  /api/scan/:id              → fetch saved scan",
      "  GET  /health",
      "",
      "More: https://pharos.dev/score",
    ].join("\n")
  )
);

export default app;
