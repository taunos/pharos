import type { Customer, Env } from './types';

const CACHE_KEY_PREFIX = 'customer-config:v1:';
const CACHE_TTL_SECONDS = 300;

export async function getCustomerFromCacheOrD1(
  slug: string,
  env: Env,
): Promise<Customer | null> {
  const cacheKey = `${CACHE_KEY_PREFIX}${slug}`;
  const cached = await env.CONFIG_CACHE.get(cacheKey);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as Customer;
    } catch (_e) {
      // Corrupt cache entry — fall through to D1.
    }
  }
  const row = await env.CUSTOMER_DB
    .prepare('SELECT * FROM customers WHERE slug = ? LIMIT 1')
    .bind(slug)
    .first<Customer>();
  if (!row) return null;
  await env.CONFIG_CACHE.put(cacheKey, JSON.stringify(row), {
    expirationTtl: CACHE_TTL_SECONDS,
  });
  return row;
}

export async function invalidateCustomerCache(slug: string, env: Env): Promise<void> {
  await env.CONFIG_CACHE.delete(`${CACHE_KEY_PREFIX}${slug}`);
}
