// Saves one report-panel run into snapshots/<date>-<name>/: the customer-visible
// report text, what it was made from (scan, audit, AI calls, Dim 6 answers) and
// a manifest. Called by tools/report-panel/run.mjs --archive <name>, or by hand:
//   node datasets/report-defects/archive-run.mjs <panel out dir> <name> [--repo <checkout>]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Text and inputs only; HTML and PDF are re-renderable from audit.json.
const KEEP = /^(report(-SYNTHETIC-DIM6)?\.md|score-(page|pdf|email)\.md|audit(-SYNTHETIC-DIM6)?\.json|scan\.json|score\.json|dim6-cells\.json|ai-calls\.jsonl|summary\.json|log\.txt)$/;

const git = (repo, ...args) => {
  try { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim(); } catch { return null; }
};

export function archiveRun(outDir, name, { repo, tier, dim6, only = null, date = new Date().toISOString().slice(0, 10) } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("--archive name: lowercase letters, digits and dashes only");
  const dest = path.join(HERE, "snapshots", `${date}-${name}`);
  if (fs.existsSync(dest)) throw new Error(`${dest} already exists; pick another name`);
  const sites = {};
  const models = new Set();
  for (const d of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (!d.isDirectory() || (only && !only.includes(d.name))) continue;
    const files = fs.readdirSync(path.join(outDir, d.name)).filter((f) => KEEP.test(f));
    if (!files.some((f) => f.endsWith(".md"))) continue;
    fs.mkdirSync(path.join(dest, d.name), { recursive: true });
    for (const f of files) fs.copyFileSync(path.join(outDir, d.name, f), path.join(dest, d.name, f));
    const scanFile = ["scan.json", "score.json"].map((f) => path.join(outDir, d.name, f)).find((f) => fs.existsSync(f));
    const scan = scanFile ? JSON.parse(fs.readFileSync(scanFile, "utf8")) : null;
    sites[d.name] = { url: (scan?.scan ?? scan)?.url ?? null, scoring_version: (scan?.scan ?? scan)?.scoring_version ?? null };
    const calls = path.join(outDir, d.name, "ai-calls.jsonl");
    if (fs.existsSync(calls)) {
      for (const l of fs.readFileSync(calls, "utf8").split(/\r?\n/)) {
        try { const m = JSON.parse(l).model; if (m) models.add(m); } catch {}
      }
    }
  }
  if (!Object.keys(sites).length) throw new Error(`no reports under ${outDir}`);
  const manifest = {
    schema_version: 1,
    run: path.basename(dest),
    created_at: new Date().toISOString(),
    commit: repo ? git(repo, "rev-parse", "--short", "HEAD") : null,
    uncommitted_changes: repo ? !!git(repo, "status", "--porcelain") : null,
    tier: tier ?? null,
    dim6: dim6 ?? null,
    models: [...models].sort(),
    sites,
    // Fill in after reading: [{ "by": "bruno|codex|gemini|reviewer_agent|orchestrator|outside_reader", "date": "YYYY-MM-DD", "sites": ["*"], "scope": "full|partial: <which parts>" }].
    // A site that was read in full and has no entry in defects.jsonl is a checked clean report.
    reviews: [],
  };
  fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return dest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [outDir, name] = process.argv.slice(2);
  const i = process.argv.indexOf("--repo");
  if (!outDir || !name) { console.error("usage: archive-run.mjs <panel out dir> <name> [--repo <checkout>]"); process.exit(2); }
  console.log(archiveRun(path.resolve(outDir), name, { repo: i > 0 ? process.argv[i + 1] : path.resolve(HERE, "..", "..") }));
}
