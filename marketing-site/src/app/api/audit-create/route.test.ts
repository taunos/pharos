import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Test C-A (A1/A2) — /api/audit-create gate, rate limit, validation, funnel.

const LEGACY_503_BODY =
  '{"ok":false,"error":"Astrant Audit is in pre-launch verification. Paid checkouts open in the next few days. Drop your URL + email at https://astrant.io/audit and we\'ll email you the moment it goes live."}';

type PutCall = { key: string; value: string; opts?: { expirationTtl?: number } };

const state: {
  env: Record<string, unknown>;
  store: Map<string, string>;
  puts: PutCall[];
} = { env: {}, store: new Map(), puts: [] };

function makeKv() {
  return {
    get: vi.fn(async (k: string) => state.store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string, opts?: { expirationTtl?: number }) => {
      state.puts.push({ key: k, value: v, opts });
      state.store.set(k, v);
    }),
  };
}

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: state.env }),
}));

const createCheckoutSession = vi.fn(async (_env: unknown, _input: { metadata: Record<string, string>; cancel_url?: string }) => ({
  checkout_url: "https://checkout.example/abc",
  checkout_session_id: "cks_1",
}));
vi.mock("@/lib/dodo", () => ({
  createCheckoutSession: (env: unknown, input: { metadata: Record<string, string>; cancel_url?: string }) =>
    createCheckoutSession(env, input),
}));

