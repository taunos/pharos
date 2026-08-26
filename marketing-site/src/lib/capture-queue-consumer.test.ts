// P0-C2 Chunk E2 — capture Queue consumer proofs. Scanner RPC is a mock Fetcher;
// BR is the stubbed global fetch; Resend is mocked. Asserts the phase pipeline,
// the ack-vs-throw matrix, byte-identical replay, and log redaction.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({ Resend: vi.fn(() => ({ emails: { send: sendMock } })) }));

import { captureQueueHandler, backpressureDeferral, type CaptureConsumerEnv } from "./capture-queue-consumer";
import { BrowserRenderingCapError } from "./score-pdf-template";
import type { ScanResult } from "./audit-types";

const uuid = () => crypto.randomUUID();
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const brFetch = vi.fn();

const scanResult = (id: string): ScanResult => ({
  id, url: "https://example.com", composite: { score: 61, grade: "C" },
  dimensions: [{ dimension_id: 1, dimension_name: "llms.txt", score: 40, grade: "F", sub_checks: [{ id: "s", name: "n", weight: 1, score: 30, passed: false, notes: "x" }] }],
  dimensions_scored: 5, dimensions_total: 6, dimensions_applicable: 5, created_at: 1_700_000_000_000, scoring_version: "1.1.0", tier: "free",
});

