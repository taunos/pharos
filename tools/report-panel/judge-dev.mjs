// Run the Dim 6 accuracy pipeline on the gold-labelled answers and write a
// verdict file for datasets/judge-labels/score.mjs. $0 provider cost: the
// saved answers are reused; only the Workers AI accuracy judge runs, through
// the local-only proxy (node tools/report-panel/start-proxy.mjs).
//
//   node tools/report-panel/judge-dev.mjs --labels datasets/judge-labels/dev.jsonl
//        --out <verdicts.jsonl> [--trace <trace.jsonl>] [--cache <dir>] [--ai-url http://127.0.0.1:8799]
//
// Each answer goes through the same functions as production (ladder.ts):
// the saved affirmation verdict (judge=AFFIRM / DENY in the saved notes) is
// kept; the accuracy judge runs on both (DENY answers can still name another
// entity or state a contradicted fact); the cell is scored by
// scoreAffirmedCell. The cell notes map to a scorer verdict:
//   misidentified / possible_mixup_cut_off -> MIXUP, facts_contradicted ->
//   WRONG_FACTS, accuracy=CORRECT -> CORRECT, judge=DENY -> DENY, the rest ->
//   UNCLEAR (URL-only credit is not an identity verdict).
//
// The site description is built the production way (reference.ts, live
// fetch) once per site and cached in --cache, so repeated runs judge against
// the same text. Judge outputs are cached by prompt (the per-call random fence
// tag is normalised), so a run re-calls the model only for prompts that
// changed. Only answers of sites present in --labels are read: the held-out
// sites' answers are never opened.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const LABELS = opt("labels");
const OUT = opt("out");
const TRACE = opt("trace", null);
const CACHE = path.resolve(opt("cache", path.join(HERE, "build", "judge-dev-cache")));
const AI_URL = opt("ai-url", "http://127.0.0.1:8799");
if (!LABELS || !OUT) throw new Error("usage: judge-dev.mjs --labels <labels.jsonl> --out <verdicts.jsonl> [--trace <file>] [--cache <dir>]");

// Where each labelled site's saved answers are (dev sites only).
const CELLS = {
  eff: "datasets/report-defects/snapshots/2026-11-10-release-check/eff",
  resend: "datasets/report-defects/snapshots/2026-11-10-release-check/resend",
  ugmonk: "datasets/report-defects/snapshots/2026-11-10-release-check/ugmonk",
  rachelqueiroz: "datasets/report-defects/snapshots/2026-11-08-panel-dim6-real/rachelqueiroz",
};

const labels = fs.readFileSync(LABELS, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
const sites = [...new Set(labels.map((l) => l.site))];
for (const s of sites) if (!CELLS[s]) throw new Error(`no saved answers configured for site ${s}`);

// ── bundle the repo's Dim 6 sources ──────────────────────────────────────
function mainCheckout() {
  try {
    return path.dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    return null;
  }
}
const BASES = [...new Set([REPO, mainCheckout()].filter(Boolean).map((p) => path.resolve(p)))];
const NODE_PATHS = BASES.flatMap((b) => ["scanner", "marketing-site"].map((pkg) => path.join(b, pkg, "node_modules"))).filter((p) => fs.existsSync(p));
async function bundle() {
  let esbuild;
  for (const nm of NODE_PATHS) {
    const p = path.join(nm, "esbuild");
    if (fs.existsSync(p)) {
      esbuild = createRequire(path.join(p, "package.json"))(p);
      break;
    }
  }
  if (!esbuild) throw new Error("esbuild not found");
  const buildDir = path.join(HERE, "build");
  fs.mkdirSync(buildDir, { recursive: true });
  const p = (rel) => JSON.stringify(path.join(REPO, "marketing-site/src/lib/dim6", rel).replace(/\\/g, "/"));
  const entry = path.join(buildDir, "judge-dev-entry.ts");
  fs.writeFileSync(entry, [
    `export { resolveSiteReference } from ${p("reference.ts")};`,
    `export { judgeAccuracy } from ${p("accuracy-judge.ts")};`,
    `export { scoreAffirmedCell } from ${p("ladder.ts")};`,
    `export { pickUrlQuestionId } from ${p("orchestrator.ts")};`,
    `export { canonicalDomain } from ${p("question-set.ts")};`,
    `export { DIM6_ENGINE_VERSION } from ${p("types.ts")};`,
    "",
  ].join("\n"));
  const outfile = path.join(buildDir, "judge-dev-bundle.mjs");
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: "node", format: "esm", target: "node22", outfile,
    external: ["cloudflare:*"], nodePaths: NODE_PATHS, logLevel: "warning",
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

// ── Workers AI through the proxy, cached by prompt ───────────────────────
fs.mkdirSync(CACHE, { recursive: true });
const ledger = { calls: 0, cached: 0, neurons: 0 };
const AI = {
  async run(model, inputs) {
    const prompt = inputs.messages.map((m) => m.content).join("\n");
    const key = crypto.createHash("sha256").update(JSON.stringify([model, inputs.max_tokens, prompt.replace(/\b[0-9a-f]{12}\b/g, "TAG")])).digest("hex");
    const file = path.join(CACHE, `${key}.json`);
    if (fs.existsSync(file)) {
      ledger.cached++;
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    const res = await fetch(AI_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, inputs }) });
    const j = await res.json().catch(() => ({ ok: false, error: `non-JSON ${res.status}` }));
    ledger.calls++;
    ledger.neurons += Number(j?.result?.usage?.neurons) || 0;
    if (!j.ok) throw new Error(`Workers AI proxy error: ${j.error}`);
    const out = { response: j.result.response };
    fs.writeFileSync(file, JSON.stringify(out));
    return out;
  },
};

