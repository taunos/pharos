import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuditReadyEmailCopy } from "./score-email";
import type { AuditRunEnv } from "./audit-fulfill-run";

// Test C-A (A3/A4 + R2-2/R2-4/R2-5) — runAuditFulfillment.

const h = vi.hoisted(() => ({
  capPeek: false,
  dim6Capped: false,
  cells: [] as Array<{ modelId: string; result: { unmeasurable: boolean } }>,
  resendSends: [] as Array<{ payload: Record<string, unknown>; opts?: Record<string, unknown> }>,
  resendError: null as null | { message: string },
  alerts: [] as Array<{ alert_code: string; session_id?: string; notes?: string }>,
  runScan: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>, opts?: Record<string, unknown>) => {
        h.resendSends.push({ payload, opts });
        return h.resendError ? { data: null, error: h.resendError } : { data: { id: "em_1" }, error: null };
      },
    };
  },
}));

vi.mock("./operator-alerts", () => ({
  alertOperator: async (_env: unknown, alert_code: string, session_id: string, notes?: string) => {
    h.alerts.push({ alert_code, session_id, notes });
  },
}));

vi.mock("./audit-pipeline", () => ({
  runScan: (...a: unknown[]) => h.runScan(...a),
  splicePaidDim6: (scan: unknown) => scan,
  llmEnrichGaps: async () => [{ check_id: "x" }],
  renderAuditHtml: () => "<html/>",
  generatePdf: async () => new ArrayBuffer(4),
  storePdf: async () => undefined,
  storeJson: async () => undefined,
  REMEDIATION_ENGINE_VERSION_TAG: "test-engine",
}));

vi.mock("./corpus-write", () => ({
  writeAuditToCorpus: async () => "scan-id",
}));

vi.mock("./dim6/runDim6", () => ({
  isDim6CapReached: async () => h.capPeek,
  runDim6Paid: async () => ({
    dimension: { dimension_id: 6 },
    cells: h.cells,
    raw: null,
    capped: h.dim6Capped,
  }),
}));

const COPY: AuditReadyEmailCopy = {
  subject: "TEST SUBJECT",
  text: ({ url, pdfUrl }) => `TEST ${url} ${pdfUrl}`,
  html: () => "<p>TEST</p>",
};

const ALL_MEASURED = [
  "openai:gpt-4o",
  "anthropic:claude-sonnet",
  "google:gemini-2.5-flash",
  "perplexity:sonar",
].map((m) => ({ modelId: m, result: { unmeasurable: false } }));

let store: Map<string, string>;

function makeEnv(extra: Partial<AuditRunEnv> = {}): AuditRunEnv {
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
  return {
    AI: {} as Ai,
    SESSIONS: kv,
    AUDITS: {
      get: async () => ({ arrayBuffer: async () => new ArrayBuffer(2) }),
    } as unknown as R2Bucket,
    CF_ACCOUNT_ID: "a",
    CF_API_TOKEN: "t",
    INTERNAL_FULFILL_KEY: "k",
    PHAROS_CORPUS: {} as D1Database,
    CORPUS_DEAD_LETTER: kv,
    CITATION_DB: {
      prepare: () => ({
        bind: () => ({ first: async () => ({ customer_email: "sub@example.com" }) }),
      }),
    } as unknown as D1Database,
    RESEND_API_KEY: "re_test",
    UNSUBSCRIBE_SECRET: "u",
    AUDIT_CHECKOUT_ENABLED: "true",
    ...extra,
  };
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
      ...extra,
    }),
  );
}
const read = (sessionId: string) => JSON.parse(store.get(`audit:${sessionId}`)!);

const SID = "11111111-2222-4333-8444-555555555555";
const AP = "ap-sub_abc123-1700000000";

beforeEach(() => {
  store = new Map();
  h.capPeek = false;
  h.dim6Capped = false;
  h.cells = ALL_MEASURED;
  h.resendSends = [];
  h.resendError = null;
  h.alerts = [];
  h.runScan = vi.fn(async () => ({ composite: { score: 71, grade: "B" } }));
});

