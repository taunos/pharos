import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuditReadyEmailCopy } from "./score-email";
import type { AuditRunEnv } from "./audit-fulfill-run";
import type { AuditFulfillConsumerEnv, AuditFulfillMessage } from "./audit-fulfill-queue-consumer";
import { createSqliteD1, readMigration, type SqliteD1 } from "./test-support/sqlite-d1";
import {
  DEFAULT_AUDIT_REVIEW_HOLD_COUNT,
  REVIEW_GEN_LEASE_MS,
  decideReviewHold,
  parseReviewHoldCount,
  readReviewHold,
  reviewEvidenceKey,
} from "./audit-review-hold";

// Audit review hold (2026-11-12): the first N paid standalone Audits are
// generated but not delivered until a reviewer releases them. Exercised over
// real SQL (migration 0019) through every buyer-email entry point.

const h = vi.hoisted(() => ({
  resendSends: [] as Array<{ payload: Record<string, unknown>; opts?: Record<string, unknown> }>,
  resendError: null as null | { message: string; statusCode?: number | null },
  resendThrow: false,
  alerts: [] as Array<{ alert_code: string; session_id?: string }>,
  runScan: vi.fn(),
  onStorePdf: null as null | ((sessionId: string) => Promise<void>),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>, opts?: Record<string, unknown>) => {
        h.resendSends.push({ payload, opts });
        if (h.resendThrow) throw new Error("socket hang up");
        return h.resendError ? { data: null, error: h.resendError } : { data: { id: "em_1" }, error: null };
      },
    };
  },
}));

vi.mock("./operator-alerts", () => ({
  alertOperator: async (_env: unknown, alert_code: string, session_id: string) => {
    h.alerts.push({ alert_code, session_id });
  },
}));

vi.mock("./audit-pipeline", () => ({
  runScan: (...a: unknown[]) => h.runScan(...a),
  splicePaidDim6: (scan: unknown) => scan,
  buildRemediationGaps: () => [{ check_id: "x" }],
  renderAuditHtml: () => "<html/>",
  generatePdf: async () => new ArrayBuffer(4),
  storePdf: async (env: { AUDITS: R2Bucket }, sessionId: string) => {
    if (h.onStorePdf) await h.onStorePdf(sessionId);
    await env.AUDITS.put(`audits/${sessionId}.pdf`, "PDF");
  },
  storeJson: async (env: { AUDITS: R2Bucket }, sessionId: string, audit: unknown) => {
    await env.AUDITS.put(`audits/${sessionId}.json`, JSON.stringify(audit));
  },
  REMEDIATION_ENGINE_VERSION_TAG: "test-engine",
}));

vi.mock("./corpus-write", () => ({ writeAuditToCorpus: async () => "scan-id" }));

vi.mock("./dim6/runDim6", () => ({
  isDim6CapReached: async () => false,
  runDim6Paid: async () => ({
    dimension: { dimension_id: 6, sub_checks: [] },
    cells: [
      "openai:gpt-4o",
      "anthropic:claude-sonnet",
      "google:gemini-2.5-flash",
      "perplexity:sonar",
    ].map((m) => ({ modelId: m, query: { id: "q1" }, result: { unmeasurable: false, accuracy: "ok" } })),
    raw: { score: 50, cells: [], totalCells: 4 },
    capped: false,
  }),
}));

const COPY: AuditReadyEmailCopy = {
  subject: "TEST SUBJECT",
  text: ({ url, pdfUrl }) => `TEST ${url} ${pdfUrl}`,
  html: () => "<p>TEST</p>",
};

let store: Map<string, string>;
let r2: Map<string, string>;
let sq: SqliteD1;

