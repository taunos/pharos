// Slice 2b Phase 1 — KV-backed rate limiting helpers.
//
// Used for /api/score/delete-me throttles:
//   - Per source IP: 3/hour, 10/day.
//   - Per target email (hashed): 1/hour, 3/day.
//
// KV consistency caveat (acknowledged): Cloudflare KV writes propagate
// ~60s worst-case across edges. A burst-refresher hitting two edges
// simultaneously may briefly exceed the nominal limit. Acceptable for v1
// because limits are anti-abuse not anti-DoS — a brief 2x burst is still
// ~10x lower than what a real attacker would need to be effective. For
// tighter limits in a future slice, the right Cloudflare primitive is
// Workers Rate Limiting (`unsafe.bindings.ratelimit`) or a Durable Object
// counter — both are overkill for v1. Documented in DEPLOY.md.

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec?: number;
}

interface CounterValue {
  count: number;
  resetAt: number; // unix seconds
}

async function checkAndIncrement(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  let counter: CounterValue;
  try {
    const raw = await kv.get(key);
    if (raw) {
      const parsed = JSON.parse(raw) as CounterValue;
      if (parsed.resetAt > now) {
        counter = parsed;
      } else {
        counter = { count: 0, resetAt: now + windowSec };
      }
    } else {
      counter = { count: 0, resetAt: now + windowSec };
    }
  } catch {
    counter = { count: 0, resetAt: now + windowSec };
  }

  if (counter.count >= limit) {
    return { allowed: false, retryAfterSec: counter.resetAt - now };
  }

  counter.count += 1;
  try {
    await kv.put(key, JSON.stringify(counter), {
      expirationTtl: windowSec + 60, // small grace
    });
  } catch {
    // KV hiccup — let request through (fail-open, anti-abuse not anti-DoS)
  }
  return { allowed: true };
}

// Phase 1.5 hardening (F-12) — triage-route rate limiting.
//   - Per-IP: 10 requests / fixed hourly bucket (YYYY-MM-DD-HH UTC).
//     Worst-case 20 requests in 2 minutes at hour boundary; acceptable v1.
//   - Per-canonical-submission: 1-hour cooldown (limit 1/hour on the
//     canonical hash from triageCacheKey).
// Both wrap the existing `checkAndIncrement` primitive and piggyback on
// the marketing-site `TRIAGE_CACHE` KV namespace with `rl:triage:` prefixes.

function utcHourBucket(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}`;
}

export async function checkTriageIpRateLimit(
  kv: KVNamespace,
  ip: string
): Promise<RateLimitResult> {
  const key = `rl:triage:ip:${ip}:${utcHourBucket()}`;
  return checkAndIncrement(kv, key, 10, 3600);
}

export async function checkTriageCanonicalRateLimit(
  kv: KVNamespace,
  canonicalHash: string
): Promise<RateLimitResult> {
  const key = `rl:triage:canon:${canonicalHash}`;
  return checkAndIncrement(kv, key, 1, 3600);
}

export async function checkDeleteMeRateLimit(
  kv: KVNamespace,
  ip: string,
  emailLogHash: string
): Promise<RateLimitResult> {
  // Strictest applicable limit wins.
  const checks: Array<{ key: string; limit: number; windowSec: number }> = [
    { key: `dl:email:${emailLogHash}:hr`, limit: 1, windowSec: 3600 },
    { key: `dl:email:${emailLogHash}:day`, limit: 3, windowSec: 86400 },
    { key: `dl:ip:${ip}:hr`, limit: 3, windowSec: 3600 },
    { key: `dl:ip:${ip}:day`, limit: 10, windowSec: 86400 },
  ];

  // Check all; only increment if all are under the limit. Two-pass to
  // avoid spurious increments when one window blocks.
  const now = Math.floor(Date.now() / 1000);
  let blockedRetry: number | null = null;
  for (const c of checks) {
    try {
      const raw = await kv.get(c.key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as CounterValue;
      if (parsed.resetAt > now && parsed.count >= c.limit) {
        const retry = parsed.resetAt - now;
        if (blockedRetry === null || retry > blockedRetry) {
          blockedRetry = retry;
        }
      }
    } catch {
      // continue
    }
  }
  if (blockedRetry !== null) {
    return { allowed: false, retryAfterSec: blockedRetry };
  }

  // All under limit — increment each (best-effort).
  for (const c of checks) {
    await checkAndIncrement(kv, c.key, c.limit, c.windowSec);
  }
  return { allowed: true };
}
