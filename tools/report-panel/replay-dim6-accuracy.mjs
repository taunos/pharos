// Replay the Dim 6 accuracy check (dim6:v5) on a saved real Dim 6 run, at $0
// provider cost: no paid provider is called again. Only Workers AI runs (the
// affirmation judge and the accuracy judge), through the local-only proxy.
//
// Usage (from the repo root; the proxy must be running:
// node tools/report-panel/start-proxy.mjs):
//   node tools/report-panel/replay-dim6-accuracy.mjs <out>/<site>
//        [--repo <checkout>] [--ai-url http://127.0.0.1:8799] [--json <file>]
//
// <out>/<site> must hold dim6-cells.json (written by run.mjs --dim6 env) and
// scan.json. The reference description is built the production way
// (reference.ts: llms.txt + homepage, fetched live from scan.json's url, two
// GET requests to that site). This runs in Node, outside the Workers network
// guard, so only replay saved runs of panel sites.
//
// Prints a per-cell table (model, question id, saved verdict, new verdict,
// the evidence quote) and the old vs new sub-check rates.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const DIR = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
if (!DIR) throw new Error("usage: replay-dim6-accuracy.mjs <out>/<site> [--repo <checkout>] [--ai-url <url>] [--json <file>]");
const REPO = path.resolve(opt("repo", path.resolve(HERE, "..", "..")));
const AI_URL = opt("ai-url", "http://127.0.0.1:8799");
const JSON_OUT = opt("json", null);

const cells = JSON.parse(fs.readFileSync(path.join(DIR, "dim6-cells.json"), "utf8"));
const scan = JSON.parse(fs.readFileSync(path.join(DIR, "scan.json"), "utf8"));

// ── bundle the repo's real Dim 6 sources (same approach as run.mjs) ──────
function mainCheckout() {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return path.dirname(common);
  } catch {
    return null;
  }
}
const BASES = [...new Set([REPO, mainCheckout()].filter(Boolean).map((p) => path.resolve(p)))];
const NODE_PATHS = BASES.flatMap((b) => ["scanner", "marketing-site"].map((pkg) => path.join(b, pkg, "node_modules")))
  .filter((p) => fs.existsSync(p));
function findEsbuild() {
  for (const nm of NODE_PATHS) {
    const p = path.join(nm, "esbuild");
    if (fs.existsSync(p)) return createRequire(path.join(p, "package.json"))(p);
  }
  throw new Error(`esbuild not found under scanner|marketing-site/node_modules of ${BASES.join(" or ")}`);
}
async function bundle() {
  const esbuild = findEsbuild();
  const tag = crypto.createHash("sha1").update(REPO).digest("hex").slice(0, 8);
  const buildDir = path.join(HERE, "build");
  fs.mkdirSync(buildDir, { recursive: true });
  const p = (rel) => JSON.stringify(path.join(REPO, "marketing-site/src/lib/dim6", rel).replace(/\\/g, "/"));
  const entry = path.join(buildDir, `replay-entry-${tag}.ts`);
  fs.writeFileSync(entry, [
    `export * from ${p("reference.ts")};`,
    `export { judgeAffirmation } from ${p("affirmation-judge.ts")};`,
    `export { judgeAccuracy } from ${p("accuracy-judge.ts")};`,
    `export { scoreAffirmedCell, affirmationFailedCell } from ${p("ladder.ts")};`,
    `export { aggregateCells } from ${p("orchestrator.ts")};`,
    `export { buildSubChecks, pickEvidenceQuote, modelLabel } from ${p("runDim6.ts")};`,
    `export { canonicalDomain } from ${p("question-set.ts")};`,
    "",
  ].join("\n"));
  const outfile = path.join(buildDir, `replay-bundle-${tag}.mjs`);
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: "node", format: "esm", target: "node22", outfile,
    external: ["cloudflare:*"], nodePaths: NODE_PATHS, logLevel: "warning",
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

// ── Workers AI through the local proxy ───────────────────────────────────
const ledger = { calls: 0, neurons: 0 };
const AI = {
  async run(model, inputs) {
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, inputs }),
    });
    const j = await res.json().catch(() => ({ ok: false, error: `non-JSON ${res.status}` }));
    ledger.calls++;
    ledger.neurons += Number(j?.result?.usage?.neurons) || 0;
    if (!j.ok) throw new Error(`Workers AI proxy error: ${j.error}`);
    return j.result;
  },
};

