// E15 (code-quality audit 2026-11-05): IPv6 rate limits key on the /64; IPv4
// keys are byte-identical to the pre-E15 key. Shared table in
// parity/ip-rate-limit-key-cases.json (marketing-site and mcp-server run it too).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkBurstLimit, checkRateLimit, rateLimitIpKey } from "./ratelimit";

const { cases }: { cases: [string, string][] } = JSON.parse(
  readFileSync(new URL("../../parity/ip-rate-limit-key-cases.json", import.meta.url), "utf8")
);

async function hmacHex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function kvEnv() {
  const kv = new Map<string, string>();
  const env = {
    RATE_LIMIT_HASH_SECRET: "s",
    CACHE: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) },
  };
  return { kv, env: env as never };
}

describe("rateLimitIpKey (shared parity table)", () => {
  it.each(cases)("%j -> %j", (input, expected) => {
    expect(rateLimitIpKey(input)).toBe(expected);
  });
});

describe("E15: IPv6 /64 keying in the scan limits", () => {
  it("IPv4 KV key is byte-identical to the pre-E15 key", async () => {
    const { kv, env } = kvEnv();
    await checkRateLimit(env, " 203.0.113.7 ", "https://example.com/");
    const today = new Date().toISOString().slice(0, 10);
    // Pre-E15: rl:ip:<hmac(secret, ip.trim().toLowerCase())>:<day>
    expect([...kv.keys()]).toContain(`rl:ip:${await hmacHex("s", "203.0.113.7")}:${today}`);
  });

  it("five scans from one /64 exhaust the per-IP budget for the whole /64", async () => {
    const { env } = kvEnv();
    const results = [];
    for (let i = 1; i <= 6; i++) {
      results.push((await checkRateLimit(env, `2001:db8:1:2::${i}`, `https://example${i}.com/`)).allowed);
    }
    expect(results).toEqual([true, true, true, true, true, false]);
    // A different /64 still has its own budget.
    expect((await checkRateLimit(env, "2001:db8:1:3::1", "https://other.com/")).allowed).toBe(true);
  });

  it("burst limiter keys IPv6 on the /64 and IPv4 unchanged", async () => {
    const calls: string[] = [];
    const limiter = { limit: async ({ key }: { key: string }) => (calls.push(key), { success: true }) };
    await checkBurstLimit(limiter, "2001:DB8:1:2:aaaa::1");
    await checkBurstLimit(limiter, "203.0.113.7");
    await checkBurstLimit(limiter, "::ffff:203.0.113.7");
    expect(calls).toEqual(["scan:2001:db8:1:2::/64", "scan:203.0.113.7", "scan:203.0.113.7"]);
  });
});