describe("runAuditFulfillment — result kinds", async () => {
  const { runAuditFulfillment } = await import("./audit-fulfill-run");

  it("unknown session → not_found", async () => {
    expect(await runAuditFulfillment(makeEnv(), "smoke-x", "https://astrant.io")).toEqual({ kind: "not_found" });
  });

  it("awaiting_payment → not_yet_paid (no scan)", async () => {
    seed(SID, "awaiting_payment");
    expect(await runAuditFulfillment(makeEnv(), SID, "https://astrant.io")).toEqual({ kind: "not_yet_paid" });
    expect(h.runScan).not.toHaveBeenCalled();
  });

  it("error → noop_terminal", async () => {
    seed(SID, "error");
    expect(await runAuditFulfillment(makeEnv(), SID, "o")).toEqual({ kind: "noop_terminal", status: "error" });
  });

  it("cap peek hit → cap_deferred BEFORE runScan", async () => {
    seed(SID, "fulfilling");
    h.capPeek = true;
    expect(await runAuditFulfillment(makeEnv(), SID, "o")).toEqual({ kind: "cap_deferred" });
    expect(h.runScan).not.toHaveBeenCalled();
    expect(read(SID).status).toBe("fulfilling");
  });

  it("cap hit inside runDim6Paid (race) → cap_deferred, never ready", async () => {
    seed(SID, "fulfilling");
    h.dim6Capped = true;
    expect(await runAuditFulfillment(makeEnv(), SID, "o", { onCap: "defer" })).toEqual({ kind: "cap_deferred" });
    expect(read(SID).status).toBe("fulfilling");
  });

  it('onCap "partial" (HTTP wrapper): cap reached → pre-C-A behaviour, ships ready with the n/a Dim 6', async () => {
    seed(SID, "fulfilling");
    h.capPeek = true;
    h.dim6Capped = true;
    h.cells = [];
    const r = await runAuditFulfillment(makeEnv(), SID, "o", { onCap: "partial", emailCopy: COPY });
    expect(r.kind).toBe("done");
    expect(h.runScan).toHaveBeenCalledTimes(1);
    expect(read(SID).status).toBe("ready");
  });

  it("pipeline failure throws and NEVER writes error", async () => {
    seed(SID, "fulfilling");
    h.runScan = vi.fn(async () => {
      throw new Error("scanner down");
    });
    await expect(runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY })).rejects.toThrow("scanner down");
    expect(read(SID).status).toBe("fulfilling");
  });
});

