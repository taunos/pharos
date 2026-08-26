// P0-C2 capture cutover — POST /api/score/capture-email proofs (tC1m capture
// leg, tC2–tC5, tC12 capture classes, CC-1(a)). Route-test harness: the
// scanner client, tokens, PDF template, and email modules are mocked
// wholesale; the route's own logic runs for real.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  calls: [] as string[],
  kvGet: vi.fn(),
  kvPut: vi.fn(),
  auditsPut: vi.fn(),
  getScanState: vi.fn(),
  captureEmail: vi.fn(),
  getPublicScan: vi.fn(),
  markPdfGenerated: vi.fn(),
  captureOutbox: vi.fn(),
  generateScoreReportPDF: vi.fn(),
  sendReady: vi.fn(),
  sendDeferred: vi.fn(),
  issueScanToken: vi.fn(),
  hashEmailForLog: vi.fn(),
}));

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: h.env }) }));
vi.mock("@/lib/score-tokens", () => ({
  issueScanToken: h.issueScanToken,
  hashEmailForLog: h.hashEmailForLog,
  PDF_TOKEN_TTL_SECONDS: 30 * 86400,
  UNSUB_TOKEN_TTL_SECONDS: 365 * 86400,
}));
vi.mock("@/lib/score-pdf-template", () => {
  class BrowserRenderingCapError extends Error {}
  return { generateScoreReportPDF: h.generateScoreReportPDF, PDF_TEMPLATE_VERSION: "v-test", BrowserRenderingCapError };
});
vi.mock("@/lib/score-email", () => ({
  sendGapReportReadyEmail: h.sendReady,
  sendGapReportDeferredEmail: h.sendDeferred,
}));
vi.mock("@/lib/score-scanner-client", () => ({
  captureEmail: h.captureEmail,
  getPublicScan: h.getPublicScan,
  getScanState: h.getScanState,
  markPdfGenerated: h.markPdfGenerated,
  captureOutbox: h.captureOutbox,
}));

import { POST } from "./route";

const SCAN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const A1 = "Another email address is already receiving this scan's report. Use that address, or try again once it's delivered.";
const A2 = "We couldn't queue your report just now. Please try again in a minute.";
const LEGACY_KEY_RE = /^score-reports\/[^/]+\/[0-9a-f]{16}\.pdf$/;

const freshState = () => ({
  ok: true,
  has_email_captured: false,
  email_opted_in_rescan: false,
  pdf_ready: false,
  unsubscribed: false,
  deletion_requested: false,
  pdf_deferred_until_tomorrow: false,
  pdf_template_version: null,
});

const req = (body: unknown = { scan_id: SCAN, email: "Alice@Example.com", opt_in_rescan: true }) =>
  new Request("https://astrant.io/api/score/capture-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function setMode(v: string | undefined) {
  if (v === undefined) delete h.env.CAPTURE_PIPELINE_MODE;
  else h.env.CAPTURE_PIPELINE_MODE = v;
}

const rec = (name: string, fn: ReturnType<typeof vi.fn>, impl: (...a: unknown[]) => unknown) =>
  fn.mockImplementation(async (...a: unknown[]) => {
    h.calls.push(name);
    return impl(...a);
  });

beforeEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(h.env)) delete h.env[k];
  Object.assign(h.env, {
    AUDITS: { put: h.auditsPut },
    TRIAGE_CACHE: { get: h.kvGet, put: h.kvPut },
    SESSIONS: {},
    CF_ACCOUNT_ID: "acct",
    CF_API_TOKEN: "tok",
    RESEND_API_KEY: "re",
    UNSUBSCRIBE_SECRET: "secret",
    INTERNAL_SCANNER_ADMIN_KEY: "k",
  });
  h.calls.length = 0;
  for (const fn of [h.kvGet, h.kvPut, h.auditsPut, h.getScanState, h.captureEmail, h.getPublicScan, h.markPdfGenerated, h.captureOutbox, h.generateScoreReportPDF, h.sendReady, h.sendDeferred, h.issueScanToken, h.hashEmailForLog]) fn.mockReset();
  h.issueScanToken.mockResolvedValue("tok");
  h.hashEmailForLog.mockResolvedValue("lhash");
  h.kvGet.mockResolvedValue(null);
  h.kvPut.mockResolvedValue(undefined);
  h.auditsPut.mockResolvedValue(undefined);
  rec("getScanState", h.getScanState, () => freshState());
  rec("captureEmail", h.captureEmail, () => ({ ok: true }));
  rec("getPublicScan", h.getPublicScan, () => ({ ok: true, data: { id: SCAN, scoring_version: "1.1.0" } }));
  rec("generateScoreReportPDF", h.generateScoreReportPDF, () => ({ r2_key: `score-reports/${SCAN}/0123456789abcdef.pdf`, pdf_size_bytes: 4 }));
  rec("markPdfGenerated", h.markPdfGenerated, () => ({ ok: true }));
  rec("sendReady", h.sendReady, () => ({ ok: true }));
  rec("sendDeferred", h.sendDeferred, () => ({ ok: true }));
  rec("captureOutbox", h.captureOutbox, () => ({ status: "deferred", enqueued: true }));
});

