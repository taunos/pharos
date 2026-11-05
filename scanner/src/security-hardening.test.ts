// Security pass 2026-11-04: input validation / SSRF, burst rate limiting,
// bounded fetches (deadline covers the body, byte caps), AI budget, and
// "truncated or errored reads never produce absence evidence".
import { describe, it, expect, vi, afterEach } from "vitest";
import { validateTargetUrl, safeFetch, MAX_HTML_BYTES, MAX_TEXT_BYTES } from "./safe-fetch";
import { checkBurstLimit, checkRateLimit, isIpLiteral, limiterIdentity, urlCacheKey, urlLimitKey } from "./ratelimit";
import { runDim3, INCOMPLETE_SPEC_NOTE } from "./checks/dim3-openapi";
import { compositeOf } from "./scoring";
import { evalWithCache, aiBudgetKey, DAILY_AI_CALL_CAP, MAX_PROMPT_CHARS } from "./checks/llm-eval";
import { runDim1, evalBlockquote } from "./checks/dim1-llmstxt";
import { runDim2 } from "./checks/dim2-mcp";
import { runDim4, evalConversational } from "./checks/dim4-structured";
import { runDim5 } from "./checks/dim5-parsable";
import app from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const INVALID_INPUT = "Invalid input: url must be a valid URL; email and tier optional";

// ── URL validation ────────────────────────────────────────────────────────

const REJECTED = [
  // live-probe repros
  "http://169.254.169.254/latest/meta-data/",
  "http://127.0.0.1:8080/",
  // schemes
  "ftp://example.com/",
  "file:///etc/passwd",
  "javascript:alert(1)",
  "data:text/html,hi",
  "gopher://example.com/",
  // ports
  "https://example.com:8443/",
  "http://example.com:22/",
  "https://example.com:0/",
  // userinfo
  "https://user:pass@example.com/",
  "https://user@example.com/",
  "https://:pw@example.com/",
  // IPv4 in all forms
  "http://127.0.0.1/",
  "http://10.0.0.1/",
  "http://192.168.1.1/",
  "http://2130706433/",
  "http://0x7f000001/",
  "http://0177.0.0.1/",
  "http://127.1/",
  "http://0x7f.0.0.1/",
  "http://8.8.8.8/",
  "http://127.0.0.1./",
  // IPv6
  "http://[::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[fd00::1]/",
  "http://[fe80::1]/",
  // local / internal names
  "http://localhost/",
  "http://LOCALHOST./",
  "http://localhost../",
  "http://app.localhost/",
  "http://printer.local/",
  "http://db.internal/",
  "http://router.home.arpa/",
  "http://intranet/",
  "https://ftp//x",
  // empty / dot-only labels
  "http://example..com/",
  "http://./",
  "http://../",
  "http://.example.com/",
  // malformed
  "not a url",
  "https://",
  "https://exa mple.com/",
];

const ACCEPTED = [
  "https://example.com",
  "https://example.com/",
  "http://example.com/path?q=1#frag",
  "https://www.example.co.uk:443/",
  "http://example.com:80/",
  "https://example.com./",
  "https://xn--bcher-kva.example/",
  "https://my-site.io/pricing",
];

describe("validateTargetUrl", () => {
  for (const u of REJECTED) {
    it(`rejects ${u}`, () => {
      expect(() => validateTargetUrl(u)).toThrow();
    });
  }
  for (const u of ACCEPTED) {
    it(`accepts ${u}`, () => {
      expect(() => validateTargetUrl(u)).not.toThrow();
    });
  }
});

// ── POST /api/scan: input validation + burst limiter ──────────────────────

function makeScanEnv(opts: { limiter?: unknown; kv?: Map<string, string>; slowKv?: boolean } = {}) {
  const kv = opts.kv ?? new Map<string, string>();
  const d1Calls: string[] = [];
  const kvOps: string[] = [];
  const env = {
    RATE_LIMIT_HASH_SECRET: "rl-secret",
    SCAN_RATE_LIMITER: opts.limiter,
    AI: { run: async () => ({ response: "50" }) },
    CACHE: {
      get: async (k: string) => {
        kvOps.push("get:" + k);
        // Real KV reads take network time; concurrent requests interleave here.
        if (opts.slowKv) await new Promise((r) => setTimeout(r, 5));
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
  };
  return { env, d1Calls, kvOps, kv };
}

function post(body: unknown, ip = "203.0.113.7") {
  return new Request("https://scanner.astrant.io/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });
}

// Every site fetch in these route tests answers 404 quickly.
function stub404(seen?: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) => {
      seen?.push(String(u));
      return new Response("nope", { status: 404 });
    })
  );
}