describe("runAuditFulfillment — buyer email (A4 + R2-5)", async () => {
  const { runAuditFulfillment } = await import("./audit-fulfill-run");

  it("standalone: sends once with reply_to + idempotency key, sets email_sent_at; replay does not resend", async () => {
    seed(SID, "fulfilling");
    store.set(`funnel:audit:${SID}`, JSON.stringify({ created_at: 1, source_scan_id: null, status: "paid" }));
    const r = await runAuditFulfillment(makeEnv(), SID, "https://astrant.io", { emailCopy: COPY });
    expect(r).toEqual({ kind: "done", composite_score: 71, grade: "B", gap_count: 1 });
    expect(read(SID).status).toBe("ready");
    expect(typeof read(SID).email_sent_at).toBe("number");
    expect(JSON.parse(store.get(`funnel:audit:${SID}`)!).status).toBe("ready");
    expect(h.resendSends).toHaveLength(1);
    const { payload, opts } = h.resendSends[0];
    expect(payload.from).toBe("Astrant <reports@astrant.io>");
    expect(payload.to).toBe("buyer@example.com");
    expect(payload.replyTo).toBe("contact@astrant.io");
    expect(payload.subject).toBe("TEST SUBJECT");
    expect(payload.text).toBe(`TEST https://example.com/ https://astrant.io/audit-results/${SID}/pdf`);
    expect(payload.html).toBe("<p>TEST</p>");
    expect(payload.attachments).toEqual([{ filename: `astrant-audit-${SID}.pdf`, content: "AAA=" }]);
    expect(opts).toEqual({ idempotencyKey: `audit-ready:${SID}` });

    // Replay of a ready session with email_sent_at → noop, no resend.
    expect(await runAuditFulfillment(makeEnv(), SID, "https://astrant.io", { emailCopy: COPY })).toEqual({
      kind: "noop_terminal",
      status: "ready",
    });
    expect(h.resendSends).toHaveLength(1);
  });

  it("ap- session: no standalone buyer email (AutoPilot email path instead)", async () => {
    seed(AP, "fulfilling");
    await runAuditFulfillment(makeEnv(), AP, "o", { emailCopy: COPY });
    expect(h.resendSends.map((s) => s.payload.to)).toEqual(["sub@example.com"]);
    expect(h.resendSends[0].payload.subject).not.toBe("TEST SUBJECT");
    expect(read(AP).email_sent_at).toBeUndefined();
  });

  it("Resend result.error → throws AuditReadyEmailError, no email_sent_at, status stays ready, no per-attempt alert", async () => {
    seed(SID, "fulfilling");
    h.resendError = { message: "rate limited" };
    const err = await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("AuditReadyEmailError");
    expect((err as { reason?: string }).reason).toBe("send_error");
    expect(read(SID).status).toBe("ready");
    expect(read(SID).email_sent_at).toBeUndefined();
    // The alert is sent once, by the consumer's final attempt (not here).
    expect(h.alerts.map((a) => a.alert_code)).not.toContain("AUDIT_READY_EMAIL_FAILED");
  });

  it("resumable: ready + no email_sent_at → only the email step runs", async () => {
    seed(SID, "ready", { composite_score: 50, grade: "D" });
    const r = await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY });
    expect(r).toEqual({ kind: "done", composite_score: 50, grade: "D" });
    expect(h.runScan).not.toHaveBeenCalled();
    expect(h.resendSends).toHaveLength(1);
    expect(typeof read(SID).email_sent_at).toBe("number");
  });

  it("gate closed → AUDIT_READY_EMAIL_HELD, no send, email_sent_at unset", async () => {
    seed(SID, "fulfilling");
    const log = vi.spyOn(console, "log");
    await runAuditFulfillment(makeEnv({ AUDIT_CHECKOUT_ENABLED: "false" }), SID, "o", { emailCopy: COPY });
    expect(h.resendSends).toHaveLength(0);
    expect(read(SID).status).toBe("ready");
    expect(read(SID).email_sent_at).toBeUndefined();
    expect(log.mock.calls.some((c) => String(c[0]).startsWith("AUDIT_READY_EMAIL_HELD"))).toBe(true);
    log.mockRestore();
  });

  it("PDF missing from R2 → AuditReadyEmailError reason pdf_not_found, logged without PII", async () => {
    seed(SID, "fulfilling");
    const errLog = vi.spyOn(console, "error");
    const env = makeEnv({ AUDITS: { get: async () => null } as unknown as R2Bucket });
    const err = await runAuditFulfillment(env, SID, "o", { emailCopy: COPY }).catch((e) => e);
    expect((err as { reason?: string }).reason).toBe("pdf_not_found");
    const line = errLog.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("AUDIT_READY_EMAIL_FAILED"));
    expect(line).toBe(`AUDIT_READY_EMAIL_FAILED session_id=${SID} reason=pdf_not_found`);
    expect(h.resendSends).toHaveLength(0);
    errLog.mockRestore();
  });

  it("null copy → held even with the gate open", async () => {
    seed(SID, "fulfilling");
    await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: null });
    expect(h.resendSends).toHaveLength(0);
    expect(read(SID).email_sent_at).toBeUndefined();
  });

  it("C-B: default copy (C5) is set → gate open sends the real email", async () => {
    seed(SID, "fulfilling");
    await runAuditFulfillment(makeEnv(), SID, "https://astrant.io"); // default copy = the real constant
    expect(h.resendSends).toHaveLength(1);
    expect(h.resendSends[0].payload.subject).toBe("Your Astrant Audit is ready");
    expect(typeof read(SID).email_sent_at).toBe("number");
  });
});

describe("runAuditFulfillment — provider completeness (A3)", async () => {
  const { runAuditFulfillment } = await import("./audit-fulfill-run");

  it("a provider with zero measurable cells → still ready + operator alert naming it", async () => {
    seed(SID, "fulfilling");
    h.cells = ALL_MEASURED.map((c) =>
      c.modelId === "google:gemini-2.5-flash" ? { ...c, result: { unmeasurable: true } } : c,
    );
    await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY });
    expect(read(SID).status).toBe("ready");
    const alert = h.alerts.find((a) => a.alert_code === "AUDIT_DIM6_PROVIDER_ZERO_CELLS");
    expect(alert?.notes).toBe("providers=google:gemini-2.5-flash");
    expect(alert?.session_id).toBe(SID);
  });

  it("all providers measured → no completeness alert", async () => {
    seed(SID, "fulfilling");
    await runAuditFulfillment(makeEnv(), SID, "o", { emailCopy: COPY });
    expect(h.alerts).toHaveLength(0);
  });
});
