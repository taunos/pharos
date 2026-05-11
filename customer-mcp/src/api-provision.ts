import type { Env, Customer, CustomerConfig } from './types';
import { requireInternalAuth } from './auth';
import { generateSlug, type SlugError } from './slug';
import { invalidateCustomerCache } from './config';

interface ProvisionBody {
  customer_id?: string;
  domain?: string;
  paid_tier?: string;
  period_end?: number | null;
  config?: CustomerConfig;
}

function jsonError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error, ...(extra ?? {}) }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function slugErrorCode(e: SlugError): string {
  return e.kind;
}

const VALID_TIERS = new Set(['implementation', 'autopilot', 'concierge']);

export async function handleProvision(req: Request, env: Env): Promise<Response> {
  const authFail = requireInternalAuth(req, env);
  if (authFail) return authFail;
  if (req.method !== 'POST') {
    return jsonError(405, 'METHOD_NOT_ALLOWED');
  }

  let body: ProvisionBody;
  try {
    body = (await req.json()) as ProvisionBody;
  } catch {
    return jsonError(400, 'INVALID_JSON');
  }

  if (!body.customer_id || typeof body.customer_id !== 'string') {
    return jsonError(400, 'MISSING_CUSTOMER_ID');
  }
  if (!body.domain || typeof body.domain !== 'string') {
    return jsonError(400, 'MISSING_DOMAIN');
  }
  if (!body.paid_tier || !VALID_TIERS.has(body.paid_tier)) {
    return jsonError(400, 'INVALID_PAID_TIER');
  }
  if (body.paid_tier !== 'implementation' && (body.period_end === undefined || body.period_end === null)) {
    return jsonError(400, 'PERIOD_END_REQUIRED_FOR_SUBSCRIPTION');
  }
  if (!body.config || typeof body.config !== 'object') {
    return jsonError(400, 'MISSING_CONFIG');
  }
  if (body.config._schema_version !== '1.0') {
    return jsonError(400, 'INVALID_SCHEMA_VERSION');
  }

  const now = Math.floor(Date.now() / 1000);
  const periodEnd = body.paid_tier === 'implementation' ? null : (body.period_end as number);
  const configJson = JSON.stringify(body.config);

  // Lookup existing row by customer_id.
  const existing = await env.CUSTOMER_DB
    .prepare('SELECT * FROM customers WHERE customer_id = ? LIMIT 1')
    .bind(body.customer_id)
    .first<Customer>();

  let slug: string;
  let operation: 'inserted' | 'updated_renewal' | 'updated_reactivated';

  if (!existing) {
    // INSERT branch — run slug validator + INSERT
    const slugResult = await generateSlug(body.domain, env.CUSTOMER_DB);
    if (!slugResult.ok) {
      return jsonError(400, slugErrorCode(slugResult.error));
    }
    slug = slugResult.slug;
    await env.CUSTOMER_DB
      .prepare(
        `INSERT INTO customers (slug, customer_id, domain, paid_tier, status, period_end, created_at, updated_at, config_json)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      )
      .bind(slug, body.customer_id, body.domain, body.paid_tier, periodEnd, now, now, configJson)
      .run();
    operation = 'inserted';
  } else {
    // UPDATE branch — keep slug + domain, update period_end + config + status + tier
    slug = existing.slug;
    operation =
      existing.status === 'active' ? 'updated_renewal' : 'updated_reactivated';
    await env.CUSTOMER_DB
      .prepare(
        `UPDATE customers
         SET status='active', period_end = ?, config_json = ?, paid_tier = ?, updated_at = ?
         WHERE customer_id = ?`,
      )
      .bind(periodEnd, configJson, body.paid_tier, now, body.customer_id)
      .run();
  }

  await invalidateCustomerCache(slug, env);

  return new Response(
    JSON.stringify({
      customer_slug: slug,
      mcp_url: `https://${slug}.mcp.astrant.io/mcp`,
      well_known_url: `https://${slug}.mcp.astrant.io/.well-known/mcp.json`,
      operation,
      provisioned_at: now,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
