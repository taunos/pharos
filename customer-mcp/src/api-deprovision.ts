import type { Env } from './types';
import { requireInternalAuth } from './auth';
import { invalidateCustomerCache } from './config';

interface DeprovisionBody {
  customer_id?: string;
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleDeprovision(req: Request, env: Env): Promise<Response> {
  const authFail = requireInternalAuth(req, env);
  if (authFail) return authFail;
  if (req.method !== 'POST') {
    return jsonError(405, 'METHOD_NOT_ALLOWED');
  }

  let body: DeprovisionBody;
  try {
    body = (await req.json()) as DeprovisionBody;
  } catch {
    return jsonError(400, 'INVALID_JSON');
  }
  if (!body.customer_id || typeof body.customer_id !== 'string') {
    return jsonError(400, 'MISSING_CUSTOMER_ID');
  }

  const row = await env.CUSTOMER_DB
    .prepare('SELECT slug, paid_tier FROM customers WHERE customer_id = ? LIMIT 1')
    .bind(body.customer_id)
    .first<{ slug: string; paid_tier: string }>();

  if (!row) {
    return jsonError(404, 'CUSTOMER_NOT_FOUND');
  }
  if (row.paid_tier === 'implementation') {
    return jsonError(400, 'DEPROVISION_NOT_APPLICABLE_TO_IMPLEMENTATION');
  }

  const now = Math.floor(Date.now() / 1000);
  await env.CUSTOMER_DB
    .prepare(`UPDATE customers SET status='cancelled', updated_at = ? WHERE customer_id = ?`)
    .bind(now, body.customer_id)
    .run();

  await invalidateCustomerCache(row.slug, env);

  return new Response(
    JSON.stringify({ deprovisioned_at: now, slug: row.slug }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
