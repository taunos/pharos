#!/usr/bin/env node
// Operator CLI for the Implementation verification report (DECISION
// 2026-11-05): runs the per-artifact acceptance checks in
// src/lib/impl-verify.ts against a customer's live site, for building the
// first buyers' Day-0 / Day-30 reports by hand.
//
// Usage (from marketing-site/, Node >= 22.18 / 23.6 for TypeScript stripping):
//   node scripts/impl-verify.mjs <siteUrl> <expected.json | delivery.patch> [--mcp <url>]
//   node scripts/impl-verify.mjs --expected <delivery.patch>
//
// The second argument is either an ExpectedArtifacts JSON (as printed by
// --expected; edit a path in it if the customer serves a file elsewhere) or the
// delivered patch itself (R2 f2-patches/<session_id>.patch, downloaded by the
// operator). --mcp is the deployed MCP Worker URL the customer reported.
//
// Output: a table on stdout, then the ArtifactCheck[] JSON.
// Exit code: 0 when every artifact is working, 1 otherwise, 2 on usage errors.
//
// No wrangler, no bindings, no production access. The only requests are GETs
// to the customer's site and the MCP handshake to --mcp. A Worker gets
// global_fetch_strictly_public; Node does not, so the fetch below refuses
// hosts that RESOLVE to non-public addresses (residual: a DNS answer that
// changes between this lookup and fetch's own; acceptable for an operator
// tool run on demand against a known customer site).

import { readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { register } from "node:module";

// impl-verify.ts imports "./safe-fetch" without an extension (bundler
// resolution); Node's ESM resolver needs ".ts". Retry relative specifiers
// with ".ts" appended.
register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try {
    return await next(spec, ctx);
  } catch (err) {
    if ((spec.startsWith("./") || spec.startsWith("../")) && !/\\.[cm]?[jt]s$/.test(spec)) {
      return next(spec + ".ts", ctx);
    }
    throw err;
  }
}`),
);

const { verifyArtifacts, expectedFromDelivery } = await import("../src/lib/impl-verify.ts");
const { UnsafeUrlError } = await import("../src/lib/safe-fetch.ts");

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    "usage: node scripts/impl-verify.mjs <siteUrl> <expected.json | delivery.patch> [--mcp <url>]\n" +
      "       node scripts/impl-verify.mjs --expected <delivery.patch>",
  );
  process.exit(2);
}

function loadExpected(file) {
  const raw = readFileSync(file);
  if (file.endsWith(".patch")) return expectedFromDelivery({ patch: new Uint8Array(raw) });
  return JSON.parse(raw.toString("utf8"));
}

// ── Non-public address refusal (Node only) ────────────────────────────────

function v4Private(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function ipPrivate(ip) {
  if (isIP(ip) === 4) return v4Private(ip);
  const s = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return v4Private(mapped[1]);
  return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff") || s.startsWith("::ffff:");
}

async function publicOnlyFetch(input, init) {
  const host = new URL(input).hostname.replace(/^\[|\]$/g, "");
  const addrs = await lookup(host, { all: true, verbatim: true });
  if (addrs.length === 0 || addrs.some((a) => ipPrivate(a.address))) {
    throw new UnsafeUrlError("host resolves to a non-public address");
  }
  return fetch(input, init);
}

// ── Output ────────────────────────────────────────────────────────────────

// Site-controlled strings (content-type, notes) are printed to a terminal:
// neutralize C0/C1 controls so a header cannot inject escape sequences.
const CONTROL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "-" + String.fromCharCode(159) + "]", "g");
const safe = (s) => String(s ?? "").replace(CONTROL, "?");

function table(checks) {
  const rows = checks.map((c) => [
    c.artifact,
    c.state,
    c.evidence.status === undefined ? "-" : String(c.evidence.status),
    c.url || "-",
    (c.evidence.missing ?? []).join(", ") || "-",
    c.evidence.note ?? "",
  ].map(safe));
  const head = ["artifact", "state", "http", "url", "missing", "note"];
  const widths = head.map((h, i) => Math.min(60, Math.max(h.length, ...rows.map((r) => r[i].length))));
  const fmt = (r) => r.map((v, i) => (i === r.length - 1 ? v : v.slice(0, widths[i]).padEnd(widths[i]))).join("  ");
  return [fmt(head), fmt(widths.map((w) => "-".repeat(w))), ...rows.map(fmt)].join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args[0] === "--expected") {
  if (!args[1]) usage("missing <delivery.patch>");
  console.log(JSON.stringify(loadExpected(args[1]), null, 2));
  process.exit(0);
}
let mcpUrl;
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--mcp") {
    mcpUrl = args[++i];
    if (!mcpUrl) usage("--mcp needs a URL");
  } else pos.push(args[i]);
}
if (pos.length !== 2) usage();

let expected;
try {
  expected = loadExpected(pos[1]);
} catch (err) {
  usage(`cannot read ${pos[1]}: ${err instanceof Error ? err.message : String(err)}`);
}

const checks = await verifyArtifacts({ siteUrl: pos[0], expected, mcpUrl, fetchImpl: publicOnlyFetch });
console.log(table(checks));
console.log("");
console.log(JSON.stringify(checks, null, 2));
process.exit(checks.every((c) => c.state === "working") ? 0 : 1);
