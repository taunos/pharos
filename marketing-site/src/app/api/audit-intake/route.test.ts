import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Dataset spec v2 §3 — /api/audit-intake: validation, paid-only, order-bound
// retention, last-write-wins with a per-session cap, streaming body cap.

type PutCall = { key: string; value: string; opts?: { expiration?: number; expirationTtl?: number } };
const state: {
  env: Record<string, unknown>;
  store: Map<string, string>;
  expirations: Map<string, number>;
  puts: PutCall[];
} = { env: {}, store: new Map(), expirations: new Map(), puts: [] };

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: state.env }),
}));

const SID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";
const OTHER = "7a1b2c3d-4e5f-4a6b-9c8d-0e1f2a3b4c5d";
const NOTE_SECRET = "call me at +55 11 99999-0000";
const nowSec = () => Math.floor(Date.now() / 1000);

function seedSession(sid: string, extra: Record<string, unknown>, ttlSec = 10 * 24 * 3600) {
  state.store.set(`audit:${sid}`, JSON.stringify({ session_id: sid, status: "fulfilling", ...extra }));
  state.expirations.set(`audit:${sid}`, nowSec() + ttlSec);
}

function req(body: unknown) {
  return new Request("https://astrant.io/api/audit-intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.store = new Map();
  state.expirations = new Map();
  state.puts = [];
  seedSession(SID, { paid_at: 1 });
  state.env = {
    SESSIONS: {
      get: vi.fn(async (k: string) => state.store.get(k) ?? null),
      put: vi.fn(async (k: string, v: string, opts?: PutCall["opts"]) => {
        state.puts.push({ key: k, value: v, opts });
        state.store.set(k, v);
      }),
      list: vi.fn(async ({ prefix }: { prefix: string }) => ({
        keys: [...state.store.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((name) => ({ name, expiration: state.expirations.get(name) })),
        list_complete: true,
      })),
    },
  };
});
afterEach(() => vi.restoreAllMocks());

async function postReq(r: Request) {
  const { POST } = await import("./route");
  const res = await POST(r);
  return { status: res.status, json: (await res.json()) as { ok: boolean; error?: string; stored?: boolean } };
}
const post = (body: unknown) => postReq(req(body));
const stored = () => JSON.parse(state.store.get(`intake:audit:${SID}`)!);

describe("POST /api/audit-intake", () => {
  it("valid answers + notes → stored, expiring exactly with the order record", async () => {
    const r = await post({ session_id: SID, trigger: "launching_api", owner: "founder", notes: "  hello  " });
    expect(r).toEqual({ status: 200, json: { ok: true, stored: true } });
    expect(state.puts).toHaveLength(1);
    expect(state.puts[0].key).toBe(`intake:audit:${SID}`);
    expect(state.puts[0].opts).toEqual({ expiration: state.expirations.get(`audit:${SID}`) });
    expect(stored()).toEqual({
      taxonomy_version: "pain-v1",
      submitted_at: expect.any(Number),
      answers: { trigger: "launching_api", owner: "founder" },
      notes: "hello",
      write_count: 1,
    });
  });

  it.each([
    ["awaiting_payment, no paid_at", { status: "awaiting_payment" }],
    ["error without paid_at", { status: "error" }],
  ])("unpaid session (%s) → 409 not_paid_yet, nothing written", async (_n, extra) => {
    seedSession(SID, extra);
    const r = await post({ session_id: SID, trigger: "other" });
    expect(r).toEqual({ status: 409, json: { ok: false, error: "not_paid_yet" } });
    expect(state.puts).toHaveLength(0);
  });

  it("order with ≤ 60 s left, or no expiration, → 410, nothing written", async () => {
    seedSession(SID, { paid_at: 1 }, 60);
    expect((await post({ session_id: SID, trigger: "other" })).status).toBe(410);
    state.expirations.delete(`audit:${SID}`);
    expect((await post({ session_id: SID, trigger: "other" })).status).toBe(410);
    expect(state.puts).toHaveLength(0);
  });

  it.each([
    ["unknown enum value", { trigger: "hacked" }],
    ["label instead of code", { owner: "SEO agency" }],
    ["code from another question", { pain: "founder" }],
    ["non-string answer", { tried: ["nothing"] }],
    ["unknown field", { email: "x@example.com" }],
    ["non-string notes", { notes: { a: 1 } }],
    ["NUL in notes", { notes: "a" + String.fromCharCode(0) + "b" }],
  ])("%s → 400, nothing written", async (_n, extra) => {
    const r = await post({ session_id: SID, ...extra });
    expect(r.status).toBe(400);
    expect(state.puts).toHaveLength(0);
  });

  it("notes over 1000 chars → 400; exactly 1000 accepted", async () => {
    expect((await post({ session_id: SID, notes: "a".repeat(1001) })).json.error).toBe("NOTES_TOO_LONG");
    expect(state.puts).toHaveLength(0);
    expect((await post({ session_id: SID, notes: "a".repeat(1000) })).status).toBe(200);
  });

  it("body over 8 KiB → 413", async () => {
    const r = await post(JSON.stringify({ session_id: SID, pad: "x".repeat(9000) }));
    expect(r.status).toBe(413);
    expect(state.puts).toHaveLength(0);
  });

  it("stops reading the body stream once past 8 KiB", async () => {
    let pulls = 0;
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        c.enqueue(chunk); // endless
      },
    });
    const r = new Request("https://astrant.io/api/audit-intake", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect((await postReq(r)).status).toBe(413);
    expect(pulls).toBeLessThan(20);
  });

  it.each([
    ["malformed JSON", "{"],
    ["array body", "[]"],
  ])("%s → 400", async (_n, raw) => {
    expect((await post(raw)).status).toBe(400);
  });

  it("another session id with no record cannot be written (404)", async () => {
    const r = await post({ session_id: OTHER, trigger: "other" });
    expect(r.status).toBe(404);
    expect(state.puts).toHaveLength(0);
  });

  it.each([undefined, "ap-123", "impl-day-x", `${SID}/../x`, 42])(
    "ineligible session_id %s → 404",
    async (sid) => {
      expect((await post({ session_id: sid, trigger: "other" })).status).toBe(404);
      expect(state.puts).toHaveLength(0);
    },
  );

  it("last write wins for the session holder, capped at 3 writes", async () => {
    expect((await post({ session_id: SID, trigger: "other", notes: "first" })).status).toBe(200);
    expect((await post({ session_id: SID, trigger: "launching_api" })).status).toBe(200);
    expect(stored()).toMatchObject({ answers: { trigger: "launching_api" }, write_count: 2 });
    expect(stored().notes).toBeUndefined();
    expect((await post({ session_id: SID, pain: "not_mentioned" })).status).toBe(200);
    const third = state.store.get(`intake:audit:${SID}`);
    const r = await post({ session_id: SID, trigger: "other" });
    expect(r).toEqual({ status: 429, json: { ok: false, error: "WRITE_LIMIT" } });
    expect(state.store.get(`intake:audit:${SID}`)).toBe(third);
  });

  it("a rewrite keeps codes already assigned to earlier notes", async () => {
    state.store.set(
      `intake:audit:${SID}`,
      JSON.stringify({ taxonomy_version: "pain-v1", submitted_at: 1, answers: {}, notes_codes: ["pain.not_mentioned"], coded_by: "human", write_count: 1 }),
    );
    expect((await post({ session_id: SID, owner: "founder" })).status).toBe(200);
    expect(stored()).toMatchObject({
      answers: { owner: "founder" },
      notes_codes: ["pain.not_mentioned"],
      coded_by: "human",
      write_count: 2,
    });
  });

  it("all fields skipped with nothing stored yet → ok, nothing stored", async () => {
    const r = await post({ session_id: SID, trigger: "", pain: null, notes: "   " });
    expect(r).toEqual({ status: 200, json: { ok: true, stored: false } });
    expect(state.puts).toHaveLength(0);
  });

  it("never logs the free text, even when the write fails", async () => {
    const spies = (["log", "error", "warn", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    (state.env.SESSIONS as { put: unknown }).put = vi.fn(async () => {
      throw new Error("kv down");
    });
    const r = await post({ session_id: SID, notes: NOTE_SECRET });
    expect(r.status).toBe(500);
    for (const s of spies) {
      for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain("99999");
    }
  });
});
