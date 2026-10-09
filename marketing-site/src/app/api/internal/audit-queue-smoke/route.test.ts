import { describe, it, expect, vi, beforeEach } from "vitest";

// Test C-A R2-8 — internal-key synthetic queue smoke.

const state: { env: Record<string, unknown>; send: ReturnType<typeof vi.fn> } = {
  env: {},
  send: vi.fn(),
};

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: state.env }),
}));

const KEY = "internal-key-123";

function req(key?: string) {
  return new Request("https://astrant.io/api/internal/audit-queue-smoke", {
    method: "POST",
    headers: key === undefined ? {} : { "x-internal-fulfill-key": key },
  });
}

beforeEach(() => {
  state.send = vi.fn(async () => undefined);
  state.env = { INTERNAL_FULFILL_KEY: KEY, AUDIT_FULFILL_QUEUE: { send: state.send } };
});

describe("POST /api/internal/audit-queue-smoke", () => {
  it.each([undefined, "", "wrong-key-1234567", "internal-key-12"])("key %s → 401, nothing enqueued", async (k) => {
    const { POST } = await import("./route");
    const res = await POST(req(k));
    expect(res.status).toBe(401);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("401 when INTERNAL_FULFILL_KEY is unset (fail closed)", async () => {
    state.env = { AUDIT_FULFILL_QUEUE: { send: state.send } };
    const { POST } = await import("./route");
    expect((await POST(req(KEY))).status).toBe(401);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("valid key → enqueues {session_id: smoke-<uuid>, origin}", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(KEY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; session_id: string };
    expect(body.ok).toBe(true);
    expect(body.session_id).toMatch(/^smoke-[0-9a-f-]{36}$/);
    expect(state.send).toHaveBeenCalledWith({ session_id: body.session_id, origin: "https://astrant.io" });
  });

  it("queue not bound → 503", async () => {
    state.env = { INTERNAL_FULFILL_KEY: KEY };
    const { POST } = await import("./route");
    expect((await POST(req(KEY))).status).toBe(503);
  });

  it("Slice Q: body {} → audit target, unchanged", async () => {
    const { POST } = await import("./route");
    const r = new Request("https://astrant.io/api/internal/audit-queue-smoke", {
      method: "POST",
      headers: { "x-internal-fulfill-key": KEY },
      body: "{}",
    });
    const res = await POST(r);
    expect(res.status).toBe(200);
    expect((state.send.mock.calls[0][0] as { session_id: string }).session_id).toMatch(/^smoke-/);
  });

  it.each([
    ["impl", (id: string) => ({ kind: "impl", session_id: id })],
    ["impl_day", (id: string) => ({ kind: "impl_day", f2_session_id: id, day_n: 30 })],
  ])("Slice Q: target %s → FULFILL_QUEUE with an impl-smoke- id", async (target, expected) => {
    const fulfillSend = vi.fn(async () => undefined);
    state.env = { ...state.env, FULFILL_QUEUE: { send: fulfillSend } };
    const { POST } = await import("./route");
    const r = new Request("https://astrant.io/api/internal/audit-queue-smoke", {
      method: "POST",
      headers: { "x-internal-fulfill-key": KEY },
      body: JSON.stringify({ target }),
    });
    const res = await POST(r);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session_id: string };
    expect(body.session_id).toMatch(/^impl-smoke-[0-9a-f-]{36}$/);
    expect(fulfillSend).toHaveBeenCalledWith(expected(body.session_id));
    expect(state.send).not.toHaveBeenCalled();
  });

  it("Slice Q: target impl with FULFILL_QUEUE unbound → 503; unknown target → 400", async () => {
    const { POST } = await import("./route");
    const mk = (target: string) =>
      new Request("https://astrant.io/api/internal/audit-queue-smoke", {
        method: "POST",
        headers: { "x-internal-fulfill-key": KEY },
        body: JSON.stringify({ target }),
      });
    expect((await POST(mk("impl"))).status).toBe(503);
    expect((await POST(mk("bogus"))).status).toBe(400);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("send throws → 500", async () => {
    state.send = vi.fn(async () => {
      throw new Error("down");
    });
    state.env = { INTERNAL_FULFILL_KEY: KEY, AUDIT_FULFILL_QUEUE: { send: state.send } };
    const { POST } = await import("./route");
    expect((await POST(req(KEY))).status).toBe(500);
  });
});