describe("POST /api/scan rejects unsafe URLs with 400 and writes nothing", () => {
  for (const u of [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:8080/",
    "https://ftp//x",
    "http://localhost/",
    "http://[::1]/",
    "https://user:pass@example.com/",
    "https://example.com:8443/",
    "http://db.internal/",
    "ftp://example.com/",
    "https://" + "a".repeat(2100) + ".com/",
  ]) {
    it(u.slice(0, 60), async () => {
      const seen: string[] = [];
      stub404(seen);
      const { env, d1Calls, kvOps } = makeScanEnv();
      const res = await app.fetch(post({ url: u }), env as never);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: INVALID_INPUT });
      expect(d1Calls).toEqual([]);
      expect(kvOps).toEqual([]);
      expect(seen).toEqual([]);
    });
  }
});

/** In-process stand-in for the Rate Limiting binding (the real one is best-effort): an exact per-key counter. */
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

describe("burst limiter (first gate)", () => {
  it("a concurrent burst with distinct query strings gets only `limit` scans through", async () => {
    stub404();
    const limiter = mockLimiter(5);
    // Fresh KV per test; KV RMW limits would let the whole concurrent burst through.
    const { env, d1Calls } = makeScanEnv({ limiter, slowKv: true });
    const burst = (e: unknown) =>
      Promise.all(Array.from({ length: 25 }, (_, i) => app.fetch(post({ url: `https://example.com/p${i}?x=${i}` }), e as never)));
    // Without the binding, the non-atomic KV read-modify-write lets the concurrent burst past 5/IP.
    const unguarded = (await burst(makeScanEnv({ slowKv: true }).env)).filter((r) => r.status === 200).length;
    expect(unguarded).toBeGreaterThan(5);
    const statuses = (await burst(env)).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(20);
    expect(d1Calls.filter((s) => s.includes("INSERT INTO scans"))).toHaveLength(5);
    expect(new Set(limiter.calls)).toEqual(new Set(["scan:203.0.113.7"]));
  });

  it("429 body for the burst limiter", async () => {
    const { env } = makeScanEnv({ limiter: { limit: async () => ({ success: false }) } });
    const res = await app.fetch(post({ url: "https://example.com/" }), env as never);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "Rate limit: 5 scans per IP per day" });
  });

  it("an unauthenticated request hits the limiter before any KV / D1 / fetch work", async () => {
    const seen: string[] = [];
    stub404(seen);
    const limiter = mockLimiter(0);
    const { env, d1Calls, kvOps } = makeScanEnv({ limiter });
    const res = await app.fetch(post({ url: "https://example.com/" }), env as never);
    expect(res.status).toBe(429);
    expect(limiter.calls).toEqual(["scan:203.0.113.7"]);
    expect(kvOps).toEqual([]);
    expect(d1Calls).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("fails open to the KV limits when the binding is missing or throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await checkBurstLimit(undefined, "1.2.3.4")).toBe(true);
    expect(
      await checkBurstLimit({ limit: async () => { throw new Error("down"); } }, "1.2.3.4")
    ).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("authenticated paid-tier calls skip both rate limits", () => {
  const KEY = "valid-internal-fulfill-key";
  const paidPost = (url: string, key = KEY) =>
    new Request("https://scanner.astrant.io/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-fulfill-key": key },
      body: JSON.stringify({ url, tier: "paid" }),
    });

  it("10 concurrent paid requests with a valid key all pass, limiter set to deny", async () => {
    stub404();
    const limiter = mockLimiter(0);
    const { env, d1Calls, kvOps } = makeScanEnv({ limiter });
    (env as Record<string, unknown>).INTERNAL_FULFILL_KEY = KEY;
    // Same URL every time: the 3/URL/day KV limit would also stop these.
    const res = await Promise.all(Array.from({ length: 10 }, () => app.fetch(paidPost("https://example.com/"), env as never)));
    expect(res.map((r) => r.status)).toEqual(Array(10).fill(200));
    for (const r of res) expect(((await r.json()) as { tier: string }).tier).toBe("paid");
    expect(limiter.calls).toEqual([]);
    expect(kvOps.some((k) => k.includes("rl:"))).toBe(false);
    expect(d1Calls.filter((s) => s.includes("INSERT INTO scans")).length).toBeGreaterThan(0);
  });

  it("a paid request with a wrong key is degraded to free and limited like free", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    stub404(seen);
    const limiter = mockLimiter(0);
    const { env, d1Calls, kvOps } = makeScanEnv({ limiter });
    (env as Record<string, unknown>).INTERNAL_FULFILL_KEY = KEY;
    const res = await app.fetch(paidPost("https://example.com/", "wrong-key"), env as never);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "Rate limit: 5 scans per IP per day" });
    expect(limiter.calls).toEqual(["scan:unknown"]);
    expect(kvOps).toEqual([]);
    expect(d1Calls).toEqual([]);
    expect(seen).toEqual([]);
    err.mockRestore();
  });

  it("a paid request with a wrong key still hits the KV limits when the burst gate allows", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stub404();
    const { env, kvOps } = makeScanEnv({ limiter: mockLimiter(100) });
    (env as Record<string, unknown>).INTERNAL_FULFILL_KEY = KEY;
    const res = await app.fetch(paidPost("https://example.com/", "wrong-key"), env as never);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tier: string }).tier).toBe("free");
    expect(kvOps.some((k) => k.startsWith("get:rl:ip:"))).toBe(true);
    expect(kvOps.some((k) => k.startsWith("get:rl:url:"))).toBe(true);
    err.mockRestore();
  });

  it("an unsafe URL is rejected even with a valid key", async () => {
    const seen: string[] = [];
    stub404(seen);
    const { env, d1Calls, kvOps } = makeScanEnv({ limiter: mockLimiter(100) });
    (env as Record<string, unknown>).INTERNAL_FULFILL_KEY = KEY;
    for (const u of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:8080/", "http://localhost/"]) {
      const res = await app.fetch(paidPost(u), env as never);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: INVALID_INPUT });
    }
    expect(d1Calls).toEqual([]);
    expect(kvOps).toEqual([]);
    expect(seen).toEqual([]);
  });
});

