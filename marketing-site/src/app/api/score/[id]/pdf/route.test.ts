// P0-C2 capture cutover — GET /api/score/[id]/pdf proofs (tC1m pdf leg,
// tC6–tC8, tC12 pdf classes). Route-test harness: scanner client, tokens and
// the PDF-key helper are mocked wholesale; the route's own logic runs for real.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  calls: [] as string[],
  auditsGet: vi.fn(),
  verifyScanToken: vi.fn(),
  hashEmailForLog: vi.fn(),
  getScoreReportPDFKey: vi.fn(),
  getEmailForScan: vi.fn(),
  getScanState: vi.fn(),
  getPdfKey: vi.fn(),
}));

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: h.env }) }));
vi.mock("@/lib/score-tokens", () => ({ verifyScanToken: h.verifyScanToken, hashEmailForLog: h.hashEmailForLog }));
vi.mock("@/lib/score-pdf-template", () => ({ getScoreReportPDFKey: h.getScoreReportPDFKey }));
vi.mock("@/lib/score-scanner-client", () => ({
  getEmailForScan: h.getEmailForScan,
  getScanState: h.getScanState,
  getPdfKey: h.getPdfKey,
}));

import { GET } from "./route";

const SCAN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const LEGACY = `score-reports/${SCAN}/0123456789abcdef.pdf`;
const VERSIONED = `score-reports/${SCAN}/0123456789abcdef/3.pdf`;
const LEGACY_LOG = `[score-pdf] download scan=${SCAN} email_hash=lhash ip=1.2.3.4 ua=ua`;

const req = () =>
  new Request(`https://astrant.io/api/score/${SCAN}/pdf?t=tok`, {
    headers: { "CF-Connecting-IP": "1.2.3.4", "User-Agent": "ua" },
  });
const call = () => GET(req(), { params: Promise.resolve({ id: SCAN }) });

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
  Object.assign(h.env, { AUDITS: { get: h.auditsGet }, UNSUBSCRIBE_SECRET: "secret", INTERNAL_SCANNER_ADMIN_KEY: "k" });
  h.calls.length = 0;
  for (const fn of [h.auditsGet, h.verifyScanToken, h.hashEmailForLog, h.getScoreReportPDFKey, h.getEmailForScan, h.getScanState, h.getPdfKey]) fn.mockReset();
  h.verifyScanToken.mockResolvedValue({ scanId: SCAN });
  h.hashEmailForLog.mockResolvedValue("lhash");
  h.getScoreReportPDFKey.mockResolvedValue(LEGACY);
  rec("getScanState", h.getScanState, () => ({ ok: true, has_email_captured: true, email_opted_in_rescan: false, pdf_ready: true, unsubscribed: false, deletion_requested: false, pdf_deferred_until_tomorrow: false, pdf_template_version: "v" }));
  rec("getEmailForScan", h.getEmailForScan, () => ({ ok: true, email: "alice@example.com" }));
  rec("getPdfKey", h.getPdfKey, () => ({ ok: true, pdf_r2_key: null }));
  h.auditsGet.mockImplementation(async (key: string) => {
    h.calls.push("AUDITS.get:" + key);
    if (key === LEGACY) return { body: "legacy-bytes" };
    if (key === VERSIONED) return { body: "versioned-bytes" };
    return null;
  });
});

async function dispatch() {
  const res = await call();
  const text = await res.text();
  return { status: res.status, text, headers: Object.fromEntries(res.headers.entries()), calls: [...h.calls] };
}
const EXPECTED_HEADERS = {
  "content-type": "application/pdf",
  "content-disposition": `attachment; filename="astrant-score-${SCAN.slice(0, 8)}.pdf"`,
  "cache-control": "private, max-age=300",
};

// ── tC1m (pdf leg) ────────────────────────────────────────────────────────────
describe("tC1m (pdf leg) — gate absent/case-variant/unknown: byte-identical response + unchanged call sequence", () => {
  it("tC1m: legacy download under gate absent, 'ON', 'on ', 'bogus' is byte-identical; getPdfKey never called; legacy log line unchanged", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    setMode(undefined);
    const base = await dispatch();
    expect(base.status).toBe(200);
    expect(base.text).toBe("legacy-bytes");
    expect(base.headers).toEqual(EXPECTED_HEADERS);
    expect(base.calls).toEqual(["getScanState", "getEmailForScan", "AUDITS.get:" + LEGACY]);
    expect(log.mock.calls.map((c) => String(c[0]))).toEqual([LEGACY_LOG]);
    for (const v of ["ON", "on ", "bogus"]) {
      h.calls.length = 0;
      log.mockClear();
      setMode(v);
      const r = await dispatch();
      expect(r.status).toBe(base.status);
      expect(r.text).toBe(base.text);
      expect(r.headers).toEqual(base.headers);
      expect(r.calls).toEqual(base.calls);
      expect(log.mock.calls.map((c) => String(c[0]))).toEqual([LEGACY_LOG]);
    }
    expect(h.getPdfKey).not.toHaveBeenCalled();
  });
});

