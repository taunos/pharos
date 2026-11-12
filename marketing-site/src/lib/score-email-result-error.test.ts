import { describe, it, expect, vi, beforeEach } from "vitest";

// Test C-A (A4) — Resend v6 returns { error } instead of throwing; the
// AutoPilot audit-ready and the standalone audit-ready senders must report it.

const h = vi.hoisted(() => ({ error: null as null | { message: string; statusCode?: number | null } }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async () => (h.error ? { data: null, error: h.error } : { data: { id: "em_1" }, error: null }),
    };
  },
}));

const { sendAutoPilotAuditReadyEmail, sendAuditReadyEmail, AUDIT_READY_EMAIL_COPY } = await import("./score-email");

const env = {
  RESEND_API_KEY: "re",
  UNSUBSCRIBE_SECRET: "u",
  AUDITS: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(2) }) } as unknown as R2Bucket,
};
const apInput = { toEmail: "a@b.co", sessionId: "ap-sub_x-1", pdfR2Key: "audits/ap-sub_x-1.pdf", origin: "o" };
const copy = { subject: "S", text: () => "T", html: () => "<p>H</p>" };

beforeEach(() => {
  h.error = null;
});

describe("sendAutoPilotAuditReadyEmail", () => {
  it("ok when Resend returns no error", async () => {
    expect(await sendAutoPilotAuditReadyEmail(env, apInput)).toEqual({ ok: true });
  });
  it("ok:false when Resend returns result.error", async () => {
    h.error = { message: "invalid_from" };
    expect(await sendAutoPilotAuditReadyEmail(env, apInput)).toEqual({ ok: false, error: "invalid_from" });
  });
});

describe("sendAuditReadyEmail", () => {
  const input = { toEmail: "a@b.co", sessionId: "s", url: "https://x.co/", origin: "o" };
  it("refuses to send without copy", async () => {
    expect(await sendAuditReadyEmail(env, input, null)).toEqual({ ok: false, error: "copy_not_set" });
  });
  it("C-B copy (C5) is set; text is exactly C5", () => {
    expect(AUDIT_READY_EMAIL_COPY?.subject).toBe("Your Astrant Audit is ready");
    expect(AUDIT_READY_EMAIL_COPY?.text({ url: "https://x.co/", pdfUrl: "https://astrant.io/audit-results/s/pdf" })).toBe(
      `Your Astrant Audit for https://x.co/ is ready.

The PDF is attached. You can also open it here:
https://astrant.io/audit-results/s/pdf

Questions or something looks wrong? Reply to this email or write to contact@astrant.io.

—Astrant`,
    );
  });
  it("ok:false when the PDF is missing from R2 (queue retries)", async () => {
    const noPdf = { ...env, AUDITS: { get: async () => null } as unknown as R2Bucket };
    expect(await sendAuditReadyEmail(noPdf, input, copy)).toEqual({ ok: false, error: "pdf_not_found:audits/s.pdf" });
  });
  it("ok:false when Resend returns result.error (4xx = confirmed not sent)", async () => {
    h.error = { message: "rate_limited", statusCode: 429 };
    expect(await sendAuditReadyEmail(env, input, copy)).toEqual({ ok: false, error: "rate_limited" });
  });
  it("review hold: SDK transport error (statusCode null) or 5xx → ambiguous (the email may have gone out)", async () => {
    h.error = { message: "Unable to fetch data", statusCode: null };
    expect(await sendAuditReadyEmail(env, input, copy)).toEqual({ ok: false, error: "Unable to fetch data", ambiguous: true });
    h.error = { message: "internal", statusCode: 500 };
    expect(await sendAuditReadyEmail(env, input, copy)).toEqual({ ok: false, error: "internal", ambiguous: true });
  });
  it("ok when sent", async () => {
    expect(await sendAuditReadyEmail(env, input, copy)).toEqual({ ok: true });
  });
});
