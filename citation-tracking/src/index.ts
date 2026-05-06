import { runProbeCycle } from './storage';
import { runMonthlyDigest, aggregateAndRender, computeDefaultPeriod } from './digest';

export interface Env {
  DB: D1Database;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  GEMINI_API_KEY: string;
  PROBE_AUTH_TOKEN: string;
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

      await runMonthlyDigest(env, periodStart, periodEnd);
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
        return new Response('Probe cycle triggered. Check D1 for results.', { status: 202 });
      }

      if (url.pathname === '/api/internal/digest-preview' && request.method === 'GET') {
        const { periodStart, periodEnd } = await resolvePeriod(env, url);
        const markdown = await aggregateAndRender(env, periodStart, periodEnd);
        return new Response(markdown, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        });
      }

      if (url.pathname === '/api/internal/digest-trigger' && request.method === 'POST') {
        const { periodStart, periodEnd } = await resolvePeriod(env, url);
        const result = await runMonthlyDigest(env, periodStart, periodEnd);
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

      return new Response('Unknown internal endpoint', { status: 404 });
    }

    return new Response('pharos-citation-tracking — internal instrumentation Worker. No public endpoints.', { status: 200 });
  },
};