type Handler = (body: Record<string, unknown>) => Record<string, unknown>;
function makeScanner(handlers: Record<string, Handler>) {
  const calls: string[] = [];
  const fetcher = {
    fetch: async (req: Request) => {
      const op = new URL(req.url).pathname.split("/").pop() as string;
      calls.push(op);
      const body = (await req.json()) as Record<string, unknown>;
      const r = handlers[op] ? handlers[op](body) : { status: "error", reason: "no_handler" };
      if (r.__throw) throw new Error("transport");
      const http = (r.__http as number) ?? (r.status === "error" ? 422 : 200);
      const clean = { ...r }; delete clean.__http; delete clean.__throw;
      return new Response(JSON.stringify({ ok: clean.status !== "error", ...clean }), { status: http });
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

function makeEnv(fetcher: Fetcher, over: Partial<CaptureConsumerEnv> = {}): CaptureConsumerEnv & { AUDITS: { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } } {
  const AUDITS = { put: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
  return {
    SCANNER_CAPTURE: fetcher, CAPTURE_CONSUMER_KEY: "k", CAPTURE_DLQ_NAME: "capture-dlq",
    AUDITS: AUDITS as unknown as R2Bucket, CF_ACCOUNT_ID: "acct", CF_API_TOKEN: "tok",
    RESEND_API_KEY: "re", UNSUBSCRIBE_SECRET: "secret", ASTRANT_BASE_URL: "https://astrant.io",
    ...over,
  } as CaptureConsumerEnv & { AUDITS: { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } };
}

function makeBatch(bodies: unknown[], queue = "capture") {
  const messages = bodies.map((body) => ({ body, ack: vi.fn(), retry: vi.fn() }));
  return { queue, messages } as unknown as MessageBatch<{ job_id: string }> & { messages: { body: unknown; ack: ReturnType<typeof vi.fn> }[] };
}

const JOB = "11111111-2222-3333-4444-555555555555";
const CLAIM = "99999999-8888-7777-6666-555555555555";
const SCAN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const KEY = `score-reports/${SCAN}/0123456789abcdef/1.pdf`; // documented versioned form
const NOW = Date.now();

function claimJob(over: Record<string, unknown> = {}, scanOver: Record<string, unknown> = {}) {
  return {
    status: "claimed",
    job: { job_id: JOB, phase: "rendering", op_fence: 1, claim_id: CLAIM, claim_expires_at: NOW + 1_000_000, email: "alice@example.com", pdf_r2_key: null, delivery_snapshot: null, created_at: 1_700_000_000_000, updated_at: NOW, ...over },
    scan: { id: SCAN, results_json: JSON.stringify(scanResult(SCAN)), pdf_r2_key: null, ...scanOver },
  };
}
const okSnapshot = JSON.stringify({ from: "a@b", to: "alice@example.com", subject: "s", text: "t", html: "<p>h</p>", headers: { X: "1" } });

beforeEach(() => {
  brFetch.mockReset();
  sendMock.mockReset().mockResolvedValue({ data: { id: "e1" }, error: null });
  vi.stubGlobal("fetch", brFetch);
});

async function run(handlers: Record<string, Handler>, over: Partial<CaptureConsumerEnv> = {}, queue = "capture", bodies: unknown[] = [{ job_id: JOB }]) {
  const { fetcher, calls } = makeScanner(handlers);
  const env = makeEnv(fetcher, over);
  const batch = makeBatch(bodies, queue);
  let threw = false;
  try { await captureQueueHandler(batch, env); } catch { threw = true; }
  return { env, calls, batch, threw };
}

describe("E2 rendering golden path", () => {
  it("claim→register→BR→versioned put→uploaded→commit→freeze→send→complete→ack", async () => {
    brFetch.mockResolvedValue(new Response(PDF_BYTES, { status: 200 }));
    const { env, calls, batch, threw } = await run({
      claim: () => claimJob({ phase: "rendering" }),
      "register-artifact": () => ({ status: "registered", r2_key: KEY }),
      "mark-uploaded": () => ({ status: "uploaded" }),
      "commit-pointer": () => ({ status: "committed" }),
      "freeze-snapshot": () => ({ status: "frozen", updated_at: NOW }),
      complete: () => ({ status: "done" }),
    });
    expect(threw).toBe(false);
    expect(brFetch).toHaveBeenCalledTimes(1); // rendered via renderScoreReportPDF (BR)
    expect(env.AUDITS.put).toHaveBeenCalledTimes(1);
    expect(env.AUDITS.put.mock.calls[0][0]).toBe(KEY); // versioned key, exactly once
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][1]).toEqual({ idempotencyKey: JOB }); // key == job_id
    expect(calls).toEqual(["claim", "register-artifact", "mark-uploaded", "commit-pointer", "freeze-snapshot", "complete"]);
    expect(batch.messages[0].ack).toHaveBeenCalledTimes(1);
  });
});

describe("E2 send-only + resume", () => {
  it("send-only uploaded job: zero BR calls, zero R2 puts, existing pointer delivered", async () => {
    const { env, calls, threw } = await run({
      claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }, { pdf_r2_key: KEY }),
      "commit-pointer": () => ({ status: "already_committed" }),
      "freeze-snapshot": () => ({ status: "frozen", updated_at: NOW }),
      complete: () => ({ status: "done" }),
    });
    expect(threw).toBe(false);
    expect(brFetch).not.toHaveBeenCalled();
    expect(env.AUDITS.put).not.toHaveBeenCalled();
    expect(calls).not.toContain("register-artifact");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("email_sending resume sends the stored snapshot unchanged; no BR/register/commit", async () => {
    const { calls, threw } = await run({
      claim: () => claimJob({ phase: "email_sending", delivery_snapshot: okSnapshot, updated_at: NOW }),
      complete: () => ({ status: "done" }),
    });
    expect(threw).toBe(false);
    expect(brFetch).not.toHaveBeenCalled();
    expect(calls).toEqual(["claim", "complete"]);
    expect(sendMock.mock.calls[0][0]).toEqual(JSON.parse(okSnapshot)); // stored snapshot, verbatim
  });

  it("freeze race: already_frozen payload wins over the local candidate", async () => {
    const stored = JSON.stringify({ from: "STORED@x", to: "STORED@y", subject: "STORED", text: "S", html: "S", headers: { S: "1" } });
    await run({
      claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }, { pdf_r2_key: KEY }),
      "commit-pointer": () => ({ status: "already_committed" }),
      "freeze-snapshot": () => ({ status: "already_frozen", snapshot: stored, updated_at: NOW }),
      complete: () => ({ status: "done" }),
    });
    expect(sendMock.mock.calls[0][0]).toEqual(JSON.parse(stored)); // the STORED snapshot was sent
  });

  it("crash after Resend acceptance / before completion → throw; leaves snapshot for replay", async () => {
    const { batch, threw } = await run({
      claim: () => claimJob({ phase: "email_sending", delivery_snapshot: okSnapshot, updated_at: NOW }),
      complete: () => ({ status: "error", reason: "lease_lost" }),
    });
    expect(sendMock).toHaveBeenCalledTimes(1); // provider accepted
    expect(threw).toBe(true); // completion failure throws (no ack)
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });
});

