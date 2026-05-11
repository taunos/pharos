import type { Env } from './types';

export async function runSweep(
  env: Env,
): Promise<{ hard_deleted: number; expired: number; swept_at: number }> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 30 * 86400;

  const deleteResult = await env.CUSTOMER_DB.prepare(
    `DELETE FROM customers WHERE status='cancelled' AND period_end < ?`,
  )
    .bind(cutoff)
    .run();

  const expireResult = await env.CUSTOMER_DB.prepare(
    `UPDATE customers SET status='expired', updated_at=? WHERE status='active' AND period_end < ? AND paid_tier IN ('autopilot', 'concierge')`,
  )
    .bind(now, now)
    .run();

  return {
    hard_deleted: deleteResult.meta?.changes ?? 0,
    expired: expireResult.meta?.changes ?? 0,
    swept_at: now,
  };
}
