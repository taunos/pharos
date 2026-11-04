// Outreach slice S8 / S2b: ProspectScan RPC path vs public /api/scan path.
// Real migration chain (schema.sql + 0001 + 0002 + 0005) on node:sqlite.
import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  dim: (id: number) => ({
    dimension_id: id,
    dimension_name: "dim" + id,
    score: 50,
    grade: "C",
    sub_checks: [],
    na: false,
  }),
}));
vi.mock("./checks/dim1-llmstxt", () => ({ runDim1: async () => h.dim(1) }));
vi.mock("./checks/dim2-mcp", () => ({ runDim2: async () => h.dim(2) }));
vi.mock("./checks/dim3-openapi", () => ({ runDim3: async () => h.dim(3) }));
vi.mock("./checks/dim4-structured", () => ({ runDim4: async () => h.dim(4) }));
vi.mock("./checks/dim5-parsable", () => ({ runDim5: async () => h.dim(5) }));
vi.mock("./checks/dim6-citation", () => ({ runDim6: async () => h.dim(6) }));

import app, { ProspectScan } from "./index";
import { prospectScan, prospectDeleteScan } from "./prospect-scan";
import { INSERT_SCAN_SQL } from "./run-scan";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

function sqlite(withSource = true) {
  const db = new DatabaseSync(":memory:");
  db.exec(read("../schema.sql"));
  db.exec(read("../migrations/0001_email_capture_columns.sql"));
  db.exec(read("../migrations/0002_tier_column.sql"));
  if (withSource) db.exec(read("../migrations/0005_scans_source.sql"));
  return db;
}

function makeEnv(db: DatabaseSync) {
  const kv = { gets: [] as string[], puts: [] as string[] };
  const sqls: string[] = [];
  const env = {
    RATE_LIMIT_HASH_SECRET: "rl-secret",
    AI: { run: async () => ({}) },
    CACHE: {
      get: async (k: string) => {
        kv.gets.push(k);
        return null;
      },
      put: async (k: string) => {
        kv.puts.push(k);
      },
    },
    DB: {
      prepare(sql: string) {
        sqls.push(sql);
        const st = {
          binds: [] as unknown[],
          bind(...a: unknown[]) {
            st.binds = a;
            return st;
          },
          async run() {
            const info = db.prepare(sql).run(...(st.binds as never[]));
            return { success: true, meta: { changes: Number(info.changes) } };
          },
          async first() {
            return (db.prepare(sql).get(...(st.binds as never[])) ?? null) as unknown;
          },
        };
        return st;
      },
    },
  };
  return { env: env as never, kv, sqls };
}

describe("ProspectScan RPC path", () => {
  it("writes source='outreach', no email, touches no KV (cache or rate limit)", async () => {
    const db = sqlite();
    const { env, kv } = makeEnv(db);
    const r = await prospectScan(env, "https://example.com/");
    const row = db.prepare("SELECT source, email, tier FROM scans WHERE id = ?").get(r.id) as Record<string, unknown>;
    expect(row).toEqual({ source: "outreach", email: null, tier: "free" });
    expect(kv.gets).toEqual([]);
    expect(kv.puts).toEqual([]);
  });

  it("throws when the D1 insert fails (no 0005 column)", async () => {
    const db = sqlite(false);
    const { env } = makeEnv(db);
    await expect(prospectScan(env, "https://example.com/")).rejects.toThrow(/SCAN_INSERT_FAILED/);
  });

  it("rejects non-http URLs", async () => {
    const { env } = makeEnv(sqlite());
    await expect(prospectScan(env, "javascript:alert(1)")).rejects.toThrow("INVALID_URL");
    await expect(prospectScan(env, 42)).rejects.toThrow("INVALID_URL");
  });

  it("deleteScan deletes only outreach rows", async () => {
    const db = sqlite();
    const { env } = makeEnv(db);
    const r = await prospectScan(env, "https://example.com/");
    const humanId = "11111111-1111-1111-1111-111111111111";
    db.prepare(
      "INSERT INTO scans (id,url,dimensions_scored,dimensions_total,results_json,created_at) VALUES (?,?,?,?,?,?)"
    ).run(humanId, "https://example.com/", 6, 6, "{}", 1);
    expect(await prospectDeleteScan(env, humanId)).toEqual({ deleted: 0 });
    expect(await prospectDeleteScan(env, r.id)).toEqual({ deleted: 1 });
    expect(db.prepare("SELECT id FROM scans").all()).toEqual([{ id: humanId }]);
    await expect(prospectDeleteScan(env, "x' OR 1=1 --")).rejects.toThrow("INVALID_SCAN_ID");
  });

  it("is exported as a WorkerEntrypoint class from index", async () => {
    const db = sqlite();
    const { env } = makeEnv(db);
    const ep = new (ProspectScan as unknown as new (c: unknown, e: unknown) => ProspectScan)({}, env);
    const r = await ep.scan("https://example.com/");
    expect((db.prepare("SELECT source FROM scans WHERE id=?").get(r.id) as { source: string }).source).toBe("outreach");
  });
});

describe("public /api/scan unchanged", () => {
  it("still uses rate limit + cache and the exact legacy INSERT (no source column), works without 0005", async () => {
    const db = sqlite(false);
    const { env, kv, sqls } = makeEnv(db);
    const res = await app.fetch(
      new Request("https://scanner.astrant.io/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
        body: JSON.stringify({ url: "https://example.com/" }),
      }),
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(sqls).toContain(INSERT_SCAN_SQL);
    expect(sqls.some((s) => s.includes("source"))).toBe(false);
    expect(kv.gets.some((k) => k.startsWith("scan:v"))).toBe(true);
    expect(kv.puts.some((k) => k.startsWith("scan:v"))).toBe(true);
    expect(kv.gets.length).toBeGreaterThan(1); // rate-limit keys read too
    expect(db.prepare("SELECT COUNT(*) AS n FROM scans WHERE id=?").get(body.id)).toEqual({ n: 1 });
  });
});