function makeEnv(extra: Partial<AuditRunEnv> = {}): AuditFulfillConsumerEnv {
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
  const audits = {
    get: async (k: string) => {
      const v = r2.get(k);
      if (v === undefined) return null;
      return {
        body: v,
        text: async () => v,
        arrayBuffer: async () => new TextEncoder().encode(v).buffer,
      };
    },
    put: async (k: string, v: unknown) => {
      r2.set(k, typeof v === "string" ? v : "BIN");
    },
  } as unknown as R2Bucket;
  return {
    AI: {} as Ai,
    SESSIONS: kv,
    AUDITS: audits,
    CF_ACCOUNT_ID: "a",
    CF_API_TOKEN: "t",
    INTERNAL_FULFILL_KEY: "k",
    PHAROS_CORPUS: {} as D1Database,
    CORPUS_DEAD_LETTER: kv,
    CITATION_DB: sq.d1,
    RESEND_API_KEY: "re_test",
    UNSUBSCRIBE_SECRET: "u",
    AUDIT_CHECKOUT_ENABLED: "true",
    AUDIT_FULFILL_QUEUE: { send: vi.fn(async () => undefined) } as unknown as Queue<AuditFulfillMessage>,
    ...extra,
  } as AuditFulfillConsumerEnv;
}

function seed(sessionId: string, status: string, extra: Record<string, unknown> = {}) {
  store.set(
    `audit:${sessionId}`,
    JSON.stringify({
      session_id: sessionId,
      url: "https://example.com/",
      email: "buyer@example.com",
      status,
      created_at: 1,
      paid_at: 2,
      ...extra,
    }),
  );
}
const read = (sessionId: string) => JSON.parse(store.get(`audit:${sessionId}`)!);
const sid = (n: number) => `11111111-2222-4333-8444-${String(n).padStart(12, "0")}`;
const SID = sid(1);

