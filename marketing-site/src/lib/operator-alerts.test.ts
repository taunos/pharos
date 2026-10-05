import { describe, it, expect, vi, beforeEach } from "vitest";

// Test C-A fix round — Resend v6 returns { error } instead of throwing.

const h = vi.hoisted(() => ({
  error: null as null | { message: string },
  throws: false,
  to: [] as unknown[],
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (p: { to: unknown }) => {
        h.to.push(p.to);
        if (h.throws) throw new Error("network");
        return h.error ? { data: null, error: h.error } : { data: { id: "em_1" }, error: null };
      },
    };
  },
}));

const { sendOperatorAlert, alertOperator } = await import("./operator-alerts");

beforeEach(() => {
  h.error = null;
  h.throws = false;
  h.to = [];
});

describe("sendOperatorAlert", () => {
  it("result.error → logs OPERATOR_ALERT_SEND_FAILED code=<code>, does not throw", async () => {
    h.error = { message: "invalid_from" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendOperatorAlert({ RESEND_API_KEY: "r", OPERATOR_ALERT_EMAIL: "o@x.test" }, { alert_code: "X_CODE" })).resolves.toBeUndefined();
    expect(err.mock.calls.some((c) => String(c[0]).startsWith("OPERATOR_ALERT_SEND_FAILED code=X_CODE"))).toBe(true);
    err.mockRestore();
  });

  it("thrown send → logs, does not throw (fail-open, unchanged)", async () => {
    h.throws = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendOperatorAlert({ RESEND_API_KEY: "r", OPERATOR_ALERT_EMAIL: "o@x.test" }, { alert_code: "Y" })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("success → no failure log", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendOperatorAlert({ RESEND_API_KEY: "r", OPERATOR_ALERT_EMAIL: "o@x.test" }, { alert_code: "Z" });
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("alertOperator", () => {
  it("falls back to contact@astrant.io when OPERATOR_ALERT_EMAIL is unset", async () => {
    await alertOperator({ RESEND_API_KEY: "r" }, "C", "sid");
    expect(h.to).toEqual(["contact@astrant.io"]);
  });
  it("uses OPERATOR_ALERT_EMAIL when set", async () => {
    await alertOperator({ RESEND_API_KEY: "r", OPERATOR_ALERT_EMAIL: "o@x.test" }, "C", "sid");
    expect(h.to).toEqual(["o@x.test"]);
  });
});
