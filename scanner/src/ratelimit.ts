import type { Env } from "./types";

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkRateLimit(
  env: Env,
  ip: string,
  url: string
): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const ipKey = `rl:ip:${ip}:${today}`;
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
