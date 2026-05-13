import { runProbeCycle } from './storage';
import { runMonthlyDigest, aggregateAndRender, computeDefaultPeriod, deriveBrandForDigest } from './digest';
import { validateBrandName } from './validation';

export interface Env {
  DB: D1Database;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  GEMINI_API_KEY: string;
  PROBE_AUTH_TOKEN: string;
  DEBUG_PROBE_LOGS?: string;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function parsePeriodParam(value: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

async function resolvePeriod(
  env: Env,
  url: URL,
): Promise<{ periodStart: number; periodEnd: number }> {
  const startParam = parsePeriodParam(url.searchParams.get('period_start'));
  const endParam = parsePeriodParam(url.searchParams.get('period_end'));
  if (startParam !== null && endParam !== null) {
    return { periodStart: startParam, periodEnd: endParam };
  }
  return computeDefaultPeriod(env);
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 2 * * *') {
      await runProbeCycle(env);
    } else if (event.cron === '0 14 1 * *') {
      const fireTime = new Date(event.scheduledTime);
      const periodMonthIndex = fireTime.getUTCMonth() - 1;
      const periodYear = fireTime.getUTCFullYear();
      const nominalPeriodStart = Math.floor(Date.UTC(periodYear, periodMonthIndex, 1) / 1000);
      const periodEnd = Math.floor(Date.UTC(periodYear, periodMonthIndex + 1, 1) / 1000);

      const minTsRow = await env.DB.prepare('SELECT MIN(timestamp) AS min_ts FROM probe_runs').first<{ min_ts: number | null }>();
      const minTsTruncated = minTsRow?.min_ts ? Math.floor(minTsRow.min_ts / 86400) * 86400 : nominalPeriodStart;
      const periodStart = Math.max(nominalPeriodStart, minTsTruncated);

      // Astrant digest (customer_id=NULL)
      await runMonthlyDigest(env, periodStart, periodEnd, null, 'Astrant');

      // Per-customer digests (active targets only)
      const activeTargets = await env.DB.prepare(
        `SELECT customer_id, brand_name FROM customer_probe_targets WHERE status='active'`
      ).all<{ customer_id: string; brand_name: string }>();
      for (const target of activeTargets.results ?? []) {
        await runMonthlyDigest(env, periodStart, periodEnd, target.customer_id, target.brand_name);
      }
    } else {
      console.warn(`Unrecognized cron expression: ${event.cron}`);
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/internal/')) {
      const auth = request.headers.get('Authorization') ?? '';
      const expected = `Bearer ${env.PROBE_AUTH_TOKEN}`;
      if (!constantTimeEqual(auth, expected)) {
        return new Response('Unauthorized', { status: 401 });
      }

      if (url.pathname === '/api/internal/probe-trigger' && request.method === 'POST') {
        ctx.waitUntil(runProbeCycle(env));
        return new Response(
          'Probe smoke-test initiated. Note: fetch-handler wall-time cap ~30s means only the first few batches will complete; full cycles run via scheduled cron only (daily 0 2 * * * UTC). Check D1 probe_runs for partial results.',
          { status: 202 },
        );
      }

      if (url.pathname === '/api/internal/digest-preview' && request.method === 'GET') {
        // Inline NUL-byte validation (per B1.3 D3 — transport-safe via String.fromCharCode(0))
        const customerIdRaw = url.searchParams.get('customer_id');
        let customerId: string | null;
        if (customerIdRaw === null || customerIdRaw === '') {
          customerId = null;
        } else {
          if (customerIdRaw.includes(String.fromCharCode(0))) {
            return jsonError(400, 'CUSTOMER_ID_NUL_BYTE', 'customer_id must not contain NUL bytes');
          }
          customerId = customerIdRaw;
        }

        const { periodStart, periodEnd } = await resolvePeriod(env, url);
        const brandResult = await deriveBrandForDigest(env, customerId);
        if (!brandResult.ok) {
          return jsonError(brandResult.status, brandResult.code, brandResult.message);
        }
        const markdown = await aggregateAndRender(env, periodStart, periodEnd, customerId, brandResult.brand);
        return new Response(markdown, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        });
      }

      if (url.pathname === '/api/internal/digest-trigger' && request.method === 'POST') {
        // Inline NUL-byte validation (per B1.3 D3 — transport-safe via String.fromCharCode(0))
        const customerIdRaw = url.searchParams.get('customer_id');
        let customerId: string | null;
        if (customerIdRaw === null || customerIdRaw === '') {
          customerId = null;
        } else {
          if (customerIdRaw.includes(String.fromCharCode(0))) {
            return jsonError(400, 'CUSTOMER_ID_NUL_BYTE', 'customer_id must not contain NUL bytes');
          }
          customerId = customerIdRaw;
        }

        const { periodStart, periodEnd } = await resolvePeriod(env, url);
        const brandResult = await deriveBrandForDigest(env, customerId);
        if (!brandResult.ok) {
          return jsonError(brandResult.status, brandResult.code, brandResult.message);
        }
        const result = await runMonthlyDigest(env, periodStart, periodEnd, customerId, brandResult.brand);
        return new Response(JSON.stringify({
          row_id: result.row_id,
          period_start: result.period_start,
          period_end: result.period_end,
          generated_at: result.generated_at,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/api/internal/probe-target-add' && request.method === 'POST') {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return jsonError(400, 'INVALID_JSON', 'request body must be valid JSON');
        }

        // CUSTOMER_ID_REQUIRED
        if (typeof body.customer_id !== 'string' || body.customer_id === '') {
          return jsonError(400, 'CUSTOMER_ID_REQUIRED', 'customer_id must be a non-empty string');
        }

        // CUSTOMER_ID_NUL_BYTE (transport-safe NUL detection)
        if (body.customer_id.includes(String.fromCharCode(0))) {
          return jsonError(400, 'CUSTOMER_ID_NUL_BYTE', 'customer_id must not contain NUL bytes');
        }

        // BRAND_NAME validation (per spec §2.1; rejects empty, too long, control/zero-width/bidi, disallowed chars)
        const brandResult = validateBrandName(body.brand_name);
        if (!brandResult.ok) {
          return jsonError(400, brandResult.code, brandResult.message);
        }
        const brandTrimmed = brandResult.value;

        if (typeof body.domain !== 'string' || body.domain === '') {
          return jsonError(400, 'DOMAIN_REQUIRED', 'domain must be a non-empty string');
        }
        if (typeof body.category !== 'string' || body.category === '') {
          return jsonError(400, 'CATEGORY_REQUIRED', 'category must be a non-empty string');
        }

        // CUSTOMER_CEILING_REACHED check (v1.0 single-cron ceiling per spec D8)
        const countRow = await env.DB.prepare(
          `SELECT COUNT(*) AS c FROM customer_probe_targets WHERE status='active'`
        ).first<{ c: number }>();
        if ((countRow?.c ?? 0) >= 3) {
          return jsonError(503, 'CUSTOMER_CEILING_REACHED',
            'Customer ceiling reached (3 active customers under v1.0 single-cron). Provision blocked until cron-split or cadence-reduction ships in v1.1+. Contact ops to bypass via direct D1 INSERT if business case is urgent.');
        }

        // INSERT (CUSTOMER_ID_COLLISION on UNIQUE constraint failure)
        try {
          const now = Math.floor(Date.now() / 1000);
          await env.DB.prepare(`
            INSERT INTO customer_probe_targets (customer_id, domain, category, brand_name, competitors, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
          `).bind(
            body.customer_id,
            body.domain,
            body.category,
            brandTrimmed,
            body.competitors ? JSON.stringify(body.competitors) : null,
            now,
            now,
          ).run();
          return new Response(JSON.stringify({ added_at: now, customer_id: body.customer_id }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (e: any) {
          if (typeof e?.message === 'string' && e.message.includes('UNIQUE constraint failed')) {
            return jsonError(409, 'CUSTOMER_ID_COLLISION', `customer_id ${body.customer_id} already exists`);
          }
          throw e;
        }
      }

      if (url.pathname === '/api/internal/probe-target-remove' && request.method === 'POST') {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return jsonError(400, 'INVALID_JSON', 'request body must be valid JSON');
        }
        if (typeof body.customer_id !== 'string' || body.customer_id === '') {
          return jsonError(400, 'CUSTOMER_ID_REQUIRED', 'customer_id must be a non-empty string');
        }

        const now = Math.floor(Date.now() / 1000);
        const updateResult = await env.DB.prepare(
          `UPDATE customer_probe_targets SET status='paused', updated_at=? WHERE customer_id=?`
        ).bind(now, body.customer_id).run();
        const changed = updateResult.meta?.changes ?? 0;
        if (changed === 0) {
          return jsonError(404, 'CUSTOMER_NOT_FOUND', `customer_id ${body.customer_id} not found`);
        }
        return new Response(JSON.stringify({ removed_at: now, status: 'paused' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/api/internal/probe-target-list' && request.method === 'POST') {
        const result = await env.DB.prepare(
          `SELECT customer_id, domain, category, brand_name, status, created_at FROM customer_probe_targets ORDER BY created_at`
        ).all();
        return new Response(JSON.stringify({ targets: result.results ?? [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Unknown internal endpoint', { status: 404 });
    }

    return new Response('pharos-citation-tracking — internal instrumentation Worker. No public endpoints.', { status: 200 });
  },
};
