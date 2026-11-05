// Outreach slice (spec §6.2 item 1): the body of POST /api/scan, extracted
// without behaviour change so the ProspectScan RPC entrypoint can share it.
//
// Public route: useCache=true, throwOnInsertFail=false, no source. The INSERT
// it runs is the exact pre-extraction statement (no `source` column), so the
// public path keeps working whether or not migration 0005 is applied.
//
// RPC (outreach) path: useCache=false (no KV read, no KV write: a cached hit
// would return another scan's id and write no outreach row, and an outreach
// result in the cache would hand a human the outreach id), source='outreach'
// (requires migration 0005), throwOnInsertFail=true (an email must never
// link to a 404 /score/<id>).
import type { Env, ScanResult, ScanTier } from "./types";
import { compositeOf } from "./scoring";
import { urlHash } from "./ratelimit";
import { runDim1 } from "./checks/dim1-llmstxt";
import { runDim2 } from "./checks/dim2-mcp";
import { runDim3 } from "./checks/dim3-openapi";
import { runDim4 } from "./checks/dim4-structured";
import { runDim5 } from "./checks/dim5-parsable";
import { runDim6 } from "./checks/dim6-citation";
import { SCORING_VERSION } from "./version";

export type RunScanOpts = {
  email?: string;
  useCache: boolean;
  throwOnInsertFail: boolean;
  source?: "outreach";
};

export const INSERT_SCAN_SQL = `INSERT INTO scans (id, url, composite_score, composite_grade, dimensions_scored, dimensions_total, results_json, email, tier, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export const INSERT_SCAN_WITH_SOURCE_SQL = `INSERT INTO scans (id, url, composite_score, composite_grade, dimensions_scored, dimensions_total, results_json, email, tier, created_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export async function runScan(
  env: Env,
  url: string,
  tier: ScanTier,
  opts: RunScanOpts
): Promise<ScanResult> {
  const email = opts.email;

  // Cache check (1h). Cache key incorporates SCORING_VERSION + tier so:
  //  - SCORING_VERSION bumps invalidate stale entries automatically.
  //  - Free vs paid scans of the same URL get distinct entries (different
  //    js_vs_no_js_render_diff signal).
  let cacheKey: string | null = null;
  if (opts.useCache) {
    const hash = await urlHash(`${url}|${tier}`);
    cacheKey = `scan:v${SCORING_VERSION}:${hash}`;
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      try {
        const data = JSON.parse(cached) as ScanResult;
        return data;
      } catch {
        // fall through to fresh scan
      }
    }
  }

  // Run dimensions in parallel.
  // Slice 3b: Dim 6 (Citation Visibility) is the free-tier demo preview only
  // here. The PAID Dim 6 audit happens in audit-fulfill, which OVERWRITES
  // this dimension on its scan-result before persisting (see
  // marketing-site/src/lib/dim6/runDim6.ts). Capability separation per
  // locked decision 1: scanner has zero of the 4 LLM-provider API keys.
  const startedAt = Date.now();
  const [d1, d2, d3, d4, d5, d6] = await Promise.all([
    runDim1(url, env),
    runDim2(url, env),
    runDim3(url, env),
    runDim4(url, env),
    runDim5(url, env, tier),
    runDim6(url, tier),
  ]);
  const dimensions = [d1, d2, d3, d4, d5, d6];
  const composite = compositeOf(dimensions);
  const id = crypto.randomUUID();
  const created_at = startedAt;

  // Slice 3a:
  //   - dimensions_scored: dimensions ATTEMPTED in this engine version (5/6 in v1.2.0).
  //   - dimensions_applicable: attempted minus whole-dim N/A (e.g. content-only
  //     site has Dim 3 N/A, so applicable=4). Counted from the array; never
  //     extrapolated. Older v1.1.0 scans did not emit this — render-side falls
  //     back to dimensions_scored when undefined.
  const dimensionsApplicable = dimensions.filter((d) => !d.na).length;

  const result: ScanResult = {
    id,
    url,
    composite,
    dimensions,
    dimensions_scored: dimensions.length,
    dimensions_total: 6,
    dimensions_applicable: dimensionsApplicable,
    created_at,
    scoring_version: SCORING_VERSION,
    tier,
  };

  // Persist to D1. Public path: best-effort (don't fail the scan if D1
  // hiccups). RPC path: throw, so the caller never links to a missing row.
  try {
    // Privacy (OD#7): do NOT persist raw IP to D1. The user_ip column is left
    // nullable in the schema (no destructive DROP) but is no longer written.
    // Rate-limiting uses a short-lived, hashed KV key (see checkRateLimit).
    const binds: unknown[] = [
      id,
      url,
      composite.score,
      composite.grade,
      result.dimensions_scored,
      result.dimensions_total,
      JSON.stringify(result),
      email ?? null,
      tier, // P0-C2 dual-write: first-class column mirrors results_json.$.tier
      created_at,
    ];
    if (opts.source) {
      await env.DB.prepare(INSERT_SCAN_WITH_SOURCE_SQL)
        .bind(...binds, opts.source)
        .run();
    } else {
      await env.DB.prepare(INSERT_SCAN_SQL).bind(...binds).run();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("D1 insert failed:", msg);
    if (opts.throwOnInsertFail) throw new Error(`SCAN_INSERT_FAILED: ${msg}`);
  }

  // Cache for 1h (public path only).
  if (cacheKey) {
    await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
  }

  return result;
}
