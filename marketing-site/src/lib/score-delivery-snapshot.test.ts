// P0-C2 v2.9 acceptance gate: prove a frozen delivery payload is byte-identical
// across retries. Resend dedups a retried send ONLY when the payload under a
// given idempotency key is byte-identical; a differing payload → 409. The
// deferred-capture consumer freezes `buildGapReportReadyPayload(...)` into
// `capture_jobs.delivery_snapshot` before email_sending and re-sends it verbatim,
// so this test guards the property the whole dedup design rests on.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Resend SDK so we can inspect the EXACT (payload, options) each send
// receives. Hoisted so the mock factory can close over the shared spy.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({
  Resend: vi.fn(() => ({ emails: { send: sendMock } })),
}));

import {
  buildGapReportReadyPayload,
  sendFrozenGapReport,
  type SendEnv,
} from "./score-email";
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

const frozenInput = {
  toEmail: "alice@example.com",
  scan,
  scanToken: "scantoken-FIXED",
  unsubscribeToken: "unsubtoken-FIXED",
  origin: "https://astrant.io",
  requestedDate: "2026-07-12",
};

describe("frozen delivery payload — byte-identical retry (v2.9 acceptance gate)", () => {
  it("two builds from identical frozen input are byte-identical", () => {
    const a = buildGapReportReadyPayload(frozenInput);
    const b = buildGapReportReadyPayload(frozenInput);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a stored snapshot round-trips through JSON unchanged (persisted == sent)", () => {
    const snap = buildGapReportReadyPayload(frozenInput);
    const restored = JSON.parse(JSON.stringify(snap));
    expect(restored).toEqual(snap);
  });

  it("no ambient Date leak — a different requestedDate changes the payload", () => {
    const a = buildGapReportReadyPayload(frozenInput);
    const b = buildGapReportReadyPayload({ ...frozenInput, requestedDate: "2026-07-13" });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("tokens are inputs, not regenerated — same tokens in ⇒ same URLs out", () => {
    const p = buildGapReportReadyPayload(frozenInput);
    expect(p.text).toContain("t=scantoken-FIXED");
    expect(p.html).toContain("t=scantoken-FIXED");
    expect(p.text).toContain("t=unsubtoken-FIXED");
    expect(p.html).toContain("t=unsubtoken-FIXED");
  });

  it("the payload is exactly the six Resend request fields", () => {
    const p = buildGapReportReadyPayload(frozenInput);
    expect(Object.keys(p).sort()).toEqual(
      ["from", "headers", "html", "subject", "text", "to"].sort()
    );
    expect(p.to).toBe("alice@example.com");
  });
});

describe("sendFrozenGapReport — real send path is byte-identical under one key", () => {
  const env: SendEnv = {
    RESEND_API_KEY: "re_test",
    UNSUBSCRIBE_SECRET: "unsub-secret",
    AUDITS: {} as R2Bucket,
  };

  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
  });

  it("two retries of a JSON-restored snapshot send the exact stored payload + same idempotency key", async () => {
    const snapshot = buildGapReportReadyPayload(frozenInput);
    // Persisted → restored, exactly as the consumer reads delivery_snapshot back.
    const restored = JSON.parse(JSON.stringify(snapshot));
    const jobId = "job-abc-123";

    await sendFrozenGapReport(env, restored, jobId);
    await sendFrozenGapReport(env, restored, jobId);

    expect(sendMock).toHaveBeenCalledTimes(2);
    const [payload1, options1] = sendMock.mock.calls[0];
    const [payload2, options2] = sendMock.mock.calls[1];

    // (1) exact stored six-field payload, unchanged
    expect(payload1).toEqual(snapshot);
    expect(payload2).toEqual(snapshot);

    // (2) same { idempotencyKey: job_id } on both calls
    expect(options1).toEqual({ idempotencyKey: jobId });
    expect(options2).toEqual({ idempotencyKey: jobId });

    // (3) byte-identical serialized request payloads
    expect(JSON.stringify(payload1)).toBe(JSON.stringify(payload2));
  });
});
