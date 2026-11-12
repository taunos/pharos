// dim6:v6 scoring option A (Bruno, 2026-11-12): uncheckable answers are left
// out of the score, and the grade is withheld below 24 checkable answers (of
// 40) or below 5 from any one AI model.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_MODEL_IDS, type CellEnvelope, type ModelId } from "./types";
import { checkableCounts, DIM6_MIN_CHECKABLE, DIM6_MIN_CHECKABLE_PER_MODEL, failedCheckBounds, isCheckable, isFailedCheck, isUncheckable } from "./checkable";
import { aggregateCells } from "./orchestrator";
import { buildSubChecks, dim6FromResult, DIM6_NOT_ENOUGH_EVIDENCE_ID } from "./runDim6";
import { buildExecutiveSummary } from "../audit-executive-summary";
import { buildRemediationGaps, renderAuditHtml } from "../audit-pipeline";
import { buildAuditReportModel, naGradeOf, naLabelOf } from "../audit-report-model";
import { DISPLAY_TEXT_MAX } from "../llm-safety";
import type { AuditResult, ScanResult } from "../audit-types";

const CORRECT = "score=100/100; judge=AFFIRM; accuracy=CORRECT; domain_named=true; url_referenced=true; context_relevant=true; no_competitor_first=true";
const UNCLEAR = "score=0/100; judge=AFFIRM; accuracy=UNCLEAR; accuracy_unclear=true; unclear_why=unsupported";
const DENY = "score=0/100; judge=DENY";
const WRONG = "score=0/100; judge=AFFIRM; accuracy=WRONG; misidentified=true; wrong_at=0";
const CONTRA = "score=0/100; judge=AFFIRM; accuracy=WRONG_FACTS; facts_contradicted=true; claim_at=0; site_at=0";
const NOT_CHECKED = "score=0/100; judge=AFFIRM; accuracy_not_checked=true";
const BLOCKED = "score=0/100; judge=AFFIRM; accuracy_blocked=true";
const FAILED_AFF = "score=0/100; affirmation_failed=true";
const JUDGE_FAILED = "score=0/100; judge=AFFIRM; accuracy=UNCLEAR; accuracy_unclear=true; accuracy_failed=judge_failed";
const URL_ONLY = "score=33/100; judge=AFFIRM; accuracy=URL_ONLY; url_only=true; url_referenced=true";
const CUT_MIXUP = "score=0/100; judge=AFFIRM; accuracy=WRONG_CUT_OFF; possible_mixup_cut_off=true; wrong_at=0; truncated=true";

let n = 0;
function cell(modelId: ModelId, notes: string, score = 0, unmeasurable = false): CellEnvelope {
  return { query: { id: `q${n++}`, text: "q", rationale: null }, modelId, result: { text: unmeasurable ? null : "acme.com is a bakery.", score, unmeasurable, truncated: false, notes } };
}
/** `per` cells of `notes` for every model. */
const each = (per: number, notes: string, score = 0) => ALL_MODEL_IDS.flatMap((m) => Array.from({ length: per }, () => cell(m, notes, score)));

