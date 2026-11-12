// Sixth dev check (orchestrator, 2026-11-11): for every gold-correct answer,
// the site description the judge sees must contain at least one line that
// backs it. "Backs" = one of the gold labelers' site-evidence quotes ("S: ...",
// split at "..." elisions into fragments of 3+ words) is found in the
// reference text with the same grounding rule as the judge's site words
// (findQuote). An answer can only be judged CORRECT if this holds, so the count
// of failures is an upper bound on correct answers lost to thin input.
//
//   node tools/report-panel/backing-check.mjs --labels datasets/judge-labels/dev.jsonl --refs <dir with reference-<site>.json> [--list]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const LABELS = opt("labels");
const REFS = opt("refs");
if (!LABELS || !REFS) throw new Error("usage: backing-check.mjs --labels <labels.jsonl> --refs <dir> [--list]");

const nm = ["marketing-site", "scanner"].map((p) => path.join(REPO, p, "node_modules", "esbuild")).find((p) => fs.existsSync(p));
const esbuild = createRequire(path.join(nm, "package.json"))(nm);
const outfile = path.join(HERE, "build", "backing-check-bundle.mjs");
fs.mkdirSync(path.dirname(outfile), { recursive: true });
await esbuild.build({
  stdin: { contents: `export { findQuote } from ${JSON.stringify(path.join(REPO, "marketing-site/src/lib/dim6/accuracy-judge.ts").replace(/\\/g, "/"))};`, resolveDir: REPO, loader: "ts" },
  bundle: true, platform: "node", format: "esm", outfile, logLevel: "warning",
});
const { findQuote } = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);

const strictCorrect = (l) => l.identity === "same_entity" && l.answered === "substantive" && l.facts === "supported" && l.invented_specifics === false && l.core_identity !== "wrong";
const labels = fs.readFileSync(LABELS, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
const refs = {};
const fails = [];
let total = 0;
for (const l of labels.filter(strictCorrect)) {
  total++;
  refs[l.site] ??= JSON.parse(fs.readFileSync(path.join(REFS, `reference-${l.site}.json`), "utf8"));
  const text = refs[l.site].verifiable ? refs[l.site].text : "";
  const ev = [...(l.evidence?.A ?? []), ...(l.evidence?.B ?? []), ...(Array.isArray(l.evidence) ? l.evidence : [])];
  // Labeler quotes carry annotations ("nav: \"Shop Donate", "terms \"...\"",
  // "JSON-LD address ...", "Canonical URL: ..."): split at them and drop the
  // annotation words, so only the site's own words are looked for.
  const fragments = ev
    .filter((e) => /^S:/.test(e))
    .flatMap((e) => e.replace(/^S:\s*/, "").split(/\.\.\.|…|";\s*|"\s*;\s*|\s+\/\s+|(?:^|\s)(?:nav|pricing|terms|about|support|contact|homepage|site nav(?: \([^)]*\))?)\s*:?\s*"/))
    .map((f) => f.replace(/^(?:Canonical URL|JSON-LD address|nav|pricing|terms)\s*:?\s*/i, "").replace(/^["“\s]+|["”\s]+$/g, "").trim())
    .filter((f) => f.split(/\s+/).length >= 2 || /\d/.test(f));
  const ok = fragments.some((f) => findQuote(text, f) !== -1);
  if (!ok) fails.push({ key: `${l.site} ${l.qid} ${l.modelId}`, q: l.question, fragments });
}
const bySite = {};
for (const f of fails) bySite[f.key.split(" ")[0]] = (bySite[f.key.split(" ")[0]] ?? 0) + 1;
console.log(`gold-correct answers with no backing line in the reference: ${fails.length}/${total} ${JSON.stringify(bySite)}`);
if (argv.includes("--list")) for (const f of fails) console.log(`- ${f.key} | ${f.q} | S: ${f.fragments.join(" / ").slice(0, 160)}`);
