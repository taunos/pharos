// E8 + E11 (code-quality audit 2026-11-05).
// E8: the ScanRpc Service Binding entrypoint keys the scan budget on the
// end-user IP the caller passes, through the same limits as POST /api/scan.
// E11: x-astrant-proxy-key is authenticated by SCAN_PROXY_KEY (fallback to
// INTERNAL_FULFILL_KEY only while SCAN_PROXY_KEY is unset), and that key
// never grants the paid tier.
import { describe, it, expect, vi, afterEach } from "vitest";
import app, { ScanRpc } from "./index";
import { rpcScan, INVALID_SCAN_INPUT, type ScanRpcResponse } from "./scan-rpc";
import { proxyTrustKey } from "./ratelimit";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockLimiter(limit: number) {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  return {
    calls,
    limit: async ({ key }: { key: string }) => {
      calls.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
}

function makeEnv(extra: Record<string, unknown> = {}, limit = 100) {
  const kv = new Map<string, string>();
  const kvOps: string[] = [];
  const d1Calls: string[] = [];
  const limiter = mockLimiter(limit);
  const env = {
    RATE_LIMIT_HASH_SECRET: "rl-secret",
    SCAN_RATE_LIMITER: limiter,
    AI: { run: async () => ({ response: "50" }) },
    CACHE: {
      get: async (k: string) => {
        kvOps.push("get:" + k);
        return kv.get(k) ?? null;
      },
      put: async (k: string, v: string) => {
        kvOps.push("put:" + k);
        kv.set(k, v);
      },
    },
    DB: {
      prepare(sql: string) {
        d1Calls.push(sql);
        return { bind: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }) }) };
      },
    },
    ...extra,
  };
  return { env: env as never, kvOps, d1Calls, limiter };
}

function stub404() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
}

const ipKvKeys = (kvOps: string[]) => new Set(kvOps.filter((k) => k.startsWith("get:rl:ip:")));

describe("E8: ScanRpc entrypoint", () => {
  const entrypoint = (env: never) => new (ScanRpc as unknown as new (c: unknown, e: unknown) => ScanRpc)({}, env);

  it("is exported from index as a named entrypoint, not part of the public fetch handler", () => {
    expect(typeof ScanRpc).toBe("function");
    expect((app as unknown as Record<string, unknown>).scan).toBeUndefined();
  });

  it("keys the burst gate and the KV daily limit on the forwarded end-user IP: two IPs, two budgets", async () => {
    stub404();
    const { env, limiter, kvOps } = makeEnv();
    const ep = entrypoint(env);
    const statuses: number[] = [];
    // 5 scans per IP per day; distinct paths keep the 3/URL limit out of the way.
    for (let i = 0; i < 6; i++) statuses.push((await ep.scan(`https://example.com/a${i}`, "198.51.100.1")).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    const second = await ep.scan("https://example.com/b", "198.51.100.2");
    expect(second.status).toBe(200);
    expect(limiter.calls.slice(-1)).toEqual(["scan:198.51.100.2"]);
    expect(new Set(limiter.calls)).toEqual(new Set(["scan:198.51.100.1", "scan:198.51.100.2"]));
    expect(ipKvKeys(kvOps).size).toBe(2);
  });

  it("returns the same 429 body as the public route when the IP is over its daily budget", async () => {
    stub404();
    const { env } = makeEnv();
    let last: ScanRpcResponse | undefined;
    for (let i = 0; i < 6; i++) last = await rpcScan(env, `https://example.com/p${i}`, "203.0.113.5");
    expect(last).toEqual({ status: 429, body: { ok: false, error: "Rate limit: 5 scans per IP per day" } });
  });

  it("keys IPv6 callers on their /64 (E15), like the public route", async () => {
    stub404();
    const { env, limiter } = makeEnv();
    await rpcScan(env, "https://example.com/x", "2001:db8:1:2::1");
    await rpcScan(env, "https://example.com/y", "2001:db8:1:2:ffff::9");
    expect(limiter.calls).toEqual(["scan:2001:db8:1:2::/64", "scan:2001:db8:1:2::/64"]);
  });

  it("burst-gate denial returns 429 before any KV or D1 work", async () => {
    stub404();
    const { env, kvOps, d1Calls } = makeEnv({}, 0);
    const r = await rpcScan(env, "https://example.com/", "198.51.100.1");
    expect(r).toEqual({ status: 429, body: { ok: false, error: "Rate limit: 5 scans per IP per day" } });
    expect(kvOps).toEqual([]);
    expect(d1Calls).toEqual([]);
  });

  it("always scans the free tier", async () => {
    stub404();
    const { env } = makeEnv({ INTERNAL_FULFILL_KEY: "k" });
    const r = await rpcScan(env, "https://example.com/", "198.51.100.1");
    expect(r.status).toBe(200);
    expect((r.body as { tier: string }).tier).toBe("free");
  });

  it("fails closed on a missing or non-literal client IP: no limit lookup, no scan", async () => {
    stub404();
    const { env, limiter, kvOps, d1Calls } = makeEnv();
    for (const ip of [undefined, null, "", "unknown", "1.2.3.4, 5.6.7.8", "example.com", 42]) {
      expect(await rpcScan(env, "https://example.com/", ip), String(ip)).toEqual({
        status: 400,
        body: { ok: false, error: "Invalid client IP" },
      });
    }
    expect(limiter.calls).toEqual([]);
    expect(kvOps).toEqual([]);
    expect(d1Calls).toEqual([]);
  });

  it("rejects unsafe URLs with the public route's 400 body", async () => {
    stub404();
    const { env, kvOps, d1Calls } = makeEnv();
    for (const u of ["http://169.254.169.254/latest/meta-data/", "http://localhost/", "ftp://example.com/", "not a url", 7]) {
      expect(await rpcScan(env, u, "198.51.100.1")).toEqual({ status: 400, body: { ok: false, error: INVALID_SCAN_INPUT } });
    }
    expect(kvOps).toEqual([]);
    expect(d1Calls).toEqual([]);
  });

  it("returns 503 MISCONFIGURED without RATE_LIMIT_HASH_SECRET", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stub404();
    const { env } = makeEnv({ RATE_LIMIT_HASH_SECRET: undefined });
    expect(await rpcScan(env, "https://example.com/", "198.51.100.1")).toEqual({
      status: 503,
      body: { ok: false, error: "MISCONFIGURED" },
    });
  });
});