const ping = await fetch(AI_URL, { method: "GET" }).catch(() => null);
if (!ping) throw new Error(`AI proxy not reachable at ${AI_URL} — start it: node tools/report-panel/start-proxy.mjs`);

const M = await bundle();
const domain = M.canonicalDomain(scan.url);
const targetUrl = `https://${domain}`;
const reference = await M.resolveSiteReference(scan.url);
console.log(`site=${scan.url} domain=${domain}`);
console.log(reference.verifiable ? `reference (${reference.text.length} chars):\n${reference.text}\n` : `reference NOT verifiable: ${reference.reason}\n`);

const verdictOf = (notes, unmeasurable) =>
  unmeasurable ? "UNMEASURABLE"
    : /accuracy_blocked=true/.test(notes) ? "BLOCKED"
    : /affirmation_failed=true/.test(notes) ? "AFF-FAILED"
    : /accuracy=(CORRECT|WRONG|UNCLEAR)/.exec(notes)?.[1]
      ?? (/judge=(AFFIRM|DENY)/.exec(notes)?.[1] ?? "?");

const rows = [];
const newCells = [];
for (const c of cells) {
  const text = c.result.text;
  const old = verdictOf(c.result.notes, c.result.unmeasurable);
  let result;
  if (c.result.unmeasurable || !text) {
    result = c.result;
  } else {
    const aff = await M.judgeAffirmation({ AI }, targetUrl, text);
    if (aff.kind === "unmeasurable") {
      result = M.affirmationFailedCell(text, c.result.truncated);
    } else if (aff.kind === "deny") {
      result = { text, score: 0, unmeasurable: false, truncated: c.result.truncated, notes: `score=0/100; judge=DENY${c.result.truncated ? "; truncated=true" : ""}` };
    } else {
      const acc = reference.verifiable
        ? await M.judgeAccuracy({ AI }, domain, reference.text, text)
        : reference.reason === "injection" ? { kind: "blocked" } : null;
      result = M.scoreAffirmedCell(text, targetUrl, [], c.result.truncated, acc);
    }
  }
  newCells.push({ ...c, result });
  const now = verdictOf(result.notes, result.unmeasurable);
  rows.push({
    model: M.modelLabel(c.modelId),
    q: c.query.id,
    old,
    new: now === "AFFIRM" ? "AFFIRM (not checked)" : now,
    score: `${c.result.score}->${result.score}`,
    quote: /AFFIRM|CORRECT|WRONG|UNCLEAR/.test(now) ? M.pickEvidenceQuote(text, domain) : "",
  });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("model", 11)}${pad("q", 5)}${pad("old", 8)}${pad("new", 22)}${pad("score", 9)}quote`);
for (const r of rows) console.log(`${pad(r.model, 11)}${pad(r.q, 5)}${pad(r.old, 8)}${pad(r.new, 22)}${pad(r.score, 9)}${r.quote}`);

const before = M.aggregateCells(cells, false);
const after = M.aggregateCells(newCells, reference.verifiable, !reference.verifiable && reference.reason === "injection");
const rate = (r) => Object.fromEntries(M.buildSubChecks(r, false, domain).map((s) => [s.id, s.na ? "na" : s.score]));
console.log(`\nDim 6 score: ${before.score} -> ${after.score}`);
console.log("rates before:", rate(before));
console.log("rates after: ", rate(after));
console.log("\nnew sub-check notes:");
for (const s of M.buildSubChecks(after, false, domain)) console.log(`- [${s.id}] ${s.notes}`);
const usd = (ledger.neurons / 1000) * 0.011;
console.log(`\nWorkers AI: ${ledger.calls} calls, ${ledger.neurons.toFixed(1)} neurons ≈ $${usd.toFixed(4)} (list price)`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ reference, rows, before: rate(before), after: rate(after) }, null, 2));
