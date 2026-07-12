import type { Env } from "./types";

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Privacy (OD#7): pseudonymize the IP with a keyed HMAC (not a plain hash —
// IPv4 hashes are enumerable). Normalizes the input; same IP → same key, so
// rate-limiting is unchanged, but no raw IP is stored at rest in KV.
async function hmacHex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkRateLimit(
  env: Env,
  ip: string,
  url: string
): Promise<{ allowed: boolean; reason?: string; misconfigured?: boolean }> {
  // Fail closed: without the hash secret we cannot pseudonymize the IP, so we
  // must not key on the raw value. Deny — but signal misconfiguration so the
  // caller returns 503, not a misleading 429.
  if (!env.RATE_LIMIT_HASH_SECRET) {
    return { allowed: false, reason: "Rate limiting temporarily unavailable", misconfigured: true };
  }
  const today = new Date().toISOString().slice(0, 10);
  const normIp = ip.trim().toLowerCase();
  const ipKey = `rl:ip:${await hmacHex(env.RATE_LIMIT_HASH_SECRET, normIp)}:${today}`;
  const urlKey = `rl:url:${await sha256(url)}:${today}`;

  const ipCount = parseInt((await env.CACHE.get(ipKey)) ?? "0", 10);
  const urlCount = parseInt((await env.CACHE.get(urlKey)) ?? "0", 10);

  if (ipCount >= 5) return { allowed: false, reason: "Rate limit: 5 scans per IP per day" };
  if (urlCount >= 3) return { allowed: false, reason: "Rate limit: 3 scans per URL per day" };

  await Promise.all([
    env.CACHE.put(ipKey, String(ipCount + 1), { expirationTtl: 90000 }),
    env.CACHE.put(urlKey, String(urlCount + 1), { expirationTtl: 90000 }),
  ]);

  return { allowed: true };
}

export async function urlHash(url: string): Promise<string> {
  return sha256(url);
}