describe("E2 BR backpressure", () => {
  it("rate-limit 429 → defer with bounded delay + ack, no explicit retry", async () => {
    brFetch.mockResolvedValue(new Response("slow", { status: 429, headers: { "Retry-After": "120" } }));
    let deferredTo = 0;
    const { batch, calls, threw } = await run({
      claim: () => claimJob({ phase: "rendering" }),
      "register-artifact": () => ({ status: "registered", r2_key: KEY }),
      defer: (b) => { deferredTo = b.next_attempt_at as number; return { status: "deferred", next_attempt_at: b.next_attempt_at }; },
    });
    expect(threw).toBe(false);
    expect(calls).toContain("defer");
    expect(deferredTo).toBeGreaterThan(Date.now()); // ~ now + 120s
    expect(deferredTo).toBeLessThan(Date.now() + 130_000);
    expect(batch.messages[0].ack).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("daily-cap 429 → defer to next quota window (< 24h) + ack", async () => {
    brFetch.mockResolvedValue(new Response("capped", { status: 429 }));
    let deferredTo = 0;
    const { batch, threw } = await run({
      claim: () => claimJob({ phase: "rendering" }),
      "register-artifact": () => ({ status: "registered", r2_key: KEY }),
      defer: (b) => { deferredTo = b.next_attempt_at as number; return { status: "deferred", next_attempt_at: b.next_attempt_at }; },
    });
    expect(threw).toBe(false);
    expect(deferredTo).toBeGreaterThan(Date.now());
    expect(deferredTo).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
    expect(batch.messages[0].ack).toHaveBeenCalledTimes(1);
  });
});

describe("E2 throw (unexpected) matrix — no ack", () => {
  it("non-429 BR failure throws", async () => {
    brFetch.mockResolvedValue(new Response("boom", { status: 500 }));
    const { batch, threw } = await run({
      claim: () => claimJob({ phase: "rendering" }),
      "register-artifact": () => ({ status: "registered", r2_key: KEY }),
    });
    expect(threw).toBe(true);
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });

  it("R2 put failure throws", async () => {
    brFetch.mockResolvedValue(new Response(PDF_BYTES, { status: 200 }));
    const { fetcher } = makeScanner({ claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "registered", r2_key: KEY }) });
    const env = makeEnv(fetcher);
    env.AUDITS.put.mockRejectedValue(new Error("r2 down"));
    const batch = makeBatch([{ job_id: JOB }]);
    await expect(captureQueueHandler(batch, env)).rejects.toBeTruthy();
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });

  it("RPC 500 throws", async () => {
    const { batch, threw } = await run({ claim: () => ({ __http: 500, status: "error" }) });
    expect(threw).toBe(true);
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });

  it("malformed claim projection throws", async () => {
    const { threw } = await run({ claim: () => ({ status: "claimed", job: { job_id: "not-uuid" }, scan: {} }) });
    expect(threw).toBe(true);
  });

  it("invalid message body throws", async () => {
    const { threw } = await run({ claim: () => claimJob() }, {}, "capture", [{ not_job_id: "x" }]);
    expect(threw).toBe(true);
  });
});

