// Validates defects.jsonl (and customer.local.jsonl when present). See README.md.
import fs from "node:fs";
import path from "node:path";

export const ENUMS = {
  label: ["defect", "not_defect", "disputed"],
  found_by: ["bruno", "outside_reader", "codex", "gemini", "reviewer_agent", "orchestrator", "panel_rule", "customer"],
  product: ["audit", "free_score", "implementation"],
  surface: ["report", "pdf", "email", "score_page", "methodology", "other"],
  category: ["false_claim", "misleading", "invented_advice", "wrong_action", "not_applicable", "raw_internal", "unclear", "inconsistent", "overclaim", "placeholder", "missing_info", "wrong_language", "other"],
  severity: ["blocker", "polish", "none"],
  status: ["open", "fixed", "deferred", "wont_fix", "not_applicable"],
};
const STRINGS = ["found_at", "source", "site", "section", "text", "why"];
const NULLABLE = ["scoring_version", "context", "fixed_text", "fix_commit", "caught_by_rule", "snapshot"];
const FIELDS = ["schema_version", "id",...Object.keys(ENUMS), ...STRINGS, ...NULLABLE];

const squash = (s) => s.replace(/\s+/g, " ").trim();

/** Returns a list of error strings for the given file contents. */
export function validate(contents, dir) {
  const errors = [];
  const ids = new Set();
  contents.split(/\r?\n/).forEach((line, n) => {
    if (!line.trim()) return;
    const at = `line ${n + 1}`;
    let e;
    try { e = JSON.parse(line); } catch { errors.push(`${at}: not JSON`); return; }
    const err = (m) => errors.push(`${at} (${e.id ?? "no id"}): ${m}`);
    for (const k of Object.keys(e)) if (!FIELDS.includes(k)) err(`unknown field ${k}`);
    for (const k of FIELDS) if (!(k in e)) err(`missing field ${k}`);
    if (e.schema_version !== 1) err("schema_version must be 1");
    if (!/^RD-\d{4,}$/.test(e.id ?? "")) err("id must look like RD-0001");
    else if (ids.has(e.id)) err("duplicate id");
    ids.add(e.id);
    for (const [k, vals] of Object.entries(ENUMS)) if (k in e && !vals.includes(e[k])) err(`${k} must be one of ${vals.join(", ")}`);
    for (const k of STRINGS) if (k in e && (typeof e[k] !== "string" || !e[k].trim())) err(`${k} must be a non-empty string`);
    for (const k of NULLABLE) if (k in e && e[k] !== null && (typeof e[k] !== "string" || !e[k].trim())) err(`${k} must be null or a non-empty string`);
    if (typeof e.found_at === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(e.found_at)) err("found_at must be YYYY-MM-DD");
    if (e.label === "not_defect" && (e.severity !== "none" || e.status !== "not_applicable")) err("not_defect needs severity none and status not_applicable");
    if (e.label === "defect" && (e.severity === "none" || e.status === "not_applicable")) err("defect needs a real severity and status");
    if (e.label === "disputed" && e.status !== "open") err("disputed needs status open (resolve it to defect or not_defect later)");
    if (e.status === "fixed" && !e.fix_commit) err("fixed needs fix_commit");
    if (typeof e.snapshot === "string") {
      const p = path.resolve(dir, e.snapshot);
      if (!p.startsWith(path.resolve(dir) + path.sep)) err("snapshot must be inside this folder");
      else if (!fs.existsSync(p)) err(`snapshot not found: ${e.snapshot}`);
      else if (typeof e.text === "string" && !squash(fs.readFileSync(p, "utf8")).includes(squash(e.text))) err("text does not appear in the snapshot");
    }
  });
  return errors;
}
