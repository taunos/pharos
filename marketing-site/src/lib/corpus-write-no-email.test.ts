import { describe, expect, it } from "vitest";
import { writeAuditToCorpus } from "./corpus-write";

// Dataset spec F-1 (2026-11-05): the corpus has no deletion path, so the buyer's
// email must never be written to it. Record every bound value and check.
function recordingDb(seen: unknown[]): D1Database {
  const stmt = (sql: string) => {
    const s = {
      bind: (...args: unknown[]) => {
        seen.push(sql, ...args);
        return s;
      },
      run: async () => ({ success: true, results: [], meta: { changes: 1, last_row_id: 1 } }),
      first: async () => null,
      all: async () => ({ success: true, results: [], meta: {} }),
      raw: async () => [],
    };
    return s;
  };
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: unknown[]) => stmts.map(() => ({ success: true, results: [], meta: { changes: 1 } })),
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

describe("writeAuditToCorpus", () => {
  it("never stores the buyer email", async () => {
    const email = "buyer-secret@example.com";
    const seen: unknown[] = [];
    const audit = {
      scan: {
        id: "scan-1",
        url: "https://example.com/",
        composite: { score: 70, grade: "B" },
        dimensions_scored: 6,
        dimensions_total: 6,
        dimensions: [],
      },
      gaps: [],
    };
    await writeAuditToCorpus(recordingDb(seen), "test-engine", {
      sessionRecord: { session_id: "sess-1", email, url: "https://example.com/", source_scan_id: null },
      audit,
      dim6Cells: [],
    } as unknown as Parameters<typeof writeAuditToCorpus>[2]).catch(() => undefined);
    expect(seen.length).toBeGreaterThan(0);
    expect(JSON.stringify(seen)).not.toContain(email);
  });
});
