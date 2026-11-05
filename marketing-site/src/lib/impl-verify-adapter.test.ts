import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSqliteD1, readMigration, type SqliteD1 } from "./test-support/sqlite-d1";
import { loadImplVerifier } from "./impl-verify-adapter";
import {
  markImplementationApplied,
  runRecheckVerification,
  type ImplVerificationEnv,
  type VerificationCheck,
} from "./impl-verification";
import { generateLlmsTxt } from "./f2-generators/llms-txt";
import { generateJsonLd } from "./f2-generators/jsonld";
import { generateMcpServerConfig } from "./f2-generators/mcp-server-config";
import { renderMcpServerWorker } from "./f2-mcp-server-template";
import { assembleGitAmPatch } from "./f2-patch-assembler";

// The wired adapter end to end: a real delivered patch in R2, the real
// checker, the flow's Day-0 / Day-30 records in a real SQL engine. Every fetch
// goes to an in-memory router; no network.

const SID = "impl-pay_adapter";
const SITE = "https://acme.com";
const MCP = "https://astrant-mcp-acme.acct.workers.dev/mcp";
const MCP_ORIGIN = new URL(MCP).origin;
const APPLIED = new Date("2026-11-05T12:00:00Z");

const kv = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;
const GEN = {
  brand_name: "Acme",
  domain: "acme.com",
  category: "Developer Tools",
  competitors: ["Globex"],
  baseline_scan_summary: "composite=40 grade=D",
};
const [llms, mcpConfig, jsonld] = await Promise.all([
  generateLlmsTxt({ SESSIONS: kv }, GEN),
  generateMcpServerConfig({ SESSIONS: kv }, GEN),
  generateJsonLd({ SESSIONS: kv }, GEN),
]);
const FILES: Record<string, string> = {
  "public/llms.txt": llms,
  "app/layout-jsonld.html": jsonld,
  ...renderMcpServerWorker(mcpConfig),
};
const PATCH = assembleGitAmPatch({
  customer_domain: GEN.domain,
  customer_email: "dev@acme.com",
  session_id: SID,
  fulfillment_time: new Date("2026-11-01T00:00:00Z"),
  files: FILES,
});

const workerDir = mkdtempSync(join(tmpdir(), "impl-verify-adapter-"));
writeFileSync(join(workerDir, "index.ts"), FILES["mcp-server/index.ts"]);
const worker = (await import(/* @vite-ignore */ pathToFileURL(join(workerDir, "index.ts")).href)).default as {
  fetch(r: Request, env: unknown): Promise<Response>;
};