describe("E2 commit outcomes", () => {
  it("preserved_for_retry → ack, never deletes R2", async () => {
    const { env, batch, threw } = await run({
      claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }, { pdf_r2_key: null }),
      "commit-pointer": () => ({ status: "preserved_for_retry" }),
    });
    expect(threw).toBe(false);
    expect(env.AUDITS.delete).not.toHaveBeenCalled();
    expect(batch.messages[0].ack).toHaveBeenCalledTimes(1);
  });

  it("missing-scan compensation deletes exactly the authorized key then confirms", async () => {
    const { env, calls } = await run({
      claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }),
      "commit-pointer": () => ({ status: "compensation_required", r2_key: KEY }),
      "confirm-compensation": () => ({ status: "confirmed" }),
    });
    expect(env.AUDITS.delete).toHaveBeenCalledTimes(1);
    expect(env.AUDITS.delete.mock.calls[0][0]).toBe(KEY);
    expect(calls).toContain("confirm-compensation");
  });

  it("failed compensation delete never confirms and throws", async () => {
    const { fetcher, calls } = makeScanner({
      claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }),
      "commit-pointer": () => ({ status: "compensation_required", r2_key: KEY }),
      "confirm-compensation": () => ({ status: "confirmed" }),
    });
    const env = makeEnv(fetcher);
    env.AUDITS.delete.mockRejectedValue(new Error("r2 down"));
    await expect(captureQueueHandler(makeBatch([{ job_id: JOB }]), env)).rejects.toBeTruthy();
    expect(calls).not.toContain("confirm-compensation");
  });
});

describe("E2 24h + DLQ + config", () => {
  it("over-24h email_sending job → ambiguous, ZERO Resend calls", async () => {
    const stale = Date.now() - 25 * 60 * 60 * 1000;
    const { calls, batch, threw } = await run({
      claim: () => claimJob({ phase: "email_sending", delivery_snapshot: okSnapshot, updated_at: stale }),
      "mark-ambiguous": () => ({ status: "ambiguous" }),
    });
    expect(threw).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(calls).toContain("mark-ambiguous");
    expect(batch.messages[0].ack).toHaveBeenCalledTimes(1);
  });

  it("DLQ batch dispositions via mark-dead-letter and never starts normal processing", async () => {
    const { calls, batch, threw } = await run(
      { "mark-dead-letter": () => ({ status: "dead_lettered" }) },
      {}, "capture-dlq",
    );
    expect(threw).toBe(false);
    expect(calls).toEqual(["mark-dead-letter"]);
    expect(calls).not.toContain("claim");
    expect(batch.messages[0].ack).toHaveBeenCalledTimes(1);
  });

  it("missing required config fails closed (throws) without acking", async () => {
    const { fetcher } = makeScanner({ claim: () => claimJob() });
    const env = makeEnv(fetcher, { SCANNER_CAPTURE: undefined });
    const batch = makeBatch([{ job_id: JOB }]);
    await expect(captureQueueHandler(batch, env)).rejects.toBeTruthy();
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });

  it("failure logs carry a fixed class only — no job id / email / key", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await run({ claim: () => ({ __http: 500, status: "error" }) });
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("class=");
    expect(logged).not.toContain(JOB);
    expect(logged).not.toContain("alice@example.com");
    expect(logged).not.toContain(KEY);
    spy.mockRestore();
  });
});

