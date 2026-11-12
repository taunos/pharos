// Report panel harness: runs the REAL paid-Audit pipeline for the fixed panel
// of sites in sites.json, locally, with in-memory stubs for D1/KV/R2/email and
// the REAL Workers AI model (via the local-only ai-proxy, whose AI binding is
// remote). See README.md for when this gate is required and the full steps.
//
// Usage (from the repo root):
//   node tools/report-panel/run.mjs [--repo <checkout>] [--only a,b]
//        [--sites <file>] [--out <dir>] [--dim6 off|env] [--no-synthetic-dim6] [--archive <name>] [--fresh]
//        [--no-pdf] [--ai-url http://127.0.0.1:8799] [--chrome <chrome.exe>]
//   node tools/report-panel/run.mjs --tier free [--checkout-open] [--repo ...] [--only a,b]
//
// Prereq (paid tier): the AI proxy is running (node tools/report-panel/start-proxy.mjs).
//
// --tier free: the FREE Score instead of the paid Audit (see free-tier.mjs).
//   Runs runScan(tier "free") and renders the results page, the Score PDF HTML
//   and the "gap report ready" email for each site into out/free/<site>/
//   (score-page.md, score-pdf.md, score-email.md + .html, scan.json,
//   score.json). No AI proxy, no Browser Rendering, nothing is sent or stored.
//   --checkout-open renders the Audit-checkout-open variant (default: closed,
//   as in production).
//
// --repo (default: the checkout this file lives in) is the code under test.
//   Its scanner/ and marketing-site/ sources are bundled with esbuild. If that
//   checkout has no node_modules (e.g. a fresh worktree), packages are
//   resolved from the main checkout's scanner/ and marketing-site/
//   node_modules (read-only; nothing is installed, linked or deleted).
// --dim6 off (default): runDim6Paid runs with NO provider keys (every cell
//   unmeasurable -> Dim 6 N/A). Only the question-set generator (Workers AI)
//   spends anything.
// --dim6 env: provider keys are read from process.env ONLY
//   (OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY, PERPLEXITY_API_KEY).
//   Paid (~$0.16/site typical). Keys are never written to disk.
// Synthetic Dim 6 (default on): additionally splices a SYNTHETIC low-score
//   Dim 6 (shaped like runDim6.buildSubChecks output) and runs the real
//   llmEnrichGaps on it, so the Dim 6 remediation text can be read without
//   paid probes. Output files are named *-SYNTHETIC-DIM6.* and carry a banner.
//
// Labelled substitutions vs production (say so when reporting results):
//   - Dim 5 paid Browser Rendering /content -> local headless Chrome --dump-dom.
//   - PDF Browser Rendering REST -> local headless Chrome --print-to-pdf.
//   - D1 (scanner DB) -> no-op stub; pharos_corpus question-set DB -> throws
//     (the production fail-open path).
//   - KV -> in-memory Map (fresh per site => no caches, no budget counters hit).
//   - Email / R2 / corpus write: not called.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { bundleFree, runSiteFree } from "./free-tier.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const REPO = path.resolve(opt("repo", path.resolve(HERE, "..", "..")));
const TIER = opt("tier", "paid");
if (!["paid", "free"].includes(TIER)) throw new Error(`--tier must be paid|free`);
const OUT = path.resolve(opt("out", TIER === "free" ? path.join(HERE, "out", "free") : path.join(HERE, "out")));
const SITES_FILE = path.resolve(opt("sites", path.join(HERE, "sites.json")));
const ONLY = opt("only", null)?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const DIM6_MODE = opt("dim6", "off");
const SYNTH_DIM6 = !flag("no-synthetic-dim6");
const PDF = !flag("no-pdf");
const AI_URL = opt("ai-url", "http://127.0.0.1:8799");
// --archive <name>: also save the run into datasets/report-defects/snapshots/ (see its README).
const ARCHIVE = opt("archive", null);
const CHROME = opt("chrome", process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe");
if (!["off", "env"].includes(DIM6_MODE)) throw new Error(`--dim6 must be off|env`);

// ── bundle the repo's real sources ───────────────────────────────────────
// The main checkout (parent of the shared .git dir), used only as a read-only
// fallback for node_modules when REPO is a worktree without them.
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
  const p = (rel) => JSON.stringify(path.join(REPO, rel).replace(/\\/g, "/"));
  const entry = path.join(buildDir, `entry-${tag}.ts`);
  fs.writeFileSync(
    entry,
    [
      `export * as scanner from ${p("scanner/src/run-scan.ts")};`,
      `export * as pipeline from ${p("marketing-site/src/lib/audit-pipeline.ts")};`,
      `export * as reportModel from ${p("marketing-site/src/lib/audit-report-model.ts")};`,
      `export * as dim6 from ${p("marketing-site/src/lib/dim6/runDim6.ts")};`,
      "",
    ].join("\n"),
  );
  const outfile = path.join(buildDir, `bundle-${tag}.mjs`);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile,
    external: ["cloudflare:*"],
    nodePaths: NODE_PATHS,
    logLevel: "warning",
    // CJS deps (e.g. the scanner's `yaml`) call require("process"); give the
    // ESM bundle a real require so Node can resolve builtins.
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

// ── stubs ────────────────────────────────────────────────────────────────
function makeKv() {
  const m = new Map();
  return {
    _map: m,
    async get(k, type) {
      const v = m.has(k) ? m.get(k) : null;
      if (v === null) return null;
      if (type === "json" || type?.type === "json") return JSON.parse(v);
      return v;
    },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list() { return { keys: [...m.keys()].map((name) => ({ name })), list_complete: true }; },
  };
}
function makeNoopD1() {
  const stmt = {
    bind() { return stmt; },
    async run() { return { success: true, meta: {} }; },
    async first() { return null; },
    async all() { return { results: [], success: true }; },
  };
  return { prepare() { return stmt; }, async batch(s) { return s.map(() => ({ success: true })); } };
}
function makeMissingTableD1() {
  return {
    prepare() {
      throw new Error("D1_ERROR: no such table: dim6_question_set (harness stub = prod pre-migration fail-open)");
    },
  };
}

// AI call ledger (per site + global). Workers AI reports neurons per call.
const ledger = { calls: 0, neurons: 0, prompt_tokens: 0, completion_tokens: 0 };
function makeAi(siteLedger, callLog) {
  return {
    async run(model, inputs) {
      const res = await fetch(AI_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, inputs }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `non-JSON ${res.status}` }));
      for (const L of [ledger, siteLedger]) L.calls++;
      const u = j?.result?.usage;
      if (u) {
        for (const L of [ledger, siteLedger]) {
          L.neurons += Number(u.neurons) || 0;
          L.prompt_tokens += Number(u.prompt_tokens) || 0;
          L.completion_tokens += Number(u.completion_tokens) || 0;
        }
      }
      callLog.push({
        model,
        prompt: inputs?.messages?.map((x) => x.content).join("\n---\n") ?? null,
        max_tokens: inputs?.max_tokens,
        ok: j.ok,
        response: j?.result?.response ?? null,
        error: j.ok ? undefined : j.error,
        usage: u ?? null,
      });
      if (!j.ok) throw new Error(`Workers AI proxy error: ${j.error}`);
      return j.result;
    },
  };
}

