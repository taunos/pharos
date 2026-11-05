#!/usr/bin/env node
// §6.1 lead import (local, one-time per source). Reads one or more CSVs whose
// first column is `domain` and writes a SQL file of INSERT OR IGNORE rows
// (state='new', icp_ok=NULL until Bruno's /admin/leads review). It never
// touches D1 itself; apply the output with:
//   npx wrangler d1 execute pharos-outreach --remote --file <out.sql>
//
// Usage:
//   node scripts/import-leads.mjs <out.sql> <source-label>=<csv> [<source-label>=<csv> ...]
// Example (Test A pools):
//   node scripts/import-leads.mjs leads-test-a.sql \
//     test-a-60-cited-vendor=../_tmp/premortem/test-a/cited-vendor-domains-60.csv \
//     test-a-60-uncited=../_tmp/premortem/test-a/uncited-domains-60.csv
//
// Re-imports are safe: `domain` is UNIQUE (INSERT OR IGNORE), and suppression
// is checked by hash before any research, so a suppressed domain stays blocked.
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const [out, ...specs] = process.argv.slice(2);
if (!out || specs.length === 0) {
  console.error("usage: node scripts/import-leads.mjs <out.sql> <source>=<csv> [...]");
  process.exit(2);
}

function normalizeDomain(raw) {
  let s = String(raw).trim().toLowerCase().replace(/^"|"$/g, "");
  s = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].split(":")[0].replace(/\.$/, "");
  if (s.startsWith("www.")) s = s.slice(4);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

const now = Date.now();
const seen = new Set();
const rows = [];
for (const spec of specs) {
  const i = spec.indexOf("=");
  if (i < 1) throw new Error(`bad spec ${spec}`);
  const source = spec.slice(0, i);
  if (!/^[a-z0-9-]+$/.test(source)) throw new Error(`bad source label ${source}`);
  const lines = readFileSync(spec.slice(i + 1), "utf8").split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(",")[0].replace(/"/g, "").trim();
  if (header !== "domain") throw new Error(`${spec}: first column must be 'domain'`);
  for (const line of lines) {
    const d = normalizeDomain(line.split(",")[0]);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    rows.push(`INSERT OR IGNORE INTO leads (id, domain, source, state, icp_ok, updated_at, created_at) VALUES ('${randomUUID()}', '${d}', '${source}', 'new', NULL, ${now}, ${now});`);
  }
}
writeFileSync(out, rows.join("\n") + "\n");
console.log(`wrote ${rows.length} leads to ${out}`);