describe("E2 exhaustive fail-closed classification", () => {
  const brRateLimit = () => brFetch.mockResolvedValue(new Response("slow", { status: 429, headers: { "Retry-After": "5" } }));

  it("defer bad_next_attempt throws (no ack); a repairable claim race acks", async () => {
    brRateLimit();
    const bad = await run({ claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "registered", r2_key: KEY }), defer: () => ({ status: "error", reason: "bad_next_attempt" }) });
    expect(bad.threw).toBe(true);
    expect(bad.batch.messages[0].ack).not.toHaveBeenCalled();

    brRateLimit();
    const race = await run({ claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "registered", r2_key: KEY }), defer: () => ({ status: "error", reason: "claim" }) });
    expect(race.threw).toBe(false);
    expect(race.batch.messages[0].ack).toHaveBeenCalledTimes(1);
  });

  it("commit key_mismatch throws; commit stale-claim acks", async () => {
    const km = await run({ claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }), "commit-pointer": () => ({ status: "error", reason: "key_mismatch" }) });
    expect(km.threw).toBe(true);
    const cl = await run({ claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }), "commit-pointer": () => ({ status: "error", reason: "claim" }) });
    expect(cl.threw).toBe(false);
    expect(cl.batch.messages[0].ack).toHaveBeenCalledTimes(1);
  });

  it("compensation confirm 'refused' throws (object deleted, not acked)", async () => {
    const { env, calls, batch, threw } = await run({
      claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }),
      "commit-pointer": () => ({ status: "compensation_required", r2_key: KEY }),
      "confirm-compensation": () => ({ status: "refused", reason: "scan_exists" }),
    });
    expect(env.AUDITS.delete).toHaveBeenCalledTimes(1);
    expect(calls).toContain("confirm-compensation");
    expect(threw).toBe(true);
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });

  it("ambiguity non-repairable error throws; repairable acks; both never call Resend", async () => {
    const stale = Date.now() - 25 * 60 * 60 * 1000;
    const poison = await run({ claim: () => claimJob({ phase: "email_sending", delivery_snapshot: okSnapshot, updated_at: stale }), "mark-ambiguous": () => ({ status: "error", reason: "phase" }) });
    expect(poison.threw).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
    const race = await run({ claim: () => claimJob({ phase: "email_sending", delivery_snapshot: okSnapshot, updated_at: stale }), "mark-ambiguous": () => ({ status: "error", reason: "lease_lost" }) });
    expect(race.threw).toBe(false);
    expect(race.batch.messages[0].ack).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("DLQ unknown disposition status throws", async () => {
    const { batch, threw } = await run({ "mark-dead-letter": () => ({ status: "weird" }) }, {}, "capture-dlq");
    expect(threw).toBe(true);
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });

  it("corrupt stored snapshot (extra field) throws BEFORE Resend", async () => {
    const corrupt = JSON.stringify({ from: "a@b", to: "c@d", subject: "s", text: "t", html: "h", headers: { X: "1" }, evil: "x" });
    const { threw } = await run({ claim: () => claimJob({ phase: "email_sending", delivery_snapshot: corrupt, updated_at: Date.now() }) });
    expect(threw).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("projection guards throw before BR/R2/Resend", async () => {
    const otherId = crypto.randomUUID();
    // job_id mismatch
    expect((await run({ claim: () => claimJob({ job_id: otherId }) })).threw).toBe(true);
    // scan.id non-uuid
    expect((await run({ claim: () => claimJob({}, { id: "not-a-uuid" }) })).threw).toBe(true);
    // results_json.id != scan.id
    const mism = await run({ claim: () => claimJob({ phase: "rendering" }, { results_json: JSON.stringify(scanResult(otherId)) }), "register-artifact": () => ({ status: "registered", r2_key: KEY }) });
    expect(mism.threw).toBe(true);
    expect(brFetch).not.toHaveBeenCalled();
    // malformed key form (not 16-hex hash)
    const badKey = await run({ claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "registered", r2_key: `score-reports/${SCAN}/hh/1.pdf` }) });
    expect(badKey.threw).toBe(true);
    expect(brFetch).not.toHaveBeenCalled();
  });

  it("real byte-identical replay across two invocations of the same email_sending job", async () => {
    const stored = JSON.stringify({ from: "a@b", to: "c@d", subject: "S", text: "T", html: "<b>H</b>", headers: { X: "1" } });
    const c = () => claimJob({ phase: "email_sending", delivery_snapshot: stored, updated_at: Date.now() });
    // attempt 1: Resend accepts, completion fails → throw, no ack
    const r1 = await run({ claim: c, complete: () => ({ status: "error", reason: "lease_lost" }) });
    expect(r1.threw).toBe(true);
    expect(r1.batch.messages[0].ack).not.toHaveBeenCalled();
    // attempt 2: reclaim, send, complete
    const r2 = await run({ claim: c, complete: () => ({ status: "done" }) });
    expect(r2.threw).toBe(false);
    expect(r2.batch.messages[0].ack).toHaveBeenCalledTimes(1);
    // both sends byte-identical, same idempotency key = job_id
    expect(sendMock).toHaveBeenCalledTimes(2);
    const [p1, o1] = sendMock.mock.calls[0]; const [p2, o2] = sendMock.mock.calls[1];
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
    expect(o1).toEqual({ idempotencyKey: JOB });
    expect(o2).toEqual({ idempotencyKey: JOB });
    // neither attempt rendered, wrote R2, or rebuilt via BR
    expect(brFetch).not.toHaveBeenCalled();
    expect(r1.env.AUDITS.put).not.toHaveBeenCalled();
    expect(r2.env.AUDITS.put).not.toHaveBeenCalled();
    // exact RPC sequence — no register/freeze/rebuild path on either attempt
    expect(r1.calls).toEqual(["claim", "complete"]);
    expect(r2.calls).toEqual(["claim", "complete"]);
  });
});

