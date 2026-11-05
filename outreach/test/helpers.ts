// Test harness: real migration on node:sqlite behind a D1-shaped adapter, plus
// fakes for the mailbox, scanner, Workers AI and fetch. No network, no real credentials.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Alerter } from "../src/alerts";
import type { Deps } from "../src/index";
import type { DrainResult, InboundMail, MailClient, OutreachDraft, SentMail, SentResult } from "../src/mail/types";
import type { DimensionResult, Env, ScanResult, SubCheck } from "../src/types";

const MIGRATION = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");

export function makeD1(sqlite: DatabaseSync) {
  const run = (sql: string, binds: unknown[]) => {
    const st = sqlite.prepare(sql);
    if (/\bRETURNING\b/i.test(sql)) {
      const rows = st.all(...(binds as never[]));
      return { changes: rows.length, rows };
    }
    const info = st.run(...(binds as never[]));
    return { changes: Number(info.changes), rows: [] as unknown[] };
  };
  const prepare = (sql: string) => {
    const stmt = {
      _sql: sql,
      _binds: [] as unknown[],
      bind(...a: unknown[]) {
        // Real D1 rejects more than 100 bound parameters per statement; node:sqlite
        // allows ~32k, so without this a fake-backed test can't catch the overflow.
        if (a.length > 100) throw new Error(`D1_ERROR: too many SQL variables (${a.length} > 100)`);
        const s2 = prepare(sql);
        s2._binds = a.map((x) => (x === undefined ? null : typeof x === "boolean" ? (x ? 1 : 0) : x));
        return s2;
      },
      async run() {
        const r = run(sql, stmt._binds);
        return { success: true, meta: { changes: r.changes }, results: r.rows };
      },
      async first<T = unknown>() {
        if (/^\s*(UPDATE|INSERT|DELETE)/i.test(sql)) {
          const r = run(sql, stmt._binds);
          return (r.rows[0] ?? null) as T | null;
        }
        return (sqlite.prepare(sql).get(...(stmt._binds as never[])) ?? null) as T | null;
      },
      async all<T = unknown>() {
        return { success: true, results: sqlite.prepare(sql).all(...(stmt._binds as never[])) as T[], meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  const batch = async (stmts: ReturnType<typeof prepare>[]) => {
    sqlite.exec("BEGIN");
    try {
      const out = stmts.map((s) => {
        const r = run(s._sql, s._binds);
        return { success: true, meta: { changes: r.changes }, results: r.rows };
      });
      sqlite.exec("COMMIT");
      return out;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  };
  return { prepare, batch } as unknown as D1Database;
}

// E5: the marketing opt-out lists, built from the real citation-tracking migrations.
const OPTOUT_LIST_MIGRATIONS = ["0011_email_suppressions.sql", "0017_outreach_do_not_contact.sql"].map((f) =>
  readFileSync(new URL(`../../citation-tracking/migrations/${f}`, import.meta.url), "utf8")
);

export function freshOptoutListsDb(): { sqlite: DatabaseSync; db: D1Database } {
  const sqlite = new DatabaseSync(":memory:");
  for (const m of OPTOUT_LIST_MIGRATIONS) sqlite.exec(m);
  return { sqlite, db: makeD1(sqlite) };
}

export function freshDb(): { sqlite: DatabaseSync; db: D1Database } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(MIGRATION);
  return { sqlite, db: makeD1(sqlite) };
}

// Fixed test secrets (test values only; never used anywhere else).
export const TEST_OPTOUT_SECRET = "test-optout-secret";
export const TEST_SUPPRESSION_SECRET = "test-suppression-secret";
export const TEST_POSTAL = "123 Test Street, Testville";

export class FakeScanner {
  calls: string[] = [];
  deleted: string[] = [];
  next: ((url: string) => ScanResult) | null = null;
  fail = false;
  async scan(url: string): Promise<ScanResult> {
    this.calls.push(url);
    if (this.fail) throw new Error("SCAN_INSERT_FAILED: boom");
    return (this.next ?? ((u) => gappyScan(u)))(url);
  }
  async deleteScan(id: string) {
    this.deleted.push(id);
    return { deleted: 1 };
  }
}

export class FakeAI {
  calls = 0;
  responses: unknown[] = [];
  async run(_model: string, _input: Record<string, unknown>): Promise<unknown> {
    this.calls++;
    if (this.responses.length) return this.responses.shift();
    return { response: "not json" };
  }
}

/** Drafts-only fake mailbox: no send method exists. `sentFolder` simulates what Bruno sent by hand. */
export class FakeMail implements MailClient {
  drafts: OutreachDraft[] = [];
  inbox: InboundMail[] = [];
  sentFolder: SentMail[] = [];
  drainCalls = 0;
  caughtUp = true;
  draftImpl: ((d: OutreachDraft) => Promise<{ draftId: string | null }>) | null = null;
  async drainInbox(_cursor: string | null, _maxPages: number): Promise<DrainResult> {
    this.drainCalls++;
    const messages = this.inbox;
    this.inbox = [];
    return { messages, caughtUp: this.caughtUp, cursor: String(Date.now()) };
  }
  async listSent(_cursor: string | null, _maxPages: number): Promise<SentResult> {
    const messages = this.sentFolder;
    this.sentFolder = [];
    return { messages, caughtUp: true, cursor: "c" };
  }
  async createDraft(d: OutreachDraft) {
    if (this.draftImpl) return this.draftImpl(d);
    this.drafts.push(d);
    return { draftId: "d-" + this.drafts.length };
  }
  /** Simulates Bruno clicking send on draft i. */
  bruno_sends(i: number, at: number, rfcMessageId = `<sent-${i}@getastrant.com>`): void {
    const d = this.drafts[i];
    this.sentFolder.push({ providerMessageId: `sent-${i}-${at}`, providerThreadId: `thr-${d.to}`, sentAt: at, to: [d.to], subject: d.subject, rfcMessageId, text: d.text });
  }
}

export function makeFetch(routes: Record<string, { status: number; body?: string; ct?: string }> = {}) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(r.body ?? "", { status: r.status, headers: { "content-type": r.ct ?? "text/html" } });
  }) as typeof fetch;
  return { f, calls };
}

export function makeEnv(db: D1Database, over: Partial<Env> = {}): Env & { SCANNER: FakeScanner; AI: FakeAI } {
  return {
    DB: db,
    OPTOUT_LISTS_DB: freshOptoutListsDb().db,
    SCANNER: new FakeScanner(),
    AI: new FakeAI(),
    OUTREACH_MODE: "gated",
    DAILY_CAP_MAX: "30",
    DRAFTS_PER_DAY: "10",
    PROSPECT_SCANS_PER_DAY: "40",
    MAIL_FROM: "bruno@getastrant.com",
    PUBLIC_BASE_URL: "https://go.getastrant.com",
    SCORE_BASE_URL: "https://astrant.io/score/",
    PRIVACY_URL: "https://astrant.io/privacy#prospecting",
    OPTOUT_HMAC_SECRET: TEST_OPTOUT_SECRET,
    SUPPRESSION_HMAC_SECRET: TEST_SUPPRESSION_SECRET,
    POSTAL_ADDRESS: TEST_POSTAL,
    OPERATOR_ALERT_TO: "ops@example.test",
    ...over,
  } as Env & { SCANNER: FakeScanner; AI: FakeAI };
}

export function clock(start: number) {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v), add: (ms: number) => (t += ms) };
}

