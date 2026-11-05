// The marketing-site copy of the SSRF guard (used by impl-verify) runs the
// shared adversarial table parity/ssrf-guard-cases.json, like the scanner,
// mcp-server and outreach copies, so drift fails this suite too.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { safeFetch, validateTargetUrl, type SafeFetchFailure } from "./safe-fetch";

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

const T: SsrfCases = JSON.parse(readFileSync(new URL("../../../parity/ssrf-guard-cases.json", import.meta.url), "utf8"));

const ok = (u: string) => {
  try {
    validateTargetUrl(u);
    return true;
  } catch {
    return false;
  }
};

describe("SSRF parity table: marketing-site safe-fetch validateTargetUrl", () => {
  it("rejects every shared reject row", () => {
    expect(T.reject.filter(ok)).toEqual([]);
    expect(T.profiles.public.reject.filter(ok)).toEqual([]);
  });
  it("accepts every shared accept row", () => {
    expect(T.accept.filter((u) => !ok(u))).toEqual([]);
    expect(T.profiles.public.accept.filter((u) => !ok(u))).toEqual([]);
  });
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

describe("SSRF parity table: marketing-site safe-fetch redirects", () => {
  const absoluteRejects = T.reject.filter((u) => {
    try {
      new URL(u);
      return true;
    } catch {
      return false;
    }
  });
  it("never fetches a redirect hop that points at a reject row, and says why", async () => {
    for (const target of absoluteRejects) {
      const { calls, fetchImpl } = redirectingFetch(302, target);
      const reasons: SafeFetchFailure[] = [];
      const res = await safeFetch(T.redirects.start_url, {}, { timeoutMs: 1000, fetchImpl, onFail: (r) => reasons.push(r) });
      expect(res, target).toBeNull();
      expect(calls, target).toHaveLength(1);
      expect(reasons, target).toEqual(["unsafe_url"]);
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

describe("onFail reasons (marketing-site addition)", () => {
  it("timeout, network, unsafe start URL; not called on success", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const reasons: SafeFetchFailure[] = [];
      const onFail = (r: SafeFetchFailure) => reasons.push(r);
      const hang = safeFetch("https://example.com/", {}, { timeoutMs: 50, fetchImpl: () => new Promise<Response>(() => {}), onFail });
      await vi.advanceTimersByTimeAsync(100);
      expect(await hang).toBeNull();
      await safeFetch("https://example.com/", {}, { timeoutMs: 50, fetchImpl: () => Promise.reject(new TypeError("x")), onFail });
      await safeFetch("http://127.0.0.1/", {}, { timeoutMs: 50, fetchImpl: async () => new Response("x"), onFail });
      (await safeFetch("https://example.com/", {}, { timeoutMs: 50, fetchImpl: async () => new Response("x"), onFail }))?.discard();
      expect(reasons).toEqual(["timeout", "network", "unsafe_url"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