describe("E2 per-operation classification (cross-op reasons rejected)", () => {
  it("commit rejects cas_failed (a freeze-only reason) → throw", async () => {
    const { threw, batch } = await run({ claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }), "commit-pointer": () => ({ status: "error", reason: "cas_failed" }) });
    expect(threw).toBe(true);
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });
  it("defer rejects fence_lost (not in its contract) → throw", async () => {
    brFetch.mockResolvedValue(new Response("slow", { status: 429, headers: { "Retry-After": "5" } }));
    const { threw } = await run({ claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "registered", r2_key: KEY }), defer: () => ({ status: "error", reason: "fence_lost" }) });
    expect(threw).toBe(true);
  });
  it("ambiguity rejects claim_or_lease (a freeze-only reason) → throw", async () => {
    const stale = Date.now() - 25 * 60 * 60 * 1000;
    const { threw } = await run({ claim: () => claimJob({ phase: "email_sending", delivery_snapshot: okSnapshot, updated_at: stale }), "mark-ambiguous": () => ({ status: "error", reason: "claim_or_lease" }) });
    expect(threw).toBe(true);
  });
  it("register rejects cas_failed; upload rejects fence_lost → throw", async () => {
    const reg = await run({ claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "error", reason: "cas_failed" }) });
    expect(reg.threw).toBe(true);
    brFetch.mockResolvedValue(new Response(PDF_BYTES, { status: 200 }));
    const up = await run({ claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "registered", r2_key: KEY }), "mark-uploaded": () => ({ status: "error", reason: "fence_lost" }) });
    expect(up.threw).toBe(true);
  });
});

describe("E2 typed client rejects malformed known-status bodies", () => {
  const cases: [string, Record<string, Handler>][] = [
    ["claim:deferred without next_attempt_at", { claim: () => ({ status: "deferred" }) }],
    ["claim:claimed without job", { claim: () => ({ status: "claimed", scan: { id: SCAN } }) }],
    ["registered without r2_key", { claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "registered" }) }],
    ["compensation_required without r2_key", { claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }), "commit-pointer": () => ({ status: "compensation_required" }) }],
    ["frozen without updated_at", { claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }), "commit-pointer": () => ({ status: "committed" }), "freeze-snapshot": () => ({ status: "frozen" }) }],
    ["already_frozen without snapshot", { claim: () => claimJob({ phase: "uploaded", pdf_r2_key: KEY }), "commit-pointer": () => ({ status: "committed" }), "freeze-snapshot": () => ({ status: "already_frozen", updated_at: NOW }) }],
    ["defer:deferred without next_attempt_at", { claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "registered", r2_key: KEY }), defer: () => ({ status: "deferred" }) }],
    ["error without reason", { claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "error" }) }],
  ];
  for (const [name, handlers] of cases) {
    it(`${name} → throw, no ack`, async () => {
      if (name.includes("defer") || name.includes("frozen") || name.includes("register")) brFetch.mockResolvedValue(new Response(PDF_BYTES, { status: 200 }));
      const { threw, batch } = await run(handlers);
      expect(threw).toBe(true);
      expect(batch.messages[0].ack).not.toHaveBeenCalled();
    });
  }
});

