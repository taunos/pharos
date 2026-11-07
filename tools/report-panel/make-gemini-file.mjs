// Builds the paste-ready Gemini review file from the reports in out/:
//
//   node tools/report-panel/make-gemini-file.mjs [--out <dir>] [--only a,b]
//
// Writes <out>/gemini-review-<YYYY-MM-DD>.md (panel order from sites.json).
// Bruno pastes it into Gemini; the answer is triaged like any other review.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const OUT = path.resolve(opt("out", path.join(HERE, "out")));
const only = opt("only", null)?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const sites = JSON.parse(fs.readFileSync(path.join(HERE, "sites.json"), "utf8"));

const labels = sites.map((s) => s.label)
  .filter((l) => (!only || only.includes(l)) && fs.existsSync(path.join(OUT, l, "report.md")));
if (labels.length === 0) {
  console.log(`no reports found under ${OUT} (run run.mjs first)`);
  process.exit(2);
}
const dim6Off = labels.some((l) => {
  try { return JSON.parse(fs.readFileSync(path.join(OUT, l, "summary.json"), "utf8")).dim6_mode !== "env"; }
  catch { return true; }
});

const header = [
  "# Review request: are these website audit reports truthful and useful?",
  "",
  `You are reviewing ${labels.length} sample reports from a paid ($79) website audit product. The product scores how easy a website is for AI assistants and agents (ChatGPT, Claude, Gemini, Perplexity) to read, understand and use. Each report contains scores per check plus a "Remediation" paragraph telling the owner what to change.`,
  "",
  "Imagine you are the business owner who paid for one of these reports and pasted it into an AI assistant to check whether the advice is right. Be skeptical and specific.",
  "",
  "For EACH report, list every sentence or score that is:",
  "1. FACTUALLY WRONG about the site. Where you can, open the site (URL is in the report) and check: does it really lack what the report says is missing?",
  "2. HALLUCINATED or IMPOSSIBLE advice (things the owner cannot do, invented files, settings or standards).",
  "3. FABRICATION PRESSURE: advice that can only be followed by inventing data (ratings, prices, FAQs, case studies, profiles).",
  "4. NOT APPLICABLE to this type of business (e.g. asking a bakery for an API).",
  "5. INCONSISTENT: two parts of the same report disagree.",
  "6. OVERCLAIM: promises outcomes the product cannot guarantee.",
  "7. JARGON or internal text a customer should never see.",
  "",
  "Output format: one table per report with columns: quote (exact) | problem type | why | severity (HIGH = a customer would lose trust / ask for a refund; MED = wrong but minor; LOW = polish). Then, at the end:",
  "- the 5 most damaging problems across all reports,",
  "- whether you would consider the report worth $79 as it stands, and what single change would improve it most.",
  "",
  dim6Off
    ? 'Note: Section "Citation Visibility" was not measured in these runs (shown as N/A). Remediation text may vary between runs.'
    : "Note: Remediation text may vary between runs.",
  "",
  "",
].join("\n");

const parts = [header];
for (const l of labels) {
  parts.push(`\n---\n\n# REPORT: ${l}\n\n${fs.readFileSync(path.join(OUT, l, "report.md"), "utf8").trim()}\n`);
}
const date = new Date().toISOString().slice(0, 10);
const file = path.join(OUT, `gemini-review-${date}.md`);
fs.writeFileSync(file, parts.join(""));
console.log(`wrote ${file} (${labels.length} reports: ${labels.join(", ")})`);
