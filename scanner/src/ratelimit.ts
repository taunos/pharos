import type { Env } from "./types";
import { constantTimeEqual } from "./auth";

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

/**
 * E15 (code-quality audit 2026-11-05): the IP part of every rate-limit key.
 * One customer usually holds a whole IPv6 /64, so IPv6 keys on that prefix
 * (expanded, lowercased: "2001:db8:1:2::/64"); a v4-mapped IPv6 address keys
 * as its IPv4. Everything else, IPv4 included, keeps the pre-E15 key
 * ip.trim().toLowerCase(), so existing counters stay valid. Copies in
 * marketing-site rate-limit-kv.ts and mcp-server site-fetch.ts follow
 * parity/ip-rate-limit-key-cases.json.
 */
export function rateLimitIpKey(ip: string): string {
  const s = ip.trim().toLowerCase();
  if (!s.includes(":")) return s;
  let host: string;
  try {
    host = new URL(`http://[${s}]/`).hostname.slice(1, -1);
  } catch {
    return s;
  }
  // The URL serializer gives the compressed form with hex groups only.
  const [head, tail] = host.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
    const hi = parseInt(groups[6] ?? "0", 16);
    const lo = parseInt(groups[7] ?? "0", 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
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
  const normIp = rateLimitIpKey(ip);
  const ipKey = `rl:ip:${await hmacHex(env.RATE_LIMIT_HASH_SECRET, normIp)}:${today}`;
  // Security pass 2026-11-04: key the per-URL limit on origin + path, so
  // distinct query strings / fragments can't each get a fresh 3/day budget.
  const urlKey = `rl:url:${await sha256(urlLimitKey(url))}:${today}`;

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

/** origin + path (no query, no fragment). The URL parser lowercases the host. */
export function urlLimitKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** The scan-cache identity: the URL without its fragment (never sent to the site, so it can't change the result). */
export function urlCacheKey(url: string): string {
  const i = url.indexOf("#");
  return i < 0 ? url : url.slice(0, i);
}

/** A bare IPv4 (dotted quad, 0-255, no leading zeros) or IPv6 literal. */
export function isIpLiteral(s: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) return v4.slice(1).every((o) => Number(o) <= 255 && (o === "0" || !o.startsWith("0")));
  if (!s.includes(":") || !/^[0-9a-fA-F:.]{2,45}$/.test(s)) return false;
  try {
    new URL(`http://[${s}]/`);
    return true;
  } catch {
    return false;
  }
}

/**
 * The rate-limit identity. The marketing proxy (astrant.io /api/scan) is a
 * cross-zone Worker subrequest, so Cloudflare replaces its CF-Connecting-IP
 * with one shared Worker address; the proxy forwards the real client IP in
 * x-astrant-client-ip, authenticated by x-astrant-proxy-key. The forwarded IP
 * is used only when that key passes the constant-time check AND the value is
 * an IP literal; otherwise our own CF-Connecting-IP. Identity only, never tier.
 */
export function limiterIdentity(
  secret: string | undefined,
  connectingIp: string | undefined,
  proxyKey: string | undefined,
  forwardedIp: string | undefined
): string {
  const fwd = forwardedIp?.trim() ?? "";
  if (secret && proxyKey && constantTimeEqual(proxyKey, secret) && isIpLiteral(fwd)) return fwd;
  return connectingIp ?? "unknown";
}

export interface RateLimitBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/**
 * First gate on POST /api/scan: the Cloudflare Rate Limiting binding. It is
 * best-effort (per Cloudflare location, approximate and eventually
 * consistent), so it blunts bursts rather than enforcing an exact count;
 * the KV read-modify-write limits stay behind it. true = allowed.
 * Fails open (logged) only when the binding is absent or errors; the KV
 * limits still apply behind it.
 */
export async function checkBurstLimit(
  limiter: RateLimitBinding | undefined,
  ip: string
): Promise<boolean> {
  if (!limiter) {
    console.error("[scan] SCAN_RATE_LIMITER binding missing; failing open to the KV limits");
    return true;
  }
  try {
    const { success } = await limiter.limit({ key: `scan:${rateLimitIpKey(ip)}` });
    return success;
  } catch (e) {
    console.error("[scan] SCAN_RATE_LIMITER errored; failing open to the KV limits:", e instanceof Error ? e.message : String(e));
    return true;
  }
}

export async function urlHash(url: string): Promise<string> {
  return sha256(url);
}
