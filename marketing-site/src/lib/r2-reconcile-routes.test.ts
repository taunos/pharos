// P0-C2 Chunk F1 — route-level proofs for the internal R2 reconciliation
// endpoints: auth, malformed input, success shape, R2/cap failure, log redaction.
import { describe, it, expect, vi, beforeEach } from "vitest";

// getCloudflareContext is mocked to return a per-test env.
let mockEnv: Record<string, unknown>;
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: mockEnv }) }));

import { POST as deletePOST } from "@/app/api/internal/r2/delete/route";
import { POST as purgePOST } from "@/app/api/internal/r2/purge-prefix/route";

const KEY = "reconcile-secret";
const SCAN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const VKEY = `score-reports/${SCAN}/0123456789abcdef/1.pdf`;
const PREFIX = `score-reports/${SCAN}/`;

function makeAudits(opts: { failDelete?: boolean; neverEmpty?: boolean; onePage?: string[] } = {}) {
  let listCalls = 0;
  return {
    delete: vi.fn(async (_k: string) => { if (opts.failDelete) throw new Error("r2 down"); }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => {
      listCalls++;
      if (opts.neverEmpty) return { objects: [{ key: `${prefix}0123456789abcdef/1.pdf` }] };
      if (opts.onePage && listCalls === 1) return { objects: opts.onePage.map((k) => ({ key: k })) };
      return { objects: [] };
    }),
  };
}
function setEnv(audits: ReturnType<typeof makeAudits>, key: string | undefined = KEY) {
  mockEnv = { AUDITS: audits, RECONCILE_R2_KEY: key };
  return audits;
}
function req(url: string, body: unknown, headerKey?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (headerKey) headers["x-internal-reconcile-key"] = headerKey;
  return new Request(`https://m${url}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

beforeEach(() => { mockEnv = {}; });

describe("POST /api/internal/r2/delete", () => {
  it("unauthorized: missing config / missing header / wrong key → 401, zero R2 calls", async () => {
    const a = makeAudits();
    mockEnv = { AUDITS: a }; // no configured proof
    expect((await deletePOST(req("/api/internal/r2/delete", { key: VKEY }, KEY))).status).toBe(401);
    setEnv(a, KEY);
    expect((await deletePOST(req("/api/internal/r2/delete", { key: VKEY }))).status).toBe(401); // no header
    expect((await deletePOST(req("/api/internal/r2/delete", { key: VKEY }, "wrong"))).status).toBe(401);
    expect(a.delete).not.toHaveBeenCalled();
  });

  it("malformed JSON → 400, zero R2 mutation", async () => {
    const a = setEnv(makeAudits());
    const res = await deletePOST(req("/api/internal/r2/delete", "not json", KEY));
    expect(res.status).toBe(400);
    expect(a.delete).not.toHaveBeenCalled();
  });

  it("bad key form → 422, zero R2 mutation", async () => {
    const a = setEnv(makeAudits());
    const res = await deletePOST(req("/api/internal/r2/delete", { key: `score-reports/${SCAN}/legacy.pdf` }, KEY));
    expect(res.status).toBe(422);
    expect(a.delete).not.toHaveBeenCalled();
  });

  it("valid → 200 { ok, status: 'deleted' } and the object is deleted", async () => {
    const a = setEnv(makeAudits());
    const res = await deletePOST(req("/api/internal/r2/delete", { key: VKEY }, KEY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "deleted" });
    expect(a.delete).toHaveBeenCalledWith(VKEY);
  });

  it("R2 failure → 500, fixed-class log only (no key/uuid)", async () => {
    const a = setEnv(makeAudits({ failDelete: true }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await deletePOST(req("/api/internal/r2/delete", { key: VKEY }, KEY));
    expect(res.status).toBe(500);
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("class=delete_error");
    expect(logged).not.toContain(SCAN);
    expect(logged).not.toContain(VKEY);
    spy.mockRestore();
  });
});

describe("POST /api/internal/r2/purge-prefix", () => {
  it("unauthorized: missing config / missing header / wrong key → 401, zero R2 calls", async () => {
    const a = makeAudits();
    mockEnv = { AUDITS: a }; // no configured proof
    expect((await purgePOST(req("/api/internal/r2/purge-prefix", { prefix: PREFIX }, KEY))).status).toBe(401);
    setEnv(a, KEY);
    expect((await purgePOST(req("/api/internal/r2/purge-prefix", { prefix: PREFIX }))).status).toBe(401); // no header
    expect((await purgePOST(req("/api/internal/r2/purge-prefix", { prefix: PREFIX }, "wrong"))).status).toBe(401);
    expect(a.list).not.toHaveBeenCalled();
    expect(a.delete).not.toHaveBeenCalled();
  });

  it("malformed JSON → 400, zero R2 mutation", async () => {
    const a = setEnv(makeAudits());
    const res = await purgePOST(req("/api/internal/r2/purge-prefix", "not json", KEY));
    expect(res.status).toBe(400);
    expect(a.list).not.toHaveBeenCalled();
    expect(a.delete).not.toHaveBeenCalled();
  });

  it("bad prefix → 422, zero R2 mutation", async () => {
    const a = setEnv(makeAudits());
    const res = await purgePOST(req("/api/internal/r2/purge-prefix", { prefix: `score-reports/${SCAN}` }, KEY));
    expect(res.status).toBe(422);
    expect(a.delete).not.toHaveBeenCalled();
  });

  it("valid → 200 { ok, status: 'purged', purged } and objects are deleted", async () => {
    const a = setEnv(makeAudits({ onePage: [VKEY, `score-reports/${SCAN}/0123456789abcdef/2.pdf`] }));
    const res = await purgePOST(req("/api/internal/r2/purge-prefix", { prefix: PREFIX }, KEY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "purged", purged: 2 });
    expect(a.delete).toHaveBeenCalledTimes(2);
  });

  it("cap failure (prefix never drains) → 422 fail-closed, fixed-class log", async () => {
    const a = setEnv(makeAudits({ neverEmpty: true }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await purgePOST(req("/api/internal/r2/purge-prefix", { prefix: PREFIX }, KEY));
    expect(res.status).toBe(422);
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("class=purge_");
    expect(logged).not.toContain(SCAN);
    spy.mockRestore();
  });
});
