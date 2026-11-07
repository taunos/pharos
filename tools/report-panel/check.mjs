// Automated lint over every report the panel harness generated.
//
//   node tools/report-panel/check.mjs [--out <dir>] [--only a,b] [--sites <file>] [--rules <file>]
//
// For each site directory in out/ it checks report.md (+ the SYNTHETIC-DIM6
// variant) against rules.json, and audit.json against the site's `expect` in
// sites.json. Prints a table per site and exits 1 on any FAIL (2 when there is
// nothing to check). This is a floor: passing it does not replace reading
// every report.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Report variants written by run.mjs: [markdown, audit json, runs expect checks].
export const VARIANTS = [
  ["report.md", "audit.json", true],
  ["report-SYNTHETIC-DIM6.md", "audit-SYNTHETIC-DIM6.json", false],
];

// Harness-only banner lines (never shown to customers) are removed before linting.
const BANNER = /^> (HARNESS NOTE:|SYNTHETIC DIM 6 INPUT)/;

export function loadRules(file = path.join(HERE, "rules.json")) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const compile = (r) => ({ ...r, re: new RegExp(r.pattern, r.flags ?? "") });
  return { text: raw.text.map(compile), fabrication: raw.fabrication.map(compile) };
}

const excerpt = (s, i, len) =>
  s.slice(Math.max(0, i - 40), i + len + 40).replace(/\s+/g, " ").trim();

/** Text rules over customer-visible report markdown. Returns findings. */
export function checkReportText(markdown, rules) {
  const out = [];
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, n) => {
    if (BANNER.test(line)) return;
    for (const r of rules.text) {
      const re = new RegExp(r.re.source, r.re.flags.includes("g") ? r.re.flags : r.re.flags + "g");
      for (const m of line.matchAll(re)) {
        out.push({ level: "FAIL", class: r.class, rule: r.id, where: `line ${n + 1}`, detail: `${r.why}: "${excerpt(line, m.index, m[0].length)}"` });
      }
    }
  });
  return out;
}

/** Per-site forbidden phrases (case-insensitive substrings) over report markdown. */
export function checkForbid(markdown, expect) {
  const out = [];
  const lines = markdown.split(/\r?\n/);
  for (const phrase of expect?.forbid ?? []) {
    const p = phrase.toLowerCase();
    lines.forEach((line, n) => {
      if (BANNER.test(line)) return;
      const i = line.toLowerCase().indexOf(p);
      if (i >= 0) out.push({ level: "FAIL", class: "expect-forbid", rule: "forbid", where: `line ${n + 1}`, detail: `panel says this is false for the site: "${excerpt(line, i, p.length)}"` });
    });
  }
  return out;
}

function findCheck(audit, ref) {
  const [dimId, checkId] = String(ref).split(".");
  const dim = audit.scan?.dimensions?.find((d) => String(d.dimension_id) === dimId);
  if (!dim) return { dim: null, sub: null };
  if (checkId === "*" || checkId === undefined) return { dim, sub: null };
  return { dim, sub: dim.sub_checks?.find((s) => s.id === checkId) ?? null };
}
const dimIsNa = (d) => !!d.na || (d.sub_checks?.length > 0 && d.sub_checks.every((s) => s.na));
const isUnmeasured = (d, s) =>
  !!d.unmeasured || /^not measured/i.test(s?.notes ?? "") || (s === null && d.sub_checks?.every((x) => /^not measured|unmeasurable/i.test(x.notes ?? "")));

/** Does the site lack ratings? Panel fact wins; else read the scan. */
export function siteLacksRatings(audit, expect) {
  if (expect && typeof expect.has_ratings === "boolean") return !expect.has_ratings;
  const { dim, sub } = findCheck(audit, "4.review_schema");
  if (!dim || !sub) return true;
  return dimIsNa(dim) || !!sub.na || Number(sub.score) === 0;
}

/** Ratings advice in remediation text when the site has no ratings. */
export function checkFabrication(audit, expect, rules) {
  if (!siteLacksRatings(audit, expect)) return [];
  const out = [];
  for (const g of audit.gaps ?? []) {
    const text = String(g.remediation ?? "");
    for (const r of rules.fabrication) {
      const m = text.match(r.re);
      if (m) out.push({ level: "FAIL", class: r.class, rule: r.id, where: `gap ${g.dimension_id}.${g.check_id}`, detail: `${r.why}: "${excerpt(text, m.index, m[0].length)}"` });
    }
  }
  return out;
}

