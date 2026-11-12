#!/usr/bin/env node
// Scores a Citation Visibility judge against the gold labels.
//
//   node datasets/judge-labels/score.mjs --judge <verdicts.jsonl> --labels <labels.jsonl> [--labels <more.jsonl>] [--as final|a|b] [--json]
//
// Judge file: JSON Lines (or a JSON array), one row per answer: {site, qid, modelId, verdict}.
// Verdicts: CORRECT | MIXUP (alias WRONG: "mixed up your site with a different person or business")
//           | WRONG_FACTS (optional: right entity, wrong facts) | UNCLEAR | DENY (alias NOT_CITED: no answer / not cited).
// Labels: rows from dev.jsonl / holdout.jsonl. `--as final` (default) uses the resolved labels; attributes still
// waiting on Bruno are null and those answers are left out of any metric that needs them (the excluded count is printed).
// `--as a` / `--as b` scores against one labeler's raw labels, to show how much the open disagreements could move a number.
// The judge file must cover the labels exactly: a missing, duplicate or unknown key (site|qid|modelId) is an error,
// never a silently smaller denominator.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const VERDICT_ALIASES = { CORRECT: "CORRECT", MIXUP: "MIXUP", WRONG: "MIXUP", WRONG_FACTS: "WRONG_FACTS", UNCLEAR: "UNCLEAR", DENY: "DENY", NOT_CITED: "DENY" };