async function dispatch() {
  const res = await POST(req());
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown>, calls: [...h.calls] };
}

// ── tC1m (capture leg) ────────────────────────────────────────────────────────
describe("tC1m (capture leg) — gate absent/case-variant/unknown: byte-identical response + unchanged call sequence", () => {
  it("tC1m: fresh capture under gate absent, 'ON', 'on ', 'bogus' is byte-identical to the legacy baseline; captureOutbox never called", async () => {
    setMode(undefined);
    const base = await dispatch();
    expect(base.status).toBe(200);
    expect(base.json).toEqual({ success: true, deferred: false, results_url: expect.stringContaining(`/score/${SCAN}?t=tok`), pdf_url: expect.stringContaining(`/api/score/${SCAN}/pdf?t=tok`) });
    expect(base.calls).toEqual(["getScanState", "captureEmail", "getPublicScan", "generateScoreReportPDF", "markPdfGenerated", "sendReady"]);
    expect(h.kvPut).toHaveBeenCalledTimes(1);
    for (const v of ["ON", "on ", "bogus"]) {
      h.calls.length = 0;
      h.kvPut.mockClear();
      setMode(v);
      const r = await dispatch();
      expect(r.status).toBe(base.status);
      expect(r.text).toBe(base.text);
      expect(r.calls).toEqual(base.calls);
      expect(h.kvPut).toHaveBeenCalledTimes(1);
    }
    expect(h.captureOutbox).not.toHaveBeenCalled();
  });
});