describe("E2 daily-cap deferral boundaries (fixed clock)", () => {
  const daily = new BrowserRenderingCapError("cap", "daily_cap");
  const rate = (ms?: number) => new BrowserRenderingCapError("rl", "rate_limit", ms);
  const MIDNIGHT = Date.UTC(2026, 0, 2, 0, 0, 0, 0); // a UTC midnight

  it("exactly at UTC midnight → schedules the next midnight (now + 24h)", () => {
    expect(backpressureDeferral(daily, MIDNIGHT)).toBe(MIDNIGHT + DAY);
  });
  it("just after midnight → the ACTUAL next midnight, not now+24h-60s", () => {
    const now = MIDNIGHT + 1000;
    expect(backpressureDeferral(daily, now)).toBe(MIDNIGHT + DAY); // next midnight
    expect(backpressureDeferral(daily, now)).toBeLessThan(now + DAY); // strictly inside the window
  });
  it("just before midnight → the imminent midnight", () => {
    const now = MIDNIGHT + DAY - 1000;
    expect(backpressureDeferral(daily, now)).toBe(MIDNIGHT + DAY);
  });
  it("rate-limit uses retryAfterMs (bounded), default when absent", () => {
    expect(backpressureDeferral(rate(5000), MIDNIGHT)).toBe(MIDNIGHT + 5000);
    expect(backpressureDeferral(rate(), MIDNIGHT)).toBe(MIDNIGHT + 30_000);
    expect(backpressureDeferral(rate(DAY * 5), MIDNIGHT)).toBe(MIDNIGHT + DAY); // capped
  });
});

const DAY = 24 * 60 * 60 * 1000;

// ── P0-C2 capture cutover — CC-1(b) consumer-refusal pins (ACTIVATION-BLOCKING) ──
describe("P0-C2 capture cutover — CC-1(b) ACTIVATION-BLOCKING consumer-refusal pins", () => {
  it("CC-1(b) ACTIVATION-BLOCKING: claim → ack_no_work acks WITHOUT touching R2 or BR (a purged/tombstoned scan is refused at the scanner)", async () => {
    const { env, calls, batch, threw } = await run({ claim: () => ({ status: "ack_no_work" }) });
    expect(threw).toBe(false);
    expect(batch.messages[0].ack).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["claim"]);
    expect(env.AUDITS.put).not.toHaveBeenCalled();
    expect(env.AUDITS.delete).not.toHaveBeenCalled();
    expect(brFetch).not.toHaveBeenCalled();
  });

  it("CC-1(b) ACTIVATION-BLOCKING: register-artifact refusal — repairable reason REPAIR-acks with ZERO AUDITS.put; non-repairable reason throws with ZERO AUDITS.put", async () => {
    const a = await run({ claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "error", reason: "lease_lost" }) });
    expect(a.threw).toBe(false);
    expect(a.batch.messages[0].ack).toHaveBeenCalledTimes(1);
    expect(a.env.AUDITS.put).not.toHaveBeenCalled();
    expect(brFetch).not.toHaveBeenCalled();
    const b = await run({ claim: () => claimJob({ phase: "rendering" }), "register-artifact": () => ({ status: "error", reason: "not_found" }) });
    expect(b.threw).toBe(true);
    expect(b.batch.messages[0].ack).not.toHaveBeenCalled();
    expect(b.env.AUDITS.put).not.toHaveBeenCalled();
    expect(brFetch).not.toHaveBeenCalled();
  });
});
