import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  auditsDelete: vi.fn(),
  verifyDeletionToken: vi.fn(),
  hashEmailForR2Key: vi.fn(),
  hashEmailForLog: vi.fn(),
  deletePiiForScan: vi.fn(),
  getScansByEmail: vi.fn(),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { AUDITS: { delete: h.auditsDelete }, UNSUBSCRIBE_SECRET: "s", INTERNAL_SCANNER_ADMIN_KEY: "k" },
  }),
}));
vi.mock("@/lib/score-tokens", () => ({
  verifyDeletionToken: h.verifyDeletionToken,
  hashEmailForR2Key: h.hashEmailForR2Key,
  hashEmailForLog: h.hashEmailForLog,
}));
vi.mock("@/lib/score-scanner-client", () => ({
  DELETE_PII_TIMEOUT_MS: 30_000,
  deletePiiForScan: h.deletePiiForScan,
  getScansByEmail: h.getScansByEmail,
}));

import { GET, POST } from "./route";

const getReq = () => new Request("https://astrant.io/api/score/delete-me/confirm?t=tok");
const postReq = () =>
  new Request("https://astrant.io/api/score/delete-me/confirm", {
    method: "POST",
    body: new URLSearchParams({ t: "tok" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.verifyDeletionToken.mockResolvedValue({ email: "x@y.com" });
  h.hashEmailForR2Key.mockResolvedValue("ehash");
  h.hashEmailForLog.mockResolvedValue("lhash");
  h.getScansByEmail.mockResolvedValue({ ok: true, scan_ids: ["s1"] });
  h.deletePiiForScan.mockResolvedValue({ ok: true });
  h.auditsDelete.mockResolvedValue(undefined);
});

describe("GET — confirmation page only, never mutates", () => {
  it("performs zero scanner/R2 mutations and shows the confirm form", async () => {
    const res = await GET(getReq());
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("Confirm data deletion");
    expect(body).toContain('method="POST"');
    expect(h.auditsDelete).not.toHaveBeenCalled();
    expect(h.deletePiiForScan).not.toHaveBeenCalled();
    expect(h.getScansByEmail).not.toHaveBeenCalled();
  });

  it("sets no-store, no-referrer, and noindex headers", async () => {
    const res = await GET(getReq());
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });
});

describe("invalid/expired token — zero mutations", () => {
  it("GET renders invalid page, no mutations", async () => {
    h.verifyDeletionToken.mockResolvedValue(null);
    const res = await GET(getReq());
    expect((await res.text())).toContain("invalid or expired");
    expect(h.getScansByEmail).not.toHaveBeenCalled();
  });
  it("POST rejects, no mutations", async () => {
    h.verifyDeletionToken.mockResolvedValue(null);
    const res = await POST(postReq());
    expect(h.auditsDelete).not.toHaveBeenCalled();
    expect(h.deletePiiForScan).not.toHaveBeenCalled();
    expect((await res.text())).toContain("invalid or expired");
  });
});

describe("POST — deletion ordering and failure semantics", () => {
  it("deletes R2 BEFORE clearing D1", async () => {
    const order: string[] = [];
    h.auditsDelete.mockImplementation(async () => { order.push("r2"); });
    h.deletePiiForScan.mockImplementation(async () => { order.push("d1"); return { ok: true }; });
    const res = await POST(postReq());
    expect(order).toEqual(["r2", "d1"]);
    expect(res.status).toBe(200);
    expect((await res.text())).toContain("has been removed");
  });

  it("R2 failure leaves D1 uncleared (email retained) and never shows success", async () => {
    h.auditsDelete.mockRejectedValue(new Error("r2 down"));
    const res = await POST(postReq());
    expect(h.deletePiiForScan).not.toHaveBeenCalled(); // email association retained for retry
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("has been removed");
    expect(body).toContain("not fully complete");
  });

  it("D1 failure after successful R2 → incomplete (non-2xx)", async () => {
    h.deletePiiForScan.mockResolvedValue({ ok: false, error: "d1 down" });
    const res = await POST(postReq());
    expect(h.auditsDelete).toHaveBeenCalledTimes(1); // R2 ran first
    expect(res.status).toBe(500);
    expect((await res.text())).not.toContain("has been removed");
  });

  it("mixed multi-scan result never claims complete removal", async () => {
    h.getScansByEmail.mockResolvedValue({ ok: true, scan_ids: ["s1", "s2"] });
    h.auditsDelete.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("r2 down"));
    const res = await POST(postReq());
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("has been removed");
    expect(body).toContain("1 of 2");
  });

  it("no scans for the email → benign 'nothing to remove', no mutations", async () => {
    h.getScansByEmail.mockResolvedValue({ ok: true, scan_ids: [] });
    const res = await POST(postReq());
    expect(res.status).toBe(200);
    expect((await res.text())).toContain("No records found");
    expect(h.auditsDelete).not.toHaveBeenCalled();
    expect(h.deletePiiForScan).not.toHaveBeenCalled();
  });

  it("getScansByEmail failure returns 502, no mutations", async () => {
    h.getScansByEmail.mockResolvedValue({ ok: false, error: "scanner down" });
    const res = await POST(postReq());
    expect(res.status).toBe(502);
    expect(h.auditsDelete).not.toHaveBeenCalled();
    expect(h.deletePiiForScan).not.toHaveBeenCalled();
  });

  it("two-request retry: R2 fails (D1 untouched, token preserved), then retry succeeds", async () => {
    // First POST — R2 fails once.
    h.auditsDelete.mockRejectedValueOnce(new Error("r2 down"));
    const res1 = await POST(postReq());
    expect(res1.status).toBe(500);
    expect(h.deletePiiForScan).not.toHaveBeenCalled(); // email association retained
    const body1 = await res1.text();
    expect(body1).toContain('name="t"');
    expect(body1).toContain('value="tok"'); // escaped token preserved for retry

    // Second POST — R2 now succeeds (default mock), D1 clears, 200.
    const res2 = await POST(postReq());
    expect(res2.status).toBe(200);
    expect(h.deletePiiForScan).toHaveBeenCalledTimes(1);
    expect((await res2.text())).toContain("has been removed");
  });
});

// ── P0-C2 capture cutover (CD7) — total route deadline ──────────────────────────
describe("P0-C2 capture cutover — confirm-route total deadline (CD7)", () => {
  const T = 1_800_000_000_000;
  const DEADLINE_LINE = "[delete-confirm] confirm_deadline";
  const logLines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]));

  it("tC1m (confirm leg): normal flow with a non-advancing clock is behavior-invisible — R2-then-D1 per scan, 200 success, ZERO confirm_deadline lines", async () => {
    vi.spyOn(Date, "now").mockReturnValue(T);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    h.getScansByEmail.mockResolvedValue({ ok: true, scan_ids: ["s1", "s2"] });
    const order: string[] = [];
    h.auditsDelete.mockImplementation(async (k: string) => { order.push("r2:" + k); });
    h.deletePiiForScan.mockImplementation(async (_e: unknown, id: string) => { order.push("d1:" + id); return { ok: true }; });
    const res = await POST(postReq());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("has been removed");
    expect(order).toEqual(["r2:score-reports/s1/ehash.pdf", "d1:s1", "r2:score-reports/s2/ehash.pdf", "d1:s2"]);
    expect(logLines(log).filter((l) => l.includes("confirm_deadline"))).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("tC10 (i): deadline is established at POST entry — a pre-loop burn trips before iteration 1: zero R2/D1 calls, every scan incomplete through the EXISTING strings; tC12 class exact", async () => {
    let first = true;
    vi.spyOn(Date, "now").mockImplementation(() => { if (first) { first = false; return T; } return T + 90_000; });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    h.getScansByEmail.mockResolvedValue({ ok: true, scan_ids: ["s1", "s2"] });
    const res = await POST(postReq());
    expect(h.auditsDelete).not.toHaveBeenCalled();
    expect(h.deletePiiForScan).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("We removed your data from 0 of 2 records.");
    expect(body).toContain("2 couldn't be fully removed just now.");
    expect(body).toContain('value="tok"'); // retry form preserved
    expect(body).not.toContain("has been removed");
    const deadlineLines = logLines(log).filter((l) => l.includes("confirm_deadline"));
    expect(deadlineLines).toEqual([DEADLINE_LINE]); // exactly once, byte-exact, identifier-free
    vi.restoreAllMocks();
  });

  it("tC10 (ii): post-R2 recheck — an R2 delete that consumes the budget prevents deletePiiForScan; current + remaining scans incomplete with exact counts", async () => {
    let t = T;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    h.getScansByEmail.mockResolvedValue({ ok: true, scan_ids: ["s1", "s2", "s3"] });
    h.auditsDelete.mockImplementation(async () => { t += 90_000; }); // the first R2 delete eats the whole budget
    const res = await POST(postReq());
    expect(h.auditsDelete).toHaveBeenCalledTimes(1); // s1's R2 delete ran (PDF gone)
    expect(h.deletePiiForScan).not.toHaveBeenCalled(); // PII not yet cleared — existing incomplete state
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("We removed your data from 0 of 3 records.");
    expect(body).toContain("3 couldn't be fully removed just now.");
    expect(body).not.toContain("has been removed");
    expect(logLines(log).filter((l) => l.includes("confirm_deadline"))).toEqual([DEADLINE_LINE]);
    for (const l of logLines(log)) if (l.includes("confirm_deadline")) { expect(l).not.toContain("s1"); expect(l).not.toContain("lhash"); }
    vi.restoreAllMocks();
  });
});
