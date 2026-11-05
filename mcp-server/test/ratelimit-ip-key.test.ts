// E15 (code-quality audit 2026-11-05): IPv6 rate limits key on the /64; IPv4
// keys are byte-identical to the pre-E15 key. Shared table in
// parity/ip-rate-limit-key-cases.json (scanner and marketing-site run it too).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkRateLimit, rateLimitIpKey } from "../src/site-fetch.ts";

const { cases }: { cases: [string, string][] } = JSON.parse(
  readFileSync(new URL("../../parity/ip-rate-limit-key-cases.json", import.meta.url), "utf8")
);

test("rateLimitIpKey matches the shared parity table", () => {
  for (const [input, expected] of cases) assert.equal(rateLimitIpKey(input), expected, JSON.stringify(input));
});

function recordingLimiter(allow: number) {
  const counts = new Map<string, number>();
  return {
    counts,
    async limit({ key }: { key: string }) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= allow };
    },
  };
}

test("E15: IPv4 and missing-IP keys are byte-identical to the pre-E15 keys", async () => {
  const limiter = recordingLimiter(10);
  await checkRateLimit(limiter, "203.0.113.7");
  await checkRateLimit(limiter, null);
  assert.deepEqual([...limiter.counts.keys()], ["fetch-tool:203.0.113.7", "fetch-tool:unknown"]);
});

test("E15: rotating addresses inside one IPv6 /64 share one budget", async () => {
  const limiter = recordingLimiter(2);
  const results: boolean[] = [];
  for (const ip of ["2001:db8:1:2::1", "2001:db8:1:2::2", "2001:DB8:1:2:ffff::3"]) {
    results.push(await checkRateLimit(limiter, ip));
  }
  assert.deepEqual(results, [true, true, false]);
  assert.equal(await checkRateLimit(limiter, "2001:db8:1:3::1"), true, "another /64 has its own budget");
  assert.equal(await checkRateLimit(limiter, "::ffff:203.0.113.9"), true);
  assert.deepEqual([...limiter.counts.keys()], [
    "fetch-tool:2001:db8:1:2::/64",
    "fetch-tool:2001:db8:1:3::/64",
    "fetch-tool:203.0.113.9",
  ]);
});
