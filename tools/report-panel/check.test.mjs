// node --test tools/report-panel/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadRules, checkReportText, checkForbid, checkFabrication, checkExpect, checkSiteDir, siteLacksRatings,
} from "./check.mjs";
import { isLocalRequest } from "./ai-proxy/src/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rules = loadRules();
const ids = (findings) => findings.filter((f) => f.level === "FAIL").map((f) => f.rule);

// Fixture markdown is stored as report.md.txt; copy into a temp out/<label>/.
function fixtureOut(names) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "report-panel-test-"));
  for (const n of names) {
    const dir = path.join(out, n);
    fs.mkdirSync(dir);
    fs.copyFileSync(path.join(HERE, "fixtures", n, "report.md.txt"), path.join(dir, "report.md"));
    fs.copyFileSync(path.join(HERE, "fixtures", n, "audit.json"), path.join(dir, "audit.json"));
  }
  return out;
}
const audit = (n) => JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", n, "audit.json"), "utf8"));
const EXPECT = {
  na: ["2.*", "3.*", "4.review_schema"],
  exists: ["4.organization_schema", "4.faq_schema"],
  has_ratings: false,
  forbid: ["can't discover or use an MCP server"],
};

test("every text rule fires on its own example and compiles", () => {
  const examples = {
    placeholder: "paths ([site value]) resolve",
    "jargon-slice": "shipped in Slice 3",
    "jargon-dim-coordinate": "engine: dim6:v3",
    "jargon-browser-rendering": "the Browser Rendering /content endpoint",
    "jargon-llm-unusable": "avg 50/100 (LLM output unusable; default)",
    "jargon-doh": "no TXT via DoH lookup",
    "jargon-puppeteer": "rendered with Puppeteer",
    "jargon-cells": "17% of measurable cells named the domain",
    "jargon-oq": "see OQ-02",
    "halluc-learning-management": "Learning Management System functionality",
    "halluc-lms": "the LMS summary",
    "halluc-model-configuration": "update the relevant model configurations",
    "halluc-knowledge-graph": "update the knowledge graph directly",
    "halluc-entity-ranking": "improve entity ranking",
    "halluc-update-models": "update the models to include a URL",
    "promise-will-improve": "This will improve the overall SEO",
    "promise-will-enable": "will enable the models to answer",
    "promise-guarantee": "we guarantee results",
    "promise-rank-higher": "your site will rank higher",
  };
  for (const r of rules.text) {
    assert.ok(examples[r.id], `add an example for new rule ${r.id}`);
    assert.deepEqual(ids(checkReportText(examples[r.id], rules)), [r.id], r.id);
  }
});

test("text rules do not fire on clean copy or on the harness banner", () => {
  const clean = [
    "> HARNESS NOTE: Dim 6 run with no provider keys (--dim6 off); production would carry a real Citation Visibility score.",
    "> SYNTHETIC DIM 6 INPUT — numbers invented; cells are synthetic.",
    "Add an Organization block with name, url and description. Estimated effort: under an hour.",
    "Citation Visibility could not be measured on this run, so it is not counted in your score.",
    "Your llms.txt is a short guide for AI assistants; models may use it.",
  ].join("\n");
  assert.deepEqual(checkReportText(clean, rules), []);
});

test("LMS rule is case-sensitive and whole-word (llms.txt does not match)", () => {
  assert.deepEqual(ids(checkReportText("Your /llms.txt file and LLMs", rules)), []);
});

test("forbid: per-site false statements are caught case-insensitively", () => {
  const f = checkForbid("AI agents CAN'T discover or use an MCP server for your site", EXPECT);
  assert.deepEqual(ids(f), ["forbid"]);
  assert.deepEqual(checkForbid("anything", {}), []);
});

test("fabrication: ratings advice fails when the site has no ratings", () => {
  assert.deepEqual(ids(checkFabrication(audit("bad"), EXPECT, rules)), ["fabricate-ratings"]);
});

test("fabrication: ratings advice is allowed when the panel says real ratings exist", () => {
  assert.deepEqual(checkFabrication(audit("bad"), { has_ratings: true }, rules), []);
});