type Route = Response | string | ((url: string, init: RequestInit) => Promise<Response>);
function router(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (r === undefined) return new Response("not found", { status: 404 });
    if (typeof r === "string") return new Response(r, { headers: { "content-type": "text/plain" } });
    if (r instanceof Response) return r.clone();
    return r(url, init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const toWorker = (url: string, init: RequestInit) => worker.fetch(new Request(url, init), {});
const homepage = () =>
  new Response(`<!doctype html><html><head><title>Acme</title>${jsonld}</head><body>hi</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const goodSite = () =>
  router({
    [`${SITE}/llms.txt`]: llms,
    [`${SITE}/`]: homepage(),
    [`${SITE}/robots.txt`]: "User-agent: *\nAllow: /\n",
    [MCP]: toWorker,
    [`${MCP_ORIGIN}/`]: toWorker,
    [`${MCP_ORIGIN}/.well-known/mcp.json`]: toWorker,
  });
const forbidden = () => new Response("forbidden", { status: 403 });
const blockedSite = () =>
  router({
    [`${SITE}/llms.txt`]: forbidden(),
    [`${SITE}/`]: forbidden(),
    [`${SITE}/robots.txt`]: forbidden(),
    [MCP]: forbidden(),
    [`${MCP_ORIGIN}/`]: forbidden(),
    [`${MCP_ORIGIN}/.well-known/mcp.json`]: forbidden(),
  });

let sq: SqliteD1;
function env(): ImplVerificationEnv {
  return {
    CITATION_DB: sq.d1,
    AUDITS: {
      get: async (k: string) => (k === `f2-patches/${SID}.patch` ? new Response(PATCH) : null),
    } as unknown as R2Bucket,
  };
}
const row = () =>
  sq.db.prepare(`SELECT status, applied_at, mcp_url FROM implementation_sessions WHERE session_id = ?`).get(SID);
const day0 = () => {
  const r = sq.db
    .prepare(`SELECT checks_json FROM implementation_verifications WHERE session_id = ? AND checkpoint = 'day0'`)
    .get(SID) as { checks_json: string } | undefined;
  return r ? (JSON.parse(r.checks_json) as VerificationCheck[]) : null;
};
const states = (checks: VerificationCheck[]) => Object.fromEntries(checks.map((c) => [c.artifact, c.state]));

beforeEach(() => {
  sq = createSqliteD1([
    readMigration("0008_implementation_sessions.sql"),
    readMigration("0016_dayn_email_sent_at.sql"),
    readMigration("0018_impl_verification.sql"),
  ]);
  sq.db.exec(`INSERT INTO implementation_sessions
    (session_id, dodo_payment_id, customer_email, customer_domain, brand_name, category, customer_id,
     status, payment_succeeded_at, bundle_expires_at, patch_r2_key, created_at, updated_at)
    VALUES ('${SID}', 'pay_adapter', 'b@acme.com', '${SITE}', 'Acme', 'saas', 'sub_1',
     'awaiting_application', 1, 2, 'f2-patches/${SID}.patch', 1, 1)`);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("loadImplVerifier (wired to ./impl-verify)", () => {
  it("returns the real checker, not null", () => {
    expect(loadImplVerifier()).not.toBeNull();
  });

  it("working: every delivered artifact verified, MCP at the given URL; Day-0 stored, mcp_url persisted", async () => {
    const site = goodSite();
    const res = await markImplementationApplied(
      env(),
      SID,
      "operator",
      { verifier: loadImplVerifier(), fetchImpl: site.fetchImpl, now: () => APPLIED },
      { mcpUrl: MCP },
    );
    expect(res.kind).toBe("applied");
    if (res.kind !== "applied") return;
    expect(states(res.checks)).toEqual({ llms_txt: "working", json_ld: "working", mcp_server: "working" });
    expect(day0()).toEqual(res.checks);
    expect(row()).toEqual({ status: "active", applied_at: APPLIED.getTime() / 1000, mcp_url: MCP });
    expect(site.calls).toContain(MCP);
  });

  it("no mcpUrl: MCP not checked (unobservable, no request to any MCP host); site artifacts still anchor Day 0", async () => {
    const site = goodSite();
    const res = await markImplementationApplied(env(), SID, "operator", {
      verifier: loadImplVerifier(),
      fetchImpl: site.fetchImpl,
      now: () => APPLIED,
    });
    expect(res.kind).toBe("applied");
    if (res.kind !== "applied") return;
    expect(states(res.checks)).toEqual({ llms_txt: "working", json_ld: "working", mcp_server: "unobservable" });
    const mcp = res.checks.find((c) => c.artifact === "mcp_server")!;
    expect(mcp.url).toBe("");
    expect(mcp.evidence.note).toMatch(/no deployed MCP URL reported/);
    expect(site.calls.some((u) => u.startsWith(MCP_ORIGIN))).toBe(false);
    expect(row()).toMatchObject({ status: "active", mcp_url: null });
  });

  it("absent: nothing deployed → not_verified, every check absent, nothing written", async () => {
    const site = router({});
    const res = await markImplementationApplied(
      env(),
      SID,
      "operator",
      { verifier: loadImplVerifier(), fetchImpl: site.fetchImpl, now: () => APPLIED },
      { mcpUrl: MCP },
    );
    expect(res.kind).toBe("not_verified");
    if (res.kind !== "not_verified") return;
    expect(states(res.checks)).toEqual({ llms_txt: "absent", json_ld: "absent", mcp_server: "absent" });
    expect(day0()).toBeNull();
    expect(row()).toEqual({ status: "awaiting_application", applied_at: null, mcp_url: null });
  });

  it("blocked: 403 everywhere → not_verified with blocked states; force anchors it and stores them", async () => {
    const site = blockedSite();
    const deps = { verifier: loadImplVerifier(), fetchImpl: site.fetchImpl, now: () => APPLIED };
    const res = await markImplementationApplied(env(), SID, "operator", deps, { mcpUrl: MCP });
    expect(res.kind).toBe("not_verified");
    if (res.kind !== "not_verified") return;
    expect(states(res.checks)).toEqual({ llms_txt: "blocked", json_ld: "blocked", mcp_server: "blocked" });

    const forced = await markImplementationApplied(env(), SID, "operator", deps, { mcpUrl: MCP, force: true });
    expect(forced.kind).toBe("applied");
    expect(states(day0()!)).toEqual({ llms_txt: "blocked", json_ld: "blocked", mcp_server: "blocked" });
  });

  it("Day 30 rechecks the MCP URL stored at Day 0", async () => {
    await markImplementationApplied(
      env(),
      SID,
      "operator",
      { verifier: loadImplVerifier(), fetchImpl: goodSite().fetchImpl, now: () => APPLIED },
      { mcpUrl: MCP },
    );
    const later = router({ [`${SITE}/llms.txt`]: llms, [`${SITE}/`]: homepage(), [MCP]: forbidden() });
    const report = await runRecheckVerification(
      env(),
      {
        session_id: SID,
        customer_domain: SITE,
        patch_r2_key: `f2-patches/${SID}.patch`,
        checkpoint: "day30",
        baselineScore: 40,
        baselineScoringVersion: "1.3.0",
        currentScore: 55,
        currentScoringVersion: "1.3.0",
        scanR2Key: "scan-key",
      },
      { verifier: loadImplVerifier(), fetchImpl: later.fetchImpl, now: () => new Date("2026-12-05T12:00:00Z") },
    );
    expect(later.calls).toContain(MCP);
    const byArtifact = Object.fromEntries(report.rows.map((r) => [r.artifact, r]));
    expect(byArtifact.llms_txt).toMatchObject({ day0: "working", current: "working", changed: false });
    expect(byArtifact.mcp_server).toMatchObject({ day0: "working", current: "blocked", changed: true });
  });
});
