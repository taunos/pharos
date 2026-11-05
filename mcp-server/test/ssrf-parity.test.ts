// E14 (code-quality audit 2026-11-05): mcp-server's SSRF-guard copy runs the
// shared adversarial table parity/ssrf-guard-cases.json. The scanner and
// outreach run the same file against their copies, so any drift fails a suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Deadline, safeFetch, validateTargetUrl } from "../src/site-fetch.ts";

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

const ok = (u: string): boolean => {
  try {
    validateTargetUrl(u);
    return true;
  } catch {
    return false;
  }
};

test("SSRF parity table: validateTargetUrl rejects every shared reject row", () => {
  assert.deepEqual(T.reject.filter(ok), []);
});

test("SSRF parity table: validateTargetUrl accepts every shared accept row", () => {
  assert.deepEqual(T.accept.filter((u) => !ok(u)), []);
});

test("SSRF parity table: validateTargetUrl matches the public profile rows", () => {
  assert.deepEqual(T.profiles.public.reject.filter(ok), []);
  assert.deepEqual(T.profiles.public.accept.filter((u) => !ok(u)), []);
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

async function run(status: number, location: string, always = false) {
  const { calls, fetchImpl } = redirectingFetch(status, location, always);
  const deadline = new Deadline(1000);
  try {
    const r = await safeFetch(T.redirects.start_url, { deadline, fetchImpl });
    return { calls, status: r.res.status as number | null };
  } catch {
    return { calls, status: null };
  } finally {
    deadline.clear();
  }
}

test("SSRF parity table: safeFetch never fetches a redirect hop that points at a reject row", async () => {
  const absolute = T.reject.filter((u) => {
    try {
      new URL(u);
      return true;
    } catch {
      return false;
    }
  });
  for (const target of absolute) {
    const { calls, status } = await run(302, target);
    assert.equal(status, null, target);
    assert.equal(calls.length, 1, target);
  }
});

test("SSRF parity table: safeFetch follows exactly the follow statuses", async () => {
  for (const s of T.redirects.follow_statuses) {
    const { calls, status } = await run(s, T.redirects.safe_same_site_target);
    assert.equal(status, 200, String(s));
    assert.equal(calls.length, 2, String(s));
  }
  for (const s of T.redirects.no_follow_statuses) {
    const { calls } = await run(s, T.redirects.safe_same_site_target);
    assert.equal(calls.length, 1, String(s));
  }
});

test("SSRF parity table: safeFetch stops after max_redirects hops", async () => {
  const { calls } = await run(302, T.redirects.safe_same_site_target, true);
  assert.equal(calls.length, T.redirects.max_redirects + 1);
});
