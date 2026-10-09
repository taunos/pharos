// citation-tracking/test/provider-health.test.ts
// H1 hygiene -- PROVIDER_CYCLE_ALL_FAILED alert + per-provider per-UTC-day dedupe.
// Invoked via: npx tsx test/provider-health.test.ts

import { checkProviderHealth, sanitizeSampleError } from '../src/provider-health';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`PASS: ${name}`);
    passCount++;
  } else {
    console.log(`FAIL: ${name}`);
    failCount++;
  }
}

type Row = { probe_run_id: string; provider: string; status: string; error_message: string | null };

// Minimal fake D1 covering the three statements provider-health.ts issues.
function makeEnv(rows: Row[]) {
  const ledger = new Set<string>();
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async all() {
              if (!sql.startsWith('SELECT provider, status, error_message FROM probe_runs')) throw new Error(`unexpected all: ${sql}`);
              return { results: rows.filter((r) => r.probe_run_id === args[0]) };
            },
            async run() {
              const key = `${args[0]}|${args[1]}`;
              if (sql.startsWith('INSERT OR IGNORE INTO provider_health_alerts')) {
                if (ledger.has(key)) return { meta: { changes: 0 } };
                ledger.add(key);
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith('DELETE FROM provider_health_alerts')) {
                const had = ledger.delete(key);
                return { meta: { changes: had ? 1 : 0 } };
              }
              throw new Error(`unexpected run: ${sql}`);
            },
          };
        },
      };
    },
  };
  return { env: { DB: db as unknown as D1Database, RESEND_API_KEY: 'x', OPERATOR_ALERT_TO: 'ops@example.test' }, ledger };
}

function cycle(runId: string, spec: Record<string, { ok: number; failed: number; err?: string }>): Row[] {
  const out: Row[] = [];
  for (const [provider, s] of Object.entries(spec)) {
    for (let i = 0; i < s.ok; i++) out.push({ probe_run_id: runId, provider, status: 'success', error_message: null });
    for (let i = 0; i < s.failed; i++) out.push({ probe_run_id: runId, provider, status: 'error', error_message: s.err ?? 'boom' });
  }
  return out;
}

function recorder() {
  const sent: string[] = [];
  return { sent, send: async (_env: unknown, msg: string) => { sent.push(msg); } };
}

const day1 = new Date(Date.UTC(2026, 9, 8, 2, 10, 0));
const day1Later = new Date(Date.UTC(2026, 9, 8, 23, 50, 0));
const day2 = new Date(Date.UTC(2026, 9, 9, 2, 10, 0));

(async () => {
  // Case 1: all-fail provider -> exactly one alert with the expected code.
  {
    const { env } = makeEnv(cycle('r1', {
      openai: { ok: 45, failed: 0 },
      gemini: { ok: 0, failed: 45, err: '{"error":{"code":429,"message":"Resource exhausted"}}' },
    }));
    const r = recorder();
    const alerted = await checkProviderHealth(env, 'r1', day1, r.send);
    assert(alerted.length === 1 && alerted[0] === 'gemini', 'case1 all-fail provider alerted');
    assert(r.sent.length === 1, 'case1 exactly one alert sent');
    assert(r.sent[0] === 'PROVIDER_CYCLE_ALL_FAILED provider=gemini sample_error={"error":{"code":429,"message":"Resource exhausted"}}', 'case1 alert message shape');
  }

  // Case 2: partial success -> no alert.
  {
    const { env } = makeEnv(cycle('r2', {
      openai: { ok: 1, failed: 44 },
      anthropic: { ok: 45, failed: 0 },
    }));
    const r = recorder();
    const alerted = await checkProviderHealth(env, 'r2', day1, r.send);
    assert(alerted.length === 0 && r.sent.length === 0, 'case2 partial success no alert');
  }

  // Case 3: second cycle same UTC day -> no duplicate; next UTC day -> alerts again.
  {
    const rows = [
      ...cycle('r3a', { perplexity: { ok: 0, failed: 45 } }),
      ...cycle('r3b', { perplexity: { ok: 0, failed: 45 } }),
      ...cycle('r3c', { perplexity: { ok: 0, failed: 45 } }),
    ];
    const { env } = makeEnv(rows);
    const r = recorder();
    await checkProviderHealth(env, 'r3a', day1, r.send);
    await checkProviderHealth(env, 'r3b', day1Later, r.send);
    assert(r.sent.length === 1, 'case3 second cycle same day no duplicate');
    await checkProviderHealth(env, 'r3c', day2, r.send);
    assert(r.sent.length === 2, 'case3 next UTC day alerts again');
  }

  // Case 4: send throws -> claim released, a later cycle the same day retries.
  {
    const rows = [
      ...cycle('r4a', { openai: { ok: 0, failed: 45 } }),
      ...cycle('r4b', { openai: { ok: 0, failed: 45 } }),
    ];
    const { env, ledger } = makeEnv(rows);
    const origError = console.error;
    console.error = () => {};
    const alerted = await checkProviderHealth(env, 'r4a', day1, async () => { throw new Error('Resend 500'); });
    console.error = origError;
    assert(alerted.length === 0 && ledger.size === 0, 'case4 throw releases claim');
    const r = recorder();
    await checkProviderHealth(env, 'r4b', day1Later, r.send);
    assert(r.sent.length === 1, 'case4 retry same day after throw');
  }

  // Case 5: no rows for provider / empty cycle -> no alert.
  {
    const { env } = makeEnv([]);
    const r = recorder();
    await checkProviderHealth(env, 'missing', day1, r.send);
    assert(r.sent.length === 0, 'case5 empty cycle no alert');
  }

  // Case 6: sample_error sanitization (120-char cap, email + token redaction, whitespace collapse).
  {
    assert(sanitizeSampleError('x'.repeat(10) + ' ' + 'a b'.repeat(100)).length === 120, 'case6 capped at 120 chars');
    assert(sanitizeSampleError('bad key for user@example.com').includes('[redacted]') && !sanitizeSampleError('bad key for user@example.com').includes('@'), 'case6 email redacted');
    assert(!sanitizeSampleError('Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuvwxyz0123').includes('abcdefghijklmnop'), 'case6 token redacted');
    assert(sanitizeSampleError('line1\n  line2') === 'line1 line2', 'case6 whitespace collapsed');
  }

  console.log(`=== provider-health ts-tests: ${passCount} PASS, ${failCount} FAIL ===`);
  if (failCount > 0) process.exit(1);
})();