function req(body: unknown, ip = "1.2.3.4") {
  return new Request("https://astrant.io/api/audit-create", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}

const VALID = { url: "https://example.com", email: "buyer@example.com" };
const SCAN_V4 = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

function openEnv(extra: Record<string, unknown> = {}) {
  state.env = {
    AUDIT_CHECKOUT_ENABLED: "true",
    DODO_API_KEY: "k",
    RATE_LIMIT_HASH_SECRET: "s",
    SESSIONS: makeKv(),
    ...extra,
  };
}

beforeEach(() => {
  state.store = new Map();
  state.puts = [];
  createCheckoutSession.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/audit-create — gate closed", () => {
  it.each([undefined, "false", "TRUE", ""])(
    "AUDIT_CHECKOUT_ENABLED=%s → 503 with the legacy body, no KV or Dodo",
    async (flag) => {
      const kv = {
        get: vi.fn(() => {
          throw new Error("KV reached while gate closed");
        }),
        put: vi.fn(() => {
          throw new Error("KV reached while gate closed");
        }),
      };
      state.env = { AUDIT_CHECKOUT_ENABLED: flag, DODO_API_KEY: "k", SESSIONS: kv };
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { POST } = await import("./route");
      const res = await POST(req(VALID));
      expect(res.status).toBe(503);
      expect(await res.text()).toBe(LEGACY_503_BODY);
      expect(kv.get).not.toHaveBeenCalled();
      expect(kv.put).not.toHaveBeenCalled();
      expect(createCheckoutSession).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});

describe("POST /api/audit-create — gate open", () => {
  it("rate limit → 429 after 5 requests per IP (default)", async () => {
    openEnv();
    const { POST } = await import("./route");
    for (let i = 0; i < 5; i++) {
      expect((await POST(req(VALID))).status).toBe(200);
    }
    const res = await POST(req(VALID));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "RATE_LIMITED", retry_after_sec: expect.any(Number) });
    expect(createCheckoutSession).toHaveBeenCalledTimes(5);
  });

  it("missing RATE_LIMIT_HASH_SECRET → 503 MISCONFIGURED (like f2), no Dodo", async () => {
    openEnv({ RATE_LIMIT_HASH_SECRET: undefined });
    const { POST } = await import("./route");
    const res = await POST(req(VALID));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "MISCONFIGURED" });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("invalid source_scan_id is dropped (not an error, not forwarded)", async () => {
    openEnv();
    const { POST } = await import("./route");
    for (const bad of ["not-a-uuid", "3f2b8c1e-9a4d-1e6f-8b2a-1c3d5e7f9a0b", "' OR 1=1 --"]) {
      const res = await POST(req({ ...VALID, source_scan_id: bad }));
      expect(res.status).toBe(200);
    }
    for (const call of createCheckoutSession.mock.calls) {
      expect(call[1].metadata.source_scan_id).toBeUndefined();
      expect(call[1].cancel_url).toBe("https://astrant.io/audit?canceled=1");
    }
  });

  it("valid UUID v4 source_scan_id is forwarded into Dodo metadata", async () => {
    openEnv();
    const { POST } = await import("./route");
    const res = await POST(req({ ...VALID, source_scan_id: SCAN_V4 }));
    expect(res.status).toBe(200);
    expect(createCheckoutSession.mock.calls[0][1].metadata.source_scan_id).toBe(SCAN_V4);
    // Test C-B: a canceled checkout returns to /audit with the scan id kept.
    expect(createCheckoutSession.mock.calls[0][1].cancel_url).toBe(
      `https://astrant.io/audit?canceled=1&source_scan_id=${SCAN_V4}`,
    );
  });

  it("field caps → 400 (url > 2048, email > 254), no Dodo", async () => {
    openEnv();
    const { POST } = await import("./route");
    const longUrl = "https://example.com/" + "a".repeat(2048);
    const longEmail = "a".repeat(250) + "@example.com";
    expect((await POST(req({ ...VALID, url: longUrl }))).status).toBe(400);
    expect((await POST(req({ ...VALID, email: longEmail }))).status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("writes the funnel record with NO TTL and no email/url", async () => {
    openEnv();
    const { POST } = await import("./route");
    const res = await POST(req({ ...VALID, source_scan_id: SCAN_V4 }));
    const { session_id } = (await res.json()) as { session_id: string };
    const funnelPut = state.puts.find((p) => p.key === `funnel:audit:${session_id}`);
    expect(funnelPut).toBeDefined();
    expect(funnelPut!.opts?.expirationTtl).toBeUndefined();
    const rec = JSON.parse(funnelPut!.value);
    expect(rec).toEqual({
      created_at: expect.any(Number),
      source_scan_id: SCAN_V4,
      status: "checkout_created",
    });
    expect(funnelPut!.value).not.toContain("example.com");
    // Session record keeps its 30-day TTL.
    const sessionPut = state.puts.find((p) => p.key === `audit:${session_id}`);
    expect(sessionPut!.opts?.expirationTtl).toBe(30 * 24 * 60 * 60);
  });

  it("funnel record without a source scan stores source_scan_id: null", async () => {
    openEnv();
    const { POST } = await import("./route");
    const res = await POST(req(VALID));
    const { session_id } = (await res.json()) as { session_id: string };
    expect(JSON.parse(state.store.get(`funnel:audit:${session_id}`)!).source_scan_id).toBeNull();
  });

  // Dataset spec v2 §4.3 — P2 opt-in checkbox (unticked by default).
  it.each([
    ["absent", undefined],
    ["false", false],
    ["string 'true'", "true"],
    ["number 1", 1],
    ["object", { yes: true }],
  ])("consent_sellable %s → 0 on session + rights record", async (_n, value) => {
    openEnv();
    const { POST } = await import("./route");
    const body: Record<string, unknown> = { ...VALID };
    if (value !== undefined) body.consent_sellable = value;
    const res = await POST(req(body));
    expect(res.status).toBe(200);
    const { session_id } = (await res.json()) as { session_id: string };
    const session = JSON.parse(state.store.get(`audit:${session_id}`)!);
    expect(session.consent_sellable).toBe(0);
    expect(session.consent_text_version).toBe("p2-sellable-v1-2026-11-05");
    expect(session.consent_at).toBe(session.created_at);
    expect(JSON.parse(state.store.get(`rights:audit:${session_id}`)!).consent_sellable).toBe(0);
  });

  it("consent_sellable true → 1; rights record has NO TTL, no email/url, P1 default on", async () => {
    openEnv();
    const { POST } = await import("./route");
    const res = await POST(req({ ...VALID, consent_sellable: true }));
    const { session_id } = (await res.json()) as { session_id: string };
    expect(JSON.parse(state.store.get(`audit:${session_id}`)!).consent_sellable).toBe(1);
    const rightsPut = state.puts.find((p) => p.key === `rights:audit:${session_id}`);
    expect(rightsPut!.opts?.expirationTtl).toBeUndefined();
    expect(JSON.parse(rightsPut!.value)).toEqual({
      tier: "audit",
      consent_sellable: 1,
      consent_text_version: "p2-sellable-v1-2026-11-05",
      consent_at: expect.any(Number),
      consent_method: "checkout_checkbox",
      p1_opt_out: 0,
    });
    expect(rightsPut!.value).not.toContain("example.com");
  });

  it("consent never changes price, product or Dodo metadata", async () => {
    openEnv();
    const { POST } = await import("./route");
    await POST(req({ ...VALID, consent_sellable: true }));
    await POST(req({ ...VALID, consent_sellable: false }));
    const [a, b] = createCheckoutSession.mock.calls.map((c) => c[1] as Record<string, unknown>);
    const strip = (x: Record<string, unknown>) => {
      const m = { ...(x.metadata as Record<string, string>) };
      delete m.session_id;
      return { ...x, metadata: m, return_url: undefined };
    };
    expect(strip(a)).toEqual(strip(b));
    expect(JSON.stringify(a)).not.toContain("consent");
  });
});
