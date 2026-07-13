// P0-C2 v2.9 acceptance gate: prove the render/write SPLIT and the 429
// classifier. renderScoreReportPDF() must return the exact BR bytes and write
// NOTHING to R2; generateScoreReportPDF() (legacy) must delegate, write exactly
// once to the legacy key, and preserve its return contract.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderScoreReportPDF,
  generateScoreReportPDF,
  classifyRetryAfter,
  BrowserRenderingCapError,
  type ScorePdfEnv,
} from "./score-pdf-template";
import { hashEmailForR2Key } from "./score-tokens";
import type { ScanResult } from "./audit-types";

const scan: ScanResult = {
  id: "11111111-2222-3333-4444-555555555555",
  url: "https://example.com",
  composite: { score: 61, grade: "C" },
  dimensions: [
    {
      dimension_id: 1,
      dimension_name: "llms.txt",
      score: 40,
      grade: "F",
      sub_checks: [
        {
          id: "d1s1",
          name: "llms.txt present",
          weight: 1,
          score: 30,
          passed: false,
          notes: "No /llms.txt served.",
        },
      ],
    },
  ],
  dimensions_scored: 5,
  dimensions_total: 6,
  dimensions_applicable: 5,
  created_at: 1_700_000_000_000,
  scoring_version: "1.1.0",
  tier: "free",
};

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
const fetchMock = vi.fn();

function makeEnv(put = vi.fn()): { env: ScorePdfEnv; put: ReturnType<typeof vi.fn> } {
  const env = {
    AUDITS: { put } as unknown as R2Bucket,
    CF_ACCOUNT_ID: "acct-123",
    CF_API_TOKEN: "tok-456",
  };
  return { env, put };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderScoreReportPDF — render only, zero R2 writes", () => {
  it("returns the exact BR response bytes and never calls AUDITS.put", async () => {
    fetchMock.mockResolvedValue(new Response(PDF_BYTES, { status: 200 }));
    const { env, put } = makeEnv();

    const { pdf, pdf_size_bytes } = await renderScoreReportPDF(
      env,
      scan,
      "alice@example.com",
      "1.1.0"
    );

    expect(new Uint8Array(pdf)).toEqual(PDF_BYTES);
    expect(pdf_size_bytes).toBe(PDF_BYTES.byteLength);
    expect(put).not.toHaveBeenCalled();
    // Rendered via the Browser Rendering REST endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/browser-rendering/pdf");
  });

  it("non-429 !ok throws a generic error (counts toward DLQ, not backpressure)", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const { env } = makeEnv();
    await expect(
      renderScoreReportPDF(env, scan, "alice@example.com", "1.1.0")
    ).rejects.not.toBeInstanceOf(BrowserRenderingCapError);
  });
});

describe("generateScoreReportPDF — legacy path delegates + writes once", () => {
  it("writes exactly once to the legacy per-email key and preserves the return contract", async () => {
    fetchMock.mockResolvedValue(new Response(PDF_BYTES, { status: 200 }));
    const { env, put } = makeEnv();

    const result = await generateScoreReportPDF(
      env,
      scan,
      "alice@example.com",
      "1.1.0"
    );

    const emailHash = await hashEmailForR2Key("alice@example.com");
    const expectedKey = `score-reports/${scan.id}/${emailHash}.pdf`;

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe(expectedKey);
    // Body written is the exact rendered bytes.
    expect(new Uint8Array(put.mock.calls[0][1])).toEqual(PDF_BYTES);
    // Return contract unchanged: { r2_key, pdf_size_bytes }.
    expect(result).toEqual({
      r2_key: expectedKey,
      pdf_size_bytes: PDF_BYTES.byteLength,
    });
  });
});

describe("429 classification via renderScoreReportPDF", () => {
  it("numeric Retry-After → rate_limit with retryAfterMs", async () => {
    fetchMock.mockResolvedValue(
      new Response("slow down", { status: 429, headers: { "Retry-After": "120" } })
    );
    const { env } = makeEnv();
    try {
      await renderScoreReportPDF(env, scan, "a@b.com", "1.1.0");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BrowserRenderingCapError);
      const e = err as BrowserRenderingCapError;
      expect(e.reason).toBe("rate_limit");
      expect(e.retryAfterMs).toBe(120_000);
    }
  });

  it("absent Retry-After → daily_cap", async () => {
    fetchMock.mockResolvedValue(new Response("capped", { status: 429 }));
    const { env } = makeEnv();
    try {
      await renderScoreReportPDF(env, scan, "a@b.com", "1.1.0");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BrowserRenderingCapError);
      const e = err as BrowserRenderingCapError;
      expect(e.reason).toBe("daily_cap");
      expect(e.retryAfterMs).toBeUndefined();
    }
  });
});

describe("classifyRetryAfter — defensive parsing (injectable clock)", () => {
  const NOW = Date.parse("2026-07-12T00:00:00.000Z");

  it("numeric delta-seconds", () => {
    expect(classifyRetryAfter("30", NOW)).toEqual({
      reason: "rate_limit",
      retryAfterMs: 30_000,
    });
  });

  it("HTTP-date with fixed clock → delta ms", () => {
    expect(classifyRetryAfter("Sun, 12 Jul 2026 00:02:00 GMT", NOW)).toEqual({
      reason: "rate_limit",
      retryAfterMs: 120_000,
    });
  });

  it("past HTTP-date clamps to zero", () => {
    expect(classifyRetryAfter("Sat, 11 Jul 2026 00:00:00 GMT", NOW)).toEqual({
      reason: "rate_limit",
      retryAfterMs: 0,
    });
  });

  it("absent header → daily_cap", () => {
    expect(classifyRetryAfter(null, NOW)).toEqual({ reason: "daily_cap" });
    expect(classifyRetryAfter("", NOW)).toEqual({ reason: "daily_cap" });
  });

  it("malformed header → explicit safe fallback (daily_cap)", () => {
    expect(classifyRetryAfter("not-a-date", NOW)).toEqual({ reason: "daily_cap" });
    expect(classifyRetryAfter("soon-ish", NOW)).toEqual({ reason: "daily_cap" });
  });
});
