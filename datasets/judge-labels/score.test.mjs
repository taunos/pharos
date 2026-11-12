import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { score, parseRows, normaliseVerdict, formatReport } from "./score.mjs";
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

test("integrity: missing, duplicate and unknown keys hard-fail; unknown verdicts rejected (Codex HIGH)", () => {
  const has = (fragment) => (e) => e instanceof Error && e.message.includes(fragment);
  // missing: a labelled answer with no prediction
  assert.throws(() => score(judge.slice(0, 3), labels), has("(missing keys): s|q4|m, s|q5|m, s|q6|m, s|q7|m, s|q8|m"));
  // duplicate prediction, even with the same verdict
  assert.throws(() => score([...judge, judge[0]], labels), has("duplicate prediction keys: s|q1|m"));
  // unknown: a prediction for an answer that has no label
  assert.throws(() => score([...judge, { site: "s", qid: "q99", modelId: "m", verdict: "CORRECT" }], labels), has("(unknown keys): s|q99|m"));
  // a different model id is a different answer (here: one unknown and one missing; unknown is reported first)
  assert.throws(() => score(judge.map((r, i) => (i === 0 ? { ...r, modelId: "other" } : r)), labels), has("(unknown keys): s|q1|other"));
  // duplicate labels (e.g. the same file passed twice)
  assert.throws(() => score(judge, [...labels, labels[0]]), has("duplicate label keys: s|q1|m"));
  // malformed keys
  assert.throws(() => score([...judge.slice(1), { qid: "q1", modelId: "m", verdict: "CORRECT" }], labels), has("prediction row 8 has no site"));
  assert.throws(() => score(judge, [...labels.slice(1), { ...labels[0], qid: "" }]), has("label row 8 has no qid"));
  assert.throws(() => score(judge, labels, { as: "c" }), has("--as must be"));
  assert.throws(() => score(judge.map((r, i) => (i === 0 ? { ...r, verdict: "MAYBE" } : r)), labels), has("unknown verdict: MAYBE"));
  // "|" in a key field could make two different answers collide (Codex LOW)
  assert.throws(() => score(judge, [...labels.slice(1), { ...labels[0], qid: "q1|m" }]), has('label row 8 has "|" in qid'));
  assert.throws(() => score([...judge.slice(1), { site: "s|q1", qid: "m", modelId: "m", verdict: "CORRECT" }], labels), has('prediction row 8 has "|" in site'));
  // long lists are capped in the message
  assert.throws(() => score([], labels), has("… (8 in all)"));
  assert.throws(() => normaliseVerdict("MAYBE"));
  assert.equal(normaliseVerdict("not_cited"), "DENY");
  // exact coverage passes, in any order
  assert.equal(score([...judge].reverse(), labels).answers, 8);
});

test("WRONG_FACTS precision is reported, with the false ones named", () => {
  const wf = judge.map((r) => (["q1", "q6", "q7"].includes(r.qid) ? { ...r, verdict: "WRONG_FACTS" } : r));
  const m = score(wf, labels).metrics;
  // judged WRONG_FACTS: q1 (truly correct: false), q6 (facts supported: false), q7 (contradicted: right)
  assert.deepEqual([m.wrong_facts_precision.num, m.wrong_facts_precision.den], [1, 3]);
  assert.equal(m.wrong_facts_precision.false_wrong_facts, 2);
  assert.equal(m.wrong_facts_precision.false_on_strictly_correct, 1);
  assert.deepEqual(m.wrong_facts_precision.false_keys, ["s|q1|m (gold facts supported)", "s|q6|m (gold facts supported)"]);
  // and it shows in the printed report
  assert.ok(formatReport(score(wf, labels)).includes("6. WRONG_FACTS precision (judged WRONG_FACTS whose gold facts are contradicted): 1/3 (33.3%) · false WRONG_FACTS: 2 (on truly correct answers: 1) · left out (facts label pending): 0"));
  // a WRONG_FACTS on an answer whose facts label is pending is left out, and the report says how many (Codex LOW)
  const pendingFacts = labels.map((r) => (r.qid === "q2" ? { ...r, facts: null } : r));
  const wf2 = wf.map((r) => (r.qid === "q2" ? { ...r, verdict: "WRONG_FACTS" } : r));
  const m2 = score(wf2, pendingFacts).metrics.wrong_facts_precision;
  assert.deepEqual([m2.num, m2.den, m2.excluded_facts_pending], [1, 3, 1]);
  assert.ok(formatReport(score(wf2, pendingFacts)).includes("· left out (facts label pending): 1"));
  // no WRONG_FACTS verdicts: 0/0, no false ones
  const none = score(judge, labels).metrics.wrong_facts_precision;
  assert.deepEqual([none.den, none.false_wrong_facts], [0, 0]);
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
