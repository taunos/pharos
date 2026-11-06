#!/usr/bin/env node
// Weekly scorecard for the 30-day launch test (2026-11-04 -> 2026-12-04).
//
// Usage (from the repo root, logged in with `wrangler login`):
//   node scripts/weekly-scorecard.mjs                       # last 7 days + since launch
//   node scripts/weekly-scorecard.mjs --since 2026-11-10    # since that date + since launch
//   node scripts/weekly-scorecard.mjs --exclude-domain mysite.com,friend.io
//
// READ-ONLY. The only command this script runs is
//   npx wrangler d1 execute <db> --remote --json --command "<SELECT ...>"
// from the worker folder that owns the DB (so wrangler resolves the binding).
// runQuery() refuses any SQL that is not a single SELECT/WITH/PRAGMA statement.
// Output is aggregate counts only: no URLs, domains, emails or IPs are printed.
//
// "External scan" = a row in pharos-scanner.scans that is
//   - not an outreach prospect scan (source IS NULL),
//   - not a paid-tier scan (paid tier = Audit fulfillment, internal),
//   - on a host that is not ours or a test host (see isExternalHost), and
//   - not on a host passed with --exclude-domain.
// Cache hits (same URL within 1 h) are not stored, so they are not counted.

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 86_400_000;
export const LAUNCH_START = Date.UTC(2026, 10, 4); // 2026-11-04 00:00 UTC
export const LAUNCH_END = Date.UTC(2026, 11, 4); // 2026-12-04 00:00 UTC
export const TARGETS = { externalScans: 50, checkoutStarts: 5, purchases: 1 };

const DBS = {
  scanner: { name: "pharos-scanner", dir: "scanner" },
  citation: { name: "pharos-citation-tracking", dir: "citation-tracking" },
  outreach: { name: "pharos-outreach", dir: "outreach" },
};

// Hosts that are ours or are test hosts. Subdomains match too.
const INTERNAL_HOSTS = ["astrant.io", "example.com", "example.org", "example.net", "localhost"];
const TEST_TLDS = ["test", "example", "invalid", "localhost", "local"];

const WRITE_WORDS =
  /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|TRUNCATE)\b/i;