describe("forwarded client IP from the marketing proxy", () => {
  const KEY = "valid-internal-fulfill-key";
  const proxied = (url: string, h: Record<string, string>, tier?: string) =>
    new Request("https://scanner.astrant.io/api/scan", {
      method: "POST",
      // CF replaces CF-Connecting-IP on the proxy's cross-zone subrequest.
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "2a06:98c0:3600::103", ...h },
      body: JSON.stringify(tier ? { url, tier } : { url }),
    });
  const envWith = (limit: number) => {
    const limiter = mockLimiter(limit);
    const s = makeScanEnv({ limiter });
    (s.env as Record<string, unknown>).INTERNAL_FULFILL_KEY = KEY;
    return { ...s, limiter };
  };

  it("isIpLiteral / limiterIdentity", () => {
    for (const ip of ["203.0.113.7", "0.0.0.0", "2001:db8::1", "::1", "::ffff:1.2.3.4"]) expect(isIpLiteral(ip), ip).toBe(true);
    for (const ip of ["", "1.2.3", "256.1.1.1", "01.2.3.4", "example.com", "1.2.3.4, 5.6.7.8", "[::1]", "::1]/x", "gg::1"]) expect(isIpLiteral(ip), ip).toBe(false);
    expect(limiterIdentity(KEY, "9.9.9.9", KEY, " 203.0.113.7 ")).toBe("203.0.113.7");
    expect(limiterIdentity(KEY, "9.9.9.9", "wrong", "203.0.113.7")).toBe("9.9.9.9");
    expect(limiterIdentity(KEY, "9.9.9.9", undefined, "203.0.113.7")).toBe("9.9.9.9");
    expect(limiterIdentity(undefined, "9.9.9.9", KEY, "203.0.113.7")).toBe("9.9.9.9");
    expect(limiterIdentity(KEY, "9.9.9.9", KEY, "not-an-ip")).toBe("9.9.9.9");
    expect(limiterIdentity(KEY, undefined, undefined, undefined)).toBe("unknown");
  });

  it("a spoofed x-astrant-client-ip without the key is ignored", async () => {
    stub404();
    const { env, limiter } = envWith(100);
    await app.fetch(proxied("https://example.com/", { "x-astrant-client-ip": "198.51.100.1" }), env as never);
    await app.fetch(proxied("https://example.com/", { "x-astrant-client-ip": "198.51.100.2", "x-astrant-proxy-key": "wrong" }), env as never);
    expect(limiter.calls).toEqual(["scan:2a06:98c0:3600::103", "scan:2a06:98c0:3600::103"]);
  });

  it("with the key, distinct client IPs get distinct budgets (burst gate and KV)", async () => {
    stub404();
    const { env, limiter, kvOps } = envWith(1);
    const send = (ip: string, path: string) =>
      app.fetch(proxied(`https://example.com/${path}`, { "x-astrant-client-ip": ip, "x-astrant-proxy-key": KEY }), env as never);
    expect((await send("198.51.100.1", "a")).status).toBe(200);
    expect((await send("198.51.100.2", "b")).status).toBe(200);
    expect((await send("198.51.100.1", "c")).status).toBe(429);
    expect(limiter.calls).toEqual(["scan:198.51.100.1", "scan:198.51.100.2", "scan:198.51.100.1"]);
    // The KV per-IP keys differ too (HMAC of each client IP).
    const ipKeys = new Set(kvOps.filter((k) => k.startsWith("get:rl:ip:")));
    expect(ipKeys.size).toBe(2);
  });

  it("tier=free with the proxy key is still limited (forwarding auth is not paid entitlement)", async () => {
    stub404();
    const { env, d1Calls } = envWith(0);
    const res = await app.fetch(
      proxied("https://example.com/", { "x-astrant-client-ip": "198.51.100.1", "x-astrant-proxy-key": KEY }, "free"),
      env as never
    );
    expect(res.status).toBe(429);
    expect(d1Calls).toEqual([]);
  });

  it("tier=paid with only the proxy key (no fulfill-key header) is degraded to free and limited", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stub404();
    const { env } = envWith(0);
    const res = await app.fetch(
      proxied("https://example.com/", { "x-astrant-client-ip": "198.51.100.1", "x-astrant-proxy-key": KEY }, "paid"),
      env as never
    );
    expect(res.status).toBe(429);
    err.mockRestore();
  });
});