export const alerts: { kind: string }[] = [];
export const noopAlert: Alerter = async (kind) => {
  alerts.push({ kind });
};

export function deps(env: Env, over: Partial<Deps> & { now: () => number }): Deps {
  return { fetch: makeFetch().f, mail: new FakeMail(), ai: env.AI, alert: noopAlert, ...over };
}

// ── scan fixtures ───────────────────────────────────────────────────────

function sc(id: string, weight: number, score: number, notes: string, extra: Partial<SubCheck> = {}): SubCheck {
  return { id, name: id, weight, score, passed: score >= 70, notes, ...extra };
}
function dim(id: number, name: string, subs: SubCheck[], extra: Partial<DimensionResult> = {}): DimensionResult {
  return { dimension_id: id, dimension_name: name, score: 30, grade: "F", sub_checks: subs, ...extra };
}

/** Dim 4 same-response evidence as the current scanner emits it for a 200 HTML homepage (example.com). */
export const HOMEPAGE_OK = homepageOk("example.com");
export function homepageOk(host: string) {
  return {
    status: 200,
    content_type: "text/html; charset=utf-8",
    parsed: true,
    requested_url: `https://${host}/`,
    final_url: `https://www.${host}/`, // same-site redirect to www is fine
    body_complete: true,
    ld_json_absent_proven: true,
  };
}
export function llmsNotFound(host: string) {
  return { status: 404, content_type: "text/html", parsed: false, requested_url: `https://${host}/llms.txt`, final_url: `https://${host}/llms.txt` };
}

