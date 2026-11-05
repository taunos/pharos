// citation-tracking/test/digest-delivery.test.ts
// Monthly digest delivery error handling (code-quality audit 2026-11-05):
//  1. sendDigestEmail rejects when Resend v6 returns { error } (it resolves, never throws).
//  2. One failing digest no longer aborts the rest of the monthly run; the operator gets one alert.
// Invoked via: tsx test/digest-delivery.test.ts (matches cadence.test.ts convention).

import { sendDigestEmail } from '../src/digest-email';
import worker from '../src/index';

let passCount = 0;
let failCount = 0;
function assert(condition: boolean, name: string): void {
  if (condition) {
    passCount++;
    console.log(`PASS: ${name}`);
  } else {
    failCount++;
    console.log(`FAIL: ${name}`);
  }
}

const realFetch = globalThis.fetch;

(async () => {
  // ── 1. Resend { error } surfaces as a rejection ─────────────────────────
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ statusCode: 422, name: 'validation_error', message: 'bad from' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
  let threw: unknown = null;
  try {
    await sendDigestEmail({ RESEND_API_KEY: 're_test' }, 'cus_1', 'a@example.com', '# Digest\n', new Uint8Array([37, 80, 68, 70]), 1767225600);
  } catch (e) {
    threw = e;
  }
  assert(threw instanceof Error && /validation_error/.test((threw as Error).message), 'Resend {error} → sendDigestEmail rejects');

  // ── 2. Monthly run continues past a failing digest; one operator alert ──
  const alerts: string[] = [];
  globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
    if (String(u) === 'https://api.resend.com/emails') alerts.push(String(init?.body ?? ''));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (/MIN\(timestamp\)/.test(sql)) return { min_ts: null };
          throw new Error('D1 down');
        },
        async all() {
          if (/FROM customer_probe_targets cpt/.test(sql)) {
            return {
              results: [
                { customer_id: 'cus_a', brand_name: 'A', customer_email: 'a@x.com', current_period_start: null, subscription_id: null },
                { customer_id: 'cus_b', brand_name: 'B', customer_email: 'b@x.com', current_period_start: null, subscription_id: null },
              ],
            };
          }
          throw new Error('D1 down');
        },
        async run() {
          throw new Error('D1 down');
        },
      };
      return stmt;
    },
  };
  const env = { DB: db, PROBES_MODE: 'on', RESEND_API_KEY: 're_test', OPERATOR_ALERT_TO: 'op@example.com' } as never;
  let scheduledThrew = false;
  const origErr = console.error;
  console.error = () => {};
  try {
    await worker.scheduled({ cron: '0 14 1 * *', scheduledTime: Date.UTC(2026, 10, 1, 14) } as ScheduledEvent, env, {} as ExecutionContext);
  } catch {
    scheduledThrew = true;
  } finally {
    console.error = origErr;
  }
  assert(!scheduledThrew, 'monthly digest run does not throw when every digest fails');
  assert(alerts.length === 1 && /DIGEST_FAILURES count=3/.test(alerts[0]) && /cus_a,cus_b/.test(alerts[0]), 'one operator alert lists Astrant + both customers');

  globalThis.fetch = realFetch;
  console.log(`=== digest-delivery ts-tests: ${passCount} PASS, ${failCount} FAIL ===`);
  if (failCount > 0) process.exit(1);
})();
