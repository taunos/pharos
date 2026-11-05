// E14 (code-quality audit 2026-11-05): outreach's SSRF-guard copy runs the
// shared adversarial table parity/ssrf-guard-cases.json. The scanner and
// mcp-server run the same file against their copies, so any drift fails a suite.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { safeHttpsUrl } from "../src/safety";
import { safeFetch } from "../src/research";

interface SsrfCases {
  reject: string[];
  accept: string[];
  profiles: Record<"public" | "prospect", { accept: string[]; reject: string[] }>;
  redirects: {
    follow_statuses: number[];
    no_follow_statuses: number[];
    max_redirects: number;
    start_url: string;
    safe_same_site_target: string;
  };
}

const T: SsrfCases = JSON.parse(
  readFileSync(new URL("../../parity/ssrf-guard-cases.json", import.meta.url), "utf8")
);

const ok = (u: string) => safeHttpsUrl(u) !== null;
const SITE = new URL(T.redirects.start_url).hostname;

describe("SSRF parity table: safeHttpsUrl (prospect profile)", () => {
  it("rejects every shared reject row", () => {
    expect(T.reject.filter(ok)).toEqual([]);
  });
  it("accepts every shared accept row", () => {
    expect(T.accept.filter((u) => !ok(u))).toEqual([]);
  });
  it("matches the prospect profile rows", () => {
    expect(T.profiles.prospect.reject.filter(ok)).toEqual([]);
    expect(T.profiles.prospect.accept.filter((u) => !ok(u))).toEqual([]);
  });
});

function redirectingFetch(status: number, location: string, always = false) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if (calls.length === 1 || always) return new Response(null, { status, headers: { location } });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  return { calls, f };
}

describe("SSRF parity table: research safeFetch redirects", () => {
  it("never fetches a redirect hop that points at a reject row", async () => {
    const absolute = T.reject.filter((u) => {
      try {
        new URL(u);
        return true;
      } catch {
        return false;
      }
    });
    for (const target of absolute) {
      const { calls, f } = redirectingFetch(302, target);
      expect(await safeFetch(f, T.redirects.start_url, SITE), target).toBeNull();
      expect(calls, target).toHaveLength(1);
    }
  });
  it("follows exactly the follow statuses", async () => {
    for (const s of T.redirects.follow_statuses) {
      const { calls, f } = redirectingFetch(s, T.redirects.safe_same_site_target);
      expect((await safeFetch(f, T.redirects.start_url, SITE))?.status, String(s)).toBe(200);
      expect(calls, String(s)).toHaveLength(2);
    }
    for (const s of T.redirects.no_follow_statuses) {
      const { calls, f } = redirectingFetch(s, T.redirects.safe_same_site_target);
      expect(await safeFetch(f, T.redirects.start_url, SITE), String(s)).toBeNull();
      expect(calls, String(s)).toHaveLength(1);
    }
  });
  it("stops after max_redirects hops", async () => {
    const { calls, f } = redirectingFetch(302, T.redirects.safe_same_site_target, true);
    expect(await safeFetch(f, T.redirects.start_url, SITE)).toBeNull();
    expect(calls).toHaveLength(T.redirects.max_redirects + 1);
  });
});
