// H1 hygiene: provider health alert.
// After a probe cycle (one drained probe_run_id), any provider with 0 successful
// probe_runs and >0 failures fires ONE operator alert, deduped to at most one per
// provider per UTC day via the provider_health_alerts claim row (migration 0015).

import { sendOperatorAlert, type AlertEnv } from './alerts';

export interface ProviderHealthEnv extends AlertEnv {
  DB: D1Database;
}

type SendAlert = (env: AlertEnv, message: string) => Promise<void>;

// Error text comes from provider response bodies; keep it short and drop anything
// email- or credential-shaped before it goes into an email.
export function sanitizeSampleError(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[^\s@]+@[^\s@]+/g, '[redacted]')
    .replace(/[A-Za-z0-9_\-]{24,}/g, '[redacted]')
    .slice(0, 120);
}

export async function checkProviderHealth(
  env: ProviderHealthEnv,
  probeRunId: string,
  now: Date = new Date(),
  send: SendAlert = sendOperatorAlert,
): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT provider, status, error_message FROM probe_runs WHERE probe_run_id = ? ORDER BY id'
  ).bind(probeRunId).all<{ provider: string; status: string; error_message: string | null }>();

  const stats = new Map<string, { ok: number; failed: number; sample: string | null }>();
  for (const r of rows.results ?? []) {
    const s = stats.get(r.provider) ?? { ok: 0, failed: 0, sample: null };
    if (r.status === 'success') {
      s.ok++;
    } else {
      s.failed++;
      if (s.sample === null) s.sample = r.error_message ?? r.status;
    }
    stats.set(r.provider, s);
  }

  const alertDate = now.toISOString().slice(0, 10);
  const firedAt = Math.floor(now.getTime() / 1000);
  const alerted: string[] = [];

  for (const [provider, s] of stats) {
    if (s.ok > 0 || s.failed === 0) continue;

    const claim = await env.DB.prepare(
      'INSERT OR IGNORE INTO provider_health_alerts (provider, alert_date, fired_at) VALUES (?, ?, ?)'
    ).bind(provider, alertDate, firedAt).run();
    if (claim.meta.changes !== 1) continue; // already alerted today

    try {
      await send(env, `PROVIDER_CYCLE_ALL_FAILED provider=${provider} sample_error=${sanitizeSampleError(s.sample ?? '')}`);
      alerted.push(provider);
    } catch (err) {
      // Release the claim so a later cycle today can retry the alert.
      await env.DB.prepare(
        'DELETE FROM provider_health_alerts WHERE provider = ? AND alert_date = ? AND fired_at = ?'
      ).bind(provider, alertDate, firedAt).run();
      console.error(`PROVIDER_HEALTH_ALERT_THROW provider=${provider} error=${String(err)}`);
    }
  }

  return alerted;
}
