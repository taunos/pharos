// dim6:v6 gold-label regression: the judge's raw outputs on the 160 gold dev
// answers (datasets/judge-labels/dev.jsonl), recorded once through the local
// Workers AI proxy by tools/report-panel/judge-dev.mjs, are replayed through
// the production pipeline (judgeAccuracy's gates, scoreAffirmedCell) with no
// model call, and scored with the gold scorer (datasets/judge-labels/score.mjs).
// Every later change to the deterministic gates, the cell scoring or the
// verdict mapping is checked against the frozen dev gates:
//   0 false "different business" accusations, 11/11 real mix-ups caught,
//   CORRECT precision >= 95%, contradiction recall (MIXUP or WRONG_FACTS)
//   >= 90%, coverage on clear cases >= 80%.
// A change to the PROMPTS is not covered (the recorded outputs belong to the
// recorded prompts): re-record with judge-dev.mjs and re-score instead.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import { judgeAccuracy, type AccuracyVerdict } from "./accuracy-judge";
import { pickUrlQuestionId } from "./orchestrator";
import { scoreAffirmedCell } from "./ladder";
import type { CellEnvelope } from "./types";

const REPO = path.resolve(__dirname, "../../../..");
const CELLS: Record<string, string> = {
  eff: "datasets/report-defects/snapshots/2026-11-10-release-check/eff",
  resend: "datasets/report-defects/snapshots/2026-11-10-release-check/resend",
  ugmonk: "datasets/report-defects/snapshots/2026-11-10-release-check/ugmonk",
  rachelqueiroz: "datasets/report-defects/snapshots/2026-11-08-panel-dim6-real/rachelqueiroz",
};

interface Row {
  site: string;
  qid: string;
  modelId: string;
  judge: string | null;
  confirm: string | null;
  compat: string | null;
  /** The specific-facts call output (null: not called or failed). */
  facts?: string | null;
  /** Every contradiction check, in call order (core first, then facts). */
  compats?: string[];
  verdict: string;
}
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "__fixtures__/dev-v6-judge-outputs.json"), "utf8")) as {
  references: Record<string, { verifiable: true; text: string; names: Array<{ text: string; acronym: boolean }>; addresses: { declared: Array<{ street: string; number: string }>; accepted: Array<{ street: string; number: string }> } }>;
  rows: Row[];
};
const labels = fs
  .readFileSync(path.join(REPO, "datasets/judge-labels/dev.jsonl"), "utf8")
  .trim()
  .split(/\r?\n/)
  .map((l) => JSON.parse(l));

/** Fake Workers AI that answers each prompt kind with the recorded output. */
function recordedAi(row: Row) {
  const compats = [...(row.compats ?? (row.compat ? [row.compat] : []))];
  return {
    run: async (_m: string, inputs: { messages: Array<{ content: string }> }) => {
      const p = inputs.messages[0].content;
      const out = p.includes("<quoted-words-")
        ? row.confirm
        : p.includes("<site-words-")
          ? compats.shift() ?? null
          : p.includes("<answer-facts-")
            ? row.facts ?? null
            : row.judge;
      return { response: out ?? "" };
    },
  } as unknown as Ai;
}

const verdictOf = (notes: string, unmeasurable: boolean) =>
  unmeasurable
    ? "UNCLEAR"
    : /misidentified=true|possible_mixup_cut_off=true/.test(notes)
      ? "MIXUP"
      : /facts_contradicted=true/.test(notes)
        ? "WRONG_FACTS"
        : /accuracy=CORRECT/.test(notes)
          ? "CORRECT"
          : /judge=DENY/.test(notes)
            ? "DENY"
            : "UNCLEAR";

async function replayVerdicts(): Promise<Array<{ site: string; qid: string; modelId: string; verdict: string }>> {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const out = [];
  for (const site of Object.keys(CELLS)) {
    const dir = path.join(REPO, CELLS[site]);
    const cells = JSON.parse(fs.readFileSync(path.join(dir, "dim6-cells.json"), "utf8")) as CellEnvelope[];
    const domain = new URL(JSON.parse(fs.readFileSync(path.join(dir, "scan.json"), "utf8")).url).hostname.replace(/^www\./, "");
    const ref = fixture.references[site];
    const facts = { names: ref.names, addresses: ref.addresses };
    const urlQ = pickUrlQuestionId([...new Map(cells.map((c) => [c.query.id, c.query])).values()], domain);
    for (const row of fixture.rows.filter((r) => r.site === site)) {
      const c = cells.find((x) => x.query.id === row.qid && x.modelId === row.modelId)!;
      const text = c.result.text;
      let notes = "unmeasurable";
      let unmeasurable = true;
      if (!(c.result.unmeasurable || !text || /affirmation_failed=true/.test(c.result.notes))) {
        unmeasurable = false;
        const acc: AccuracyVerdict = await judgeAccuracy({ AI: recordedAi(row) }, domain, ref.text, text, { names: ref.names, question: c.query.text });
        const ctx = { urlQuestion: c.query.id === urlQ, domain, siteFacts: facts, question: c.query.text };
        if (/judge=DENY/.test(c.result.notes)) {
          notes = acc.kind === "wrong" || acc.kind === "wrong_facts" ? scoreAffirmedCell(text, `https://${domain}`, [], c.result.truncated, acc, ctx).notes : "score=0/100; judge=DENY";
        } else notes = scoreAffirmedCell(text, `https://${domain}`, [], c.result.truncated, acc, ctx).notes;
      }
      out.push({ site, qid: row.qid, modelId: row.modelId, verdict: verdictOf(notes, unmeasurable) });
    }
  }
  return out;
}

describe("dim6:v6 on the gold dev labels (recorded judge outputs, no model call)", () => {
  it("replays the recorded verdicts exactly and passes every dev gate", async () => {
    const verdicts = await replayVerdicts();
    expect(verdicts).toHaveLength(160);
    const recorded = new Map(fixture.rows.map((r) => [`${r.site}|${r.qid}|${r.modelId}`, r.verdict]));
    const diffs = verdicts.filter((v) => recorded.get(`${v.site}|${v.qid}|${v.modelId}`) !== v.verdict).map((v) => `${v.site} ${v.qid} ${v.modelId} ${v.verdict}`);
    expect(diffs).toEqual([]);
    // The gold scorer, run exactly as the orchestrator runs it (CLI, --json).
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dim6-dev-")), "verdicts.jsonl");
    fs.writeFileSync(tmp, `${verdicts.map((v) => JSON.stringify(v)).join(String.fromCharCode(10))}${String.fromCharCode(10)}`);
    const res = JSON.parse(
      execFileSync(process.execPath, [path.join(REPO, "datasets/judge-labels/score.mjs"), "--judge", tmp, "--labels", path.join(REPO, "datasets/judge-labels/dev.jsonl"), "--json"], { encoding: "utf8" })
    );
    expect(res.answers).toBe(labels.length);
    const m = res.metrics;
    expect(m.false_mixup_accusations.num).toBe(0);
    expect(m.mixup_recall.num).toBe(m.mixup_recall.den);
    expect(m.mixup_recall.den).toBe(11);
    expect(m.correct_precision.strict.pct).toBeGreaterThanOrEqual(95);
    expect(m.contradiction_recall.flagged.pct).toBeGreaterThanOrEqual(90);
    expect(m.clear_cases.coverage.pct).toBeGreaterThanOrEqual(80);
  });
});