describe("per-URL limit and cache key normalization", () => {
  it("urlLimitKey drops query and fragment; urlCacheKey drops only the fragment", () => {
    expect(urlLimitKey("https://Example.com/a?x=1#f")).toBe("https://example.com/a");
    expect(urlLimitKey("https://example.com")).toBe("https://example.com/");
    expect(urlCacheKey("https://example.com/a?x=1#f")).toBe("https://example.com/a?x=1");
    expect(urlCacheKey("https://example.com/a?x=1")).toBe("https://example.com/a?x=1");
  });

  it("distinct query strings share the 3/URL/day budget", async () => {
    const kv = new Map<string, string>();
    const env = { RATE_LIMIT_HASH_SECRET: "s", CACHE: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) } };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkRateLimit(env as never, `198.51.100.${i}`, `https://example.com/p?utm=${i}#x${i}`));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].reason).toBe("Rate limit: 3 scans per URL per day");
  });
});

// ── safeFetch: redirects, deadline, byte caps ─────────────────────────────

function streamOf(chunks: Uint8Array[], opts: { hang?: boolean; onCancel?: () => void } = {}) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (i < chunks.length) ctl.enqueue(chunks[i++]);
      else if (!opts.hang) ctl.close();
      else return new Promise<void>(() => {}); // never delivers more
    },
    cancel() {
      opts.onCancel?.();
    },
  });
}

