// F-Fnd library: tryAssignFoundingStatus + resolveTierFromProductId helpers.
// Spec pharos-founding-pricing-spec v5.1 §3 D5-D9 locked content.

import type { D1Database, D1Result } from '@cloudflare/workers-types';

export type AssignmentResult =
  | { kind: 'newly_assigned'; foundingOrderSeq: number; foundingTierLocks: Record<string, number> }
  | { kind: 'already_founder'; foundingOrderSeq: number; founding_status: 'active' | 'cancelled'; foundingTierLocks: Record<string, number> }
  | { kind: 'cohort_full' }
  | { kind: 'baseline_sentinel' }
  | { kind: 'feature_not_yet_enabled' };

export function resolveTierFromProductId(
  env: { STANDARD_PRODUCT_ID: string; PRO_PRODUCT_ID: string },
  productId: string,
): { tierKey: 'standard' | 'pro'; tierPriceCents: number } | null {
  if (productId === env.STANDARD_PRODUCT_ID) return { tierKey: 'standard', tierPriceCents: 14900 };
  if (productId === env.PRO_PRODUCT_ID) return { tierKey: 'pro', tierPriceCents: 89900 };
  return null;
}

function isTableNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message ?? '';
  return msg.includes('D1_ERROR') && msg.includes('no such table: founding_customers');
}

function hashCustomerIdSync(customerId: string): string {
  let hash = 5381;
  for (let i = 0; i < customerId.length; i++) {
    hash = ((hash << 5) + hash + customerId.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function logFeatureNotYetEnabled(customerId: string): void {
  console.warn(JSON.stringify({
    kind: 'F-Fnd feature_not_yet_enabled',
    customer_id_hash: hashCustomerIdSync(customerId),
    reason: 'founding_customers table missing',
    timestamp: Date.now(),
  }));
}

export async function tryAssignFoundingStatus(
  env: { CITATION_DB: D1Database },
  customerId: string,
  initialTierKey: 'standard' | 'pro',
  initialTierPriceCents: number,
): Promise<AssignmentResult> {
  if (customerId === 'astrant' || customerId === 'ASTRANT') {
    return { kind: 'baseline_sentinel' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const tierLocksJson = JSON.stringify({ [initialTierKey]: initialTierPriceCents });

  let result: D1Result;
  try {
    result = await env.CITATION_DB.prepare(`
      INSERT OR IGNORE INTO founding_customers
        (customer_id, founding_status, founding_assigned_at, founding_tier_locks,
         created_at, updated_at)
      VALUES (?, 'active', ?, ?, ?, ?)
    `).bind(customerId, nowSec, tierLocksJson, nowSec, nowSec).run();
  } catch (err) {
    if (isTableNotFoundError(err)) {
      logFeatureNotYetEnabled(customerId);
      return { kind: 'feature_not_yet_enabled' };
    }
    throw err;
  }

  if (result.meta.changes === 1) {
    const row = await env.CITATION_DB.prepare(
      'SELECT founding_order_seq, founding_tier_locks FROM founding_customers WHERE customer_id = ?'
    ).bind(customerId).first<{ founding_order_seq: number; founding_tier_locks: string }>();

    if (!row || row.founding_order_seq == null) {
      throw new Error(`F-Fnd assignment race: INSERT succeeded but row not found or seq null for ${customerId}`);
    }

    return {
      kind: 'newly_assigned',
      foundingOrderSeq: row.founding_order_seq,
      foundingTierLocks: JSON.parse(row.founding_tier_locks),
    };
  }

  const existing = await env.CITATION_DB.prepare(
    'SELECT founding_order_seq, founding_status, founding_tier_locks FROM founding_customers WHERE customer_id = ?'
  ).bind(customerId).first<{
    founding_order_seq: number;
    founding_status: 'active' | 'cancelled';
    founding_tier_locks: string;
  }>();

  if (existing) {
    return {
      kind: 'already_founder',
      foundingOrderSeq: existing.founding_order_seq,
      founding_status: existing.founding_status,
      foundingTierLocks: JSON.parse(existing.founding_tier_locks),
    };
  }

  return { kind: 'cohort_full' };
}