export function parseRows(text) {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[")) return JSON.parse(t);
  return t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const KEY_FIELDS = ["site", "qid", "modelId"];
const keyOf = (r) => `${r.site}|${r.qid}|${r.modelId}`;

/** A row's key, or an error naming what is wrong with it (missing or non-string key fields). */
function checkedKey(r, what, i) {
  if (!r || typeof r !== "object") throw new Error(`${what} row ${i + 1} is not an object`);
  const bad = KEY_FIELDS.filter((k) => typeof r[k] !== "string" || !r[k].trim());
  if (bad.length) throw new Error(`${what} row ${i + 1} has no ${bad.join("/")}`);
  // "|" joins the key: {site:"a", qid:"b|c"} and {site:"a|b", qid:"c"} would collide (Codex LOW).
  const piped = KEY_FIELDS.filter((k) => r[k].includes("|"));
  if (piped.length) throw new Error(`${what} row ${i + 1} has "|" in ${piped.join("/")}`);
  return keyOf(r);
}

const listed = (keys, max = 5) => `${keys.slice(0, max).join(", ")}${keys.length > max ? `, … (${keys.length} in all)` : ""}`;

export function normaliseVerdict(v) {
  const n = VERDICT_ALIASES[String(v ?? "").trim().toUpperCase()];
  if (!n) throw new Error(`unknown verdict: ${v}`);
  return n;
}

function labelView(row, as) {
  if (as === "a") return row.labeler_a;
  if (as === "b") return row.labeler_b;
  return row; // top-level attributes: agreed or resolved values, null while waiting on Bruno
}

const isDifferent = (l) => l.identity === "different_named_entity" || l.identity === "mixed_entity";
// "Truly correct" = the answer is about the site's real owner, commits to it, its facts are backed by the site, nothing invented.
const strictCorrect = (l) => l.identity === "same_entity" && l.answered === "substantive" && l.facts === "supported" && l.invented_specifics === false && l.core_identity !== "wrong";
const lenientCorrect = (l) => l.identity === "same_entity" && l.answered !== "non_answer" && l.facts === "supported" && l.invented_specifics === false && l.core_identity !== "wrong";
const known = (l, attrs) => attrs.every((a) => l[a] !== null && l[a] !== undefined);

function ratio(num, den) {
  return { num, den, pct: den ? Math.round((1000 * num) / den) / 10 : null };
}

/**
 * Integrity (Codex HIGH, 2026-11-12): every number below is a claim about the
 * whole label set, so the prediction file must cover it exactly. Hard-fails
 * on a malformed key, a duplicate label or prediction key, a prediction for
 * an answer that has no label (unknown key), and a label with no prediction
 * (missing key). Nothing is silently dropped.
 */
export function score(judgeRows, labelRows, { as = "final" } = {}) {
  if (!["final", "a", "b"].includes(as)) throw new Error(`--as must be final, a or b (got ${as})`);
  const labels = new Map();
  const dupLabels = [];
  labelRows.forEach((r, i) => {
    const k = checkedKey(r, "label", i);
    if (labels.has(k)) dupLabels.push(k);
    labels.set(k, r);
  });
  if (dupLabels.length) throw new Error(`duplicate label keys: ${listed(dupLabels)}`);
  const judge = new Map();
  const dupJudge = [];
  judgeRows.forEach((r, i) => {
    const k = checkedKey(r, "prediction", i);
    if (judge.has(k)) dupJudge.push(k);
    judge.set(k, normaliseVerdict(r.verdict));
  });
  if (dupJudge.length) throw new Error(`duplicate prediction keys: ${listed(dupJudge)}`);
  const unknown = [...judge.keys()].filter((k) => !labels.has(k));
  if (unknown.length) throw new Error(`predictions for answers with no label (unknown keys): ${listed(unknown)}`);
  const missing = [...labels.keys()].filter((k) => !judge.has(k));
  if (missing.length) throw new Error(`labelled answers with no prediction (missing keys): ${listed(missing)}`);
  const rows = [];
  for (const [key, row] of labels) {
    const l = labelView(row, as);
    if (!l || typeof l !== "object") throw new Error(`label ${key} has no ${as === "final" ? "attributes" : `labeler_${as}`}`);
    rows.push({ key, site: row.site, verdict: judge.get(key), l });
  }
  const out = { as, answers: rows.length, missing_verdicts: 0, metrics: {}, by_site: {} };
  out.metrics = metrics(rows);
  for (const site of [...new Set(rows.map((r) => r.site))].sort()) out.by_site[site] = metrics(rows.filter((r) => r.site === site));
  return out;
}

function metrics(rows) {
  const m = {};
  // 1. False "different business" accusations: labelled NOT a different entity, judged MIXUP.
  const idKnown = rows.filter((r) => known(r.l, ["identity"]));
  const notDiff = idKnown.filter((r) => !isDifferent(r.l));
  const falseAcc = notDiff.filter((r) => r.verdict === "MIXUP");
  m.false_mixup_accusations = {
    ...ratio(falseAcc.length, notDiff.length),
    on_answers_backed_by_site: ratio(
      falseAcc.filter((r) => r.l.facts === "supported").length,
      notDiff.filter((r) => r.l.facts === "supported").length,
    ),
    on_wrong_core_identity_same_name: falseAcc.filter((r) => r.l.core_identity === "wrong").length,
    excluded_identity_pending: rows.length - idKnown.length,
    keys: falseAcc.map((r) => r.key),
  };
  const judgedMixup = idKnown.filter((r) => r.verdict === "MIXUP");
  m.mixup_precision = ratio(judgedMixup.filter((r) => isDifferent(r.l)).length, judgedMixup.length);
  // 2. Recall on real different_named_entity (and mixed_entity).
  const diff = idKnown.filter((r) => isDifferent(r.l));
  m.mixup_recall = {
    ...ratio(diff.filter((r) => r.verdict === "MIXUP").length, diff.length),
    definite: ratio(diff.filter((r) => r.l.answered === "substantive" && r.verdict === "MIXUP").length, diff.filter((r) => r.l.answered === "substantive").length),
    hedged: ratio(diff.filter((r) => r.l.answered === "hedged_guess" && r.verdict === "MIXUP").length, diff.filter((r) => r.l.answered === "hedged_guess").length),
    missed_keys: diff.filter((r) => r.verdict !== "MIXUP").map((r) => `${r.key} judged ${r.verdict}`),
  };
  // 3. Precision of CORRECT.
  const need = ["identity", "answered", "facts", "invented_specifics", "core_identity"];
  const judgedCorrect = rows.filter((r) => r.verdict === "CORRECT");
  const jcKnown = judgedCorrect.filter((r) => known(r.l, need));
  m.correct_precision = {
    strict: ratio(jcKnown.filter((r) => strictCorrect(r.l)).length, jcKnown.length),
    lenient_incl_hedged: ratio(jcKnown.filter((r) => lenientCorrect(r.l)).length, jcKnown.length),
    excluded_labels_pending: judgedCorrect.length - jcKnown.length,
    judged_correct_but: {
      domain_guess_or_unidentified: jcKnown.filter((r) => r.l.identity === "unidentifiable").length,
      hedged_guess: jcKnown.filter((r) => r.l.answered === "hedged_guess").length,
      non_answer: jcKnown.filter((r) => r.l.answered === "non_answer").length,
      facts_contradicted: jcKnown.filter((r) => r.l.facts === "contradicted").length,
      facts_unsupported: jcKnown.filter((r) => r.l.facts === "unsupported").length,
      invented_specifics: jcKnown.filter((r) => r.l.invented_specifics === true).length,
      different_entity: jcKnown.filter((r) => isDifferent(r.l)).length,
    },
  };
  const allKnown = rows.filter((r) => known(r.l, need));
  m.correct_recall_strict = ratio(allKnown.filter((r) => strictCorrect(r.l) && r.verdict === "CORRECT").length, allKnown.filter((r) => strictCorrect(r.l)).length);
  // 4. Coverage on clearly answerable cases: clear correct, clear mix-up, clear non-answer.
  // Coverage = judge gives a definite verdict (not UNCLEAR); accuracy = the definite verdict is the right one.
  const clear = allKnown.map((r) => {
    let want = null;
    if (strictCorrect(r.l)) want = "CORRECT";
    else if (isDifferent(r.l) && r.l.answered === "substantive") want = "MIXUP";
    else if (r.l.answered === "non_answer" && r.l.facts === "none") want = "DENY";
    return { ...r, want };
  }).filter((r) => r.want);
  const decided = clear.filter((r) => r.verdict !== "UNCLEAR");
  m.clear_cases = {
    coverage: ratio(decided.length, clear.length),
    accuracy: ratio(clear.filter((r) => r.verdict === r.want).length, clear.length),
    by_expected: Object.fromEntries(["CORRECT", "MIXUP", "DENY"].map((w) => {
      const c = clear.filter((r) => r.want === w);
      return [w, { ...ratio(c.filter((r) => r.verdict === w).length, c.length), got: tally(c.map((r) => r.verdict)) }];
    })),
  };
  // 5. Contradiction recall: answers whose facts conflict with the site (any identity).
  // flagged = judged MIXUP or WRONG_FACTS; not_passed = anything but CORRECT.
  const contra = rows.filter((r) => known(r.l, ["facts"]) && r.l.facts === "contradicted");
  m.contradiction_recall = {
    flagged: ratio(contra.filter((r) => r.verdict === "MIXUP" || r.verdict === "WRONG_FACTS").length, contra.length),
    not_passed_as_correct: ratio(contra.filter((r) => r.verdict !== "CORRECT").length, contra.length),
    got: tally(contra.map((r) => r.verdict)),
    passed_keys: contra.filter((r) => r.verdict === "CORRECT").map((r) => r.key),
  };
  // 6. WRONG_FACTS precision: judged WRONG_FACTS ("your site's text contradicts
  // this answer") whose gold facts are really contradicted. A false one accuses
  // a customer's answer of something their own site does not say.
  const judgedWF = rows.filter((r) => r.verdict === "WRONG_FACTS");
  const wfKnown = judgedWF.filter((r) => known(r.l, ["facts"]));
  const falseWF = wfKnown.filter((r) => r.l.facts !== "contradicted");
  m.wrong_facts_precision = {
    ...ratio(wfKnown.length - falseWF.length, wfKnown.length),
    false_wrong_facts: falseWF.length,
    false_on_strictly_correct: falseWF.filter((r) => known(r.l, need) && strictCorrect(r.l)).length,
    excluded_facts_pending: judgedWF.length - wfKnown.length,
    false_keys: falseWF.map((r) => `${r.key} (gold facts ${r.l.facts})`),
  };
  m.verdicts = tally(rows.map((r) => r.verdict));
  return m;
}

function tally(xs) {
  const t = {};
  for (const x of xs) t[x] = (t[x] || 0) + 1;
  return t;
}

const f = (r) => (r.den ? `${r.num}/${r.den} (${r.pct}%)` : `0/0 (n/a)`);

export function formatReport(res) {
  const m = res.metrics;
  const lines = [
    `Labels: ${res.as} · answers scored: ${res.answers} (every labelled answer has exactly one prediction)`,
    `Verdicts: ${JSON.stringify(m.verdicts)}`,
    ``,
    `1. False "different business" accusations (labelled not a different entity, judged MIXUP): ${f(m.false_mixup_accusations)}`,
    `   - of answers backed by the site: ${f(m.false_mixup_accusations.on_answers_backed_by_site)}`,
    `   - accusations on same-name answers with a wrong core identity: ${m.false_mixup_accusations.on_wrong_core_identity_same_name}`,
    `   - left out (identity waiting on Bruno): ${m.false_mixup_accusations.excluded_identity_pending}`,
    `   MIXUP precision (judged MIXUP that really are a different entity): ${f(m.mixup_precision)}`,
    `2. Recall on real different-entity answers: ${f(m.mixup_recall)} · definite ${f(m.mixup_recall.definite)} · hedged ${f(m.mixup_recall.hedged)}`,
    `3. Precision of CORRECT: strict ${f(m.correct_precision.strict)} · incl. hedged ${f(m.correct_precision.lenient_incl_hedged)} · left out (labels pending): ${m.correct_precision.excluded_labels_pending}`,
    `   judged CORRECT but: ${JSON.stringify(m.correct_precision.judged_correct_but)}`,
    `   recall of truly correct answers: ${f(m.correct_recall_strict)}`,
    `4. Clear cases: coverage (definite verdict) ${f(m.clear_cases.coverage)} · accuracy ${f(m.clear_cases.accuracy)}`,
    ...Object.entries(m.clear_cases.by_expected).map(([w, r]) => `   expected ${w}: ${f(r)} got ${JSON.stringify(r.got)}`),
    `5. Contradiction recall (facts conflict with the site): flagged as wrong ${f(m.contradiction_recall.flagged)} · not passed as CORRECT ${f(m.contradiction_recall.not_passed_as_correct)} · got ${JSON.stringify(m.contradiction_recall.got)}`,
    `6. WRONG_FACTS precision (judged WRONG_FACTS whose gold facts are contradicted): ${f(m.wrong_facts_precision)} · false WRONG_FACTS: ${m.wrong_facts_precision.false_wrong_facts} (on truly correct answers: ${m.wrong_facts_precision.false_on_strictly_correct}) · left out (facts label pending): ${m.wrong_facts_precision.excluded_facts_pending}${m.wrong_facts_precision.false_keys.length ? ` · ${m.wrong_facts_precision.false_keys.join(", ")}` : ""}`,
    ``,
    `Per site (false accusations · different-entity recall · CORRECT precision strict · clear-case accuracy):`,
    ...Object.entries(res.by_site).map(([s, b]) => `   ${s.padEnd(14)} ${f(b.false_mixup_accusations).padEnd(16)} ${f(b.mixup_recall).padEnd(16)} ${f(b.correct_precision.strict).padEnd(16)} ${f(b.clear_cases.accuracy)}`),
  ];
  return lines.join("\n");
}

function main(argv) {
  const args = { labels: [], as: "final", json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--judge") args.judge = argv[++i];
    else if (a === "--labels") args.labels.push(argv[++i]);
    else if (a === "--as") args.as = argv[++i];
    else if (a === "--json") args.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.judge || !args.labels.length) {
    console.error("usage: score.mjs --judge <verdicts.jsonl> --labels <labels.jsonl> [--labels ...] [--as final|a|b] [--json]");
    process.exit(2);
  }
  const judge = parseRows(fs.readFileSync(args.judge, "utf8"));
  const labels = args.labels.flatMap((p) => parseRows(fs.readFileSync(p, "utf8")));
  const res = score(judge, labels, { as: args.as });
  console.log(args.json ? JSON.stringify(res, null, 2) : formatReport(res));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main(process.argv.slice(2));
