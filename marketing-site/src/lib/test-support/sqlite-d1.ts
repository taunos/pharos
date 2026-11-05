// Slice Q — test-only D1 stand-in over node:sqlite (Node >= 22.5; CI runs 24),
// so the lease / CAS / release SQL is exercised against a real SQL engine
// rather than string-matched. Imported by *.test.ts files only.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type SqlCall = { sql: string; params: unknown[] };

export interface SqliteD1 {
  db: DatabaseSync;
  d1: D1Database;
  calls: SqlCall[];
  // Return true to make that statement throw (fault injection).
  failWhen: ((sql: string) => boolean) | null;
}

const MIGRATIONS = new URL("../../../../citation-tracking/migrations/", import.meta.url);

export function readMigration(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, MIGRATIONS)), "utf8");
}

export function createSqliteD1(schemaSql: string[]): SqliteD1 {
  const db = new DatabaseSync(":memory:");
  for (const s of schemaSql) db.exec(s);
  const state: SqliteD1 = { db, d1: null as unknown as D1Database, calls: [], failWhen: null };
  const check = (sql: string) => {
    if (state.failWhen?.(sql)) throw new Error("D1_ERROR: injected failure");
  };
  state.d1 = {
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt = {
        bind(...p: unknown[]) {
          params = p;
          return stmt;
        },
        async run() {
          state.calls.push({ sql, params });
          check(sql);
          const r = db.prepare(sql).run(...(params as never[]));
          return { success: true, meta: { changes: Number(r.changes) } };
        },
        async first<T>() {
          state.calls.push({ sql, params });
          check(sql);
          return ((db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null) as T | null;
        },
        async all<T>() {
          state.calls.push({ sql, params });
          check(sql);
          return { success: true, results: db.prepare(sql).all(...(params as never[])) as T[] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return state;
}

// Minimal tables the Slice Q paths touch besides implementation_sessions.
export const PROBE_TARGETS_SQL = `CREATE TABLE customer_probe_targets (
  customer_id TEXT PRIMARY KEY, domain TEXT, brand_name TEXT, category TEXT, competitors TEXT,
  status TEXT, created_at INTEGER, updated_at INTEGER, probe_cadence TEXT, next_probe_at INTEGER)`;
export const SUBSCRIPTIONS_SQL = `CREATE TABLE subscriptions (
  subscription_id TEXT PRIMARY KEY, customer_id TEXT, customer_email TEXT, product_id TEXT,
  status TEXT, audit_fired_at INTEGER)`;