describe("safeFetch", () => {
  it("re-validates every redirect hop (metadata / localhost targets are refused)", async () => {
    for (const loc of ["http://169.254.169.254/latest/meta-data/", "http://localhost/", "http://[::1]/", "https://x.com:8080/"]) {
      const calls: string[] = [];
      const fetchImpl = async (u: string) => {
        calls.push(u);
        return new Response(null, { status: 302, headers: { location: loc } });
      };
      expect(await safeFetch("https://example.com/", {}, { timeoutMs: 1000, fetchImpl })).toBeNull();
      expect(calls).toEqual(["https://example.com/"]);
    }
  });

  it("follows at most 3 redirects, then returns the last 3xx", async () => {
    const calls: string[] = [];
    const fetchImpl = async (u: string) => {
      calls.push(u);
      return new Response(null, { status: 301, headers: { location: `/hop${calls.length}` } });
    };
    const r = await safeFetch("https://example.com/", {}, { timeoutMs: 1000, fetchImpl });
    expect(r?.status).toBe(301);
    expect(r?.redirects).toBe(3);
    expect(calls).toHaveLength(4);
    expect(r?.url).toBe("https://example.com/hop3");
  });

  it("refuses an unsafe first URL without fetching", async () => {
    const fetchImpl = vi.fn(async () => new Response("x"));
    expect(await safeFetch("http://10.0.0.1/", {}, { timeoutMs: 1000, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops Authorization on a cross-origin redirect; 307 keeps method+body, 302 becomes GET", async () => {
    const seen: { u: string; auth: string | null; method?: string; body?: unknown }[] = [];
    const fetchImpl = async (u: string, init?: RequestInit) => {
      seen.push({ u, auth: new Headers(init?.headers).get("authorization"), method: init?.method, body: init?.body });
      if (seen.length === 1) return new Response(null, { status: 307, headers: { location: "https://example.com/b" } });
      if (seen.length === 2) return new Response(null, { status: 302, headers: { location: "https://other.com/c" } });
      return new Response("ok");
    };
    const r = await safeFetch("https://example.com/a", { method: "POST", body: "{}", headers: { Authorization: "Bearer t" } }, { timeoutMs: 1000, fetchImpl });
    expect(r?.status).toBe(200);
    expect(seen.map((s) => [s.u, s.auth, s.method, s.body])).toEqual([
      ["https://example.com/a", "Bearer t", "POST", "{}"],
      ["https://example.com/b", "Bearer t", "POST", "{}"],
      ["https://other.com/c", null, "GET", undefined],
    ]);
  });

  it("follows only 301/302/303/307/308; 304 and other 3xx are returned as-is", async () => {
    for (const status of [300, 304, 305, 306]) {
      const calls: string[] = [];
      const fetchImpl = async (u: string) => {
        calls.push(u);
        return new Response(null, { status, headers: { location: "https://example.com/next" } });
      };
      const r = await safeFetch("https://example.com/", {}, { timeoutMs: 1000, fetchImpl });
      expect(r?.status, String(status)).toBe(status);
      expect(calls).toEqual(["https://example.com/"]);
    }
  });

  it("method rewriting: 303 -> GET; 301/302 -> GET only for POST; 307/308 preserve", async () => {
    const run = async (status: number, method: string) => {
      const seen: { method?: string; body?: unknown }[] = [];
      const fetchImpl = async (_u: string, init?: RequestInit) => {
        seen.push({ method: init?.method, body: init?.body });
        return seen.length === 1 ? new Response(null, { status, headers: { location: "/next" } }) : new Response("ok");
      };
      await safeFetch("https://example.com/", { method, body: method === "GET" || method === "HEAD" ? undefined : "b" }, { timeoutMs: 1000, fetchImpl });
      return seen[1];
    };
    expect(await run(303, "POST")).toEqual({ method: "GET", body: undefined });
    expect(await run(303, "PUT")).toEqual({ method: "GET", body: undefined });
    expect(await run(303, "HEAD")).toEqual({ method: "HEAD", body: undefined });
    expect(await run(301, "POST")).toEqual({ method: "GET", body: undefined });
    expect(await run(302, "POST")).toEqual({ method: "GET", body: undefined });
    expect(await run(301, "PUT")).toEqual({ method: "PUT", body: "b" });
    expect(await run(302, "DELETE")).toEqual({ method: "DELETE", body: "b" });
    expect(await run(302, "GET")).toEqual({ method: "GET", body: undefined });
    expect(await run(307, "POST")).toEqual({ method: "POST", body: "b" });
    expect(await run(308, "PUT")).toEqual({ method: "PUT", body: "b" });
  });

  it("headers that never arrive (fetch ignoring the signal) time out to null", async () => {
    const fetchImpl = () => new Promise<Response>(() => {});
    const t0 = Date.now();
    expect(await safeFetch("https://example.com/", {}, { timeoutMs: 50, fetchImpl })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("a slow body is cut by the SAME deadline: incomplete, empty text, stream cancelled", async () => {
    let cancelled = false;
    const fetchImpl = async () =>
      new Response(streamOf([new TextEncoder().encode("<html>")], { hang: true, onCancel: () => (cancelled = true) }), { status: 200 });
    const r = await safeFetch("https://example.com/", {}, { timeoutMs: 60, fetchImpl });
    expect(r?.status).toBe(200);
    const t0 = Date.now();
    const b = await r!.body({ maxBytes: MAX_HTML_BYTES });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(b).toEqual({ text: "", bytes: 0, truncated: false, complete: false });
    await new Promise((res) => setTimeout(res, 0));
    expect(cancelled).toBe(true);
  });

  it("a stream whose cancel() never settles does not block the read", async () => {
    const fetchImpl = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull: () => new Promise<void>(() => {}),
          cancel: () => new Promise<void>(() => {}),
        }),
        { status: 200 }
      );
    const r = await safeFetch("https://example.com/", {}, { timeoutMs: 50, fetchImpl });
    const b = await r!.body({ maxBytes: 100 });
    expect(b.complete).toBe(false);
  });

  it("an oversize body is truncated at the cap and the stream cancelled", async () => {
    let cancelled = false;
    const chunk = new Uint8Array(256 * 1024).fill(97);
    const chunks = Array.from({ length: 12 }, () => chunk); // 3 MB
    const fetchImpl = async () => new Response(streamOf(chunks, { hang: true, onCancel: () => (cancelled = true) }), { status: 200 });
    const r = await safeFetch("https://example.com/", {}, { timeoutMs: 1000, fetchImpl });
    const b = await r!.body({ maxBytes: MAX_HTML_BYTES });
    expect(b.truncated).toBe(true);
    expect(b.complete).toBe(false);
    expect(b.text.length).toBe(MAX_HTML_BYTES);
    await new Promise((res) => setTimeout(res, 0));
    expect(cancelled).toBe(true);
  });

  it("countUpTo keeps counting past the cap without buffering", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    const fetchImpl = async () => new Response(streamOf([chunk, chunk, chunk, chunk, chunk]), { status: 200 });
    const r = await safeFetch("https://example.com/", {}, { timeoutMs: 1000, fetchImpl });
    const b = await r!.body({ maxBytes: 2 * 1024 * 1024, countUpTo: 3 * 1024 * 1024 + 1 });
    expect(b).toMatchObject({ truncated: true, complete: false, bytes: 3 * 1024 * 1024 + 1 });
    expect(b.text.length).toBe(2 * 1024 * 1024);
  });

  it("deadline while only counting past the cap keeps the prefix, still truncated", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    const fetchImpl = async () => new Response(streamOf([chunk, chunk, chunk], { hang: true }), { status: 200 });
    const r = await safeFetch("https://example.com/", {}, { timeoutMs: 100, fetchImpl });
    const b = await r!.body({ maxBytes: 2 * 1024 * 1024, countUpTo: 8 * 1024 * 1024 });
    expect(b).toMatchObject({ truncated: true, complete: false, bytes: 3 * 1024 * 1024 });
    expect(b.text.length).toBe(2 * 1024 * 1024);
  });

  it("a body under the cap is complete", async () => {
    const fetchImpl = async () => new Response("hello", { status: 200 });
    const r = await safeFetch("https://example.com/", {}, { timeoutMs: 1000, fetchImpl });
    expect(await r!.body({ maxBytes: MAX_TEXT_BYTES })).toEqual({ text: "hello", bytes: 5, truncated: false, complete: true });
  });
});

// ── Dimensions: discovered URLs are validated; incomplete reads prove nothing ──

const kvEnv = () => ({ AI: { run: async () => ({ response: "50" }) }, CACHE: { get: async () => null, put: async () => {} } }) as never;

describe("discovered URLs go through the same validation", () => {
  it("Dim 1 never fetches llms.txt links to IPs / internal hosts", async () => {
    const seen: string[] = [];
    const llms = [
      "# Acme",
      "> Acme does things.",
      "- [meta](http://169.254.169.254/latest/meta-data/)",
      "- [lo](http://127.0.0.1:8080/admin)",
      "- [int](http://db.internal/x)",
      "- [ok](https://acme.com/docs.md)",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        seen.push(String(u));
        if (String(u) === "https://acme.com/llms.txt") return new Response(llms, { status: 200, headers: { "content-type": "text/plain" } });
        return new Response("# Docs\n- item", { status: 200 });
      })
    );
    const d = await runDim1("https://acme.com/", kvEnv());
    expect(seen.sort()).toEqual(["https://acme.com/docs.md", "https://acme.com/llms.txt"]);
    expect(d.sub_checks.find((s) => s.id === "linked_pages_quality")!.notes).toBe("1/4 sampled links return markdown-ish content");
  });

  it("Dim 2 never POSTs to an internal MCP transport URL", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        seen.push(String(u));
        if (String(u).endsWith("/.well-known/mcp.json"))
          return new Response(JSON.stringify({ name: "x", transports: [{ url: "http://127.0.0.1:9000/mcp" }] }), { status: 200 });
        return new Response("", { status: 404 });
      })
    );
    const d = await runDim2("https://acme.com/", kvEnv());
    expect(seen.some((u) => u.includes("127.0.0.1"))).toBe(false);
    expect(d.sub_checks.find((s) => s.id === "live_invocation")!.score).toBe(0);
  });
});

