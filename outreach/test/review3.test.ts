// Codex round 3 + the orchestrator's OBSERVATION-ONLY CLAIMS policy.
// A finding reaches a draft only if it states a directly observed fact about ONE
// request to the lead's OWN host, with that response's own status/content-type,
// and (when the claim depends on the body) a fully read body. Written to fail first.
import { describe, it, expect } from "vitest";
import { COPY_RULES, selectGaps } from "../src/facts";
import { gappyScan } from "./helpers";
import type { ScanResult, SubCheck } from "../src/types";

const D = "example.com";
const sub = (s: ScanResult, dim: number, id: string) => s.dimensions.find((d) => d.dimension_id === dim)!.sub_checks.find((x) => x.id === id)!;
const ids = (s: ScanResult) => selectGaps(s, D).map((g) => g.id);

describe("Codex round 3 reproductions", () => {
  it("(1) a homepage response that redirected to another host never yields a JSON-LD absence claim", () => {
    const s = gappyScan();
    for (const sc of s.dimensions[3].sub_checks) sc.evidence = { ...sc.evidence!, final_url: "https://other.com/" };
    expect(ids(s).some((i) => i.startsWith("4."))).toBe(false);
  });
  it("(2) the H1 / blockquote claim is never made (line-limited search can't prove whole-file absence)", () => {
    const s = gappyScan();
    const p = sub(s, 1, "presence");
    p.score = 100;
    p.passed = true;
    p.notes = 'status=200, content-type="text/plain"';
    expect(ids(s).some((i) => i.startsWith("1.spec_compliance"))).toBe(false);
  });
  it("(3) the Markdown claim is never made (403 probes + HTML 200 can't prove 'no Markdown version')", () => {
    expect(ids(gappyScan()).some((i) => i.startsWith("5."))).toBe(false);
  });
  it("(4) Organization / Product / Service / Offer type claims are never made (@type may be an IRI, array or @graph)", () => {
    const s = gappyScan();
    const j = sub(s, 4, "json_ld_present");
    j.passed = true;
    j.score = 100;
    j.notes = "1 valid JSON-LD block(s) on homepage";
    j.evidence = { ...j.evidence!, ld_json_absent_proven: false };
    const all = ids(s);
    expect(all.some((i) => i.startsWith("4.organization_schema") || i.startsWith("4.service_offer_schema"))).toBe(false);
  });
});

describe("only the three observation findings exist", () => {
  it("copy table = 1.presence.{not_found,html} + 4.json_ld_present.none", () => {
    const codes = COPY_RULES.flatMap((r) => Object.keys(r.variants).map((v) => `${r.key}.${v}`)).sort();
    expect(codes).toEqual(["1.presence.html", "1.presence.not_found", "4.json_ld_present.none"]);
  });
  it("the valid base evidence produces exactly the two expected findings", () => {
    expect(ids(gappyScan()).sort()).toEqual(["1.presence.not_found", "4.json_ld_present.none"]);
  });
});

// ── property-style: every claimable code, every bad-evidence variant, never the claim ──

type Mut = [string, (sc: SubCheck) => void];
const ev = (sc: SubCheck) => (sc.evidence ??= { status: null, content_type: "", parsed: false });

const COMMON_BAD: Mut[] = [
  ["no evidence", (sc) => delete sc.evidence],
  ["final URL other host", (sc) => (ev(sc).final_url = "https://other.com/x")],
  ["final URL lookalike host", (sc) => (ev(sc).final_url = "https://example.com.evil.co/x")],
  ["final URL subdomain other than www", (sc) => (ev(sc).final_url = "https://cdn.example.com/x")],
  ["final URL http", (sc) => (ev(sc).final_url = (ev(sc).final_url ?? "").replace("https:", "http:"))],
  ["final URL missing", (sc) => (ev(sc).final_url = "")],
  ["final URL garbage", (sc) => (ev(sc).final_url = "not a url")],
  ["requested URL other host", (sc) => (ev(sc).requested_url = "https://other.com/")],
  ["requested URL missing", (sc) => delete ev(sc).requested_url],
  ["status null (fetch error)", (sc) => (ev(sc).status = null)],
  ["status 403", (sc) => (ev(sc).status = 403)],
  ["status 429", (sc) => (ev(sc).status = 429)],
  ["status 500", (sc) => (ev(sc).status = 500)],
  ["status 301", (sc) => (ev(sc).status = 301)],
];

const CASES: { code: string; prep: (s: ScanResult) => SubCheck; bad: Mut[] }[] = [
  {
    code: "1.presence.not_found",
    prep: (s) => sub(s, 1, "presence"),
    bad: [
      ...COMMON_BAD,
      ["status 200", (sc) => (ev(sc).status = 200)],
      ["status 410", (sc) => (ev(sc).status = 410)],
      ["requested other path", (sc) => (ev(sc).requested_url = "https://example.com/robots.txt")],
    ],
  },
  {
    code: "1.presence.html",
    prep: (s) => {
      const p = sub(s, 1, "presence");
      p.score = 50;
      p.notes = 'status=200, content-type="text/html"';
      p.evidence = { ...p.evidence!, status: 200, content_type: "text/html; charset=utf-8" };
      return p;
    },
    bad: [
      ...COMMON_BAD.filter(([n]) => n !== "status 301"),
      ["content-type text/plain", (sc) => (ev(sc).content_type = "text/plain")],
      ["content-type missing", (sc) => (ev(sc).content_type = "")],
      ["content-type application/xhtml", (sc) => (ev(sc).content_type = "application/xhtml+xml")],
      ["requested other path", (sc) => (ev(sc).requested_url = "https://example.com/")],
    ],
  },
  {
    code: "4.json_ld_present.none",
    prep: (s) => sub(s, 4, "json_ld_present"),
    bad: [
      ...COMMON_BAD,
      ["body not complete", (sc) => (ev(sc).body_complete = false)],
      ["body complete missing", (sc) => delete ev(sc).body_complete],
      ["absence not proven", (sc) => (ev(sc).ld_json_absent_proven = false)],
      ["absence proof missing", (sc) => delete ev(sc).ld_json_absent_proven],
      ["not parsed", (sc) => (ev(sc).parsed = false)],
      ["content-type json", (sc) => (ev(sc).content_type = "application/json")],
      ["content-type missing", (sc) => (ev(sc).content_type = "")],
      ["requested other path", (sc) => (ev(sc).requested_url = "https://example.com/about")],
      ["notes say blocks exist", (sc) => (sc.notes = "1 valid JSON-LD block(s) on homepage")],
    ],
  },
];

describe("property: bad evidence never produces a claim", () => {
  for (const c of CASES) {
    it(`${c.code}: valid evidence produces it`, () => {
      const s = gappyScan();
      c.prep(s);
      expect(ids(s)).toContain(c.code);
    });
    for (const [name, mut] of c.bad) {
      it(`${c.code}: ${name} ⇒ no claim`, () => {
        const s = gappyScan();
        mut(c.prep(s));
        expect(ids(s)).not.toContain(c.code);
      });
    }
  }
  it("pairs of bad mutations never produce any claim either", () => {
    for (const c of CASES) {
      for (const [n1, m1] of c.bad) {
        for (const [n2, m2] of c.bad) {
          const s = gappyScan();
          const sc = c.prep(s);
          m1(sc);
          m2(sc);
          expect(ids(s), `${c.code}: ${n1} + ${n2}`).not.toContain(c.code);
        }
      }
    }
  });
});
