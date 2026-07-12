// P0-C2 prerequisite invariants, verified against a real SQLite engine
// (node:sqlite, Node 24) using the exact statements the handlers run + the real
// schema + migrations — so the DB-enforced privacy invariants can't silently
// drift. (D1 integration behavior is additionally verified post-deploy on
// disposable data per the production runbook.)
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { CAPTURE_SET_EMAIL_SQL, UNSUBSCRIBE_SQL } from "./score-sql";

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(read("../schema.sql"));
  db.exec(read("../migrations/0001_email_capture_columns.sql"));
  db.exec(read("../migrations/0002_tier_column.sql")); // also validates CHECK-in-ADD-COLUMN
  return db;
}

function insertScan(
  db: DatabaseSync,
  o: { id: string; unsubscribed_at?: number | null; opted?: number; tier?: string | null },
): void {
  db.prepare(
    `INSERT INTO scans (id, url, dimensions_scored, dimensions_total, results_json, created_at,
                        email_opted_in_rescan, unsubscribed_at, tier)
     VALUES (?, 'https://x', 6, 6, '{}', 1, ?, ?, ?)`,
  ).run(o.id, o.opted ?? 0, o.unsubscribed_at ?? null, o.tier === undefined ? "free" : o.tier);
}

const state = (db: DatabaseSync, id: string) =>
  db.prepare("SELECT email_opted_in_rescan AS opt, unsubscribed_at AS unsub, tier FROM scans WHERE id=?").get(id) as
    | { opt: number; unsub: number | null; tier: string | null }
    | undefined;

describe("P0-C2 privacy invariants (real SQLite)", () => {
  it("tier CHECK accepts free/paid/NULL and rejects anything else", () => {
    const db = freshDb();
    insertScan(db, { id: "a", tier: "free" });
    insertScan(db, { id: "b", tier: "paid" });
    insertScan(db, { id: "c", tier: null });
    expect(state(db, "a")!.tier).toBe("free");
    expect(state(db, "c")!.tier).toBe(null);
    expect(() => insertScan(db, { id: "d", tier: "bogus" })).toThrow();
  });

  it("unsubscribe clears email_opted_in_rescan and sets unsubscribed_at", () => {
    const db = freshDb();
    insertScan(db, { id: "u", opted: 1 });
    db.prepare(UNSUBSCRIBE_SQL).run(12345, "u");
    expect(state(db, "u")).toMatchObject({ opt: 0, unsub: 12345 });
  });

  it("opt-in is clamped to 0 while unsubscribed (capture-after-unsubscribe)", () => {
    const db = freshDb();
    insertScan(db, { id: "s", unsubscribed_at: 999, opted: 0 });
    // set-email with opted_in=1 must NOT re-enable rescan on an unsubscribed row
    db.prepare(CAPTURE_SET_EMAIL_SQL).run("e@x.com", 1, "tok", "s");
    const r = state(db, "s")!;
    expect(r.opt).toBe(0);
    expect(r.unsub).toBe(999); // still unsubscribed
  });

  it("opt-in sticks for a row that is not unsubscribed", () => {
    const db = freshDb();
    insertScan(db, { id: "n", unsubscribed_at: null, opted: 0 });
    db.prepare(CAPTURE_SET_EMAIL_SQL).run("e@x.com", 1, "tok", "n");
    expect(state(db, "n")!.opt).toBe(1);
  });
});