// ── local Chrome (labelled substitute for Browser Rendering) ─────────────
function chrome(args, timeoutMs = 60000) {
  const profile = path.join(HERE, "chrome-profile");
  return new Promise((resolve, reject) => {
    execFile(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, ...args],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}
const realFetch = globalThis.fetch;
const brLog = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/browser-rendering\/content/.test(url)) {
    const body = JSON.parse(init?.body ?? "{}");
    try {
      const html = await chrome(["--dump-dom", "--virtual-time-budget=15000", body.url]);
      brLog.push({ url: body.url, ok: true, bytes: html.length });
      return new Response(JSON.stringify({ success: true, result: html }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    } catch (e) {
      brLog.push({ url: body.url, ok: false, error: String(e).slice(0, 200) });
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    }
  }
  if (/^https:\/\/api\.cloudflare\.com\//.test(url)) {
    throw new Error(`harness: blocked unexpected Cloudflare API call ${url}`);
  }
  return realFetch(input, init);
};

// ── synthetic Dim 6 (built by the real runDim6.ts code) ─────────────────
// Invented answers and site text (each quote starts with "example"), scored
// into cell notes the way the ladder writes them, then turned into the
// dimension by dim6.dim6FromResult, so the report shows the wording and
// layout the current code produces. 40 answers: 36 came back, 32 checkable
// (above the option A floor), 4 not checkable.
const SYNTH_REF = [
  "From llms.txt:",
  "Name: Example Site – what the site says it is",
  "Summary: example site text: a bakery in Example City",
  "From the homepage:",
  "Details: example site text: Office at Example Street 1",
].join("\n");
const SYNTH_MODELS = ["openai:gpt-4o", "anthropic:claude-sonnet", "google:gemini-2.5-flash", "perplexity:sonar"];

function syntheticDim6(dim6) {
  const at = (needle) => SYNTH_REF.indexOf(needle);
  const backed = "example answer: Example Site is a bakery in Example City.";
  const kinds = {
    correct: { score: 100, text: backed, notes: `score=100/100; judge=AFFIRM; accuracy=CORRECT; domain_named=true; url_referenced=true; context_relevant=true; no_competitor_first=true; claim_at=0; site_at=${at("example site text: a bakery")}` },
    url: { score: 33, text: "https://example.com", notes: "score=33/100; judge=AFFIRM; accuracy=URL_ONLY; url_only=true; url_referenced=true" },
    wrong: { score: 0, text: "example answer: the site belongs to Example Namesake, a different business with a similar name.", notes: "score=0/100; judge=AFFIRM; accuracy=WRONG; misidentified=true; wrong_at=0" },
    contra: { score: 0, text: "example answer: it has no physical location.", notes: `score=0/100; judge=AFFIRM; accuracy=WRONG_FACTS; facts_contradicted=true; claim_at=0; site_at=${at("example site text: Office")}` },
    unclear: { score: 0, text: "example answer: it is one of the best-known bakeries.", notes: "score=0/100; judge=AFFIRM; accuracy=UNCLEAR; accuracy_unclear=true; unclear_why=uncheckable" },
    cut: { score: 0, text: "example answer: Example Site is a bakery that", notes: "score=0/100; judge=AFFIRM; accuracy=UNCLEAR; accuracy_unclear=true; unclear_why=truncated; truncated=true" },
    deny: { score: 0, text: "example answer: I don't have information about this site.", notes: "score=0/100; judge=DENY" },
    missing: { score: 0, text: null, notes: "Templated fallback: network/timeout: example", unmeasurable: true },
  };
  // per model, 10 answers each
  const plan = [
    ["correct", "correct", "url", "wrong", "unclear", "deny", "deny", "deny", "deny", "missing"],
    ["correct", "contra", "unclear", "deny", "deny", "deny", "deny", "deny", "deny", "missing"],
    ["correct", "correct", "wrong", "wrong", "cut", "deny", "deny", "deny", "deny", "missing"],
    ["correct", "correct", "wrong", "unclear", "deny", "deny", "deny", "deny", "deny", "missing"],
  ];
  const cells = plan.flatMap((row, mi) =>
    row.map((k, qi) => {
      const c = kinds[k];
      return {
        query: { id: `q${qi + 1}`, text: "example question", rationale: null },
        modelId: SYNTH_MODELS[mi],
        result: { text: c.text, score: c.score, unmeasurable: c.unmeasurable === true, truncated: c.notes.includes("truncated=true"), notes: c.notes },
      };
    }),
  );
  const unchecked = /(?:^|; )(?:accuracy_unclear=true|accuracy_not_checked=true|affirmation_failed=true)(?:;|$)/;
  const checkable = cells.filter((c) => !c.result.unmeasurable && !unchecked.test(c.result.notes));
  const avg = (cs) => (cs.length ? Math.round(cs.reduce((s, c) => s + c.result.score, 0) / cs.length) : null);
  const result = {
    score: avg(checkable),
    cells,
    perModelAverage: Object.fromEntries(SYNTH_MODELS.map((m) => [m, avg(checkable.filter((c) => c.modelId === m))])),
    unmeasurableCount: cells.filter((c) => c.result.unmeasurable).length,
    uncheckableCount: cells.filter((c) => !c.result.unmeasurable).length - checkable.length,
    totalCells: cells.length,
    accuracyChecked: true,
    referenceText: SYNTH_REF,
  };
  return dim6.dim6FromResult(result, false, "example.com").dimension;
}

// ── markdown extraction from the shared report model ─────────────────────
// The first line of a harness-only banner starts with one of these; check.mjs
// strips it before linting, since a customer never sees it.
const DIM6_OFF_BANNER = "HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.";
const SYNTH_BANNER = "SYNTHETIC DIM 6 INPUT — Citation Visibility numbers below are invented by the eval harness (shape identical to runDim6 output); the remediation text for them is real Llama output.";

function toMarkdown(m, C, banner) {
  const L = [];
  if (banner) L.push(`> ${banner}`, "");
  L.push(`# ${C.brand}`, "", `${m.generatedLabel}`, "", `**${m.url}**`, "");
  L.push(`## ${m.composite.score} — grade ${m.composite.grade}`, "", `_${m.scopeNote.replace(/<[^>]+>/g, "")}_`, "");
  if (m.versionNote) L.push(`_${m.versionNote}_`, "");
  L.push(`## ${C.summaryHeading}`, "", ...m.executiveSummary.flatMap((s) => [s, ""]));
  L.push(`## ${C.dimensionsHeading}`, "");
  for (const d of m.dimensions) {
    if (d.kind === "na") {
      L.push(`### ${d.name} — ${M.reportModel.naLabelOf(d)} (${M.reportModel.naGradeOf(d)})`, "", d.note, "");
      for (const e of d.evidence ?? []) L.push(`**${e.name}:** ${e.notes}`, "");
      continue;
    }
    L.push(`### ${d.name} — ${d.score} ${d.grade}`, "", `| ${C.checkColumns.join(" | ")} |`, "|---|---|---|---|");
    for (const s of d.checks) L.push(`| ${s.name} | ${s.scoreLabel} | ${s.weightLabel} | ${s.notes.replace(/\|/g, "\\|")} |`);
    L.push("");
  }
  L.push(`## ${C.gapsHeading}`, "", C.gapsIntro, "");
  if (m.gaps.length === 0) L.push(C.gapsEmpty, "");
  for (const g of m.gaps) {
    L.push(`### ${g.checkName}`, "", `_${g.dimensionName} · ${g.metaLabel}_`, "",
      `**${C.findingLabel}** ${g.finding}`, "", `**${C.remediationLabel}** ${g.remediation}`, "");
  }
  L.push(`## ${C.jsonHeading}`, "", `${C.jsonIntro}${C.jsonIntroPdfOnly} _(JSON body omitted here; see audit.json)_`, "");
  L.push(...C.footer.map((f) => `${f.before}${f.label}.`));
  return L.join("\n");
}

function injectBanner(html, text) {
  return html.replace(
    "<body>",
    `<body>\n<div style="border:2px solid #b45309;background:#fffbeb;color:#78350f;padding:8pt;margin-bottom:12pt;font-weight:600">${text}</div>`,
  );
}

// ── per-site run ─────────────────────────────────────────────────────────
async function runSite(M, site) {
  const dir = path.join(OUT, site.label);
  fs.mkdirSync(dir, { recursive: true });
  const siteLedger = { calls: 0, neurons: 0, prompt_tokens: 0, completion_tokens: 0 };
  const callLog = [];
  const logLines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ["log", "warn", "error"]) {
    console[k] = (...a) => { logLines.push(`[${k}] ${a.map(String).join(" ")}`); };
  }
  const t0 = Date.now();
  const br0 = brLog.length;
  try {
    const AI = makeAi(siteLedger, callLog);
    const kv = makeKv();
    const sessionId = crypto.randomUUID();
    const scannerEnv = {
      DB: makeNoopD1(), CACHE: makeKv(), AI,
      CF_ACCOUNT_ID: "harness-local", CF_API_TOKEN: "harness-local-placeholder",
    };
    // 1. scanner runScan at the paid tier (what /api/scan does after the
    //    internal-fulfill-key check passes).
    const scannerScan = await M.scanner.runScan(scannerEnv, site.url, "paid", {
      useCache: false, throwOnInsertFail: false,
    });
    fs.writeFileSync(path.join(dir, "scan.json"), JSON.stringify(scannerScan, null, 2));

    // 2. paid Dim 6 (runDim6Paid) — keys only from env in --dim6 env mode.
    const keys = DIM6_MODE === "env"
      ? {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
          PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
        }
      : {};
    const dim6 = await M.dim6.runDim6Paid(
      { AI, ...keys, cacheKv: kv, questionSetDb: makeMissingTableD1() },
      site.url,
    );
    if (DIM6_MODE === "env") {
      fs.writeFileSync(path.join(dir, "dim6-cells.json"), JSON.stringify(dim6.cells, null, 2));
    }

    // 3. splice + LLM remediation + render (audit-fulfill-run.ts order).
    const scan = M.pipeline.splicePaidDim6(scannerScan, dim6.dimension);
    const mEnv = { AI, SESSIONS: kv };
    const gaps = M.pipeline.buildRemediationGaps ? M.pipeline.buildRemediationGaps(scan) : await M.pipeline.llmEnrichGaps(mEnv, scan, sessionId);
    const audit = { scan, gaps, engine_version: M.pipeline.REMEDIATION_ENGINE_VERSION_TAG };
    fs.writeFileSync(path.join(dir, "audit.json"), JSON.stringify(audit, null, 2));
    const html = M.pipeline.renderAuditHtml(audit, sessionId);
    fs.writeFileSync(path.join(dir, "report.html"), html);
    const C = M.reportModel.AUDIT_REPORT_COPY;
    fs.writeFileSync(
      path.join(dir, "report.md"),
      toMarkdown(M.reportModel.buildAuditReportModel(audit, sessionId), C, DIM6_MODE === "off" ? DIM6_OFF_BANNER : null),
    );
    if (PDF) await chrome(["--no-pdf-header-footer", `--print-to-pdf=${path.join(dir, "report.pdf")}`, pathToFileURL(path.join(dir, "report.html")).href]).catch((e) => logLines.push(`[harness] pdf failed ${e}`));

    // 4. synthetic Dim 6 variant (same KV => non-Dim-6 remediations are cache hits).
    if (SYNTH_DIM6) {
      const scanS = M.pipeline.splicePaidDim6(scannerScan, syntheticDim6(M.dim6));
      const gapsS = M.pipeline.buildRemediationGaps ? M.pipeline.buildRemediationGaps(scanS) : await M.pipeline.llmEnrichGaps(mEnv, scanS, sessionId);
      const auditS = { scan: scanS, gaps: gapsS, engine_version: M.pipeline.REMEDIATION_ENGINE_VERSION_TAG };
      fs.writeFileSync(path.join(dir, "audit-SYNTHETIC-DIM6.json"), JSON.stringify(auditS, null, 2));
      fs.writeFileSync(path.join(dir, "report-SYNTHETIC-DIM6.html"), injectBanner(M.pipeline.renderAuditHtml(auditS, sessionId), SYNTH_BANNER));
      fs.writeFileSync(path.join(dir, "report-SYNTHETIC-DIM6.md"),
        toMarkdown(M.reportModel.buildAuditReportModel(auditS, sessionId), C, SYNTH_BANNER));
    }

    const summary = {
      label: site.label, url: site.url, type: site.type, repo: REPO, dim6_mode: DIM6_MODE,
      synthetic_dim6: SYNTH_DIM6,
      composite: scan.composite, scanner_composite: scannerScan.composite,
      dims: scan.dimensions.map((d) => ({ id: d.dimension_id, name: d.dimension_name, score: d.score, grade: d.grade, na: !!d.na })),
      gaps: gaps.length, ai: siteLedger, browser_rendering_substitute: brLog.slice(br0),
      seconds: Math.round((Date.now() - t0) / 1000),
    };
    fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    Object.assign(console, orig);
    fs.writeFileSync(path.join(dir, "ai-calls.jsonl"), callLog.map((c) => JSON.stringify(c)).join("\n") + "\n");
    fs.writeFileSync(path.join(dir, "log.txt"), logLines.join("\n") + "\n");
  }
}

// ── main ─────────────────────────────────────────────────────────────────
const sites = JSON.parse(fs.readFileSync(SITES_FILE, "utf8")).filter((s) => !ONLY || ONLY.includes(s.label));
if (sites.length === 0) throw new Error(`no sites selected from ${SITES_FILE}`);
// --fresh: the release check's second half must use sites never tested before.
if (flag("fresh")) (await import("../../datasets/report-defects/archive-run.mjs")).assertFreshSites(sites, path.join(HERE, "sites.json"));
if (TIER === "free") {
  fs.mkdirSync(OUT, { recursive: true });
  const F = await bundleFree({ REPO, HERE, NODE_PATHS, esbuild: findEsbuild() });
  console.log(`repo=${REPO} tier=free checkout=${flag("checkout-open") ? "open" : "closed"} sites=${sites.map((s) => s.label).join(",")}`);
  const results = [];
  for (const s of sites) {
    const t0 = Date.now();
    try {
      const r = await runSiteFree(F, s, path.join(OUT, s.label), { checkoutOpen: flag("checkout-open") });
      results.push(r);
      console.log(`${s.label}: ${r.composite.score} ${r.composite.grade} ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (e) {
      console.log(`${s.label}: FAILED ${e?.stack ?? e}`);
      results.push({ label: s.label, error: String(e) });
    }
  }
  fs.writeFileSync(path.join(OUT, `run-free-${Date.now()}.json`), JSON.stringify({ repo: REPO, tier: "free", results }, null, 2));
  if (ARCHIVE) console.log(`archived: ${(await import("../../datasets/report-defects/archive-run.mjs")).archiveRun(OUT, ARCHIVE, { repo: REPO, tier: "free", only: sites.map((s) => s.label) })}`);
  if (results.some((r) => r.error)) process.exitCode = 1;
  process.exit();
}
const ping = await realFetch(AI_URL, { method: "GET" }).catch(() => null);
if (!ping) throw new Error(`AI proxy not reachable at ${AI_URL} — start it: node tools/report-panel/start-proxy.mjs`);
fs.mkdirSync(OUT, { recursive: true });
const M = await bundle();
console.log(`repo=${REPO} dim6=${DIM6_MODE} synthetic_dim6=${SYNTH_DIM6} sites=${sites.map((s) => s.label).join(",")}`);
const results = [];
for (const s of sites) {
  try {
    const r = await runSite(M, s);
    results.push(r);
    console.log(`${s.label}: ${r.composite.score} ${r.composite.grade} gaps=${r.gaps} ai_calls=${r.ai.calls} neurons=${r.ai.neurons.toFixed(1)} ${r.seconds}s`);
  } catch (e) {
    console.log(`${s.label}: FAILED ${e?.stack ?? e}`);
    results.push({ label: s.label, error: String(e) });
  }
}
// Workers AI list price: $0.011 per 1,000 neurons (first 10,000 neurons/day free on Workers Paid).
const usd = (ledger.neurons / 1000) * 0.011;
const tally = { ...ledger, workers_ai_usd_list_price: Number(usd.toFixed(5)), note: "Workers AI only; Dim 6 provider spend is 0 in --dim6 off mode" };
fs.writeFileSync(path.join(OUT, `run-${Date.now()}.json`), JSON.stringify({ repo: REPO, dim6: DIM6_MODE, tally, results }, null, 2));
if (ARCHIVE) console.log(`archived: ${(await import("../../datasets/report-defects/archive-run.mjs")).archiveRun(OUT, ARCHIVE, { repo: REPO, tier: "paid", dim6: DIM6_MODE, only: sites.map((s) => s.label) })}`);
console.log(`TOTAL ai_calls=${ledger.calls} neurons=${ledger.neurons.toFixed(1)} ≈ $${usd.toFixed(4)} (list price)`);
if (results.some((r) => r.error)) process.exitCode = 1;
