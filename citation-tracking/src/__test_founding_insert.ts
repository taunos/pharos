// citation-tracking/src/__test_founding_insert.ts
// F-Fnd D3 case 7: concurrent INSERT smoke test.
// env.ENV !== 'local' guard via the [env.dev] block's vars binding.
// Production wrangler deploy uses top-level config (no ENV) — endpoint 404s.
// Belt-and-suspenders: router wiring also gates on env.ENV === 'local'.

export async function handleTestFoundingInsert(req: Request, env: any): Promise<Response> {
  if (env.ENV !== 'local') {
    return new Response('Not found', { status: 404 });
  }
  const url = new URL(req.url);
  const customerId = url.searchParams.get('customer_id');
  if (!customerId) return new Response('missing customer_id', { status: 400 });

  const nowSec = Math.floor(Date.now() / 1000);

  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO founding_customers
      (customer_id, founding_status, founding_assigned_at, founding_tier_locks, created_at, updated_at)
    VALUES (?, 'active', ?, '{"standard": 14900}', ?, ?)
  `).bind(customerId, nowSec, nowSec, nowSec).run();

  return new Response(JSON.stringify({ inserted: result.meta.changes, customerId }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
