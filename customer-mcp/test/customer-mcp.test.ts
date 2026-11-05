// customer-mcp integration tests: the real Worker entrypoint over a node:sqlite
// D1 adapter running the REAL migration, plus an in-memory KV. Covers tenant
// isolation by Host slug, entitlement (status / period_end), the KV config
// cache, slug generation, internal-API auth, and the sweep.
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index";
import { generateSlug } from "../src/slug";
import { getCustomerFromCacheOrD1 } from "../src/config";
import { runSweep } from "../src/sweep";
import type { Env } from "../src/types";

const KEY = "test-internal-key";

function makeD1(sqlite: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      async run() {
        const info = sqlite.prepare(sql).run(...(binds as never[]));
        return { success: true, meta: { changes: Number(info.changes) }, results: [] };
      },
      async first<T>() {
        return (sqlite.prepare(sql).get(...(binds as never[])) ?? null) as T | null;
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

function makeKV() {
  const store = new Map<string, string>();
  const kv = {
    store,
    async get(k: string) {
      return store.has(k) ? store.get(k)! : null;
    },
    async put(k: string, v: string) {
      store.set(k, v);
    },
    async delete(k: string) {
      store.delete(k);
    },
  };
  return kv;
}

let sqlite: DatabaseSync;
let kv: ReturnType<typeof makeKV>;
let env: Env;
const ctx = {} as ExecutionContext;
const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0001_initial_schema.sql", import.meta.url), "utf8"));
  kv = makeKV();
  env = { CUSTOMER_DB: makeD1(sqlite), CONFIG_CACHE: kv as unknown as KVNamespace, INTERNAL_PROVISION_KEY: KEY };
});

function config(brand: string, extra: Record<string, unknown> = {}) {
  return { _schema_version: "1.0", brand_name: brand, description: `${brand} desc`, ...extra };
}