const M = await bundle();
const verdictOf = (notes, unmeasurable) =>
  unmeasurable ? "UNCLEAR"
    : /misidentified=true|possible_mixup_cut_off=true/.test(notes) ? "MIXUP"
    : /facts_contradicted=true/.test(notes) ? "WRONG_FACTS"
    : /accuracy=CORRECT/.test(notes) ? "CORRECT"
    : /judge=DENY/.test(notes) ? "DENY"
    : "UNCLEAR";

const out = [];
const trace = [];
for (const site of sites) {
  const dir = path.join(REPO, CELLS[site]);
  const cells = JSON.parse(fs.readFileSync(path.join(dir, "dim6-cells.json"), "utf8"));
  const scan = JSON.parse(fs.readFileSync(path.join(dir, "scan.json"), "utf8"));
  const domain = M.canonicalDomain(scan.url);
  const refFile = path.join(CACHE, `reference-${site}.json`);
  const reference = fs.existsSync(refFile) ? JSON.parse(fs.readFileSync(refFile, "utf8")) : await M.resolveSiteReference(scan.url);
  if (!fs.existsSync(refFile)) fs.writeFileSync(refFile, JSON.stringify(reference, null, 2));
  if (!reference.verifiable) throw new Error(`${site}: reference not verifiable (${reference.reason})`);
  const facts = { names: reference.names, addresses: reference.addresses };
  const urlQ = M.pickUrlQuestionId([...new Map(cells.map((c) => [c.query.id, c.query])).values()], domain);
  for (const l of labels.filter((x) => x.site === site)) {
    const c = cells.find((x) => x.query.id === l.qid && x.modelId === l.modelId);
    if (!c) throw new Error(`${site} ${l.qid} ${l.modelId}: no saved answer`);
    const text = c.result.text;
    const t = {};
    let result;
    if (c.result.unmeasurable || !text || /affirmation_failed=true/.test(c.result.notes)) result = { notes: "unmeasurable", unmeasurable: true };
    else {
      const denied = /judge=DENY/.test(c.result.notes);
      const acc = await M.judgeAccuracy({ AI }, domain, reference.text, text, { names: reference.names, question: c.query.text }, t);
      const ctx = { urlQuestion: c.query.id === urlQ, domain, siteFacts: facts, question: c.query.text };
      if (denied) {
        result =
          acc.kind === "wrong" || acc.kind === "wrong_facts"
            ? M.scoreAffirmedCell(text, `https://${domain}`, [], c.result.truncated, acc, ctx)
            : { notes: "score=0/100; judge=DENY", unmeasurable: false };
      } else result = M.scoreAffirmedCell(text, `https://${domain}`, [], c.result.truncated, acc, ctx);
      t.verdict = acc;
    }
    const verdict = verdictOf(result.notes, result.unmeasurable);
    out.push({ site, qid: l.qid, modelId: l.modelId, verdict });
    trace.push({ site, qid: l.qid, modelId: l.modelId, verdict, notes: result.notes, judge: t.judge ?? null, confirm: t.confirm ?? null, compat: t.compat ?? null, settled: t.verdict ?? null });
  }
}
fs.writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join("\n") + "\n");
if (TRACE) fs.writeFileSync(TRACE, trace.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`engine=${M.DIM6_ENGINE_VERSION} answers=${out.length} workers_ai_calls=${ledger.calls} cached=${ledger.cached} neurons=${ledger.neurons.toFixed(1)} (~$${((ledger.neurons / 1000) * 0.011).toFixed(4)})`);
