// E8 (code-quality audit 2026-11-05): score_url calls pharos-scanner's ScanRpc
// entrypoint over a Service Binding with the end-user IP, and fails closed
// when the binding is missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requestScan, SCANNER_BINDING_MISSING, type ScanRpcBinding } from "../src/scanner-rpc.ts";

function fakeScanner(reply = { status: 200, body: { id: "x" } as unknown }) {
  const calls: Array<[string, string]> = [];
  const binding: ScanRpcBinding = {
    scan: async (url, ip) => {
      calls.push([url, ip]);
      return reply;
    },
  };
  return { binding, calls };
}

test("requestScan passes each end-user IP through, so two users reach the scanner as two identities", async () => {
  const { binding, calls } = fakeScanner();
  await requestScan(binding, "https://example.com/", "198.51.100.1");
  await requestScan(binding, "https://example.com/", "2001:db8::7");
  assert.deepEqual(calls, [
    ["https://example.com/", "198.51.100.1"],
    ["https://example.com/", "2001:db8::7"],
  ]);
});

test("requestScan returns the scanner's status and body unchanged", async () => {
  const { binding } = fakeScanner({ status: 429, body: { ok: false, error: "Rate limit: 5 scans per IP per day" } });
  assert.deepEqual(await requestScan(binding, "https://example.com/", "198.51.100.1"), {
    status: 429,
    body: { ok: false, error: "Rate limit: 5 scans per IP per day" },
  });
});

test("requestScan sends an empty IP when the Worker saw none (the scanner refuses it)", async () => {
  const { binding, calls } = fakeScanner();
  await requestScan(binding, "https://example.com/", null);
  assert.deepEqual(calls, [["https://example.com/", ""]]);
});

test("requestScan fails closed when the SCANNER binding is missing", async () => {
  await assert.rejects(requestScan(undefined, "https://example.com/", "198.51.100.1"), new Error(SCANNER_BINDING_MISSING));
  await assert.rejects(
    requestScan({} as ScanRpcBinding, "https://example.com/", "198.51.100.1"),
    new Error(SCANNER_BINDING_MISSING)
  );
});

test("requestScan times out a hung scanner", async () => {
  const hung: ScanRpcBinding = { scan: () => new Promise(() => {}) };
  await assert.rejects(requestScan(hung, "https://example.com/", "198.51.100.1", 10), { name: "TimeoutError" });
});

test("score_url uses the binding with the client IP, never the public scanner URL; wrangler binds ScanRpc", () => {
  const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(src, /requestScan\(env\.SCANNER, url, clientIp\)/);
  assert.doesNotMatch(src, /pharos-scanner\.pharos-dev\.workers\.dev/);
  assert.doesNotMatch(src, /scanner\.astrant\.io\/api\/scan/);
  const cfg = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(cfg, /\{ "binding": "SCANNER", "service": "pharos-scanner", "entrypoint": "ScanRpc" \}/);
});