// ── tC6–tC8 (gate ON) ─────────────────────────────────────────────────────────
describe("gate ON — pointer-first download (CD5 fallback rule)", () => {
  beforeEach(() => setMode("on"));

  it("tC6: pointer present + valid + object present → streams the versioned object with the existing headers; ZERO getEmailForScan calls; NO success log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    rec("getPdfKey", h.getPdfKey, () => ({ ok: true, pdf_r2_key: VERSIONED }));
    const r = await dispatch();
    expect(r.status).toBe(200);
    expect(r.text).toBe("versioned-bytes");
    expect(r.headers).toEqual(EXPECTED_HEADERS);
    expect(r.calls).toEqual(["getScanState", "getPdfKey", "AUDITS.get:" + VERSIONED]);
    expect(h.getEmailForScan).toHaveBeenCalledTimes(0);
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it("tC7: pointer NULL → the legacy fallback runs byte-shaped as baseline (email read-back + legacy key + legacy log line)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await dispatch();
    expect(r.status).toBe(200);
    expect(r.text).toBe("legacy-bytes");
    expect(r.headers).toEqual(EXPECTED_HEADERS);
    expect(r.calls).toEqual(["getScanState", "getPdfKey", "getEmailForScan", "AUDITS.get:" + LEGACY]);
    expect(log.mock.calls.map((c) => String(c[0]))).toEqual([LEGACY_LOG]);
  });

  it("tC8: prefix-invalid pointer → 404 pdf_pointer_invalid (no legacy fetch, no R2 get); valid-but-missing → 404 pdf_object_missing (no legacy fetch); lookup failure → 404 pdf_key_lookup_failed (no legacy fetch, no R2 get)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const bad of [`score-reports/other-scan/0123456789abcdef/3.pdf`, `score-reports/${SCAN}/0123456789abcdef/3.txt`, `other/${SCAN}/x.pdf`]) {
      h.calls.length = 0;
      err.mockClear();
      rec("getPdfKey", h.getPdfKey, () => ({ ok: true, pdf_r2_key: bad }));
      const r = await dispatch();
      expect(r.status).toBe(404);
      expect(r.text).toBe("Not found");
      expect(r.calls).toEqual(["getScanState", "getPdfKey"]);
      expect(h.getEmailForScan).not.toHaveBeenCalled();
      expect(h.auditsGet).not.toHaveBeenCalled();
      expect(err.mock.calls.map((c) => String(c[0]))).toEqual(["[score-pdf] pdf_pointer_invalid"]);
    }

    h.calls.length = 0;
    err.mockClear();
    rec("getPdfKey", h.getPdfKey, () => ({ ok: true, pdf_r2_key: `score-reports/${SCAN}/0123456789abcdef/9.pdf` }));
    const missing = await dispatch();
    expect(missing.status).toBe(404);
    expect(missing.calls).toEqual(["getScanState", "getPdfKey", `AUDITS.get:score-reports/${SCAN}/0123456789abcdef/9.pdf`]);
    expect(h.getEmailForScan).not.toHaveBeenCalled();
    expect(err.mock.calls.map((c) => String(c[0]))).toEqual(["[score-pdf] pdf_object_missing"]);

    h.calls.length = 0;
    err.mockClear();
    h.auditsGet.mockClear();
    rec("getPdfKey", h.getPdfKey, () => ({ ok: false }));
    const lookup = await dispatch();
    expect(lookup.status).toBe(404);
    expect(lookup.calls).toEqual(["getScanState", "getPdfKey"]);
    expect(h.getEmailForScan).not.toHaveBeenCalled();
    expect(h.auditsGet).not.toHaveBeenCalled();
    expect(err.mock.calls.map((c) => String(c[0]))).toEqual(["[score-pdf] pdf_key_lookup_failed"]);
  });

  it("tC12 (pdf classes): every NEW console.* line across the gated paths is EXACTLY one of the three Appendix D pdf classes; all three observed; none carries a scan id / email / key", async () => {
    const lines: string[] = [];
    for (const m of ["log", "error", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(String(a[0])));
    const outcomes: Array<() => unknown> = [
      () => ({ ok: true, pdf_r2_key: VERSIONED }),
      () => ({ ok: true, pdf_r2_key: "bad/key.pdf" }),
      () => ({ ok: true, pdf_r2_key: `score-reports/${SCAN}/0123456789abcdef/9.pdf` }),
      () => ({ ok: false }),
    ];
    for (const o of outcomes) {
      rec("getPdfKey", h.getPdfKey, o);
      await dispatch();
    }
    const allowed = new Set(["[score-pdf] pdf_key_lookup_failed", "[score-pdf] pdf_pointer_invalid", "[score-pdf] pdf_object_missing"]);
    for (const l of lines) expect(allowed.has(l), `unexpected new log line: ${l}`).toBe(true);
    expect(new Set(lines)).toEqual(allowed);
    for (const l of lines) {
      expect(l).not.toContain(SCAN);
      expect(l).not.toContain("alice");
      expect(l).not.toContain("score-reports/");
    }
  });
});