/** expect.na (must be N/A) and expect.exists (must not be 0 or N/A). */
export function checkExpect(audit, expect) {
  const out = [];
  for (const ref of expect?.na ?? []) {
    const { dim, sub } = findCheck(audit, ref);
    if (!dim || (!sub && !ref.endsWith("*"))) {
      out.push({ level: "WARN", class: "expect-na", rule: "unknown-check", where: ref, detail: "check id not in this audit (renamed?)" });
      continue;
    }
    if (sub === null) {
      if (!dimIsNa(dim)) out.push({ level: "FAIL", class: "expect-na", rule: "scored-but-na", where: ref, detail: `${dim.dimension_name} scored ${dim.score} ${dim.grade}; panel says it must be N/A` });
    } else if (!dim.na && !sub.na) {
      out.push({ level: "FAIL", class: "expect-na", rule: "scored-but-na", where: ref, detail: `${sub.name} scored ${sub.score}/100; panel says it must be N/A` });
    }
  }
  for (const ref of expect?.exists ?? []) {
    const { dim, sub } = findCheck(audit, ref);
    if (!dim || (!sub && !ref.endsWith("*"))) {
      out.push({ level: "WARN", class: "expect-exists", rule: "unknown-check", where: ref, detail: "check id not in this audit (renamed?)" });
      continue;
    }
    const na = sub === null ? dimIsNa(dim) : !!dim.na || !!sub.na;
    const name = sub?.name ?? dim.dimension_name;
    if (na) {
      out.push(isUnmeasured(dim, sub)
        ? { level: "WARN", class: "expect-exists", rule: "exists-unmeasured", where: ref, detail: `${name} not measured on this run; panel says it exists` }
        : { level: "FAIL", class: "expect-exists", rule: "exists-but-na", where: ref, detail: `${name} reported N/A; panel says it exists on the site` });
    } else if (sub !== null && Number(sub.score) === 0) {
      out.push({ level: "FAIL", class: "expect-exists", rule: "exists-but-zero", where: ref, detail: `${name} scored 0/100 ("${String(sub.notes ?? "").slice(0, 90)}"); panel says it exists on the site` });
    }
  }
  return out;
}

/** All checks for one site directory. Returns { files: {name: findings[]} }. */
export function checkSiteDir(dir, site, rules) {
  const files = {};
  for (const [md, json, structural] of VARIANTS) {
    const mdPath = path.join(dir, md);
    if (!fs.existsSync(mdPath)) continue;
    const findings = [];
    const text = fs.readFileSync(mdPath, "utf8");
    findings.push(...checkReportText(text, rules), ...checkForbid(text, site?.expect));
    const jsonPath = path.join(dir, json);
    if (fs.existsSync(jsonPath)) {
      const audit = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      findings.push(...checkFabrication(audit, site?.expect, rules));
      if (structural) findings.push(...checkExpect(audit, site?.expect));
    } else {
      findings.push({ level: "FAIL", class: "missing", rule: "missing-audit-json", where: json, detail: "report without its audit json" });
    }
    if (!site) findings.push({ level: "WARN", class: "expect", rule: "not-in-panel", where: md, detail: "site not in sites.json; expect checks skipped" });
    files[md] = findings;
  }
  return { files };
}

export const CLASSES = ["placeholder", "jargon", "hallucination", "outcome-promise", "fabrication", "expect-na", "expect-exists", "expect-forbid", "missing", "expect"];

export function formatSite(label, url, result) {
  const names = Object.keys(result.files);
  const short = (n) => (n === "report.md" ? "report" : "synthetic-dim6");
  const rows = [["class", ...names.map(short), "status"]];
  for (const c of CLASSES) {
    const counts = names.map((n) => result.files[n].filter((f) => f.class === c && f.level === "FAIL").length);
    const warns = names.map((n) => result.files[n].filter((f) => f.class === c && f.level === "WARN").length);
    if (c === "missing" || c === "expect") { if (counts.every((x) => !x) && warns.every((x) => !x)) continue; }
    const status = counts.some(Boolean) ? "FAIL" : warns.some(Boolean) ? "warn" : "ok";
    rows.push([c, ...counts.map((x, i) => (warns[i] ? `${x} (+${warns[i]}w)` : String(x))), status]);
  }
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const lines = [`\n== ${label}  ${url ?? ""}`];
  for (const r of rows) lines.push("  " + r.map((c, i) => c.padEnd(w[i])).join("  "));
  for (const n of names) {
    for (const f of result.files[n]) lines.push(`  ${f.level === "FAIL" ? "FAIL" : "warn"} [${short(n)}] ${f.rule} @ ${f.where}: ${f.detail}`);
  }
  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name, def) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  const OUT = path.resolve(opt("out", path.join(HERE, "out")));
  const sites = JSON.parse(fs.readFileSync(path.resolve(opt("sites", path.join(HERE, "sites.json"))), "utf8"));
  const rules = loadRules(path.resolve(opt("rules", path.join(HERE, "rules.json"))));
  const only = opt("only", null)?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
  const dirs = fs.existsSync(OUT)
    ? fs.readdirSync(OUT, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(OUT, d.name, "report.md")))
        .map((d) => d.name)
        .filter((l) => !only || only.includes(l))
    : [];
  if (dirs.length === 0) {
    console.log(`no reports found under ${OUT} (run run.mjs first)`);
    process.exit(2);
  }
  let fails = 0;
  for (const label of dirs) {
    const site = sites.find((s) => s.label === label);
    const result = checkSiteDir(path.join(OUT, label), site, rules);
    fails += Object.values(result.files).flat().filter((f) => f.level === "FAIL").length;
    console.log(formatSite(label, site?.url, result));
  }
  const missing = sites.filter((s) => !dirs.includes(s.label) && (!only || only.includes(s.label))).map((s) => s.label);
  if (missing.length) console.log(`\nnote: panel sites with no report in ${OUT}: ${missing.join(", ")}`);
  console.log(`\n${fails ? "FAIL" : "PASS"}: ${fails} failing finding(s) across ${dirs.length} site(s). A PASS is a floor, not a substitute for reading every report.`);
  process.exit(fails ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