function batch(sessionId: string, attempts = 1) {
  const message = {
    body: { session_id: sessionId, origin: "https://astrant.io" },
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
  return { batch: { queue: "astrant-audit-fulfill", messages: [message] } as unknown as MessageBatch<AuditFulfillMessage>, message };
}

beforeEach(() => {
  store = new Map();
  r2 = new Map();
  sq = createSqliteD1([readMigration("0019_audit_review_holds.sql")]);
  h.resendSends = [];
  h.resendError = null;
  h.resendThrow = false;
  h.alerts = [];
  h.onStorePdf = null;
  h.runScan = vi.fn(async () => ({ composite: { score: 71, grade: "B" }, dimensions: [{ dimension_id: 6 }] }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const { runAuditFulfillment } = await import("./audit-fulfill-run");
const { auditFulfillQueueHandler } = await import("./audit-fulfill-queue-consumer");
const { releaseHeldAudit, listHeldAudits, getHeldAuditForReview, getHeldAuditPdf } = await import(
  "./audit-review-admin"
);

describe("parseReviewHoldCount — fail-closed", () => {
  it("absent / malformed → default 10; plain integers parse; '0' disables", () => {
    expect(DEFAULT_AUDIT_REVIEW_HOLD_COUNT).toBe(10);
    for (const bad of [undefined, "", " 3", "-1", "1.5", "ten", "1e3", "true"]) {
      expect(parseReviewHoldCount(bad)).toBe(10);
    }
    expect(parseReviewHoldCount("0")).toBe(0);
    expect(parseReviewHoldCount("3")).toBe(3);
  });
});

describe("held", () => {
  it("a paid standalone order is generated, held (no email), alerted, evidence stored", async () => {
    seed(SID, "fulfilling");
    const r = await runAuditFulfillment(makeEnv(), SID, "https://astrant.io", { emailCopy: COPY });
    expect(r.kind).toBe("done");
    expect(read(SID).status).toBe("ready");
    expect(read(SID).email_sent_at).toBeUndefined();
    expect(h.resendSends).toHaveLength(0);
    expect(h.alerts.map((a) => a.alert_code)).toContain("AUDIT_REVIEW_HOLD_READY");
    const row = await readReviewHold(sq.d1, SID);
    expect(row).toMatchObject({ held: 1, released_at: null, delivered_at: null });
    const evidence = JSON.parse(r2.get(reviewEvidenceKey(SID))!);
    expect(evidence.cells).toHaveLength(4);
    expect(evidence.summary.cells).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(`AUDIT_REVIEW_HOLD_DELIVERY_SKIPPED session_id=${SID}`);
  });

  it("the hold is decided in D1 before the PDF exists", async () => {
    seed(SID, "fulfilling");
    let rowAtStore: unknown = "unset";
    h.onStorePdf = async (s) => {
      rowAtStore = await readReviewHold(sq.d1, s);
    };
    await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY });
    expect(rowAtStore).toMatchObject({ held: 1, released_at: null });
  });

  it("D1 down → fails closed before the scan: throws, no email, no report", async () => {
    seed(SID, "fulfilling");
    sq.failWhen = () => true;
    await expect(runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY })).rejects.toThrow("D1_ERROR");
    expect(h.runScan).not.toHaveBeenCalled();
    expect(h.resendSends).toHaveLength(0);
    expect(r2.has(`audits/${SID}.pdf`)).toBe(false);
  });

  it("ap- (AutoPilot) sessions are not standalone orders: no hold row", async () => {
    const AP = "ap-sub_abc123-1700000000";
    seed(AP, "fulfilling");
    await runAuditFulfillment(makeEnv(), AP, "o", { emailCopy: COPY });
    expect(await readReviewHold(sq.d1, AP)).toBeNull();
  });
});

describe("count limit (counted in D1)", () => {
  it("only the first N orders are held; order N+1 is delivered normally", async () => {
    const env = makeEnv({ AUDIT_REVIEW_HOLD_COUNT: "2" });
    for (const n of [1, 2, 3]) {
      seed(sid(n), "fulfilling");
      await runAuditFulfillment(env, sid(n), "o", { emailCopy: COPY });
    }
    expect((await readReviewHold(sq.d1, sid(1)))?.held).toBe(1);
    expect((await readReviewHold(sq.d1, sid(2)))?.held).toBe(1);
    expect((await readReviewHold(sq.d1, sid(3)))?.held).toBe(0);
    expect(h.resendSends).toHaveLength(1);
    expect(h.resendSends[0].payload.to).toBe("buyer@example.com");
    expect(read(sid(3)).email_sent_at).toBeTypeOf("number");
    expect(read(sid(1)).email_sent_at).toBeUndefined();
  });

  it("the count survives a fresh process (D1, not memory), and released holds still count", async () => {
    for (const n of [1, 2]) {
      seed(sid(n), "fulfilling");
      await runAuditFulfillment(makeEnv({ AUDIT_REVIEW_HOLD_COUNT: "2" }), sid(n), "o", { emailCopy: COPY });
    }
    await releaseHeldAudit(makeEnv(), sid(1), "https://astrant.io", COPY);
    seed(sid(3), "fulfilling");
    await runAuditFulfillment(makeEnv({ AUDIT_REVIEW_HOLD_COUNT: "2" }), sid(3), "o", { emailCopy: COPY });
    expect((await readReviewHold(sq.d1, sid(3)))?.held).toBe(0);
  });

  it("concurrent orders cannot both take the last slot", async () => {
    const env = makeEnv({ AUDIT_REVIEW_HOLD_COUNT: "1" });
    seed(sid(1), "fulfilling");
    seed(sid(2), "fulfilling");
    await Promise.all([
      runAuditFulfillment(env, sid(1), "o", { emailCopy: COPY }),
      runAuditFulfillment(env, sid(2), "o", { emailCopy: COPY }),
    ]);
    const held = [await readReviewHold(sq.d1, sid(1)), await readReviewHold(sq.d1, sid(2))].filter(
      (r) => r?.held === 1,
    );
    expect(held).toHaveLength(1);
    expect(h.resendSends).toHaveLength(1);
  });
});

describe("retries and resends cannot bypass the hold", () => {
  beforeEach(async () => {
    seed(SID, "fulfilling");
    await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY });
    expect(h.resendSends).toHaveLength(0);
  });

  it("queue duplicate / retry on the ready session (resume path) → no email", async () => {
    const { batch: b, message } = batch(SID, 2);
    await auditFulfillQueueHandler(b, makeEnv(), (env, s, o) => runAuditFulfillment(env, s, o, { emailCopy: COPY }));
    expect(message.ack).toHaveBeenCalled();
    expect(h.resendSends).toHaveLength(0);
  });

  it("operator replay (/api/audit-fulfill, onCap partial) on the ready session → no email", async () => {
    await runAuditFulfillment(makeEnv(), SID, "o", { onCap: "partial", emailCopy: COPY });
    expect(h.resendSends).toHaveLength(0);
  });

  it("a full re-run (status reset to fulfilling) reuses the decision, even with the count lowered to 0", async () => {
    seed(SID, "fulfilling");
    await runAuditFulfillment(makeEnv({ AUDIT_REVIEW_HOLD_COUNT: "0" }), SID, "o", { emailCopy: COPY });
    expect(h.resendSends).toHaveLength(0);
    expect((await readReviewHold(sq.d1, SID))?.held).toBe(1);
  });

  it("resume path with D1 down → throws (queue retries), no email", async () => {
    sq.failWhen = () => true;
    await expect(runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY })).rejects.toThrow("D1_ERROR");
    expect(h.resendSends).toHaveLength(0);
  });
});