describe("E11: SCAN_PROXY_KEY authenticates the forwarded client IP", () => {
  const PROXY = "scan-proxy-key-value";
  const FULFILL = "internal-fulfill-key-value";
  const WORKER_IP = "2a06:98c0:3600::103";
  const WORKER_KEY = "scan:2a06:98c0:3600:0::/64";

  const proxied = (h: Record<string, string>, body: Record<string, unknown> = {}) =>
    new Request("https://scanner.astrant.io/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": WORKER_IP, ...h },
      body: JSON.stringify({ url: "https://example.com/", ...body }),
    });

  it("proxyTrustKey: SCAN_PROXY_KEY when set; INTERNAL_FULFILL_KEY only while it is unset", () => {
    expect(proxyTrustKey({ SCAN_PROXY_KEY: PROXY, INTERNAL_FULFILL_KEY: FULFILL })).toBe(PROXY);
    expect(proxyTrustKey({ SCAN_PROXY_KEY: PROXY })).toBe(PROXY);
    expect(proxyTrustKey({ INTERNAL_FULFILL_KEY: FULFILL })).toBe(FULFILL);
    expect(proxyTrustKey({ SCAN_PROXY_KEY: "", INTERNAL_FULFILL_KEY: FULFILL })).toBe(FULFILL);
    expect(proxyTrustKey({})).toBeUndefined();
    expect(proxyTrustKey({ INTERNAL_FULFILL_KEY: "" })).toBeUndefined();
  });

  it("with SCAN_PROXY_KEY set, the proxy key is trusted and the old key is not", async () => {
    stub404();
    const { env, limiter } = makeEnv({ SCAN_PROXY_KEY: PROXY, INTERNAL_FULFILL_KEY: FULFILL });
    await app.fetch(proxied({ "x-astrant-client-ip": "198.51.100.1", "x-astrant-proxy-key": PROXY }), env);
    await app.fetch(proxied({ "x-astrant-client-ip": "198.51.100.2", "x-astrant-proxy-key": FULFILL }), env);
    expect(limiter.calls).toEqual(["scan:198.51.100.1", WORKER_KEY]);
  });

  it("with SCAN_PROXY_KEY unset, the old INTERNAL_FULFILL_KEY is still trusted (transition)", async () => {
    stub404();
    const { env, limiter } = makeEnv({ INTERNAL_FULFILL_KEY: FULFILL });
    await app.fetch(proxied({ "x-astrant-client-ip": "198.51.100.1", "x-astrant-proxy-key": FULFILL }), env);
    await app.fetch(proxied({ "x-astrant-client-ip": "198.51.100.2", "x-astrant-proxy-key": PROXY }), env);
    expect(limiter.calls).toEqual(["scan:198.51.100.1", WORKER_KEY]);
  });

  it("the proxy key never grants the paid tier, in either header", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stub404();
    for (const extra of [{ SCAN_PROXY_KEY: PROXY, INTERNAL_FULFILL_KEY: FULFILL }, { SCAN_PROXY_KEY: PROXY }]) {
      const { env, limiter } = makeEnv(extra);
      for (const h of [
        { "x-internal-fulfill-key": PROXY },
        { "x-astrant-proxy-key": PROXY, "x-astrant-client-ip": "198.51.100.1" },
        { "x-internal-fulfill-key": PROXY, "x-astrant-proxy-key": PROXY, "x-astrant-client-ip": "198.51.100.1" },
      ]) {
        const res = await app.fetch(proxied(h, { tier: "paid", url: `https://example.com/${limiter.calls.length}` }), env);
        expect(res.status).toBe(200);
        expect(((await res.json()) as { tier: string }).tier).toBe("free");
      }
      // Degraded to free means rate-limited like free: every call hit the burst gate.
      expect(limiter.calls.length).toBe(3);
    }
  });

  it("INTERNAL_FULFILL_KEY still grants paid with SCAN_PROXY_KEY set", async () => {
    stub404();
    const { env, limiter } = makeEnv({ SCAN_PROXY_KEY: PROXY, INTERNAL_FULFILL_KEY: FULFILL });
    const res = await app.fetch(proxied({ "x-internal-fulfill-key": FULFILL }, { tier: "paid" }), env);
    expect(((await res.json()) as { tier: string }).tier).toBe("paid");
    expect(limiter.calls).toEqual([]);
  });
});
