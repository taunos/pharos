import type { Env } from './types';
import { getCustomerFromCacheOrD1 } from './config';
import { handleProvision } from './api-provision';
import { handleDeprovision } from './api-deprovision';
import { handleUpdateConfig } from './api-update-config';
import { handleSweep } from './api-sweep';
import { handleMcp } from './mcp-handler';
import { wellKnownMcp, wellKnownServerCard } from './well-known';
import { runSweep } from './sweep';

function mcpNotFound(): Response {
  return new Response(JSON.stringify({ error: 'MCP not found or no longer active' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Internal API routes (any subdomain — auth-gated):
    if (url.pathname.startsWith('/api/internal/')) {
      if (url.pathname === '/api/internal/provision-customer') {
        return handleProvision(req, env);
      }
      if (url.pathname === '/api/internal/deprovision-customer') {
        return handleDeprovision(req, env);
      }
      if (url.pathname === '/api/internal/update-customer-config') {
        return handleUpdateConfig(req, env);
      }
      if (url.pathname === '/api/internal/sweep') {
        return handleSweep(req, env);
      }
      return new Response('Not Found', { status: 404 });
    }

    // Customer MCP routes (per-subdomain):
    const host = req.headers.get('Host') ?? '';
    const slugMatch = host.match(/^([a-z0-9-]+)\.mcp\.astrant\.io$/);
    if (!slugMatch) return new Response('Not Found', { status: 404 });
    const slug = slugMatch[1];

    // Entitlement check (canonical — honors D4 end-of-period sunset semantics):
    const customer = await getCustomerFromCacheOrD1(slug, env);
    if (!customer) return mcpNotFound();
    if (customer.status === 'expired') return mcpNotFound();
    // status='cancelled' still serves while period_end > now (end-of-period sunset).
    // The sweep cron flips cancelled → expired post-period_end; the period_end check
    // below handles the window between period_end and the next sweep run.
    if (customer.period_end !== null && customer.period_end < Math.floor(Date.now() / 1000)) {
      return mcpNotFound();
    }

    if (url.pathname === '/.well-known/mcp.json') return wellKnownMcp(customer);
    if (url.pathname === '/.well-known/mcp/server-card.json') return wellKnownServerCard(customer);
    if (url.pathname === '/mcp' || url.pathname === '/sse') return handleMcp(req, customer);
    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 3 * * *') {
      await runSweep(env); // await, NOT ctx.waitUntil (per C3)
    } else {
      console.warn(`Unrecognized cron expression: ${event.cron}`);
    }
  },
};
