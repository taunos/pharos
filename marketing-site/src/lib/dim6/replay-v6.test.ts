// dim6:v6 replay test: the saved 2026-11-10 release-check answers and the
// 2026-11-08 rachelqueiroz run, with the accuracy judge's raw outputs
// recorded once through the local Workers AI proxy
// (tools/report-panel/replay-dim6-accuracy.mjs --record, fixtures in
// datasets/report-defects/replay-FIXER-LABELS-not-gold/). Each recorded output is fed through the
// deterministic gates (settleAccuracy) and the cell scoring and report notes,
// with no model call, and the corrected labels are asserted:
//   - the false "mixed up with a different person or business" labels of the
//     release check are gone (RD-0102..0106);
//   - Rachel's 8 mix-ups with the namesake author / a graphic designer stay
//     flagged;
//   - guesses and an invented address are no longer matches (RD-0116);
//   - correct homepage-URL answers count (RD-0111..0115);
//   - answers naming the business count as naming the site (RD-0107..0110);
//   - every note fits the report cell (RD-0122).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseAccuracyOutput, parseConfirmOutput, settleAccuracy, type AccuracyVerdict } from "./accuracy-judge";
import { scoreAffirmedCell, type SiteFacts } from "./ladder";
import { aggregateCells } from "./orchestrator";
import { buildSubChecks } from "./runDim6";
import { stripUnsafeChars, DISPLAY_TEXT_MAX } from "../llm-safety";
import type { CellEnvelope } from "./types";
import type { SiteReference } from "./reference";

const ROOT = path.resolve(__dirname, "../../../../datasets/report-defects");

interface RecordedCell {
  modelId: string;
  qid: string;
  judge: string | null;
  judgeRetry?: string | null;
  confirm: string | null;
  verdict: AccuracyVerdict | { kind: "blocked" } | null;
}
interface Fixture {
  engine: string;
  source: string;
  domain: string;
  reference: SiteReference;
  urlQuestionId: string | null;
  cells: RecordedCell[];
}

function load(name: string): { fx: Fixture; cells: CellEnvelope[] } {
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "replay-FIXER-LABELS-not-gold", name), "utf8")) as Fixture;
  const cells = JSON.parse(fs.readFileSync(path.join(ROOT, "..", "..", fx.source, "dim6-cells.json"), "utf8")) as CellEnvelope[];
  return { fx, cells };
}

/** Re-score a saved run from the recorded raw judge outputs (no model call). */
function replay(name: string) {
  const { fx, cells } = load(name);
  expect(fx.engine).toBe("dim6:v6");
  expect(fx.reference.verifiable).toBe(true);
  if (!fx.reference.verifiable) throw new Error("fixture reference not verifiable");
  const ref = fx.reference;
  const facts: SiteFacts = { names: ref.names, addresses: ref.addresses };
  const targetUrl = `https://${fx.domain}`;
  const out: CellEnvelope[] = [];
  const settled = new Map<string, AccuracyVerdict>();
  for (const c of cells) {
    const rec = fx.cells.find((r) => r.modelId === c.modelId && r.qid === c.query.id);
    if (!rec) {
      out.push(c); // DENY, unmeasurable or affirmation failure: unchanged
      continue;
    }
    const text = c.result.text ?? "";
    let verdict: AccuracyVerdict;
    if (rec.judge === null) {
      // No judge output: the screen or the length cap decided without a call.
      verdict = rec.verdict as AccuracyVerdict;
      expect(verdict).toMatchObject({ kind: "unclear" });
      expect((verdict as { failed?: string }).failed).toBeDefined();
    } else {
      let parsed = parseAccuracyOutput(rec.judge);
      expect(parsed, `${c.modelId} ${c.query.id}: recorded judge output parses`).not.toBeNull();
      const cleaned = stripUnsafeChars(text);
      let first = settleAccuracy(parsed!, cleaned, fx.domain, { names: ref.names });
      // Same retry as judgeAccuracy: a quote not found in the answer.
      if ("kind" in first && first.kind === "unclear" && (first.why === "correct_unsupported" || first.why === "wrong_unsupported") && rec.judgeRetry) {
        const wasWrong = parsed!.verdict === "WRONG";
        parsed = parseAccuracyOutput(rec.judgeRetry);
        expect(parsed).not.toBeNull();
        first = settleAccuracy(parsed!, cleaned, fx.domain, { names: ref.names });
        if (wasWrong && "kind" in first && first.kind === "unclear") first = { ...first, raw: "WRONG" };
      }
      if ("needsConfirm" in first) {
        const conf = rec.confirm === null ? null : parseConfirmOutput(rec.confirm);
        const v = settleAccuracy(parsed!, cleaned, fx.domain, { names: ref.names }, conf);
        verdict = !("needsConfirm" in v)
          ? v
          : parsed!.verdict === "WRONG"
            ? { kind: "unclear", why: "mixup_unconfirmed", raw: "WRONG" }
            : { kind: "unclear", why: "correct_unsupported", raw: parsed!.verdict };
      } else verdict = first;
      // The gates are deterministic: the replay reproduces the recorded verdict.
      expect(verdict, `${c.modelId} ${c.query.id}`).toEqual(rec.verdict);
    }
    settled.set(`${c.modelId.split(":")[0]} ${c.query.id}`, verdict);
    const result = scoreAffirmedCell(text, targetUrl, [], c.result.truncated, verdict, {
      urlQuestion: c.query.id === fx.urlQuestionId,
      domain: fx.domain,
      siteFacts: facts,
    });
    out.push({ ...c, result });
  }
  const agg = aggregateCells(out, true);
  const subs = buildSubChecks(agg, false, fx.domain);
  const flagged = (flag: string) => out.filter((c) => c.result.notes.includes(flag)).map((c) => `${c.modelId.split(":")[0]} ${c.query.id}`);
  const urlCells = out.filter((c) => c.query.id === fx.urlQuestionId);
  return { fx, cells, out, agg, subs, settled, flagged, urlCells };
}

