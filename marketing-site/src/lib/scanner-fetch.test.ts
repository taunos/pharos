// SCANNER_SVC Service Binding: marketing → scanner calls prefer the binding and
// fall back to the workers.dev URL when it is absent (local dev, tests, a
// deploy that predates the binding). Request bytes are identical either way.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_SCANNER_URL, scannerFetch } from "./scanner-fetch";
import { runScan } from "./audit-pipeline";

const fetchMock = vi.fn();
const ok = () => new Response(JSON.stringify({ id: "scan-1" }), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("scannerFetch", () => {
  it("binding present → binding.fetch with the given url + init; public fetch untouched", async () => {
    const svc = { fetch: vi.fn(async () => ok()) };
    const init = { method: "POST", headers: { a: "b" }, body: "x" };
    await scannerFetch(svc as unknown as Fetcher, `${DEFAULT_SCANNER_URL}/api/scan`, init);
    expect(svc.fetch).toHaveBeenCalledWith(`${DEFAULT_SCANNER_URL}/api/scan`, init);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binding absent → public fetch to the URL", async () => {
    fetchMock.mockResolvedValueOnce(ok());
    const init = { method: "GET" };
    await scannerFetch(undefined, `${DEFAULT_SCANNER_URL}/api/scan/x`, init);
    expect(fetchMock).toHaveBeenCalledWith(`${DEFAULT_SCANNER_URL}/api/scan/x`, init);
  });
});

describe("runScan (Audit / Implementation paid scans)", () => {
  const expected = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-fulfill-key": "fk" },
    body: JSON.stringify({ url: "https://example.com", tier: "paid" }),
  };

  it("binding present → paid request (fulfill key, tier) over the binding", async () => {
    const svc = { fetch: vi.fn(async () => ok()) };
    const r = await runScan("https://example.com", "fk", svc as unknown as Fetcher);
    expect(r).toEqual({ id: "scan-1" });
    expect(svc.fetch).toHaveBeenCalledWith(`${DEFAULT_SCANNER_URL}/api/scan`, expected);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binding absent → the same request to the workers.dev URL", async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await runScan("https://example.com", "fk");
    expect(fetchMock).toHaveBeenCalledWith(`${DEFAULT_SCANNER_URL}/api/scan`, expected);
  });
});
