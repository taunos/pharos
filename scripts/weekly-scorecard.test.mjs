// node --test scripts/weekly-scorecard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertKvCommand,
  assertReadOnly,
  funnelMetrics,
  hostOf,
  isExternalHost,
  kvGetCommand,
  kvListCommand,
  scannerMetrics,
} from "./weekly-scorecard.mjs";

test("KV allowlist accepts only funnel list/get on SESSIONS", () => {
  assert.equal(
    kvListCommand(),
    'npx wrangler kv key list --binding SESSIONS --remote --prefix "funnel:audit:"',
  );
  assert.equal(
    kvGetCommand("funnel:audit:cks_AbC-123_x"),
    'npx wrangler kv key get "funnel:audit:cks_AbC-123_x" --binding SESSIONS --remote',
  );
});

test("KV allowlist refuses put/delete, other keys, bindings and injection", () => {
  for (const key of [
    "audit:cks_1", // session record (holds email + URL)
    "funnel:audit:",
    'funnel:audit:x" && npx wrangler kv key delete "funnel:audit:y',
    "funnel:audit:x --binding WAITLIST",
    "funnel:audit:$(whoami)",
    "funnel:audit:a/b",
  ]) {
    assert.throws(() => kvGetCommand(key), /refused/, key);
  }
  for (const cmd of [
    'npx wrangler kv key put "funnel:audit:x" "{}" --binding SESSIONS --remote',
    'npx wrangler kv key delete "funnel:audit:x" --binding SESSIONS --remote',
    'npx wrangler kv bulk delete keys.json --binding SESSIONS --remote',
    'npx wrangler kv key list --binding SESSIONS --remote --prefix "audit:"',
    'npx wrangler kv key list --binding SESSIONS --remote',
    'npx wrangler kv key get "funnel:audit:x" --binding WAITLIST --remote',
    'npx wrangler kv key get "funnel:audit:x" --binding SESSIONS --remote && echo',
    'npx wrangler kv key get "funnel:audit:x" --binding SESSIONS',
  ]) {
    assert.throws(() => assertKvCommand(cmd), /refused/, cmd);
  }
});

test("funnelMetrics windows each state by its own timestamp; untimed go to all-time", () => {
  const recs = [
    { created_at: 10, status: "checkout_created" },
    { created_at: 11, status: "paid", paid_at: 20 },
    { created_at: 12, status: "ready", paid_at: 21, ready_at: 30 },
    { created_at: 13, status: "failed", paid_at: 22, failed_at: 60 },
    { created_at: 5, status: "ready", ready_at: 25 }, // paid write lost: paid by ready_at
    { status: "paid" }, // no timestamps at all
  ];
  const m = funnelMetrics(recs, 10, 50);
  assert.deepEqual(m.windowed, { checkoutStarts: 4, paid: 4, ready: 2, failed: 0 });
  assert.deepEqual(m.allTime, { checkoutStarts: 6, paid: 5, ready: 2, failed: 1 });
  assert.equal(m.untimed, 1);
});

test("assertReadOnly accepts single read statements", () => {
  assert.ok(assertReadOnly("SELECT COUNT(*) FROM scans WHERE created_at >= 1"));
  assert.ok(assertReadOnly("  with x AS (SELECT 1) SELECT * FROM x"));
  assert.ok(assertReadOnly("PRAGMA table_info(scans)"));
});

test("assertReadOnly refuses writes, multi-statements and shell-unsafe SQL", () => {
  for (const sql of [
    "DELETE FROM scans",
    "UPDATE scans SET email = NULL",
    "INSERT INTO scans VALUES (1)",
    "SELECT 1; DELETE FROM scans",
    "WITH x AS (SELECT 1) DELETE FROM scans",
    "SELECT 1 WHERE 1 = 1 OR (DROP TABLE scans)",
    "select * from scans where url = \"a\"",
    "SELECT '$(rm -rf x)'",
    "SELECT '%PATH%'",
    "VACUUM",
    "",
  ]) {
    assert.throws(() => assertReadOnly(sql), /refused/, sql);
  }
});

test("hostOf normalizes and tolerates junk", () => {
  assert.equal(hostOf("https://WWW.Foo.com/x"), "foo.com");
  assert.equal(hostOf("not a url"), null);
});

test("isExternalHost excludes our, test and junk hosts", () => {
  for (const h of ["astrant.io", "mcp.astrant.io", "example.com", "localhost", "shop.test", "ftp", "10.0.0.1", null]) {
    assert.equal(isExternalHost(h), false, String(h));
  }
  assert.equal(isExternalHost("resend.com"), true);
  assert.equal(isExternalHost("resend.com", ["resend.com"]), false);
  assert.equal(isExternalHost("api.resend.com", ["resend.com"]), false);
});

test("scannerMetrics splits external, outreach, own-host and paid scans", () => {
  const rows = [
    { url: "https://a.com", created_at: 10, source: null, tier: "free", has_email: 1 },
    { url: "https://www.a.com/x", created_at: 11, source: null, tier: "free", has_email: 0 },
    { url: "https://b.com", created_at: 12, source: "outreach", tier: "free", has_email: 0 },
    { url: "https://astrant.io", created_at: 13, source: null, tier: "free", has_email: 1 },
    { url: "https://c.com", created_at: 14, source: null, tier: "paid", has_email: 0 },
    { url: "https://astrant.io", created_at: 15, source: null, tier: "paid", has_email: 0 },
    { url: "https://d.com", created_at: 99, source: null, tier: "free", has_email: 0 },
  ];
  assert.deepEqual(scannerMetrics(rows, 0, 50), {
    externalScans: 2,
    externalDomains: 1,
    emailCaptures: 1,
    outreachScans: 1,
    internalScans: 1,
    paidScans: 1,
    paidDomains: 1,
  });
});
