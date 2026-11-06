import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSqliteD1, type SqliteD1 } from "../test-support/sqlite-d1";
import {
  canonicalDomain,
  resolveQuestionSet,
  DIM6_QUESTION_SET_VERSION,
  type QuestionSetEnv,
} from "./question-set";
import { isValidQuestionSet } from "./promptset";

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../../corpus/migrations/0004_dim6_question_set.sql", import.meta.url)),
  "utf8"
);

// Each generator call returns a DIFFERENT valid set (tagged by call number),
// so any reuse/convergence assertion fails if a second generation leaks out.
function makeAi(opts: { mode?: "good" | "garbage"; delayMs?: () => number } = {}) {
  const prompts: string[] = [];
  let n = 0;
  const ai = {
    run: async (_model: string, input: { messages: Array<{ content: string }> }) => {
      prompts.push(input.messages[0].content);
      const call = ++n;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs!()));
      if (opts.mode === "garbage") return { response: "not json" };
      const set = Array.from({ length: 10 }, (_, i) => ({
        id: `q${i + 1}`,
        text: `Run ${call}: which tool helps with task number ${i + 1}?`,
        rationale: "test",
      }));
      return { response: JSON.stringify(set) };
    },
  };
  return { ai: ai as unknown as Ai, prompts, calls: () => n };
}

let sq: SqliteD1;
beforeEach(() => {
  sq = createSqliteD1([MIGRATION]);
});

function env(ai: Ai, db: D1Database = sq.d1): QuestionSetEnv {
  return { AI: ai, questionSetDb: db };
}

function rows() {
  return sq.db.prepare("SELECT * FROM dim6_question_set").all() as Array<{
    canonical_domain: string;
    question_set_version: string;
    queries_json: string;
    source: string;
  }>;
}

describe("canonicalDomain", () => {
  it("drops scheme, www, port, path, query, fragment, trailing dot; lowercases", () => {
    for (const u of [
      "https://example.com",
      "https://WWW.Example.COM/pricing?ref=x#top",
      "http://example.com:8080/",
      "https://www.example.com./",
      "example.com",
    ]) {
      expect(canonicalDomain(u)).toBe("example.com");
    }
  });
  it("keeps non-www subdomains distinct and rejects non-http(s)", () => {
    expect(canonicalDomain("https://docs.example.com/")).toBe("docs.example.com");
    expect(canonicalDomain("ftp://example.com/")).toBeNull();
    expect(canonicalDomain("https://")).toBeNull();
  });
});

describe("resolveQuestionSet", () => {
  it("reuses the stored set on a second run without calling the generator", async () => {
    const g = makeAi();
    const first = await resolveQuestionSet(env(g.ai), "https://example.com/");
    expect(g.calls()).toBe(1);
    const second = await resolveQuestionSet(env(g.ai), "https://example.com/");
    expect(g.calls()).toBe(1);
    expect(second).toEqual(first);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      canonical_domain: "example.com",
      question_set_version: DIM6_QUESTION_SET_VERSION,
      source: "generated",
    });
  });

  it("different URL forms of one domain share one set", async () => {
    const g = makeAi();
    const a = await resolveQuestionSet(env(g.ai), "https://www.Example.com/pricing?utm=1");
    const b = await resolveQuestionSet(env(g.ai), "http://example.com:8443/");
    const c = await resolveQuestionSet(env(g.ai), "https://example.com./about");
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(g.calls()).toBe(1);
    expect(rows()).toHaveLength(1);
    // The generator sees the canonical domain, never the typed path/query.
    expect(g.prompts[0]).toContain("TARGET DOMAIN: example.com");
    expect(g.prompts[0]).not.toContain("pricing");
    expect(g.prompts[0]).not.toContain("utm");
  });

  it("concurrent first runs converge on one stored set", async () => {
    const g = makeAi({ delayMs: () => Math.floor(Math.random() * 5) });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => resolveQuestionSet(env(g.ai), "https://example.com/"))
    );
    expect(g.calls()).toBeGreaterThan(1); // they really did race
    for (const r of results) expect(r).toEqual(results[0]);
    expect(rows()).toHaveLength(1);
    expect(JSON.parse(rows()[0].queries_json)).toEqual(results[0]);
  });

  it("re-validates a stored row and never uses an invalid one", async () => {
    const bad = Array.from({ length: 10 }, (_, i) => ({
      id: `q${i + 1}`,
      text: i === 0 ? "Tell me everything about example.com please" : `Valid stored question ${i + 1}?`,
      rationale: null,
    }));
    sq.db
      .prepare("INSERT INTO dim6_question_set VALUES (?, ?, ?, ?, ?)")
      .run("example.com", DIM6_QUESTION_SET_VERSION, JSON.stringify(bad), "generated", 1);
    const g = makeAi();
    const out = await resolveQuestionSet(env(g.ai), "https://example.com/");
    expect(g.calls()).toBe(1);
    expect(out.some((q) => /tell me everything/i.test(q.text))).toBe(false);
    expect(isValidQuestionSet(out)).toBe(true);
  });

  it("rejects malformed stored JSON / wrong count", () => {
    expect(isValidQuestionSet(null)).toBe(false);
    expect(isValidQuestionSet([{ id: "q1", text: "What does example.com do?", rationale: null }])).toBe(false);
    const dupIds = Array.from({ length: 10 }, () => ({ id: "q1", text: "What does example.com do?", rationale: null }));
    expect(isValidQuestionSet(dupIds)).toBe(false);
  });

  it("does not store a pure bank fallback; the next good generation is stored", async () => {
    const bad = makeAi({ mode: "garbage" });
    const bank = await resolveQuestionSet(env(bad.ai), "https://example.com/");
    expect(bank[0].id).toBe("q_bank_1");
    expect(bank[0].text).toContain("example.com");
    expect(rows()).toHaveLength(0);

    const good = makeAi();
    const gen = await resolveQuestionSet(env(good.ai), "https://example.com/");
    expect(gen[0].id).toBe("q1");
    expect(rows()).toHaveLength(1);
  });

  it("a different question_set_version is never reused; the current one gets its own row", async () => {
    const old = Array.from({ length: 10 }, (_, i) => ({
      id: `q${i + 1}`,
      text: `Old version question ${i + 1}?`,
      rationale: null,
    }));
    sq.db
      .prepare("INSERT INTO dim6_question_set VALUES (?, ?, ?, ?, ?)")
      .run("example.com", "dim6-qs:v0", JSON.stringify(old), "generated", 1);
    const g = makeAi();
    const out = await resolveQuestionSet(env(g.ai), "https://example.com/");
    expect(g.calls()).toBe(1);
    expect(out[0].text).not.toContain("Old version");
    expect(rows().map((r) => r.question_set_version).sort()).toEqual(
      ["dim6-qs:v0", DIM6_QUESTION_SET_VERSION].sort()
    );
  });

  it("fails open when the table is missing (migration not yet applied)", async () => {
    const noTable = createSqliteD1([]);
    const g = makeAi();
    const out = await resolveQuestionSet(env(g.ai, noTable.d1), "https://example.com/");
    expect(isValidQuestionSet(out)).toBe(true);
    expect(g.calls()).toBe(1);
  });

  it("fails open when the write fails after a successful read", async () => {
    sq.failWhen = (sql) => sql.startsWith("INSERT");
    const g = makeAi();
    const out = await resolveQuestionSet(env(g.ai), "https://example.com/");
    expect(isValidQuestionSet(out)).toBe(true);
    expect(rows()).toHaveLength(0);
  });
});
