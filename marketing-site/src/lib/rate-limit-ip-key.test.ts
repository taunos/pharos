// E15 (code-quality audit 2026-11-05): IPv6 rate limits key on the /64; IPv4
// keys are byte-identical to the pre-E15 key. Shared table in
// parity/ip-rate-limit-key-cases.json (scanner and mcp-server run it too).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkTriageIpRateLimit, hmacIp, rateLimitIpKey } from "./rate-limit-kv";

const { cases }: { cases: [string, string][] } = JSON.parse(
  readFileSync(new URL("../../../parity/ip-rate-limit-key-cases.json", import.meta.url), "utf8")
);

async function preE15Hmac(secret: string, ip: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip.trim().toLowerCase()));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function memKv() {
  const m = new Map<string, string>();
  const kv = {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
  } as unknown as KVNamespace;
  return { m, kv };
}

describe("rateLimitIpKey (shared parity table)", () => {
  it.each(cases)("%j -> %j", (input, expected) => {
    expect(rateLimitIpKey(input)).toBe(expected);
  });
});

describe("E15: hmacIp keys IPv6 on the /64, IPv4 unchanged", () => {
  it("IPv4 hash is byte-identical to the pre-E15 hash", async () => {
    for (const ip of ["203.0.113.5", " 198.51.100.1 ", "unknown"]) {
      expect(await hmacIp("s", ip)).toBe(await preE15Hmac("s", ip));
    }
  });
  it("every address in one /64 shares a hash; another /64 does not", async () => {
    const a = await hmacIp("s", "2001:db8:1:2::1");
    expect(await hmacIp("s", "2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(a);
    expect(await hmacIp("s", "2001:db8:1:3::1")).not.toBe(a);
  });
  it("a v4-mapped address shares its IPv4 budget", async () => {
    expect(await hmacIp("s", "::ffff:203.0.113.5")).toBe(await hmacIp("s", "203.0.113.5"));
  });
  it("rotating addresses inside one /64 cannot dodge the triage limit", async () => {
    const { kv } = memKv();
    const allowed = [];
    for (let i = 1; i <= 11; i++) allowed.push((await checkTriageIpRateLimit(kv, `2001:db8:1:2::${i.toString(16)}`, "s")).allowed);
    expect(allowed.filter(Boolean)).toHaveLength(10);
    expect(allowed[10]).toBe(false);
  });
});
