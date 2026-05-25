// F-Fnd one-shot backfill endpoint. Gated by INTERNAL_FULFILL_KEY.
// Inserts founding_customers rows for in-window active Standard + Pro subscriptions.

import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { constantTimeEqual } from '@/lib/dodo';
import type { D1Database } from '@cloudflare/workers-types';

export const dynamic = 'force-dynamic';

interface FoundingBackfillEnv {
  INTERNAL_FULFILL_KEY: string;
  CITATION_DB: D1Database;
  STANDARD_PRODUCT_ID: string;
  PRO_PRODUCT_ID: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const env = getCloudflareContext().env as unknown as FoundingBackfillEnv;
  const provided = req.headers.get('x-internal-fulfill-key');
  if (!env.INTERNAL_FULFILL_KEY || !provided ||
      !constantTimeEqual(provided, env.INTERNAL_FULFILL_KEY)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const standardProductId = env.STANDARD_PRODUCT_ID;
  const proProductId = env.PRO_PRODUCT_ID;

  const result = await env.CITATION_DB.prepare(`
    INSERT OR IGNORE INTO founding_customers (
      customer_id, founding_status, founding_assigned_at, founding_tier_locks,
      created_at, updated_at
    )
    SELECT
      s.customer_id,
      'active',
      s.created_at,
      CASE
        WHEN s.product_id = ?1 THEN '{"standard": 14900}'
        WHEN s.product_id = ?2 THEN '{"pro": 89900}'
        ELSE NULL
      END,
      s.created_at,
      strftime('%s','now')
    FROM subscriptions s
    WHERE s.status = 'active'
      AND s.product_id IN (?1, ?2)
      AND s.customer_id NOT IN ('astrant', 'ASTRANT')
    ORDER BY s.created_at ASC
  `).bind(standardProductId, proProductId).run();

  const counter = await env.CITATION_DB.prepare(
    'SELECT reserved_count, updated_at FROM founding_cohort_meta WHERE id = 1'
  ).first<{ reserved_count: number; updated_at: number }>();

  const rowCount = await env.CITATION_DB.prepare(
    'SELECT COUNT(*) AS n FROM founding_customers'
  ).first<{ n: number }>();

  const windowSubsCount = await env.CITATION_DB.prepare(`
    SELECT COUNT(*) AS n FROM subscriptions
    WHERE status = 'active' AND product_id IN (?1, ?2)
  `).bind(standardProductId, proProductId).first<{ n: number }>();

  return NextResponse.json({
    inserted: result.meta.changes,
    reserved_count: counter?.reserved_count,
    backfilled_at: counter?.updated_at,
    founding_rows: rowCount?.n,
    window_subs_count: windowSubsCount?.n,
    overflow: (windowSubsCount?.n ?? 0) > 30,
  });
}
