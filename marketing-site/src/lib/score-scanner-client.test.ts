// P0-C2 capture cutover — scanner-client caller-side bounds (tC9 per-contract,
// tC11). `fetch` is stubbed; `AbortSignal.timeout` is spied so the timeout VALUE
// is asserted and the abort leg is driven by the stub — Node schedules
// AbortSignal.timeout on an internal timer fake timers cannot advance, and
// wall-clock waits are prohibited (prompt v2.2 tC9 executor note).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  captureEmail,
  markPdfGenerated,
  unsubscribeScan,
  deletePiiForScan,
  getEmailForScan,
  getScansByEmail,
  getScanState,
  getPublicScan,
  captureOutbox,
  getPdfKey,
  DELETE_PII_TIMEOUT_MS,
} from "./score-scanner-client";

const env = { INTERNAL_SCANNER_ADMIN_KEY: "k" };
const fetchMock = vi.fn();
let timeoutArgs: number[] = [];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  timeoutArgs = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    timeoutArgs.push(ms);
    return new AbortController().signal;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const timeoutErr = () => ({ name: "TimeoutError", message: "The operation was aborted due to timeout" });
const abortErr = () => ({ name: "AbortError", message: "aborted" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const EXISTING: Array<{ name: string; ms: number; call: () => Promise<unknown> }> = [
  { name: "captureEmail", ms: 10_000, call: () => captureEmail(env, "s", { email: "a@b.co", email_opted_in_rescan: true, unsubscribe_token: "t" }) },
  { name: "markPdfGenerated", ms: 10_000, call: () => markPdfGenerated(env, "s", { pdf_template_version: "v" }) },
  { name: "unsubscribeScan", ms: 10_000, call: () => unsubscribeScan(env, "s") },
  { name: "deletePiiForScan", ms: 30_000, call: () => deletePiiForScan(env, "s") },
  { name: "getEmailForScan", ms: 10_000, call: () => getEmailForScan(env, "s") },
  { name: "getScansByEmail", ms: 10_000, call: () => getScansByEmail(env, "a@b.co") },
  { name: "getScanState", ms: 10_000, call: () => getScanState(env, "s") },
  { name: "getPublicScan", ms: 10_000, call: () => getPublicScan("s") },
];

describe("tC9 — the eight EXISTING helpers: timeout/abort → {ok:false,error:'timeout'}; non-timeout throws PROPAGATE", () => {
  for (const hlp of EXISTING) {
    it(`tC9: ${hlp.name} — TimeoutError → timeout shape at ${hlp.ms} ms; AbortError → timeout shape; Error('boom') propagates; signal attached`, async () => {
      fetchMock.mockRejectedValueOnce(timeoutErr());
      expect(await hlp.call()).toEqual({ ok: false, error: "timeout" });
      expect(timeoutArgs).toEqual([hlp.ms]);

      fetchMock.mockRejectedValueOnce(abortErr());
      expect(await hlp.call()).toEqual({ ok: false, error: "timeout" });

      fetchMock.mockRejectedValueOnce(new Error("boom"));
      await expect(hlp.call()).rejects.toThrow("boom");

      // a plain object without a name is not a timeout either → propagates
      fetchMock.mockRejectedValueOnce({ code: "ECONNRESET" });
      await expect(hlp.call()).rejects.toEqual({ code: "ECONNRESET" });

      expect(fetchMock).toHaveBeenCalledTimes(4);
      for (const c of fetchMock.mock.calls) expect((c[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
      expect(timeoutArgs).toEqual([hlp.ms, hlp.ms, hlp.ms, hlp.ms]);
    });
  }

  it("tC9: existing helpers keep their success shapes unchanged with the signal attached", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    expect(await captureEmail(env, "s", { email: "a@b.co", email_opted_in_rescan: false, unsubscribe_token: "t" })).toEqual({ ok: true });
    fetchMock.mockResolvedValueOnce(json({ ok: true, email: "a@b.co" }));
    expect(await getEmailForScan(env, "s")).toEqual({ ok: true, email: "a@b.co" });
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await deletePiiForScan(env, "s")).toEqual({ ok: false, error: "500: nope" });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json", "x-internal-scanner-admin-key": "k" });
  });
});

describe("tC9 — captureOutbox never throws", () => {
  const payload = { email: "a@b.co", email_opted_in_rescan: true, unsubscribe_token: "t" };
  it("tC9: timeout AND transport throw → transport_error; 200 deferred maps enqueued; 409/404/503 map; 500 / non-JSON / wrong status field → transport_error; 10 s signal", async () => {
    fetchMock.mockRejectedValueOnce(timeoutErr());
    expect(await captureOutbox(env, "s", payload)).toEqual({ status: "transport_error" });
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    expect(await captureOutbox(env, "s", payload)).toEqual({ status: "transport_error" });
    fetchMock.mockResolvedValueOnce(json({ ok: true, status: "deferred", job_id: "j", reused: false, enqueued: true }));
    expect(await captureOutbox(env, "s", payload)).toEqual({ status: "deferred", enqueued: true });
    fetchMock.mockResolvedValueOnce(json({ ok: true, status: "deferred", job_id: "j", reused: true, enqueued: false }));
    expect(await captureOutbox(env, "s", payload)).toEqual({ status: "deferred", enqueued: false });
    fetchMock.mockResolvedValueOnce(json({ ok: false, status: "conflict" }, 409));
    expect(await captureOutbox(env, "s", payload)).toEqual({ status: "conflict" });
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: "scan not found" }, 404));
    expect(await captureOutbox(env, "s", payload)).toEqual({ status: "not_found" });
    fetchMock.mockResolvedValueOnce(json({ ok: false, status: "unavailable" }, 503));
    expect(await captureOutbox(env, "s", payload)).toEqual({ status: "unavailable" });
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: "db error" }, 500));
    expect(await captureOutbox(env, "s", payload)).toEqual({ status: "transport_error" });
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    expect(await captureOutbox(env, "s", payload)).toEqual({ status: "transport_error" });
    fetchMock.mockResolvedValueOnce(json({ ok: true, status: "something_else" }));
    expect(await captureOutbox(env, "s", payload)).toEqual({ status: "transport_error" });
    expect(new Set(timeoutArgs)).toEqual(new Set([10_000]));
    expect(fetchMock.mock.calls[2][0]).toBe("https://pharos-scanner.pharos-dev.workers.dev/api/scan/s/capture-outbox");
    expect(JSON.parse(String(fetchMock.mock.calls[2][1].body))).toEqual(payload);
    for (const c of fetchMock.mock.calls) expect((c[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("tC9 — getPdfKey never throws", () => {
  it("tC9: timeout AND throw → {ok:false}; 200 ok with key / null → ok; non-200, ok:false body, non-JSON, non-string key → {ok:false}; 10 s signal", async () => {
    fetchMock.mockRejectedValueOnce(timeoutErr());
    expect(await getPdfKey(env, "s")).toEqual({ ok: false });
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    expect(await getPdfKey(env, "s")).toEqual({ ok: false });
    fetchMock.mockResolvedValueOnce(json({ ok: true, pdf_r2_key: "score-reports/s/abc/1.pdf" }));
    expect(await getPdfKey(env, "s")).toEqual({ ok: true, pdf_r2_key: "score-reports/s/abc/1.pdf" });
    fetchMock.mockResolvedValueOnce(json({ ok: true, pdf_r2_key: null }));
    expect(await getPdfKey(env, "s")).toEqual({ ok: true, pdf_r2_key: null });
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: "not found" }, 404));
    expect(await getPdfKey(env, "s")).toEqual({ ok: false });
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: "unauthorized" }, 401));
    expect(await getPdfKey(env, "s")).toEqual({ ok: false });
    fetchMock.mockResolvedValueOnce(json({ ok: false }));
    expect(await getPdfKey(env, "s")).toEqual({ ok: false });
    fetchMock.mockResolvedValueOnce(new Response("garbage", { status: 200 }));
    expect(await getPdfKey(env, "s")).toEqual({ ok: false });
    fetchMock.mockResolvedValueOnce(json({ ok: true, pdf_r2_key: 42 }));
    expect(await getPdfKey(env, "s")).toEqual({ ok: false });
    expect(new Set(timeoutArgs)).toEqual(new Set([10_000]));
    expect(fetchMock.mock.calls[2][0]).toBe("https://pharos-scanner.pharos-dev.workers.dev/api/internal/scan/s/pdf-key");
    for (const c of fetchMock.mock.calls) expect((c[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("tC11 — DELETE_PII_TIMEOUT_MS single source of truth", () => {
  it("tC11: DELETE_PII_TIMEOUT_MS === 30_000 AND > PD_REQUEST_BUDGET_MS (25_000; scanner privacy-delete.ts) — change one → change both", () => {
    const PD_REQUEST_BUDGET_MS = 25_000;
    expect(DELETE_PII_TIMEOUT_MS).toBe(30_000);
    expect(DELETE_PII_TIMEOUT_MS).toBeGreaterThan(PD_REQUEST_BUDGET_MS);
  });
});