function seed(slug: string, o: { status?: string; period_end?: number | null; tier?: string; cfg?: unknown; customer_id?: string } = {}) {
  sqlite
    .prepare(
      `INSERT INTO customers (slug, customer_id, domain, paid_tier, status, period_end, created_at, updated_at, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      slug,
      o.customer_id ?? `cus_${slug}`,
      `${slug}.com`,
      o.tier ?? "autopilot",
      o.status ?? "active",
      o.period_end === undefined ? now() + 86400 : o.period_end,
      now(),
      now(),
      JSON.stringify(o.cfg ?? config(slug.toUpperCase(), { pricing: [{ plan: `${slug}-plan` }] })),
    );
}

function call(host: string, path: string, init: RequestInit = {}) {
  const req = new Request(`https://${host}${path}`, init);
  // new Request() derives Host from the URL in workerd; set it explicitly for undici.
  const headers = new Headers(init.headers);
  headers.set("Host", host);
  return worker.fetch(new Request(req, { headers }), env, ctx);
}

function rpc(host: string, method: string, params?: unknown) {
  return call(host, "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

function internal(path: string, body: unknown, key = KEY) {
  return call("anything.mcp.astrant.io", `/api/internal/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

describe("tenant isolation by Host slug", () => {
  it("each subdomain serves only its own customer's config", async () => {
    seed("acme");
    seed("globex");
    const a = await (await rpc("acme.mcp.astrant.io", "tools/call", { name: "get_pricing" })).json<any>();
    const g = await (await rpc("globex.mcp.astrant.io", "tools/call", { name: "get_pricing" })).json<any>();
    expect(JSON.parse(a.result.content[0].text)).toEqual({ pricing: [{ plan: "acme-plan" }] });
    expect(JSON.parse(g.result.content[0].text)).toEqual({ pricing: [{ plan: "globex-plan" }] });
  });

  it("cache keys are per-slug: a cached tenant never answers for another", async () => {
    seed("acme");
    seed("globex");
    await rpc("acme.mcp.astrant.io", "initialize");
    await rpc("globex.mcp.astrant.io", "initialize");
    expect([...kv.store.keys()].sort()).toEqual(["customer-config:v1:acme", "customer-config:v1:globex"]);
    const init = await (await rpc("globex.mcp.astrant.io", "initialize")).json<any>();
    expect(init.result.serverInfo.name).toBe("GLOBEX");
  });

  it.each([
    "mcp.astrant.io",
    "acme.mcp.astrant.io.evil.com",
    "a.b.mcp.astrant.io",
    "acme_x.mcp.astrant.io",
    "acme.mcp.astrant.io:8443",
    "",
  ])("rejects non-tenant host %j with 404 and never reads D1", async (host) => {
    seed("acme");
    let reads = 0;
    const real = env.CUSTOMER_DB;
    env.CUSTOMER_DB = { prepare: (s: string) => (reads++, real.prepare(s)) } as unknown as D1Database;
    const req = new Request("https://acme.mcp.astrant.io/mcp", { method: "POST", body: "{}" });
    const headers = new Headers();
    if (host) headers.set("Host", host);
    const res = await worker.fetch(new Request(req, { headers }), env, ctx);
    expect(res.status).toBe(404);
    expect(reads).toBe(0);
  });

  it("unknown slug → 404 MCP not found", async () => {
    const res = await rpc("nobody.mcp.astrant.io", "tools/list");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "MCP not found or no longer active" });
  });
});

describe("entitlement", () => {
  it("expired → 404", async () => {
    seed("acme", { status: "expired" });
    expect((await rpc("acme.mcp.astrant.io", "tools/list")).status).toBe(404);
  });

  it("cancelled but inside the paid period → still serves (end-of-period sunset)", async () => {
    seed("acme", { status: "cancelled", period_end: now() + 3600 });
    expect((await rpc("acme.mcp.astrant.io", "tools/list")).status).toBe(200);
  });

  it("active but past period_end → 404 even before the sweep runs, even from cache", async () => {
    seed("acme", { period_end: now() + 3600 });
    expect((await rpc("acme.mcp.astrant.io", "tools/list")).status).toBe(200); // now cached
    const cached = JSON.parse(kv.store.get("customer-config:v1:acme")!);
    kv.store.set("customer-config:v1:acme", JSON.stringify({ ...cached, period_end: now() - 1 }));
    expect((await rpc("acme.mcp.astrant.io", "tools/list")).status).toBe(404);
  });

  it("implementation tier (period_end NULL) serves indefinitely", async () => {
    seed("acme", { tier: "implementation", period_end: null });
    expect((await rpc("acme.mcp.astrant.io", "tools/list")).status).toBe(200);
  });
});

describe("config cache", () => {
  it("reads D1 once, then serves from KV", async () => {
    seed("acme");
    let reads = 0;
    const real = env.CUSTOMER_DB;
    env.CUSTOMER_DB = { prepare: (s: string) => (reads++, real.prepare(s)) } as unknown as D1Database;
    await getCustomerFromCacheOrD1("acme", env);
    await getCustomerFromCacheOrD1("acme", env);
    expect(reads).toBe(1);
  });

  it("a corrupt cache entry falls through to D1", async () => {
    seed("acme");
    kv.store.set("customer-config:v1:acme", "{not json");
    const c = await getCustomerFromCacheOrD1("acme", env);
    expect(c?.slug).toBe("acme");
  });

  it("deprovision invalidates the cache so the change is visible immediately", async () => {
    seed("acme");
    await rpc("acme.mcp.astrant.io", "tools/list");
    expect(kv.store.has("customer-config:v1:acme")).toBe(true);
    const res = await internal("deprovision-customer", { customer_id: "cus_acme" });
    expect(res.status).toBe(200);
    expect(kv.store.has("customer-config:v1:acme")).toBe(false);
  });

  it("update-config shallow-merges, invalidates cache, and the new value is served", async () => {
    seed("acme");
    await rpc("acme.mcp.astrant.io", "tools/call", { name: "get_pricing" });
    const res = await internal("update-customer-config", { customer_id: "cus_acme", config: { pricing: [{ plan: "new" }] } });
    expect(res.status).toBe(200);
    const out = await (await rpc("acme.mcp.astrant.io", "tools/call", { name: "get_pricing" })).json<any>();
    expect(JSON.parse(out.result.content[0].text)).toEqual({ pricing: [{ plan: "new" }] });
    const init = await (await rpc("acme.mcp.astrant.io", "initialize")).json<any>();
    expect(init.result.serverInfo.name).toBe("ACME"); // omitted keys preserved
  });
});

describe("MCP JSON-RPC surface", () => {
  it("lists exactly the 4 customer tools", async () => {
    seed("acme");
    const r = await (await rpc("acme.mcp.astrant.io", "tools/list")).json<any>();
    expect(r.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "get_capabilities",
      "get_pricing",
      "get_case_studies",
      "get_contact_tools",
    ]);
  });

  it("unknown tool → -32602; non-POST → 405; bad JSON → -32700", async () => {
    seed("acme");
    const bad = await rpc("acme.mcp.astrant.io", "tools/call", { name: "drop_tables" });
    expect(bad.status).toBe(400);
    expect((await bad.json<any>()).error.code).toBe(-32602);
    expect((await call("acme.mcp.astrant.io", "/mcp")).status).toBe(405);
    const pe = await call("acme.mcp.astrant.io", "/mcp", { method: "POST", body: "{" });
    expect((await pe.json<any>()).error.code).toBe(-32700);
  });

  it("well-known endpoints point at the tenant's own subdomain", async () => {
    seed("acme");
    const wk = await (await call("acme.mcp.astrant.io", "/.well-known/mcp.json")).json<any>();
    expect(wk.mcp).toBe("https://acme.mcp.astrant.io/mcp");
    expect(wk.name).toBe("ACME");
  });
});

describe("internal API auth", () => {
  it.each(["provision-customer", "deprovision-customer", "update-customer-config", "sweep"])(
    "%s rejects a wrong or missing bearer before touching D1",
    async (path) => {
      seed("acme");
      expect((await internal(path, { customer_id: "cus_acme" }, "wrong")).status).toBe(401);
      const res = await call("x.mcp.astrant.io", `/api/internal/${path}`, { method: "POST", body: "{}" });
      expect(res.status).toBe(401);
      expect(sqlite.prepare("SELECT status FROM customers").get()).toEqual({ status: "active" });
    },
  );

  it("an unset INTERNAL_PROVISION_KEY never authorizes", async () => {
    env.INTERNAL_PROVISION_KEY = undefined as unknown as string;
    for (const k of [undefined, ""]) {
      env.INTERNAL_PROVISION_KEY = k as unknown as string;
      const res = await internal("sweep", {}, String(k));
      expect(res.status).toBe(503);
    }
  });
});

describe("provision", () => {
  const body = (o: Record<string, unknown> = {}) => ({
    customer_id: "cus_1",
    domain: "https://Acme.com/pricing?x=1",
    paid_tier: "autopilot",
    period_end: now() + 86400,
    config: config("Acme"),
    ...o,
  });

  it("inserts, then a re-provision of the same customer keeps the slug (renewal / reactivation)", async () => {
    const first = await (await internal("provision-customer", body())).json<any>();
    expect(first).toMatchObject({ customer_slug: "acme", operation: "inserted", mcp_url: "https://acme.mcp.astrant.io/mcp" });
    await internal("deprovision-customer", { customer_id: "cus_1" });
    const again = await (await internal("provision-customer", body({ domain: "other.io" }))).json<any>();
    expect(again).toMatchObject({ customer_slug: "acme", operation: "updated_reactivated" });
    expect(sqlite.prepare("SELECT status, domain FROM customers").get()).toEqual({ status: "active", domain: "https://Acme.com/pricing?x=1" });
  });

  it("subscription tiers require period_end; schema version is enforced", async () => {
    expect((await (await internal("provision-customer", body({ period_end: null }))).json<any>()).error).toBe(
      "PERIOD_END_REQUIRED_FOR_SUBSCRIPTION",
    );
    expect((await (await internal("provision-customer", body({ config: { ...config("A"), _schema_version: "2" } }))).json<any>()).error).toBe(
      "INVALID_SCHEMA_VERSION",
    );
    expect((await (await internal("provision-customer", body({ paid_tier: "enterprise" }))).json<any>()).error).toBe("INVALID_PAID_TIER");
  });
});

describe("generateSlug", () => {
  const db = () => env.CUSTOMER_DB;
  it("strips protocol, path and TLD; dots become dashes", async () => {
    expect(await generateSlug("https://Shop.Example.co/x?y#z", db())).toEqual({ ok: true, slug: "shop-example" });
  });
  it("rejects non-ASCII before replacement (münchen is not m-nchen)", async () => {
    expect(await generateSlug("münchen.de", db())).toEqual({ ok: false, error: { kind: "SLUG_NON_ASCII" } });
  });
  it("rejects reserved slugs and over-long labels", async () => {
    expect(await generateSlug("www.com", db())).toEqual({ ok: false, error: { kind: "SLUG_RESERVED" } });
    expect(await generateSlug(`${"a".repeat(64)}.com`, db())).toEqual({ ok: false, error: { kind: "SLUG_TOO_LONG" } });
  });
  it("collides to -2, -3 …", async () => {
    seed("acme");
    seed("acme-2");
    expect(await generateSlug("acme.io", db())).toEqual({ ok: true, slug: "acme-3" });
  });
  it("a collision suffix that would exceed 63 chars is SLUG_TOO_LONG", async () => {
    const base = "a".repeat(62);
    seed(base);
    expect(await generateSlug(`${base}.com`, db())).toEqual({ ok: false, error: { kind: "SLUG_TOO_LONG" } });
  });
});

describe("sweep", () => {
  it("expires lapsed subscriptions, hard-deletes cancelled rows 30d past period_end, leaves the rest", async () => {
    const t = now();
    seed("lapsed", { period_end: t - 10 });
    seed("current", { period_end: t + 3600 });
    seed("impl", { tier: "implementation", period_end: null });
    seed("oldcancel", { status: "cancelled", period_end: t - 31 * 86400 });
    seed("newcancel", { status: "cancelled", period_end: t - 86400 });
    const r = await runSweep(env);
    expect(r).toMatchObject({ hard_deleted: 1, expired: 1 });
    const rows = Object.fromEntries(
      (sqlite.prepare("SELECT slug, status FROM customers").all() as { slug: string; status: string }[]).map((x) => [x.slug, x.status]),
    );
    expect(rows).toEqual({ lapsed: "expired", current: "active", impl: "active", newcancel: "cancelled" });
  });
});
