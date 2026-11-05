// E14 (code-quality audit 2026-11-05): the scanner's two SSRF-guard copies run
// the shared adversarial table parity/ssrf-guard-cases.json. mcp-server and
// outreach run the same file against their copies, so any drift fails a suite.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { safeFetch, validateTargetUrl } from "./safe-fetch";
import { assertProspectUrl } from "./prospect-scan";

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

const passes = (fn: (u: string) => unknown) => (u: string) => {
  try {
    fn(u);
    return true;
  } catch {
    return false;
  }
};

const COPIES = [
  { name: "safe-fetch validateTargetUrl", profile: "public" as const, ok: passes(validateTargetUrl) },
  { name: "prospect-scan assertProspectUrl", profile: "prospect" as const, ok: passes(assertProspectUrl) },
];

describe.each(COPIES)("SSRF parity table: $name", ({ profile, ok }) => {
  it("rejects every shared reject row", () => {
    expect(T.reject.filter(ok)).toEqual([]);
  });
  it("accepts every shared accept row", () => {
    expect(T.accept.filter((u) => !ok(u))).toEqual([]);
  });
  it(`matches the ${profile} profile rows`, () => {
    expect(T.profiles[profile].reject.filter(ok)).toEqual([]);
    expect(T.profiles[profile].accept.filter((u) => !ok(u))).toEqual([]);
  });
});

/** Absolute reject rows: a relative Location ("not a url", "") resolves against the start URL. */
const ABSOLUTE_REJECTS = T.reject.filter((u) => {
  try {
    new URL(u);
    return true;
  } catch {
    return false;
  }
});

function redirectingFetch(status: number, location: string, always = false) {
  const calls: string[] = [];
  const fetchImpl = async (input: string) => {
    calls.push(input);
    if (calls.length === 1 || always) return new Response(null, { status, headers: { location } });
    return new Response("ok", { status: 200 });
  };
  return { calls, fetchImpl };
}

describe("SSRF parity table: safe-fetch redirects", () => {
  it("never fetches a redirect hop that points at a reject row", async () => {
    for (const target of ABSOLUTE_REJECTS) {
      const { calls, fetchImpl } = redirectingFetch(302, target);
      const res = await safeFetch(T.redirects.start_url, {}, { timeoutMs: 1000, fetchImpl });
      expect(res, target).toBeNull();
      expect(calls, target).toHaveLength(1);
    }
  });
  it("follows exactly the follow statuses", async () => {
    for (const status of T.redirects.follow_statuses) {
      const { calls, fetchImpl } = redirectingFetch(status, T.redirects.safe_same_site_target);
      const res = await safeFetch(T.redirects.start_url, {}, { timeoutMs: 1000, fetchImpl });
      expect(res?.status, String(status)).toBe(200);
      expect(calls, String(status)).toHaveLength(2);
      res?.discard();
    }
    for (const status of T.redirects.no_follow_statuses) {
      const { calls, fetchImpl } = redirectingFetch(status, T.redirects.safe_same_site_target);
      const res = await safeFetch(T.redirects.start_url, {}, { timeoutMs: 1000, fetchImpl });
      expect(calls, String(status)).toHaveLength(1);
      res?.discard();
    }
  });
  it("stops after max_redirects hops", async () => {
    const { calls, fetchImpl } = redirectingFetch(302, T.redirects.safe_same_site_target, true);
    const res = await safeFetch(T.redirects.start_url, {}, { timeoutMs: 1000, fetchImpl });
    expect(calls).toHaveLength(T.redirects.max_redirects + 1);
    res?.discard();
  });
});