describe("release", () => {
  beforeEach(async () => {
    seed(SID, "fulfilling");
    await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY });
  });

  it("delivers through the normal buyer email: once, with the standard idempotency key", async () => {
    const r = await releaseHeldAudit(makeEnv(), SID, "https://astrant.io", COPY);
    expect(r).toMatchObject({ kind: "released", email: "sent" });
    expect(h.resendSends).toHaveLength(1);
    expect(h.resendSends[0].opts).toEqual({ idempotencyKey: `audit-ready:${SID}` });
    expect(h.resendSends[0].payload.to).toBe("buyer@example.com");
    expect(read(SID).email_sent_at).toBeTypeOf("number");
    const row = await readReviewHold(sq.d1, SID);
    expect(row?.released_at).toBeTypeOf("number");
    expect(row?.delivered_at).toBeTypeOf("number");
  });

  it("double release → one email; released_at keeps its first value", async () => {
    const first = await releaseHeldAudit(makeEnv(), SID, "o", COPY);
    const second = await releaseHeldAudit(makeEnv(), SID, "o", COPY);
    expect(second).toMatchObject({ kind: "released", email: "already_sent" });
    expect(h.resendSends).toHaveLength(1);
    if (first.kind === "released" && second.kind === "released") {
      expect(second.hold.released_at).toBe(first.hold.released_at);
    }
  });

  it("double release even when KV has not yet seen email_sent_at → one email (D1 marker)", async () => {
    const stale = store.get(`audit:${SID}`)!;
    await releaseHeldAudit(makeEnv(), SID, "o", COPY);
    store.set(`audit:${SID}`, stale); // KV lag: the second reader sees no email_sent_at
    const second = await releaseHeldAudit(makeEnv(), SID, "o", COPY);
    expect(second).toMatchObject({ email: "already_sent" });
    expect(h.resendSends).toHaveLength(1);
  });

  it("concurrent releases → one email", async () => {
    const env = makeEnv();
    const rs = await Promise.all([
      releaseHeldAudit(env, SID, "o", COPY),
      releaseHeldAudit(env, SID, "o", COPY),
    ]);
    expect(h.resendSends).toHaveLength(1);
    expect(rs.map((r) => (r.kind === "released" ? r.email : r.kind)).sort()).toContain("sent");
  });

  it("queue duplicate after release → no second email", async () => {
    const stale = store.get(`audit:${SID}`)!;
    await releaseHeldAudit(makeEnv(), SID, "o", COPY);
    store.set(`audit:${SID}`, stale);
    const { batch: b } = batch(SID, 1);
    await auditFulfillQueueHandler(b, makeEnv(), (env, s, o) => runAuditFulfillment(env, s, o, { emailCopy: COPY }));
    expect(h.resendSends).toHaveLength(1);
  });

  it("a failed send throws, keeps the release, gives the claim back; releasing again sends", async () => {
    h.resendError = { message: "invalid recipient", statusCode: 422 };
    await expect(releaseHeldAudit(makeEnv(), SID, "o", COPY)).rejects.toMatchObject({
      name: "AuditReadyEmailError",
      reason: "send_error",
    });
    const row = await readReviewHold(sq.d1, SID);
    expect(row?.released_at).toBeTypeOf("number");
    expect(row?.send_claimed_at).toBeNull();
    expect(row?.delivered_at).toBeNull();
    h.resendError = null;
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toMatchObject({ email: "sent" });
    expect(h.resendSends).toHaveLength(2); // one failed attempt + one real send
  });

  it("a send claim of unknown outcome is never retaken automatically, however old; clearing it by hand sends", async () => {
    sq.db.prepare(`UPDATE audit_review_holds SET released_at = 1, send_claimed_at = 1 WHERE session_id = ?`).run(SID);
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toMatchObject({ email: "send_in_progress" });
    expect(h.resendSends).toHaveLength(0);
    sq.db.prepare(`UPDATE audit_review_holds SET send_claimed_at = NULL WHERE session_id = ?`).run(SID);
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toMatchObject({ email: "sent" });
    expect(h.resendSends).toHaveLength(1);
  });

  it("a send that THREW (outcome unknown) keeps the claim, alerts, and is never resent automatically", async () => {
    h.resendThrow = true;
    await expect(releaseHeldAudit(makeEnv(), SID, "o", COPY)).rejects.toMatchObject({ ambiguous: true });
    expect((await readReviewHold(sq.d1, SID))?.send_claimed_at).toBeTypeOf("number");
    expect(h.alerts.map((a) => a.alert_code)).toContain("AUDIT_REVIEW_SEND_OUTCOME_UNKNOWN");
    h.resendThrow = false;
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toMatchObject({ email: "send_in_progress" });
    expect(h.resendSends).toHaveLength(1); // only the ambiguous attempt
  });

  it("SDK-returned transport error (application_error, statusCode null) or 5xx is ambiguous: claim kept", async () => {
    for (const statusCode of [null, 503]) {
      sq.db.prepare(`UPDATE audit_review_holds SET send_claimed_at = NULL`).run();
      h.resendError = { message: "Unable to fetch data", statusCode };
      await expect(releaseHeldAudit(makeEnv(), SID, "o", COPY)).rejects.toMatchObject({ ambiguous: true });
      expect((await readReviewHold(sq.d1, SID))?.send_claimed_at).toBeTypeOf("number");
    }
  });

  it("reconcile not_sent → the next release sends; reconcile delivered → no send ever", async () => {
    const { reconcileHeldAuditSend } = await import("./audit-review-admin");
    h.resendThrow = true;
    await releaseHeldAudit(makeEnv(), SID, "o", COPY).catch(() => {});
    h.resendThrow = false;
    expect(await reconcileHeldAuditSend(makeEnv(), SID, "not_sent")).toEqual({ kind: "reconciled" });
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toMatchObject({ email: "sent" });
    expect(h.resendSends).toHaveLength(2);
    expect(await reconcileHeldAuditSend(makeEnv(), SID, "delivered")).toEqual({ kind: "nothing_to_reconcile" });
  });

  it("reconcile delivered records the send; release then never emails", async () => {
    const { reconcileHeldAuditSend } = await import("./audit-review-admin");
    h.resendThrow = true;
    await releaseHeldAudit(makeEnv(), SID, "o", COPY).catch(() => {});
    h.resendThrow = false;
    expect(await reconcileHeldAuditSend(makeEnv(), SID, "delivered")).toEqual({ kind: "reconciled" });
    expect((await readReviewHold(sq.d1, SID))?.delivered_at).toBeTypeOf("number");
    expect(read(SID).email_sent_at).toBeTypeOf("number");
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toMatchObject({ email: "already_sent" });
    expect(h.resendSends).toHaveLength(1);
  });

  it("delivered marker cannot be written → alert, and a later release does NOT resend", async () => {
    sq.failWhen = (sql) => sql.includes("SET delivered_at");
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toMatchObject({ email: "sent" });
    expect(h.alerts.map((a) => a.alert_code)).toContain("AUDIT_REVIEW_DELIVERED_MARK_FAILED");
    sq.failWhen = null;
    store.set(`audit:${SID}`, JSON.stringify({ ...read(SID), email_sent_at: undefined })); // KV lost it too
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toMatchObject({ email: "send_in_progress" });
    expect(h.resendSends).toHaveLength(1);
  });

  it("a duplicate run after release cannot replace the reviewed report", async () => {
    const reviewedJson = r2.get(`audits/${SID}.json`);
    await releaseHeldAudit(makeEnv(), SID, "o", COPY);
    seed(SID, "fulfilling"); // a stale duplicate that read `fulfilling`
    h.runScan = vi.fn(async () => ({ composite: { score: 10, grade: "F" }, dimensions: [] }));
    const r = await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY });
    expect(r).toEqual({ kind: "noop_terminal", status: "fulfilling" });
    expect(r2.get(`audits/${SID}.json`)).toBe(reviewedJson);
  });

  it("checkout gate closed at release → released but no email; a later release sends", async () => {
    expect(await releaseHeldAudit(makeEnv({ AUDIT_CHECKOUT_ENABLED: "false" }), SID, "o", COPY)).toMatchObject({
      email: "gate_closed",
    });
    expect(h.resendSends).toHaveLength(0);
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toMatchObject({ email: "sent" });
  });

  it("not held / not ready → refused, nothing sent", async () => {
    expect(await releaseHeldAudit(makeEnv(), sid(99), "o", COPY)).toEqual({ kind: "not_held" });
    seed(sid(2), "fulfilling");
    sq.db.prepare(`INSERT INTO audit_review_holds (session_id, held, decided_at) VALUES (?, 1, 1)`).run(sid(2));
    expect(await releaseHeldAudit(makeEnv(), sid(2), "o", COPY)).toEqual({ kind: "not_ready", status: "fulfilling" });
    expect((await readReviewHold(sq.d1, sid(2)))?.released_at).toBeNull();
    expect(h.resendSends).toHaveLength(0);
  });
});