test("fabrication: without a panel fact, a 0 or N/A review_schema means no ratings", () => {
  assert.equal(siteLacksRatings(audit("bad"), undefined), true);
  const withRatings = audit("bad");
  withRatings.scan.dimensions[2].sub_checks[2].score = 100;
  assert.equal(siteLacksRatings(withRatings, undefined), false);
});

test("expect.na: a scored dimension or check that must be N/A fails", () => {
  const f = checkExpect(audit("bad"), EXPECT).filter((x) => x.class === "expect-na");
  assert.deepEqual(f.map((x) => `${x.level} ${x.where}`), ["FAIL 2.*", "FAIL 4.review_schema"]);
});

test("expect.exists: scored 0 fails; unmeasured N/A only warns; whole-dim N/A fails", () => {
  const f = checkExpect(audit("bad"), EXPECT).filter((x) => x.class === "expect-exists");
  assert.deepEqual(f.map((x) => `${x.level} ${x.rule} ${x.where}`), [
    "FAIL exists-but-zero 4.organization_schema",
    "WARN exists-unmeasured 4.faq_schema",
  ]);
  const naDim = checkExpect(audit("good"), { exists: ["2.*"] });
  assert.deepEqual(naDim.map((x) => `${x.level} ${x.rule}`), ["FAIL exists-but-na"]);
});

test("expect: unknown check ids warn instead of passing silently", () => {
  const f = checkExpect(audit("good"), { na: ["4.renamed_check"], exists: ["9.*"] });
  assert.deepEqual(f.map((x) => `${x.level} ${x.rule}`), ["WARN unknown-check", "WARN unknown-check"]);
});

test("checkSiteDir: bad fixture fails every class, good fixture passes", () => {
  const out = fixtureOut(["bad", "good"]);
  const bad = checkSiteDir(path.join(out, "bad"), { label: "bad", expect: EXPECT }, rules).files["report.md"];
  const classes = new Set(bad.filter((f) => f.level === "FAIL").map((f) => f.class));
  for (const c of ["placeholder", "jargon", "hallucination", "outcome-promise", "fabrication", "expect-na", "expect-exists", "expect-forbid"]) {
    assert.ok(classes.has(c), `bad fixture should fail ${c}`);
  }
  const good = checkSiteDir(path.join(out, "good"), { label: "good", expect: { na: ["2.*", "4.review_schema"], exists: ["4.organization_schema"], has_ratings: false } }, rules).files["report.md"];
  assert.deepEqual(good, []);
});

test("CLI exits 1 on a FAIL, 0 on a clean panel, 2 with nothing to check", () => {
  const out = fixtureOut(["bad", "good"]);
  const sites = path.join(out, "sites.json");
  fs.writeFileSync(sites, JSON.stringify([
    { label: "bad", url: "https://fixture.example/", expect: EXPECT },
    { label: "good", url: "https://fixture.example/", expect: { na: ["2.*"], has_ratings: false } },
  ]));
  const run = (...args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [path.join(HERE, "check.mjs"), "--out", out, "--sites", sites, ...args], { encoding: "utf8" }) };
    } catch (e) {
      return { code: e.status, out: e.stdout };
    }
  };
  const all = run();
  assert.equal(all.code, 1);
  assert.match(all.out, /== bad/);
  assert.match(all.out, /FAIL \[report\] placeholder/);
  assert.equal(run("--only", "good").code, 0);
  assert.equal(run("--only", "nope").code, 2);
});

test("ai-proxy rejects any non-local Host", () => {
  const req = (url, host) => new Request(url, { method: "POST", headers: host ? { host } : {} });
  assert.equal(isLocalRequest(req("http://127.0.0.1:8799/", "127.0.0.1:8799")), true);
  assert.equal(isLocalRequest(req("http://localhost:8799/", "localhost:8799")), true);
  assert.equal(isLocalRequest(req("https://report-panel-ai-proxy-local-only.example.workers.dev/", "report-panel-ai-proxy-local-only.example.workers.dev")), false);
  assert.equal(isLocalRequest(req("http://127.0.0.1:8799/", "evil.example")), false);
  assert.equal(isLocalRequest(req("https://astrant.io/", "127.0.0.1")), false);
});