describe("checkable answers (option A)", () => {
  it("classifies every cell state", () => {
    // the site's own description missing or injected: fail closed at 0, never left out (Codex 2026-11-12)
    for (const notes of [CORRECT, DENY, WRONG, CONTRA, BLOCKED, NOT_CHECKED, URL_ONLY, CUT_MIXUP]) {
      expect(isCheckable(cell("openai:gpt-4o", notes)), notes).toBe(true);
      expect(isUncheckable(cell("openai:gpt-4o", notes)), notes).toBe(false);
    }
    for (const notes of [UNCLEAR, FAILED_AFF, JUDGE_FAILED]) {
      expect(isCheckable(cell("openai:gpt-4o", notes)), notes).toBe(false);
      expect(isUncheckable(cell("openai:gpt-4o", notes)), notes).toBe(true);
    }
    expect([UNCLEAR, FAILED_AFF, JUDGE_FAILED].map((n) => isFailedCheck(cell("openai:gpt-4o", n)))).toEqual([false, true, true]);
    // a provider failure is neither: it never came back
    const missing = cell("openai:gpt-4o", "Templated fallback: network", 0, true);
    expect(isCheckable(missing) || isUncheckable(missing)).toBe(false);
    // a flag must be a whole note field, not a substring of another
    expect(isUncheckable(cell("openai:gpt-4o", "score=0/100; judge=DENY; xaccuracy_unclear=true"))).toBe(false);
  });

  it("the score is the average of the checkable answers; mix-ups and contradictions stay 0", () => {
    const cells = [...each(3, CORRECT, 100), ...each(3, UNCLEAR), ...each(1, WRONG), ...each(1, CONTRA), ...each(1, DENY)];
    const r = aggregateCells(cells, true);
    // 12 backed of 24 checkable (the 12 UNCLEAR are left out): 50, not 33
    expect(r.score).toBe(50);
    expect(r.uncheckableCount).toBe(12);
    expect(r.perModelAverage).toEqual(Object.fromEntries(ALL_MODEL_IDS.map((m) => [m, 50])));
  });

  it("measured but nothing checkable: score 0 here (never null, which means nothing came back), grade withheld", () => {
    const r = aggregateCells(each(10, UNCLEAR), true);
    expect(r.score).toBe(0);
    expect(r.perModelAverage).toEqual(Object.fromEntries(ALL_MODEL_IDS.map((m) => [m, null])));
    expect(dim6FromResult(r, false, "acme.com").dimension).toMatchObject({ na: true, unmeasured: true });
  });

  it("floor: at least 24 checkable answers and at least 5 from every model", () => {
    expect([DIM6_MIN_CHECKABLE, DIM6_MIN_CHECKABLE_PER_MODEL]).toEqual([24, 5]);
    // 24 checkable, 6 per model: graded
    expect(checkableCounts([...each(6, DENY), ...each(4, UNCLEAR)]).meetsFloor).toBe(true);
    // 23 checkable: withheld
    const c23 = [...each(6, DENY).slice(1), ...each(4, UNCLEAR)];
    expect(checkableCounts(c23)).toMatchObject({ checkable: 23, uncheckable: 16, meetsFloor: false, thinModels: [] });
    // 31 checkable, but Perplexity has only 4: withheld
    const thin = [
      ...ALL_MODEL_IDS.filter((m) => m !== "perplexity:sonar").flatMap((m) => Array.from({ length: 9 }, () => cell(m, DENY))),
      ...Array.from({ length: 4 }, () => cell("perplexity:sonar", DENY)),
      ...Array.from({ length: 6 }, () => cell("perplexity:sonar", UNCLEAR)),
    ];
    expect(checkableCounts(thin)).toMatchObject({ checkable: 31, meetsFloor: false, thinModels: ["perplexity:sonar"] });
    // a model that never answered is thin too
    const silent = [...ALL_MODEL_IDS.filter((m) => m !== "google:gemini-2.5-flash").flatMap((m) => Array.from({ length: 10 }, () => cell(m, DENY))), ...Array.from({ length: 10 }, () => cell("google:gemini-2.5-flash", "Templated fallback: network", 0, true))];
    expect(checkableCounts(silent)).toMatchObject({ checkable: 30, meetsFloor: false, thinModels: ["google:gemini-2.5-flash"] });
  });

  it("below the floor: N/A with the reason, the counts and the fix, never a gap, never a grade", () => {
    const cells = [...each(3, CORRECT, 100), ...each(5, UNCLEAR), ...each(1, WRONG), ...each(1, CONTRA)];
    const r = { ...aggregateCells(cells, true), referenceText: "Name: Acme" };
    const { dimension } = dim6FromResult(r, false, "acme.com");
    expect(dimension).toMatchObject({ dimension_id: 6, na: true, unmeasured: true, score: 0 });
    // Bruno 2026-11-12: the mix-up and contradiction evidence stays visible with no grade
    expect(dimension.sub_checks.map((s) => s.id)).toEqual([DIM6_NOT_ENOUGH_EVIDENCE_ID, "citation_misidentified_answers", "citation_contradicted_answers"]);
    const [, mix, contra] = dimension.sub_checks;
    expect(mix.notes).toMatch(/^4 of the 20 answers we could check against your site linked your site to a different named person or business\. /);
    expect(mix.notes).toMatch(/This row is for information\.$/);
    expect(contra.notes).toMatch(/^4 of the 20 answers we could check against your site said something your site's text contradicts\. /);
    expect(contra.notes).toMatch(/This row is for information\.$/);
    for (const row of [mix, contra]) {
      expect(row.notes).not.toContain("checks above");
      expect(row.notes).not.toContain("counted again");
    }
    // the report: "Not graded", the note, then the evidence rows
    const model = buildAuditReportModel({ scan: { id: "s", url: "https://acme.com/", composite: { score: 50, grade: "D" }, dimensions_total: 6, created_at: 0, dimensions: [dimension] }, gaps: [] } as unknown as AuditResult, "sess-0001");
    const d = model.dimensions[0];
    expect(d).toMatchObject({ kind: "na", notGraded: true, unmeasured: true });
    if (d.kind !== "na") throw new Error("na");
    expect(naLabelOf(d)).toBe("Not graded");
    expect(naGradeOf(d)).toBe("not counted in score");
    expect(d.evidence?.map((e) => e.id)).toEqual(["citation_misidentified_answers", "citation_contradicted_answers"]);
    expect(model.scopeNote).toContain("Not graded on this run: Citation Visibility.");
    expect(model.scopeNote).not.toContain("Not measured");
    const html = renderAuditHtml({ scan: { id: "s", url: "https://acme.com/", composite: { score: 50, grade: "D" }, dimensions_total: 6, created_at: 0, dimensions: [dimension] }, gaps: [] } as unknown as AuditResult, "sess-0001");
    expect(html).toContain(">Not graded</span>");
    expect(html).toContain("Answers contradicted by your site&#39;s text");
    const sc = dimension.sub_checks[0];
    expect(sc).toMatchObject({ id: DIM6_NOT_ENOUGH_EVIDENCE_ID, na: true });
    expect(sc.notes).toBe(
      "Citation Visibility is not graded on this run: 20 of the 40 test answers could be checked against your site's text, and we grade it only when at least 24 can be checked, with at least 5 from each of the 4 AI models. It is not counted in your score. 20 of the answers that came back could not be checked against your site's text: 20 said things your site's text does not clearly back or contradict. A fuller description of who you are and what you do on your site (your homepage, llms.txt file and structured data) gives us more of your site's own text to check answers against. Astrant Citation Visibility v6 (4 AI models)."
    );
    expect(sc.notes.length).toBeLessThanOrEqual(DISPLAY_TEXT_MAX);
    const scan = { id: "s", url: "https://acme.com/", composite: { score: 50, grade: "D" }, dimensions_total: 6, created_at: 0, dimensions: [dimension] } as unknown as ScanResult;
    expect(buildRemediationGaps(scan)).toEqual([]);
  });

  it("below the floor because one model is thin: the note names it and its count", () => {
    const cells = [
      ...ALL_MODEL_IDS.filter((m) => m !== "perplexity:sonar").flatMap((m) => Array.from({ length: 10 }, () => cell(m, DENY))),
      ...Array.from({ length: 3 }, () => cell("perplexity:sonar", DENY)),
      ...Array.from({ length: 7 }, () => cell("perplexity:sonar", "Templated fallback: network", 0, true)),
    ];
    const r = aggregateCells(cells, true);
    const note = dim6FromResult(r, false, "acme.com").dimension.sub_checks[0].notes;
    expect(note).toContain("with at least 5 from each of the 4 AI models (answers we could check: Perplexity 3).");
    expect(note).toContain("7 of the 40 test answers did not come back from the AI models (network or provider failures).");
  });

  it("no usable description: the claimed answers stay 0 and the grade stays (a site can't hide a weak section by removing its description)", () => {
    const cells = [...each(6, NOT_CHECKED), ...each(4, DENY)];
    const r = aggregateCells(cells, false);
    const { dimension } = dim6FromResult(r, false, "acme.com");
    expect(dimension.na).toBeUndefined();
    expect(dimension.score).toBe(0);
    expect(dimension.sub_checks[0].notes).toContain(
      "We could not find or read a clear description of your site on it, so the 24 answers that said the model knew your site could not be checked and were counted as 0. To fix this,"
    );
  });

  it("our failed checks are left out, but never decide a grade: counted as 0 or 100 the grade must be the same", () => {
    // 30 checkable answers averaging 50 (grade D): 15 backed, 15 not known, at least 6 per model
    const base = ALL_MODEL_IDS.flatMap((m, i) => [
      ...Array.from({ length: i < 3 ? 4 : 3 }, () => cell(m, CORRECT, 100)),
      ...Array.from({ length: i < 3 ? 4 : 3 }, () => cell(m, DENY)),
    ]);
    // plus 1 failed check: 48..52, both D → graded 50
    const one = [...base, cell("openai:gpt-4o", JUDGE_FAILED)];
    const c1 = checkableCounts(one);
    expect([c1.checkable, c1.failed]).toEqual([30, 1]);
    expect(failedCheckBounds(c1)).toEqual({ low: 48, high: 52 });
    expect(dim6FromResult(aggregateCells(one, true), false, "acme.com").dimension).toMatchObject({ score: 50, grade: "D" });
    // 10 failed checks: 38..63 (F to C) → no grade, and the note says it is our failure, with no advice to the site
    const ten = [...base, ...each(2, JUDGE_FAILED), cell("anthropic:claude-sonnet", FAILED_AFF), cell("google:gemini-2.5-flash", JUDGE_FAILED)];
    const c10 = checkableCounts(ten);
    expect([c10.checkable, c10.failed, c10.meetsFloor]).toEqual([30, 10, true]);
    expect(failedCheckBounds(c10)).toEqual({ low: 38, high: 63 });
    const { dimension } = dim6FromResult(aggregateCells(ten, true), false, "acme.com");
    expect(dimension).toMatchObject({ na: true, unmeasured: true });
    expect(dimension.sub_checks[0]).toMatchObject({ id: "dim6_checks_failed", name: "Citation Visibility (not graded: our checks failed)" });
    // the executive summary gives the same reason, not "too few answers"
    const other = [1, 2, 3, 4, 5].map((id) => ({ dimension_id: id, dimension_name: `D${id}`, score: 90, grade: "A", sub_checks: [{ id: `s${id}`, name: "n", weight: 1, score: 90, passed: true, notes: "" }] }));
    const summary = buildExecutiveSummary({ scan: { composite: { score: 90, grade: "A" }, dimensions_total: 6, dimensions: [...other, dimension] }, gaps: [] } as unknown as AuditResult, "Gaps").join(" ");
    expect(summary).toContain("is not graded on this run because some of our checks failed on its test answers");
    expect(summary).not.toContain("too few");
    expect(dimension.sub_checks[0].notes).toBe(
      "Citation Visibility is not graded on this run: one of our checks failed on 10 of the test answers, and depending on what those answers said, the grade could be anything from F to C. It is not counted in your score; this is a failure on our side, not something your site needs to fix. 10 of the answers that came back could not be checked against your site's text: 10 could not be checked because one of our checks failed. Astrant Citation Visibility v6 (4 AI models)."
    );
  });

  it("the single no-grade note fits the report cell even with every kind of answer, ending on a whole sentence", () => {
    const mixed = [
      ...ALL_MODEL_IDS.flatMap((m, i) => (i === 3 ? [] : [cell(m, CORRECT, 100), cell(m, WRONG), cell(m, CONTRA), cell(m, CUT_MIXUP), cell(m, UNCLEAR), cell(m, JUDGE_FAILED), cell(m, FAILED_AFF)])),
      ...Array.from({ length: 4 }, () => cell("openai:gpt-4o", "score=0/100; judge=AFFIRM; accuracy=UNCLEAR; accuracy_unclear=true; unclear_why=truncated; truncated=true")),
      ...Array.from({ length: 10 }, () => cell("perplexity:sonar", "Templated fallback: network", 0, true)),
    ];
    for (const [checked, blocked, why] of [[true, false, undefined], [false, false, "structured_data_unreadable"], [false, true, undefined]] as const) {
      const r = { ...aggregateCells(mixed, checked, blocked), ...(why ? { accuracyNotCheckedReason: why } : {}) };
      const note = dim6FromResult(r, false, "acme.com").dimension.sub_checks[0].notes;
      expect(note.length, note).toBeLessThanOrEqual(DISPLAY_TEXT_MAX);
      expect(note).toMatch(/^Citation Visibility is not graded on this run: /);
      expect(note).toMatch(/[.)]$/);
    }
  });

  it("a section with no grade because every check failed (our outage) never tells the site to fix its description", () => {
    const r = aggregateCells(each(10, JUDGE_FAILED), true);
    const note = dim6FromResult(r, false, "acme.com").dimension.sub_checks[0].notes;
    expect(note).toContain("40 of the answers that came back could not be checked against your site's text: 40 could not be checked because one of our checks failed.");
    expect(note).not.toContain("A fuller description");
  });

  it("an injected description stays checkable at 0: it can't remove answers or withhold the grade", () => {
    const r = aggregateCells([...each(8, BLOCKED), ...each(2, DENY)], false, true);
    expect(r.score).toBe(0);
    expect(r.uncheckableCount).toBe(0);
    const { dimension } = dim6FromResult(r, false, "acme.com");
    expect(dimension.na).toBeUndefined();
    expect(dimension.score).toBe(0);
  });

  it("at the floor: graded over the checkable answers, with the uncheckable count on its own line", () => {
    const cells = [...each(3, CORRECT, 100), ...each(3, DENY), ...each(4, UNCLEAR)];
    const r = aggregateCells(cells, true);
    const { dimension } = dim6FromResult(r, false, "acme.com");
    expect(dimension).toMatchObject({ score: 50, grade: "D" });
    expect(dimension.na).toBeUndefined();
    const row = dimension.sub_checks.find((s) => s.id === "citation_uncheckable_answers")!;
    expect(row).toMatchObject({ na: true, weight: 0, name: "Answers with not enough evidence to check" });
    expect(row.notes).toMatch(/^16 of the 40 test answers that came back are not counted in this score, because we could not check them against your site's text: 16 said things/);
    expect(buildSubChecks(r, false, "acme.com")[0].notes).toContain("40 of 40 test answers came back from the 4 AI models, and 24 of those could be checked against your site's text and are counted in this score.");
  });

  it("the methodology page and the disclosure state the same floor as the code", () => {
    for (const rel of ["../../app/score/methodology/page.tsx", "./disclosure.ts"]) {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      expect(src, rel).toContain(`at least ${DIM6_MIN_CHECKABLE} of the`);
      expect(src, rel).toContain(`at least ${DIM6_MIN_CHECKABLE_PER_MODEL} from each`);
    }
  });

  it("executive summary: a withheld grade is called not graded, not 'not measured'", () => {
    const withheld = dim6FromResult(aggregateCells(each(10, UNCLEAR), true), false, "acme.com").dimension;
    const other = [1, 2, 3, 4, 5].map((id) => ({ dimension_id: id, dimension_name: `D${id}`, score: 90, grade: "A", sub_checks: [{ id: `s${id}`, name: "n", weight: 1, score: 90, passed: true, notes: "" }] }));
    const audit = { scan: { composite: { score: 90, grade: "A" }, dimensions_total: 6, dimensions: [...other, withheld] }, gaps: [] } as unknown as AuditResult;
    const lines = buildExecutiveSummary(audit, "Gaps");
    expect(lines.join(" ")).toContain("is not graded on this run because too few of its test answers could be checked against your site's text");
    expect(lines.join(" ")).not.toContain("was not measured on this run");
  });
});