/** A scan with three claimable gaps: llms.txt 404, no JSON-LD (homepage answered), no Markdown. */
export function gappyScan(url = "https://example.com/", id = "aaaaaaaa-0000-4000-8000-000000000001"): ScanResult {
  const host = new URL(url).hostname;
  const HOMEPAGE_OK = homepageOk(host);
  return {
    id,
    url,
    composite: { score: 42, grade: "D" },
    dimensions_applicable: 5,
    created_at: 1,
    tier: "free",
    dimensions: [
      dim(1, "llms.txt Quality", [sc("presence", 25, 0, "status=404", { evidence: llmsNotFound(host) }), sc("spec_compliance", 25, 0, "h1=no, blockquote=no"), sc("blockquote_eval", 15, 50, "LLM rated blockquote 50/100")]),
      dim(2, "MCP Server Discoverability", [sc("well_known", 30, 0, "no /.well-known/mcp")]),
      dim(3, "OpenAPI / API Catalog", [sc("discovery", 1, 0, "n/a", { na: true })], { na: true }),
      dim(4, "Structured Capability Data", [
        sc("json_ld_present", 25, 0, "no JSON-LD found on homepage", { evidence: HOMEPAGE_OK }),
        sc("organization_schema", 20, 0, "no Organization schema", { evidence: HOMEPAGE_OK }),
        sc("faq_schema", 20, 0, "0 Q&A pair(s); skipped (no questions)", { evidence: HOMEPAGE_OK }),
      ]),
      dim(5, "Agent Parsability", [sc("markdown_negotiation", 25, 25, "No markdown variant or content negotiation. Agents must fall back to HTML extraction.")]),
      dim(6, "Citation Visibility", [sc("free_tier_dim6_preview", 1, 0, "demo", { na: true })], { na: true }),
    ],
  };
}

export async function insertLead(db: D1Database, l: { id?: string; domain: string; state?: string; icp_ok?: number | null; country?: string | null; contact_email?: string | null; scanned_at?: number | null; fact_sheet_json?: string | null; scan_id?: string | null }, now = 1): Promise<string> {
  const id = l.id ?? crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO leads (id, domain, source, country, state, icp_ok, contact_email, contact_source_url, scanned_at, fact_sheet_json, scan_id, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    .bind(id, l.domain, "test", l.country ?? null, l.state ?? "new", l.icp_ok === undefined ? 1 : l.icp_ok, l.contact_email ?? null, l.contact_email ? `https://${l.domain}/contact` : null, l.scanned_at ?? null, l.fact_sheet_json ?? null, l.scan_id ?? null, now, now)
    .run();
  return id;
}

export function inboundMail(over: Partial<InboundMail>): InboundMail {
  return {
    providerMessageId: crypto.randomUUID(),
    providerThreadId: null,
    receivedAt: 1,
    from: "hello@example.com",
    subject: "Re: Two fixes for example.com",
    headers: {},
    text: "",
    dsn: null,
    ...over,
  };
}

// Weekday 2026-11-10 (Tuesday) 14:00 UTC — inside the send window.
export const TUE_1400 = Date.UTC(2026, 10, 10, 14, 0, 0);
