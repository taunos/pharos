#!/usr/bin/env node
// Turns the old judge's verdicts (result.notes in dim6-cells.json) into a score.mjs judge file.
//   node datasets/judge-labels/extract-old-judge.mjs <site>=<path/to/dim6-cells.json> [...] > old-judge.jsonl
// notes look like "score=0/100; judge=DENY" or "score=..; judge=AFFIRM; accuracy=WRONG; misidentified=true".
// DENY → DENY · AFFIRM+CORRECT → CORRECT · AFFIRM+WRONG ("mixed up your site with a different person or business") → MIXUP · AFFIRM+UNCLEAR → UNCLEAR.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function verdictFromNotes(notes) {
  const n = String(notes ?? "");
  const judge = (n.match(/judge=(\w+)/) || [])[1];
  const acc = (n.match(/accuracy=(\w+)/) || [])[1];
  if (judge === "DENY") return "DENY";
  if (judge === "AFFIRM" && acc === "CORRECT") return "CORRECT";
  if (judge === "AFFIRM" && acc === "WRONG") return "MIXUP";
  if (judge === "AFFIRM" && acc === "UNCLEAR") return "UNCLEAR";
  throw new Error(`unrecognised notes: ${n}`);
}

export function extract(site, cells) {
  return cells.map((c) => ({ site, qid: c.query.id, modelId: c.modelId, verdict: verdictFromNotes(c.result.notes) }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const rows = [];
  for (const arg of process.argv.slice(2)) {
    const i = arg.indexOf("=");
    if (i < 1) throw new Error(`expected <site>=<path>, got ${arg}`);
    rows.push(...extract(arg.slice(0, i), JSON.parse(fs.readFileSync(arg.slice(i + 1), "utf8"))));
  }
  process.stdout.write(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
