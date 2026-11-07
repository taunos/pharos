// Report truthfulness (1.3.2): a content-only site is not scored on an MCP
// server it should not build, and a site without ratings is not pushed to
// invent them. Fixtures only: every fetch is stubbed, no network.
import { describe, it, expect, vi, afterEach } from "vitest";
import { runDim2, DIM2_CONTENT_ONLY_NA_NOTE } from "./checks/dim2-mcp";
import { runDim4, REVIEW_SCHEMA_NA_NOTE } from "./checks/dim4-structured";
import { runScan } from "./run-scan";
import { compositeOf, SPEC_WEIGHTS } from "./scoring";
import type { DimensionResult } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

const env = () =>
  ({
    CACHE: { get: async () => null, put: async () => {} },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
    AI: { run: async () => ({ response: "50" }) },
  }) as never;

type Route = () => Response | Promise<Response>;
function routes(map: Record<string, Route>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) => {
      calls.push(String(u));
      return (map[String(u)] ?? (() => new Response("", { status: 404 })))();
    })
  );
  return calls;
}
const json = (v: unknown, type = "application/json") => () =>
  new Response(JSON.stringify(v), { status: 200, headers: { "content-type": type } });
const html = (s: string) => () => new Response(s, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

const HOME = "https://acme.com/";
const DOH = "https://cloudflare-dns.com/dns-query?name=_mcp.acme.com&type=TXT";
const PAGE = "<!doctype html><html><head><title>Acme Psychology</title></head><body><h1>Acme</h1><p>We help people.</p></body></html>";
const SPEC = { openapi: "3.1.0", info: { title: "Acme", version: "1", description: "x".repeat(30) }, paths: {} };
const scan = () => runScan(env(), HOME, "free", { useCache: false, throwOnInsertFail: false });
const dim = (r: { dimensions: DimensionResult[] }, id: number) => r.dimensions.find((d) => d.dimension_id === id)!;

describe("1.3.2 Dim 2: N/A on a content-only site with no MCP artifact", () => {
  it("content-only site (Dim 3 N/A, no card, no _mcp TXT) => Dim 2 whole-dimension N/A", async () => {
    routes({ [HOME]: html(PAGE) });
    const r = await scan();
    expect(dim(r, 3).na).toBe(true);
    const d2 = dim(r, 2);
    expect(d2.na).toBe(true);
    expect(d2.unmeasured).toBeUndefined();
    expect(d2.sub_checks.every((s) => s.na === true && s.score === 0)).toBe(true);
    expect(d2.sub_checks[0].notes).toBe(DIM2_CONTENT_ONLY_NA_NOTE);
  });

  it("content-only site with a _mcp TXT record => Dim 2 scored as before", async () => {
    routes({
      [HOME]: html(PAGE),
      [DOH]: json({ Status: 0, Answer: [{ name: "_mcp.acme.com", type: 16, data: '"v=1; mcp=https://mcp.acme.com/mcp"' }] }, "application/dns-json"),
    });
    const r = await scan();
    expect(dim(r, 3).na).toBe(true);
    const d2 = dim(r, 2);
    expect(d2.na).toBeUndefined();
    expect(d2.sub_checks.find((s) => s.id === "dns_txt")).toMatchObject({ score: 100, passed: true });
    expect(d2.score).toBeGreaterThan(0);
  });

  it("content-only site with a (broken) MCP card => Dim 2 scored as before", async () => {
    routes({ [HOME]: html(PAGE), "https://acme.com/.well-known/mcp.json": () => new Response("not json", { status: 200 }) });
    const d2 = dim(await scan(), 2);
    expect(d2.na).toBeUndefined();
    expect(d2.sub_checks.find((s) => s.id === "well_known")!.score).toBe(50);
  });

  it("a site with an API (Dim 3 scored) and no MCP => Dim 2 still scored (0 on discovery)", async () => {
    routes({ [HOME]: html(PAGE), "https://acme.com/openapi.json": json(SPEC) });
    const r = await scan();
    expect(dim(r, 3).na).toBeUndefined();
    const d2 = dim(r, 2);
    expect(d2.na).toBeUndefined();
    expect(d2.sub_checks.find((s) => s.id === "well_known")!.score).toBe(0);
  });

  it("runDim2 without the content-only signal (or with false) never goes N/A", async () => {
    routes({});
    expect((await runDim2(HOME, env())).na).toBeUndefined();
    expect((await runDim2(HOME, env(), false)).na).toBeUndefined();
    expect((await runDim2(HOME, env(), Promise.resolve(true))).na).toBe(true);
  });

  it("the content-only promise is not awaited when an MCP artifact exists", async () => {
    routes({ "https://acme.com/.well-known/mcp.json": json({ name: "acme" }) });
    const d2 = await runDim2(HOME, env(), new Promise<boolean>(() => {}));
    expect(d2.na).toBeUndefined();
  });

  it("composite for a content-only site renormalizes over Dims 1, 4 and 5 only", async () => {
    routes({ [HOME]: html(PAGE) });
    const r = await scan();
    // Free tier: Dim 6 is the static demo (N/A). Dims 2 and 3 N/A here.
    expect(r.dimensions.filter((d) => d.na).map((d) => d.dimension_id)).toEqual([2, 3, 6]);
    expect(r.dimensions_applicable).toBe(3);
    expect(r.dimensions_scored).toBe(6);
    const [d1, d4, d5] = [dim(r, 1), dim(r, 4), dim(r, 5)];
    const expected = Math.round(
      (d1.score * SPEC_WEIGHTS[1] + d4.score * SPEC_WEIGHTS[4] + d5.score * SPEC_WEIGHTS[5]) /
        (SPEC_WEIGHTS[1] + SPEC_WEIGHTS[4] + SPEC_WEIGHTS[5])
    );
    expect(r.composite.score).toBe(expected);
    expect(r.composite).toEqual(compositeOf(r.dimensions));
  });
});

describe("1.3.2 Dim 4: review_schema is N/A without ratings markup", () => {
  const ORG = '{"@context":"https://schema.org","@type":"Organization","name":"Acme","url":"https://acme.com"}';
  const page = (...ld: string[]) =>
    `<html><head>${ld.map((b) => `<script type="application/ld+json">${b}</script>`).join("")}</head><body>x</body></html>`;

  it("no Review / AggregateRating => sub-check N/A, weight redistributed", async () => {
    routes({ [HOME]: html(page(ORG)) });
    const d4 = await runDim4(HOME, env());
    const rs = d4.sub_checks.find((s) => s.id === "review_schema")!;
    expect(rs).toMatchObject({ na: true, score: 0, passed: false, weight: 15, notes: REVIEW_SCHEMA_NA_NOTE });
    const scored = d4.sub_checks.filter((s) => !s.na);
    const expected = Math.round(scored.reduce((a, s) => a + s.score * s.weight, 0) / scored.reduce((a, s) => a + s.weight, 0));
    expect(d4.score).toBe(expected);
  });

  it("well-formed AggregateRating present => scored 100 as before", async () => {
    routes({ [HOME]: html(page(ORG, '{"@context":"https://schema.org","@type":"AggregateRating","ratingValue":"4.8","reviewCount":"12"}')) });
    const rs = (await runDim4(HOME, env())).sub_checks.find((s) => s.id === "review_schema")!;
    expect(rs.na).toBeUndefined();
    expect(rs).toMatchObject({ score: 100, passed: true });
  });

  it("malformed Review present => scored 50 as before", async () => {
    routes({ [HOME]: html(page(ORG, '{"@context":"https://schema.org","@type":"Review"}')) });
    const rs = (await runDim4(HOME, env())).sub_checks.find((s) => s.id === "review_schema")!;
    expect(rs.na).toBeUndefined();
    expect(rs.score).toBe(50);
  });
});
