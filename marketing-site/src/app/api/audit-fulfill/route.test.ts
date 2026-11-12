import { describe, it, expect, vi, beforeEach } from "vitest";

// Slice Q (Q4) — /api/audit-fulfill enqueues impl-day ids onto astrant-fulfill
// (202) instead of running the Day-N audit inside the request; any other id is
// unchanged (runAuditFulfillment, onCap "partial").

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  send: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: state.env }) }));
vi.mock("@/lib/audit-fulfill-run", () => ({
  runAuditFulfillment: vi.fn(async () => ({ kind: "done", composite_score: 50, grade: "C", gap_count: 3 })),
  readAuditSession: vi.fn(async () => null),
  writeAuditSession: vi.fn(async () => undefined),
}));

const { runAuditFulfillment } = await import("@/lib/audit-fulfill-run");
const KEY = "internal-key-123";

function req(session_id: string) {
  return new Request("https://astrant.io/api/audit-fulfill", {
    method: "POST",
    headers: { "x-internal-fulfill-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ session_id }),
  });
}

beforeEach(() => {
  state.send = vi.fn(async () => undefined);
  state.env = { INTERNAL_FULFILL_KEY: KEY, FULFILL_QUEUE: { send: state.send } };
  vi.mocked(runAuditFulfillment).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/audit-fulfill — review hold", () => {
  it("passes mayGenerateHeld:false; a held order is handed to the audit queue (202), not generated here", async () => {
    const auditSend = vi.fn(async () => undefined);
    state.env = { INTERNAL_FULFILL_KEY: KEY, AUDIT_FULFILL_QUEUE: { send: auditSend }, PUBLIC_ORIGIN: "https://astrant.io" };
    vi.mocked(runAuditFulfillment).mockResolvedValueOnce({ kind: "held_requires_queue" });
    const { POST } = await import("./route");
    const res = await POST(req("11111111-2222-4333-8444-555555555555"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, enqueued: true, review_held: true });
    expect(vi.mocked(runAuditFulfillment).mock.calls[0][3]).toMatchObject({ mayGenerateHeld: false });
    expect(auditSend).toHaveBeenCalledWith({
      session_id: "11111111-2222-4333-8444-555555555555",
      origin: "https://astrant.io",
    });
  });
});

describe("POST /api/audit-fulfill — review hold hand-off failure", () => {
  it("enqueue throws → 503, session NOT marked error", async () => {
    const { writeAuditSession } = await import("@/lib/audit-fulfill-run");
    vi.mocked(writeAuditSession).mockClear();
    state.env = {
      INTERNAL_FULFILL_KEY: KEY,
      AUDIT_FULFILL_QUEUE: { send: vi.fn(async () => { throw new Error("queue down"); }) },
    };
    vi.mocked(runAuditFulfillment).mockResolvedValueOnce({ kind: "held_requires_queue" });
    const { POST } = await import("./route");
    const res = await POST(req("11111111-2222-4333-8444-555555555555"));
    expect(res.status).toBe(503);
    expect(writeAuditSession).not.toHaveBeenCalled();
  });
});

describe("POST /api/audit-fulfill — impl-day (Slice Q)", () => {
  it("impl-day id → enqueue {kind:impl_day} → 202; no run in the request", async () => {
    const { POST } = await import("./route");
    const res = await POST(req("impl-day60-impl-pay_abc"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, enqueued: true });
    expect(state.send).toHaveBeenCalledWith({ kind: "impl_day", f2_session_id: "impl-pay_abc", day_n: 60 });
    expect(runAuditFulfillment).not.toHaveBeenCalled();
  });

  it("send fails → 503, nothing run", async () => {
    state.send = vi.fn(async () => {
      throw new Error("queue down");
    });
    state.env = { INTERNAL_FULFILL_KEY: KEY, FULFILL_QUEUE: { send: state.send } };
    const { POST } = await import("./route");
    const res = await POST(req("impl-day30-impl-pay_abc"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "enqueue failed" });
    expect(runAuditFulfillment).not.toHaveBeenCalled();
  });

  it("binding missing → 503", async () => {
    state.env = { INTERNAL_FULFILL_KEY: KEY };
    const { POST } = await import("./route");
    expect((await POST(req("impl-day90-impl-pay_abc"))).status).toBe(503);
  });

  it("fix round: replay of an ap- session that throws → error written + audit_fired_at released", async () => {
    const run = await import("@/lib/audit-fulfill-run");
    vi.mocked(run.runAuditFulfillment).mockRejectedValueOnce(new Error("scan failed"));
    vi.mocked(run.readAuditSession).mockResolvedValueOnce({
      session_id: "ap-sub_x-123",
      url: "https://example.com/",
      email: "b@example.com",
      status: "fulfilling",
      created_at: 1,
    } as never);
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          run: async () => {
            calls.push({ sql, params });
            return { meta: { changes: 1 } };
          },
        }),
      }),
    };
    state.env = {
      INTERNAL_FULFILL_KEY: KEY,
      FULFILL_QUEUE: { send: state.send },
      CITATION_DB: db,
      SESSIONS: { get: async () => null, put: async () => undefined },
    };
    const { POST } = await import("./route");
    const res = await POST(req("ap-sub_x-123"));
    expect(res.status).toBe(500);
    expect(vi.mocked(run.writeAuditSession)).toHaveBeenCalledWith(
      state.env,
      expect.objectContaining({ status: "error" }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("SET audit_fired_at = NULL");
    expect(calls[0].params).toEqual(["sub_x", 123]);
  });

  it("non-impl-day id → unchanged (runAuditFulfillment, onCap partial), no enqueue", async () => {
    const { POST } = await import("./route");
    const res = await POST(req("ap-sub_x-123"));
    expect(res.status).toBe(200);
    expect(runAuditFulfillment).toHaveBeenCalledWith(state.env, "ap-sub_x-123", "https://astrant.io", {
      onCap: "partial",
      mayGenerateHeld: false,
    });
    expect(state.send).not.toHaveBeenCalled();
  });
});