describe("duplicate generation before release", () => {
  it("two concurrent runs of one held order → only one writes artifacts", async () => {
    seed(SID, "fulfilling");
    let writes = 0;
    h.onStorePdf = async () => {
      writes += 1;
    };
    await Promise.all([
      runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY }),
      runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY }),
    ]);
    expect(writes).toBe(1);
    expect((await readReviewHold(sq.d1, SID))?.generated_at).toBeTypeOf("number");
  });

  it("a run that fails mid-store gives the lease back, so the retry can generate", async () => {
    seed(SID, "fulfilling");
    h.onStorePdf = async () => {
      throw new Error("r2 down");
    };
    await expect(runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY })).rejects.toThrow("r2 down");
    expect((await readReviewHold(sq.d1, SID))?.gen_claimed_at).toBeNull();
    h.onStorePdf = null;
    expect((await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY })).kind).toBe("done");
    expect(read(SID).status).toBe("ready");
  });
});

describe("HTTP replay may not generate a held report", () => {
  it("mayGenerateHeld false + held fulfilling order → held_requires_queue, nothing run", async () => {
    seed(SID, "fulfilling");
    expect(
      await runAuditFulfillment(makeEnv(), SID, "o", { onCap: "partial", mayGenerateHeld: false, emailCopy: COPY }),
    ).toEqual({ kind: "held_requires_queue" });
    expect(h.runScan).not.toHaveBeenCalled();
    expect(r2.has(`audits/${SID}.pdf`)).toBe(false);
  });

  it("mayGenerateHeld false on a NOT held order runs normally", async () => {
    seed(SID, "fulfilling");
    const r = await runAuditFulfillment(makeEnv({ AUDIT_REVIEW_HOLD_COUNT: "0" }), SID, "o", {
      mayGenerateHeld: false,
      emailCopy: COPY,
    });
    expect(r.kind).toBe("done");
  });
});

