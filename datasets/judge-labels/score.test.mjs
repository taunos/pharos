import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { score, parseRows, normaliseVerdict } from "./score.mjs";
import { verdictFromNotes } from "./extract-old-judge.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const base = { identity: "same_entity", core_identity: "correct", answered: "substantive", facts: "supported", has_unsupported_claims: false, invented_specifics: false, url: "absent", truncated: false, names_site: "domain" };
const row = (qid, over = {}) => ({ site: "s", qid, modelId: "m", ...base, ...over, labeler_a: { ...base, ...over }, labeler_b: { ...base, ...over } });

const labels = [
  row("q1"), // truly correct
  row("q2"), // truly correct
  row("q3", { identity: "different_named_entity", core_identity: "wrong", facts: "contradicted" }), // definite mix-up
  row("q4", { identity: "different_named_entity", core_identity: "wrong", facts: "contradicted", answered: "hedged_guess" }), // hedged mix-up
  row("q5", { identity: "unidentifiable", core_identity: "not_stated", answered: "non_answer", facts: "none" }), // non-answer
  row("q6", { identity: "unidentifiable", core_identity: "not_stated", answered: "hedged_guess" }), // domain guess
  row("q7", { facts: "contradicted", invented_specifics: true }), // right entity, invented address
  { ...row("q8"), identity: null, final: null, status: "needs_bruno" }, // identity pending
];
const judge = [
  ["q1", "CORRECT"], ["q2", "WRONG"], ["q3", "MIXUP"], ["q4", "UNCLEAR"], ["q5", "DENY"], ["q6", "CORRECT"], ["q7", "MIXUP"], ["q8", "MIXUP"],
].map(([qid, verdict]) => ({ site: "s", qid, modelId: "m", verdict }));

test("false accusations, recall, precision and clear-case coverage", () => {
  const m = score(judge, labels).metrics;
  // not-different with known identity: q1 q2 q5 q6 q7 = 5; judged MIXUP among them: q2 (WRONG alias), q7 = 2
  assert.deepEqual([m.false_mixup_accusations.num, m.false_mixup_accusations.den], [2, 5]);
  assert.equal(m.false_mixup_accusations.excluded_identity_pending, 1);
  // backed by site among not-different: q1 q2 q6 = 3 (q6 supported guess); accused: q2
  assert.deepEqual([m.false_mixup_accusations.on_answers_backed_by_site.num, m.false_mixup_accusations.on_answers_backed_by_site.den], [1, 3]);
  // MIXUP precision: judged MIXUP with known identity q2 q3 q7 → 1 real
  assert.deepEqual([m.mixup_precision.num, m.mixup_precision.den], [1, 3]);
  // recall: q3 caught, q4 missed
  assert.deepEqual([m.mixup_recall.num, m.mixup_recall.den], [1, 2]);
  assert.deepEqual([m.mixup_recall.definite.num, m.mixup_recall.definite.den], [1, 1]);
  assert.deepEqual([m.mixup_recall.hedged.num, m.mixup_recall.hedged.den], [0, 1]);
  // judged CORRECT: q1 (truly correct), q6 (domain guess) → strict 1/2
  assert.deepEqual([m.correct_precision.strict.num, m.correct_precision.strict.den], [1, 2]);
  assert.equal(m.correct_precision.judged_correct_but.domain_guess_or_unidentified, 1);
  assert.equal(m.correct_precision.judged_correct_but.hedged_guess, 1);
  // clear cases: q1,q2 (CORRECT), q3 (MIXUP), q5 (DENY) = 4; all definite; right: q1 q3 q5 = 3
  assert.deepEqual([m.clear_cases.coverage.num, m.clear_cases.coverage.den], [4, 4]);
  assert.deepEqual([m.clear_cases.accuracy.num, m.clear_cases.accuracy.den], [3, 4]);
  // contradicted: q3 (MIXUP), q4 (UNCLEAR), q7 (MIXUP) → flagged 2/3, not passed 3/3
  assert.deepEqual([m.contradiction_recall.flagged.num, m.contradiction_recall.flagged.den], [2, 3]);
  assert.deepEqual([m.contradiction_recall.not_passed_as_correct.num, m.contradiction_recall.not_passed_as_correct.den], [3, 3]);
});

test("--as a / b scores against a labeler's raw labels (pending rows included)", () => {
  const m = score(judge, labels, { as: "a" }).metrics;
  assert.equal(m.false_mixup_accusations.den, 6);
  assert.equal(m.false_mixup_accusations.num, 3);
});

test("missing verdicts are counted, unknown verdicts rejected", () => {
  const res = score(judge.slice(0, 3), labels);
  assert.equal(res.missing_verdicts, 5);
  assert.throws(() => normaliseVerdict("MAYBE"));
  assert.equal(normaliseVerdict("not_cited"), "DENY");
});

test("old-judge notes map to verdicts", () => {
  assert.equal(verdictFromNotes("score=0/100; judge=DENY"), "DENY");
  assert.equal(verdictFromNotes("score=0/100; judge=DENY; truncated=true"), "DENY");
  assert.equal(verdictFromNotes("score=80/100; judge=AFFIRM; accuracy=CORRECT; domain_named=true"), "CORRECT");
  assert.equal(verdictFromNotes("score=0/100; judge=AFFIRM; accuracy=WRONG; misidentified=true"), "MIXUP");
  assert.equal(verdictFromNotes("score=0/100; judge=AFFIRM; accuracy=UNCLEAR; accuracy_unclear=true"), "UNCLEAR");
  assert.throws(() => verdictFromNotes("score=1"));
});

test("dev.jsonl is well-formed: 40 answers per site, enums valid, final set only when nothing is pending", () => {
  const rows = parseRows(fs.readFileSync(path.join(HERE, "dev.jsonl"), "utf8"));
  const enums = {
    identity: ["same_entity", "different_named_entity", "mixed_entity", "unidentifiable"],
    core_identity: ["correct", "wrong", "not_stated"],
    answered: ["substantive", "hedged_guess", "non_answer"],
    facts: ["supported", "contradicted", "unsupported", "none"],
    url: ["correct", "incorrect", "mixed", "unknown", "absent"],
    names_site: ["domain", "brand_name", "both", "neither"],
  };
  const perSite = {};
  for (const r of rows) {
    perSite[r.site] = (perSite[r.site] || 0) + 1;
    for (const who of [r.labeler_a, r.labeler_b]) for (const [k, v] of Object.entries(enums)) assert.ok(v.includes(who[k]), `${r.site} ${r.qid} ${k}=${who[k]}`);
    assert.ok(["agreed", "resolved_by_rule", "resolved_by_bruno", "needs_bruno"].includes(r.status));
    assert.equal(r.final === null, r.status === "needs_bruno");
    assert.equal(r.pending.length > 0, r.status === "needs_bruno");
  }
  for (const n of Object.values(perSite)) assert.equal(n, 40);
  // finalized 2026-11-11: nothing waits on Bruno
  assert.equal(rows.filter((r) => r.status === "needs_bruno").length, 0);
});