export function assertReadOnly(sql) {
  const s = String(sql).trim();
  if (!/^(SELECT|WITH|PRAGMA)\b/i.test(s)) throw new Error("refused: SQL must start with SELECT, WITH or PRAGMA");
  if (s.includes(";")) throw new Error("refused: one statement only (no ';')");
  if (WRITE_WORDS.test(s)) throw new Error("refused: SQL contains a write keyword");
  // The SQL is passed inside double quotes on a shell command line.
  if (/["`$%\\]/.test(s)) throw new Error("refused: SQL contains a shell-unsafe character");
  return s;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return null;
  }
}

export function isExternalHost(host, extraExcluded = []) {
  if (!host || !host.includes(".")) return false; // junk like https://ftp//x
  if (/^[\d.]+$/.test(host) || host.includes(":")) return false; // IP literals
  const tld = host.split(".").pop();
  if (TEST_TLDS.includes(tld)) return false;
  for (const d of [...INTERNAL_HOSTS, ...extraExcluded]) {
    if (host === d || host.endsWith("." + d)) return false;
  }
  return true;
}

function runQuery(db, sql) {
  // Collapse whitespace so multi-line SQL fits on one command line.
  const safe = assertReadOnly(String(sql).replace(/\s+/g, " "));
  const cmd = `npx wrangler d1 execute ${db.name} --remote --json --command "${safe}"`;
  let out;
  try {
    out = execSync(cmd, {
      cwd: join(REPO, db.dir),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // Never echo stderr wholesale (it can carry account details); keep the first line.
    const first = String(err.stderr || err.stdout || err.message).split("\n").find((l) => l.trim()) || "";
    throw new Error(`${db.name}: wrangler failed: ${first.slice(0, 200)}`);
  }
  const start = out.indexOf("[");
  const parsed = JSON.parse(out.slice(start));
  if (!parsed[0]?.success) throw new Error(`${db.name}: query failed`);
  return parsed[0].results;
}

// Each source is fetched once; a failure marks that source's metrics as errors.
function tryQuery(db, sql) {
  try {
    return { rows: runQuery(db, sql) };
  } catch (err) {
    return { error: err.message };
  }
}

function parseArgs(argv) {
  const args = { since: null, exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--since") {
      const v = argv[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) throw new Error("--since needs YYYY-MM-DD");
      args.since = Date.parse(v + "T00:00:00Z");
    } else if (argv[i] === "--exclude-domain") {
      args.exclude.push(...String(argv[++i] || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean));
    } else if (argv[i] === "-h" || argv[i] === "--help") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

// ---- metric computation (pure; tested) ----------------------------------

export function scannerMetrics(rows, from, to, exclude = []) {
  const inWin = rows.filter((r) => r.created_at >= from && r.created_at < to);
  const external = inWin.filter(
    (r) => r.source == null && r.tier !== "paid" && isExternalHost(hostOf(r.url), exclude),
  );
  const paidExternal = inWin.filter((r) => r.tier === "paid" && isExternalHost(hostOf(r.url), exclude));
  return {
    externalScans: external.length,
    externalDomains: new Set(external.map((r) => hostOf(r.url))).size,
    emailCaptures: external.filter((r) => r.has_email).length,
    outreachScans: inWin.filter((r) => r.source === "outreach").length,
    internalScans: inWin.filter((r) => r.source == null && r.tier !== "paid" && !isExternalHost(hostOf(r.url), exclude)).length,
    paidScans: paidExternal.length,
    paidDomains: new Set(paidExternal.map((r) => hostOf(r.url))).size,
  };
}

function windowSql(from, to) {
  return { from: Math.floor(from), to: Math.floor(to) };
}

function outreachSql(from, to) {
  const { from: f, to: t } = windowSql(from, to);
  const between = (col) => `${col} >= ${f} AND ${col} < ${t}`;
  return `SELECT
    (SELECT COUNT(*) FROM leads WHERE ${between("created_at")}) AS leads_added,
    (SELECT COUNT(*) FROM messages WHERE ${between("created_at")}) AS drafts_d1,
    (SELECT COUNT(*) FROM messages WHERE ${between("drafted_at")}) AS drafts_mailbox,
    (SELECT COUNT(*) FROM messages WHERE ${between("sent_at")}) AS sent,
    (SELECT COUNT(*) FROM inbound WHERE lead_id IS NOT NULL AND class IN ('interested','question','not_interested','needs_human') AND ${between("received_at")}) AS replies,
    (SELECT COUNT(*) FROM inbound WHERE lead_id IS NOT NULL AND class IN ('interested','question') AND ${between("received_at")}) AS replies_positive,
    (SELECT COUNT(*) FROM inbound WHERE lead_id IS NULL AND class NOT IN ('auto_reply','bounce_hard','bounce_soft') AND ${between("received_at")}) AS inbound_unmatched,
    (SELECT COUNT(*) FROM leads WHERE state = 'opted_out' AND ${between("terminal_at")}) AS opt_outs,
    (SELECT COUNT(*) FROM inbound WHERE class = 'complaint' AND ${between("received_at")}) AS complaints,
    (SELECT COUNT(*) FROM inbound WHERE class = 'bounce_hard' AND ${between("received_at")}) AS bounces`;
}

function citationSql(from, to) {
  const { from: f, to: t } = windowSql(from, to);
  return `SELECT
    (SELECT COUNT(*) FROM email_suppressions WHERE suppressed_at >= ${f} AND suppressed_at < ${t}) AS unsubscribes,
    (SELECT COUNT(*) FROM outreach_do_not_contact WHERE created_at >= ${f} AND created_at < ${t}) AS delete_requests`;
}

// ---- rendering ------------------------------------------------------------

const NM = "n/m"; // not measurable today

function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function render(windows, sections, notes) {
  const labelW = Math.max(...sections.flatMap((s) => s.rows.map((r) => r[0].length))) + 4;
  const colW = 18;
  const pad = (s, w) => String(s).padEnd(w);
  const lines = [];
  lines.push(pad("", labelW) + windows.map((w) => pad(w.label, colW)).join(""));
  for (const s of sections) {
    lines.push("");
    lines.push(s.title);
    for (const [label, ...vals] of s.rows) lines.push(pad("  " + label, labelW) + vals.map((v) => pad(v, colW)).join(""));
  }
  lines.push("");
  lines.push(...notes);
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("node scripts/weekly-scorecard.mjs [--since YYYY-MM-DD] [--exclude-domain a.com,b.com]");
    return;
  }
  const now = Date.now();
  const firstFrom = args.since ?? now - 7 * DAY;
  const windows = [
    { label: args.since ? `since ${fmtDate(firstFrom)}` : "last 7 days", from: firstFrom, to: now },
    { label: `since ${fmtDate(LAUNCH_START)}`, from: LAUNCH_START, to: now },
  ];
  const minFrom = Math.floor(Math.min(...windows.map((w) => w.from)));

  // One scanner read covering both windows; host filtering happens here, and
  // nothing row-level is printed.
  const scan = tryQuery(
    DBS.scanner,
    // tier is NULL only on April-2026 rows (before the tier column existed).
    `SELECT url, created_at, source, tier, (email IS NOT NULL AND email <> '') AS has_email FROM scans WHERE created_at >= ${minFrom}`,
  );
  const perWin = windows.map((w) => ({
    scan: scan.rows ? scannerMetrics(scan.rows, w.from, w.to, args.exclude) : null,
    out: tryQuery(DBS.outreach, outreachSql(w.from, w.to)),
    cit: tryQuery(DBS.citation, citationSql(w.from, w.to)),
  }));

  const sv = (k) => perWin.map((p) => (p.scan ? p.scan[k] : "ERR"));
  const ov = (k) => perWin.map((p) => (p.out.rows ? p.out.rows[0][k] : "ERR"));
  const cv = (k) => perWin.map((p) => (p.cit.rows ? p.cit.rows[0][k] : "ERR"));
  const nm = () => windows.map(() => NM);

  const launch = perWin[1];
  const ext = launch.scan ? launch.scan.externalScans : "ERR";
  const extDom = launch.scan ? launch.scan.externalDomains : "ERR";
  const daysLeft = Math.max(0, Math.ceil((LAUNCH_END - now) / DAY));

  const sections = [
    {
      title: "Traffic (pharos-scanner)",
      rows: [
        ["External scans (total)", ...sv("externalScans")],
        ["External scans (unique domains)", ...sv("externalDomains")],
        ["Score email captures (external)", ...sv("emailCaptures")],
        ["Outreach prospect scans (excluded)", ...sv("outreachScans")],
        ["Own/test-host scans (excluded)", ...sv("internalScans")],
      ],
    },
    {
      title: "Buying",
      rows: [
        ["Qualified buyers who saw the offer", ...nm()],
        ["Audit checkout starts", ...nm()],
        ["Paid Audits (Dodo)", ...nm()],
        ["Refunds", ...nm()],
        ["Proxy: paid-tier scans, ext. hosts", ...sv("paidScans")],
        ["Proxy: paid-tier scans, ext. domains", ...sv("paidDomains")],
        ["Audit report opens / downloads", ...nm()],
        ["Buyers acting on the report", ...nm()],
      ],
    },
    {
      title: "Outreach (pharos-outreach)",
      rows: [
        ["Leads added", ...ov("leads_added")],
        ["Drafts passed validator (D1)", ...ov("drafts_d1")],
        ["Drafts saved to Zoho", ...ov("drafts_mailbox")],
        ["Sent (seen in Sent folder)", ...ov("sent")],
        ["Replies (human, matched to a lead)", ...ov("replies")],
        ["  of which interested/question", ...ov("replies_positive")],
        ["Unmatched inbound (not auto/bounce)", ...ov("inbound_unmatched")],
        ["Opt-outs (leads)", ...ov("opt_outs")],
        ["Complaints", ...ov("complaints")],
        ["Hard bounces", ...ov("bounces")],
      ],
    },
    {
      title: "Opt-out lists (pharos-citation-tracking)",
      rows: [
        ["Email unsubscribes (suppressions)", ...cv("unsubscribes")],
        ["Score data-deletion requests", ...cv("delete_requests")],
      ],
    },
    {
      title: `Targets (launch window, ${daysLeft} days left to ${fmtDate(LAUNCH_END)})`,
      rows: [
        ["External scans >= 50", `${ext} / ${TARGETS.externalScans}`, `(${extDom} unique domains)`],
        ["Checkout starts >= 5", `${NM} / ${TARGETS.checkoutStarts}`, ""],
        ["Purchases >= 1", `${NM} / ${TARGETS.purchases}`, ""],
      ],
    },
  ];

  const errors = [
    scan.error && `scanner: ${scan.error}`,
    ...perWin.flatMap((p) => [p.out.error && `outreach: ${p.out.error}`, p.cit.error && `citation: ${p.cit.error}`]),
  ].filter(Boolean);

  const notes = [
    `Windows are UTC, end = now (${new Date(now).toISOString().slice(0, 16)}Z).`,
    `n/m = not measurable from D1 today:`,
    `  - checkout starts / paid / refunds: Audit funnel lives in KV SESSIONS (funnel:audit:<session>), not D1; amounts, discounts and refunds only in the Dodo dashboard.`,
    `  - qualified buyers who saw the offer: no page-view or offer-impression record exists (Cloudflare Web Analytics is outside D1).`,
    `  - report opens/downloads and buyers acting on the report: not tracked anywhere.`,
    `Proxy rows: a paid-tier scan is one Audit fulfillment run; it counts retries and test purchases on non-Astrant hosts.`,
    `External = source IS NULL, not paid tier, host not astrant.io/example.*/localhost/test TLD/IP/dotless${args.exclude.length ? ", not --exclude-domain" : ""}. MCP score_url scans count as external. Cache hits are not stored.`,
    ...(errors.length ? ["", "ERRORS:", ...[...new Set(errors)].map((e) => "  " + e)] : []),
  ];

  console.log(`Astrant launch-test scorecard  (generated ${new Date(now).toISOString().slice(0, 10)})\n`);
  console.log(render(windows, sections, notes));
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