describe("abandoned generation lease", () => {
  it("live lease held by another run → generation_in_progress; queue re-sends past the lease, does not ack as done", async () => {
    seed(SID, "fulfilling");
    await decideReviewHold(sq.d1, SID, 10);
    sq.db.prepare(`UPDATE audit_review_holds SET gen_claimed_at = ? WHERE session_id = ?`).run(Date.now(), SID);
    expect(await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY })).toEqual({ kind: "generation_in_progress" });
    const env = makeEnv();
    const { batch: b, message } = batch(SID, 1);
    await auditFulfillQueueHandler(b, env, (e, s, o) => runAuditFulfillment(e, s, o, { emailCopy: COPY }));
    expect(message.ack).toHaveBeenCalled();
    expect(env.AUDIT_FULFILL_QUEUE.send).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: SID, rechecks: 1 }),
      { delaySeconds: 31 * 60 },
    );
    expect(r2.has(`audits/${SID}.pdf`)).toBe(false);
  });

  it("an expired lease (holder dead) is retaken and the report generated", async () => {
    seed(SID, "fulfilling");
    await decideReviewHold(sq.d1, SID, 10);
    sq.db
      .prepare(`UPDATE audit_review_holds SET gen_claimed_at = ? WHERE session_id = ?`)
      .run(Date.now() - REVIEW_GEN_LEASE_MS - 1, SID);
    expect((await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY })).kind).toBe("done");
    expect((await readReviewHold(sq.d1, SID))?.generated_at).toBeTypeOf("number");
  });

  it("ready in KV but the generated marker never written: release adopts once the lease expired, not before", async () => {
    seed(SID, "ready", { completed_at: 9 });
    r2.set(`audits/${SID}.pdf`, "PDF");
    await decideReviewHold(sq.d1, SID, 10);
    sq.db.prepare(`UPDATE audit_review_holds SET gen_claimed_at = ? WHERE session_id = ?`).run(Date.now(), SID);
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toEqual({
      kind: "not_ready",
      status: "generation_in_progress",
    });
    sq.db
      .prepare(`UPDATE audit_review_holds SET gen_claimed_at = ? WHERE session_id = ?`)
      .run(Date.now() - REVIEW_GEN_LEASE_MS - 1, SID);
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toMatchObject({ email: "sent" });
  });
});

