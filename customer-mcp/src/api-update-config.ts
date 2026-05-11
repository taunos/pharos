import type { Env, CustomerConfig } from './types';
import { requireInternalAuth } from './auth';
import { invalidateCustomerCache } from './config';

interface UpdateConfigBody {
  customer_id?: string;
  config?: Partial<CustomerConfig>;
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleUpdateConfig(req: Request, env: Env): Promise<Response> {
  const authFail = requireInternalAuth(req, env);
  if (authFail) return authFail;
  if (req.method !== 'POST') {
    return jsonError(405, 'METHOD_NOT_ALLOWED');
  }

  let body: UpdateConfigBody;
  try {
    body = (await req.json()) as UpdateConfigBody;
  } catch {
    return jsonError(400, 'INVALID_JSON');
  }
  if (!body.customer_id || typeof body.customer_id !== 'string') {
    return jsonError(400, 'MISSING_CUSTOMER_ID');
  }
  if (!body.config || typeof body.config !== 'object') {
    return jsonError(400, 'MISSING_CONFIG');
  }

  const row = await env.CUSTOMER_DB
    .prepare('SELECT slug, config_json FROM customers WHERE customer_id = ? LIMIT 1')
    .bind(body.customer_id)
    .first<{ slug: string; config_json: string }>();

  if (!row) {
    return jsonError(404, 'CUSTOMER_NOT_FOUND');
  }

  let existing: CustomerConfig;
  try {
    existing = JSON.parse(row.config_json) as CustomerConfig;
  } catch {
    return jsonError(500, 'STORED_CONFIG_CORRUPT');
  }

  // Shallow merge at top level: provided keys replace; omitted preserved.
  const merged: CustomerConfig = { ...existing, ...body.config };

  if (merged._schema_version !== '1.0') {
    return jsonError(400, 'INVALID_SCHEMA_VERSION');
  }

  const now = Math.floor(Date.now() / 1000);
  await env.CUSTOMER_DB
    .prepare(`UPDATE customers SET config_json = ?, updated_at = ? WHERE customer_id = ?`)
    .bind(JSON.stringify(merged), now, body.customer_id)
    .run();

  await invalidateCustomerCache(row.slug, env);

  return new Response(JSON.stringify({ updated_at: now }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