const oldFlagged = (cells: CellEnvelope[]) =>
  cells.filter((c) => c.result.notes.includes("misidentified=true")).map((c) => `${c.modelId.split(":")[0]} ${c.query.id}`);

// Answers to the URL question that give the homepage URL on the right host
// (deterministic), to check RD-0111..0115 against what the answers say.
const givesHomepage = (c: CellEnvelope, domain: string) =>
  new RegExp(`https?://(?:www\\.)?${domain.replace(/\./g, "\\.")}/?(?![\\w/.-])`, "i").test(c.result.text ?? "");

describe("replay of the 2026-11-10 release check through dim6:v6", () => {
  for (const site of ["eff", "resend", "tartine", "ugmonk"]) {
    it(`${site}: none of the v5 false mix-ups remain; every note fits; URL answers count`, () => {
      const r = replay(`2026-11-10-${site}.v6.json`);
      expect(oldFlagged(r.cells).length).toBeGreaterThan(0); // v5 flagged some
      expect(r.flagged("misidentified=true")).toEqual([]);
      expect(r.flagged("possible_mixup_cut_off=true")).toEqual([]);
      expect(r.subs.map((s) => s.id)).not.toContain("citation_misidentified_answers");
      for (const s of r.subs) expect(s.notes.length).toBeLessThanOrEqual(DISPLAY_TEXT_MAX);
      for (const c of r.urlCells.filter((c) => givesHomepage(c, r.fx.domain) && !c.result.truncated && !c.result.notes.includes("judge=DENY")))
        expect(c.result.score, `${c.modelId} ${c.query.id}`).toBeGreaterThan(0);
    });
  }

  it("drveit: only answers that name a different business are mix-ups; guesses and the invented address are not matches", () => {
    const r = replay("2026-11-10-drveit.v6.json");
    // RD-0102: non-answers, domain-name guesses, a truncated domain guess and
    // Perplexity's (correct) oral-care products are no mix-ups.
    for (const k of ["openai q5", "anthropic q3", "google q9", "perplexity q5"]) {
      expect(r.flagged("misidentified=true"), k).not.toContain(k);
      expect(r.flagged("possible_mixup_cut_off=true"), k).not.toContain(k);
    }
    // Gemini q5 ("Dr. Veit Clínica Veterinária, a veterinary clinic") is a real mix-up.
    expect(r.flagged("misidentified=true")).toContain("google q5");
    for (const k of r.flagged("misidentified=true")) expect(["google q2", "google q5"]).toContain(k);
    // RD-0116: guesses and the invented address are not counted as matches.
    const cellOf = (k: string) => r.out.find((c) => `${c.modelId.split(":")[0]} ${c.query.id}` === k)!;
    for (const k of ["openai q1", "google q4", "google q6"]) {
      expect(cellOf(k).result.notes, k).not.toContain("accuracy=CORRECT");
      expect(cellOf(k).result.score, k).toBe(0);
    }
    expect(cellOf("google q6").result.notes).toContain("unclear_why=address");
    for (const s of r.subs) expect(s.notes.length).toBeLessThanOrEqual(DISPLAY_TEXT_MAX);
  });

  it("names count as naming the site: the naming rate no longer misses answers that name the business (RD-0107..0110)", () => {
    for (const site of ["eff", "resend", "tartine", "ugmonk"]) {
      const r = replay(`2026-11-10-${site}.v6.json`);
      const named = r.out.filter((c) => c.result.notes.includes("domain_named=true")).length;
      const correct = r.out.filter((c) => c.result.notes.includes("accuracy=CORRECT")).length;
      // Every answer the judge found correct names the site by domain or name.
      expect(named, site).toBe(correct);
    }
  });
});

describe("replay of the 2026-11-08 rachelqueiroz run: the real mix-ups stay flagged", () => {
  it("all 8 answers that described the namesake author or a graphic designer are still flagged", () => {
    const r = replay("2026-11-08-rachelqueiroz.v6.json");
    const before = oldFlagged(r.cells);
    expect(before).toHaveLength(8);
    const after = [...r.flagged("misidentified=true"), ...r.flagged("possible_mixup_cut_off=true")];
    for (const k of before) expect(after, k).toContain(k);
    // The Perplexity answers that describe the psychologist stay matches.
    for (const k of ["perplexity q1", "perplexity q2", "perplexity q3", "perplexity q10"]) expect(r.settled.get(k)?.kind, k).toBe("correct");
    const row = r.subs.find((s) => s.id === "citation_misidentified_answers")!;
    expect(row.notes).toContain("Rachel de Queiroz");
    expect(row.notes.length).toBeLessThanOrEqual(DISPLAY_TEXT_MAX);
  });
});

describe("the v5 bare verdicts can no longer raise a mix-up", () => {
  it("a bare WRONG (the v5 output form) is not a mix-up under v6", () => {
    for (const name of ["2026-11-10-eff.v6.json", "2026-11-10-resend.v6.json", "2026-11-10-tartine.v6.json", "2026-11-10-ugmonk.v6.json", "2026-11-10-drveit.v6.json"]) {
      const { fx, cells } = load(name);
      if (!fx.reference.verifiable) continue;
      for (const c of cells.filter((x) => x.result.notes.includes("misidentified=true"))) {
        const v = settleAccuracy(parseAccuracyOutput("WRONG")!, stripUnsafeChars(c.result.text ?? ""), fx.domain, { names: fx.reference.names });
        expect(v).toMatchObject({ kind: "unclear", why: "wrong_unsupported" });
      }
    }
  });
});