describe("truncated or errored reads produce no absence evidence", () => {
  it("Dim 4: oversize homepage without ld+json => truncated, not complete, absence NOT proven", async () => {
    const big = "<html><body>" + "a".repeat(MAX_HTML_BYTES + 1000) + "</body></html>";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(big, { status: 200, headers: { "content-type": "text/html" } })));
    const d = await runDim4("https://acme.com/", kvEnv());
    for (const s of d.sub_checks)
      expect(s.evidence).toMatchObject({ status: 200, body_complete: false, truncated: true, ld_json_absent_proven: false });
    expect(d.sub_checks[0].score).toBe(0); // scoring of the prefix unchanged: no JSON-LD
  });

  it("Dim 4: JSON-LD inside the read prefix of an oversize page still scores", async () => {
    const ld = '<script type="application/ld+json">{"@type":"Organization","name":"A"}</script>';
    const big = "<html>" + ld + "a".repeat(MAX_HTML_BYTES) + "</html>";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(big, { status: 200, headers: { "content-type": "text/html" } })));
    const d = await runDim4("https://acme.com/", kvEnv());
    expect(d.sub_checks[0].score).toBe(100);
    expect(d.sub_checks[0].evidence).toMatchObject({ truncated: true, body_complete: false, ld_json_absent_proven: false });
  });

  it("Dim 4: a body that stalls past the deadline => not complete, absence NOT proven", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(streamOf([new TextEncoder().encode("<html><body>")], { hang: true }), { status: 200, headers: { "content-type": "text/html" } }))
    );
    const p = runDim4("https://acme.com/", kvEnv());
    await vi.advanceTimersByTimeAsync(8001);
    const d = await p;
    expect(d.sub_checks[0].evidence).toMatchObject({ status: 200, body_complete: false, truncated: false, parsed: false, ld_json_absent_proven: false });
  });

  it("Dim 4: a stream error mid-body => not complete, absence NOT proven", async () => {
    let n = 0;
    const s = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (n++ === 0) ctl.enqueue(new TextEncoder().encode("<html>"));
        else ctl.error(new Error("reset"));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(s, { status: 200, headers: { "content-type": "text/html" } })));
    const d = await runDim4("https://acme.com/", kvEnv());
    expect(d.sub_checks[0].evidence).toMatchObject({ body_complete: false, ld_json_absent_proven: false });
  });

  it("Dim 1: oversize llms.txt => presence evidence truncated, not complete; presence score unchanged", async () => {
    const big = "# T\n> q\n" + "x".repeat(MAX_TEXT_BYTES);
    vi.stubGlobal("fetch", vi.fn(async (u: string) =>
      String(u).endsWith("/llms.txt") ? new Response(big, { status: 200, headers: { "content-type": "text/plain" } }) : new Response("", { status: 404 })
    ));
    const d = await runDim1("https://acme.com/", kvEnv());
    const p = d.sub_checks.find((s) => s.id === "presence")!;
    expect(p.score).toBe(100);
    expect(p.evidence).toMatchObject({ status: 200, truncated: true, body_complete: false });
  });

  it("Dim 1: a complete llms.txt => body_complete true, truncated false", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) =>
      String(u).endsWith("/llms.txt") ? new Response("# T\n> q\n", { status: 200, headers: { "content-type": "text/plain" } }) : new Response("", { status: 404 })
    ));
    const d = await runDim1("https://acme.com/", kvEnv());
    expect(d.sub_checks.find((s) => s.id === "presence")!.evidence).toMatchObject({ body_complete: true, truncated: false });
  });
});

