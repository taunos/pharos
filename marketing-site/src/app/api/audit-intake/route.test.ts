import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Dataset spec v2 §3 — /api/audit-intake validation + per-session authorization.

type PutCall = { key: string; value: string; opts?: { expirationTtl?: number } };
const state: { env: Record<string, unknown>; store: Map<string, string>; puts: PutCall[] } = {
  env: {},
  store: new Map(),
  puts: [],
};

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: state.env }),
}));

const SID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";
const OTHER = "7a1b2c3d-4e5f-4a6b-9c8d-0e1f2a3b4c5d";
const NOTE_SECRET = "call me at +55 11 99999-0000";

function req(body: unknown) {
  return new Request("https://astrant.io/api/audit-intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.store = new Map([[`audit:${SID}`, JSON.stringify({ session_id: SID, status: "ready" })]]);
  state.puts = [];
  state.env = {
    SESSIONS: {
      get: vi.fn(async (k: string) => state.store.get(k) ?? null),
      put: vi.fn(async (k: string, v: string, opts?: { expirationTtl?: number }) => {
        state.puts.push({ key: k, value: v, opts });
        state.store.set(k, v);
      }),
    },
  };
});
afterEach(() => vi.restoreAllMocks());

async function post(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST(req(body));
  return { status: res.status, json: (await res.json()) as { ok: boolean; error?: string; stored?: boolean } };
}

describe("POST /api/audit-intake", () => {
  it("valid answers + notes → stored under the session's intake key with the order TTL", async () => {
    const r = await post({ session_id: SID, trigger: "launching_api", owner: "founder", notes: "  hello  " });
    expect(r).toEqual({ status: 200, json: { ok: true, stored: true } });
    expect(state.puts).toHaveLength(1);
    expect(state.puts[0].key).toBe(`intake:audit:${SID}`);
    expect(state.puts[0].opts?.expirationTtl).toBe(30 * 24 * 60 * 60);
    expect(JSON.parse(state.puts[0].value)).toEqual({
      taxonomy_version: "pain-v1",
      submitted_at: expect.any(Number),
      answers: { trigger: "launching_api", owner: "founder" },
      notes: "hello",
    });
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

  it("write-once: a second submit for the same session is refused and does not overwrite", async () => {
    expect((await post({ session_id: SID, trigger: "other" })).status).toBe(200);
    const first = state.store.get(`intake:audit:${SID}`);
    const r = await post({ session_id: SID, trigger: "launching_api" });
    expect(r).toEqual({ status: 409, json: { ok: false, error: "ALREADY_SUBMITTED" } });
    expect(state.store.get(`intake:audit:${SID}`)).toBe(first);
  });

  it("all fields skipped → ok, nothing stored", async () => {
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
