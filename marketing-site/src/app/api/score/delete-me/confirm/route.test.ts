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