describe("Dim 3: an OpenAPI spec not read in full leaves the whole dimension unmeasured", () => {
  const SPEC = JSON.stringify({ openapi: "3.1.0", info: { title: "T", version: "1", description: "x".repeat(30) }, paths: {} });
  const byPath = (wk: () => Response) =>
    vi.fn(async (u: string) => (String(u).endsWith("/.well-known/api-catalog") ? wk() : new Response("", { status: 404 })));

  const expectUnmeasured = (d: Awaited<ReturnType<typeof runDim3>>) => {
    expect(d).toMatchObject({ na: true, unmeasured: true, score: 0 });
    expect(d.sub_checks.map((s) => s.id)).toEqual(["discovery", "spec_validity", "info_completeness", "security_schemes", "operation_coverage"]);
    for (const s of d.sub_checks) expect(s.na, s.id).toBe(true);
    // Discovery stays as informational text; every other note is the dimension note.
    expect(d.sub_checks[0].notes.startsWith(INCOMPLETE_SPEC_NOTE + " Found via well-known /.well-known/api-catalog at https://acme.com/.well-known/api-catalog")).toBe(true);
    for (const s of d.sub_checks.slice(1)) expect(s.notes).toBe(INCOMPLETE_SPEC_NOTE);
  };
  const others = [1, 2, 4, 5].map((id) => ({ dimension_id: id, dimension_name: "d" + id, score: 40, grade: "D", sub_checks: [] }));

  it("a >10 MB valid spec: the WHOLE dimension is unmeasured (na) and dropped from the composite", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(32); // whitespace: valid JSON if it were complete
    const head = new TextEncoder().encode(SPEC);
    vi.stubGlobal("fetch", byPath(() => new Response(streamOf([head, ...Array(11).fill(chunk)]), { status: 200, headers: { "content-type": "application/json" } })));
    const d = await runDim3("https://acme.com/", kvEnv());
    expectUnmeasured(d);
    // Composite is exactly the composite without Dim 3.
    expect(compositeOf([...others, d])).toEqual(compositeOf(others));
  });

  it("an oversized garbage file at /.well-known/api-catalog cannot raise the composite", async () => {
    const junk = new Uint8Array(1024 * 1024).fill(120); // "xxxx..."
    vi.stubGlobal("fetch", byPath(() => new Response(streamOf(Array(11).fill(junk)), { status: 200, headers: { "content-type": "application/json" } })));
    const d = await runDim3("https://acme.com/", kvEnv());
    expectUnmeasured(d);
    const without = compositeOf(others);
    expect(without.score).toBe(40);
    expect(compositeOf([...others, d])).toEqual(without);
  });

  it("a spec body that stalls past the deadline is unmeasured too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", byPath(() => new Response(streamOf([new TextEncoder().encode('{"openapi":')], { hang: true }), { status: 200 })));
    const p = runDim3("https://acme.com/", kvEnv());
    await vi.advanceTimersByTimeAsync(5001);
    expectUnmeasured(await p);
  });

  it("a complete spec is scored exactly as before", async () => {
    vi.stubGlobal("fetch", byPath(() => new Response(SPEC, { status: 200, headers: { "content-type": "application/json" } })));
    const d = await runDim3("https://acme.com/", kvEnv());
    expect(d.sub_checks.find((s) => s.id === "spec_validity")).toMatchObject({ score: 100, notes: "Valid JSON spec, openapi 3.1.0." });
    expect(d.sub_checks.some((s) => s.na)).toBe(false);
  });
});