describe("slot order = payment order", () => {
  it("an order decided at payment keeps its slot even if later orders are fulfilled first", async () => {
    const env = makeEnv({ AUDIT_REVIEW_HOLD_COUNT: "1" });
    await decideReviewHold(sq.d1, sid(1), 1); // webhook, order 1 pays first; its queue message is delayed
    await decideReviewHold(sq.d1, sid(2), 1); // webhook, order 2
    seed(sid(2), "fulfilling");
    await runAuditFulfillment(env, sid(2), "o", { emailCopy: COPY });
    seed(sid(1), "fulfilling");
    await runAuditFulfillment(env, sid(1), "o", { emailCopy: COPY });
    expect((await readReviewHold(sq.d1, sid(1)))?.held).toBe(1);
    expect((await readReviewHold(sq.d1, sid(2)))?.held).toBe(0);
    expect(h.resendSends.map((x) => x.payload.to)).toHaveLength(1);
    expect(read(sid(1)).email_sent_at).toBeUndefined();
  });
});

describe("pre-hold sessions", () => {
  it("a session already ready before the hold existed is held on the email path and can still be released", async () => {
    seed(SID, "ready", { completed_at: 9 });
    r2.set(`audits/${SID}.pdf`, "PDF");
    await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY });
    expect(h.resendSends).toHaveLength(0);
    expect(await releaseHeldAudit(makeEnv(), SID, "o", COPY)).toMatchObject({ email: "sent" });
    expect((await readReviewHold(sq.d1, SID))?.generated_at).toBe(9);
  });
});

describe("review list / fetch", () => {
  it("lists held reports (no buyer email) and fetches report + Dim 6 cells + PDF", async () => {
    seed(SID, "fulfilling");
    await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY });
    const list = await listHeldAudits(makeEnv());
    expect(list).toHaveLength(1);
    expect(list[0].hold.session_id).toBe(SID);
    expect(list[0].session).toMatchObject({ status: "ready", url: "https://example.com/" });
    expect(JSON.stringify(list)).not.toContain("buyer@example.com");

    const review = await getHeldAuditForReview(makeEnv(), SID);
    expect(review?.dim6_dimension).toEqual({ dimension_id: 6 });
    expect((review?.dim6_evidence as { cells: unknown[] }).cells).toHaveLength(4);
    expect(review?.audit).toBeTruthy();
    expect(await getHeldAuditPdf(makeEnv(), SID)).not.toBeNull();
    expect(await getHeldAuditForReview(makeEnv(), sid(99))).toBeNull();
  });
});