// ── tC2–tC5 (gate ON) ─────────────────────────────────────────────────────────
describe("gate ON — deferred pipeline (CD3 outcome mapping)", () => {
  beforeEach(() => setMode("on"));

  it("tC2: fresh capture → exactly ONE captureOutbox call; ZERO generate/mark/captureEmail/getPublicScan/send; 200 {success, deferred:true, results_url, pdf_url}", async () => {
    const r = await dispatch();
    expect(r.status).toBe(200);
    expect(Object.keys(r.json)).toEqual(["success", "deferred", "results_url", "pdf_url"]);
    expect(r.json.success).toBe(true);
    expect(r.json.deferred).toBe(true);
    expect(r.json.results_url).toMatch(new RegExp(`/score/${SCAN}\\?t=tok$`));
    expect(r.json.pdf_url).toMatch(new RegExp(`/api/score/${SCAN}/pdf\\?t=tok$`));
    expect(h.captureOutbox).toHaveBeenCalledTimes(1);
    expect(h.captureOutbox.mock.calls[0][1]).toBe(SCAN);
    expect(h.captureOutbox.mock.calls[0][2]).toEqual({ email: "alice@example.com", email_opted_in_rescan: true, unsubscribe_token: "tok" });
    expect(h.generateScoreReportPDF).not.toHaveBeenCalled();
    expect(h.markPdfGenerated).not.toHaveBeenCalled();
    expect(h.captureEmail).not.toHaveBeenCalled();
    expect(h.getPublicScan).not.toHaveBeenCalled();
    expect(h.sendReady).not.toHaveBeenCalled();
    expect(h.sendDeferred).not.toHaveBeenCalled();
    expect(r.calls).toEqual(["getScanState", "captureOutbox"]);
  });

  it("tC3: resubmit within 300 s → 200 deferred with NO outbox call and NO stamp; outside 300 s → outbox call; stamp written ONLY on the deferred-200 path", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    h.kvGet.mockResolvedValue(String(nowSec - 100));
    const inside = await dispatch();
    expect(inside.status).toBe(200);
    expect(inside.json).toEqual({ success: true, deferred: true, results_url: expect.any(String), pdf_url: expect.any(String) });
    expect(h.captureOutbox).not.toHaveBeenCalled();
    expect(h.kvPut).not.toHaveBeenCalled();

    h.kvGet.mockResolvedValue(String(nowSec - 400));
    const outside = await dispatch();
    expect(outside.status).toBe(200);
    expect(h.captureOutbox).toHaveBeenCalledTimes(1);
    expect(h.kvPut).toHaveBeenCalledTimes(1);
    expect(h.kvPut.mock.calls[0][0]).toBe(`idem:capture:${SCAN}:lhash`);
    expect(h.kvPut.mock.calls[0][2]).toEqual({ expirationTtl: 86400 });

    // enqueued:false is still `deferred` → stamped + 200
    h.kvGet.mockResolvedValue(null);
    h.kvPut.mockClear();
    rec("captureOutbox", h.captureOutbox, () => ({ status: "deferred", enqueued: false }));
    const unsent = await dispatch();
    expect(unsent.status).toBe(200);
    expect(unsent.json.deferred).toBe(true);
    expect(h.kvPut).toHaveBeenCalledTimes(1);
  });

  it("tC4: conflict → 409 + Appendix A string 1, NO stamp, class outbox_conflict; unavailable AND transport_error → 503 + Appendix A string 2, NO stamp, class outbox_unavailable", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    rec("captureOutbox", h.captureOutbox, () => ({ status: "conflict" }));
    const c = await dispatch();
    expect(c.status).toBe(409);
    expect(c.json).toEqual({ success: false, error: A1 });
    expect(h.kvPut).not.toHaveBeenCalled();
    expect(err.mock.calls.map((x) => String(x[0]))).toEqual(["[capture-email] outbox_conflict"]);

    for (const status of ["unavailable", "transport_error"]) {
      err.mockClear();
      rec("captureOutbox", h.captureOutbox, () => ({ status }));
      const u = await dispatch();
      expect(u.status).toBe(503);
      expect(u.json).toEqual({ success: false, error: A2 });
      expect(h.kvPut).not.toHaveBeenCalled();
      expect(err.mock.calls.map((x) => String(x[0]))).toEqual(["[capture-email] outbox_unavailable"]);
    }
  });

  it("tC5: not_found → 404 { success:false, error:'Scan not found.' } (byte-reuse), NO stamp, no log line", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    rec("captureOutbox", h.captureOutbox, () => ({ status: "not_found" }));
    const r = await dispatch();
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ success: false, error: "Scan not found." });
    expect(h.kvPut).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it("tC12 (capture classes): every NEW console.* line across the gated paths is EXACTLY one of the two Appendix D capture classes; both observed; none carries a scan id / email / token", async () => {
    const lines: string[] = [];
    for (const m of ["log", "error", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(String(a[0])));
    for (const status of ["deferred", "conflict", "not_found", "unavailable", "transport_error"]) {
      rec("captureOutbox", h.captureOutbox, () => (status === "deferred" ? { status, enqueued: true } : { status }));
      await dispatch();
    }
    h.kvGet.mockResolvedValue(String(Math.floor(Date.now() / 1000) - 10));
    await dispatch(); // within-cooldown short-circuit
    const allowed = new Set(["[capture-email] outbox_conflict", "[capture-email] outbox_unavailable"]);
    for (const l of lines) expect(allowed.has(l), `unexpected new log line: ${l}`).toBe(true);
    expect(new Set(lines)).toEqual(allowed);
    for (const l of lines) {
      expect(l).not.toContain(SCAN);
      expect(l).not.toContain("alice");
      expect(l).not.toContain("tok");
      expect(l).not.toContain("lhash");
    }
  });

  it("CC-1(a) ACTIVATION-BLOCKING: gate ON full dispatch → ZERO generateScoreReportPDF invocations and ZERO direct AUDITS.put of any legacy-shaped key score-reports/<id>/<hash16>.pdf", async () => {
    const r = await dispatch();
    expect(r.status).toBe(200);
    expect(h.generateScoreReportPDF).toHaveBeenCalledTimes(0);
    expect(h.auditsPut).toHaveBeenCalledTimes(0);
    expect(h.auditsPut.mock.calls.filter((c) => LEGACY_KEY_RE.test(String(c[0])))).toHaveLength(0);
  });
});