describe("Dim 5 page weight keeps its >3MB bucket past the HTML cap", () => {
  it("a 4MB homepage with no Content-Length still scores 0 on page weight", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    vi.stubGlobal("fetch", vi.fn(async (u: string) =>
      String(u) === "https://acme.com/"
        ? new Response(streamOf([chunk, chunk, chunk, chunk]), { status: 200, headers: { "content-type": "text/html" } })
        : new Response("", { status: 404 })
    ));
    const d = await runDim5("https://acme.com/", kvEnv(), "free");
    expect(d.sub_checks.find((s) => s.id === "page_weight_lcp")!.score).toBe(0);
  });
});

// ── AI budget + prompt cap ────────────────────────────────────────────────

function aiEnv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const run = vi.fn(async () => ({ response: "80" }));
  const env = {
    AI: { run },
    CACHE: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) },
  } as never;
  return { env, run, store };
}

describe("daily Workers AI budget", () => {
  it("metered calls are counted; cache hits are not", async () => {
    const { env, run, store } = aiEnv();
    await evalWithCache(env, { prompt: "p", cacheKey: "k", metered: true });
    await evalWithCache(env, { prompt: "p", cacheKey: "k", metered: true }); // cache hit
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.get(aiBudgetKey())).toBe("1");
  });

  it("exhausted budget: no AI call, default score, fallback (unmeasured), not cached, logged", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env, run, store } = aiEnv({ [aiBudgetKey()]: String(DAILY_AI_CALL_CAP) });
    const r = await evalWithCache(env, { prompt: "p", cacheKey: "k2", metered: true });
    expect(run).not.toHaveBeenCalled();
    expect(r).toEqual({ score: 50, cached: false, fallback: true });
    expect([...store.keys()]).toEqual([aiBudgetKey()]);
    expect(err.mock.calls.some((c) => String(c[0]).includes("AI_BUDGET_EXHAUSTED"))).toBe(true);
    err.mockRestore();
  });

  it("Dim 4 FAQ eval is metered: exhausted budget => the FAQ LLM part gets the AI-failure default and note", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const faq = {
      "@type": "FAQPage",
      mainEntity: ["How do I start?", "What does it cost?", "Can I cancel?"].map((q) => ({ "@type": "Question", name: q })),
    };
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(`<script type="application/ld+json">${JSON.stringify(faq)}</script>`, { status: 200, headers: { "content-type": "text/html" } })
    ));
    const { env, run } = aiEnv({ [aiBudgetKey()]: String(DAILY_AI_CALL_CAP + 5) });
    const d = await runDim4("https://acme.com/", env);
    const s = d.sub_checks.find((x) => x.id === "faq_schema")!;
    expect(run).not.toHaveBeenCalled();
    expect(s.notes).toBe("3 Q&A pair(s); LLM rated 3 question(s) avg 50/100 (LLM output unusable; default)");
    expect(s.score).toBe(Math.round(60 * 0.6 + 50 * 0.4));
    vi.restoreAllMocks();
  });

  it("worst-case prompts from today's callers stay under the cap (scoring unchanged)", async () => {
    const { env, run } = aiEnv();
    await evalBlockquote(env, "word ".repeat(2000));
    await evalConversational(env, Array.from({ length: 20 }, (_, i) => `question ${i} ` + "q".repeat(400)));
    expect(run).toHaveBeenCalledTimes(2);
    for (const c of run.mock.calls as unknown as [string, { messages: { content: string }[] }][])
      expect(c[1].messages[0].content.length).toBeLessThan(MAX_PROMPT_CHARS);
  });

  it("an over-long prompt is never sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { env, run } = aiEnv();
    const r = await evalWithCache(env, { prompt: "x".repeat(MAX_PROMPT_CHARS + 1), cacheKey: "k3" });
    expect(run).not.toHaveBeenCalled();
    expect(r.fallback).toBe(true);
    vi.restoreAllMocks();
  });
});
