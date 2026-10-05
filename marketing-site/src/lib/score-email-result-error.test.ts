import { describe, it, expect, vi, beforeEach } from "vitest";

// Test C-A (A4) — Resend v6 returns { error } instead of throwing; the
// AutoPilot audit-ready and the standalone audit-ready senders must report it.

const h = vi.hoisted(() => ({ error: null as null | { message: string } }));
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
const copy = { subject: "S", text: () => "T" };

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
  it("C-A ships the copy constant as a null placeholder", () => {
    expect(AUDIT_READY_EMAIL_COPY).toBeNull();
  });
  it("refuses to send without copy", async () => {
    expect(await sendAuditReadyEmail(env, input)).toEqual({ ok: false, error: "copy_not_set" });
  });
  it("ok:false when Resend returns result.error", async () => {
    h.error = { message: "rate_limited" };
    expect(await sendAuditReadyEmail(env, input, copy)).toEqual({ ok: false, error: "rate_limited" });
  });
  it("ok when sent", async () => {
    expect(await sendAuditReadyEmail(env, input, copy)).toEqual({ ok: true });
  });
});
