#!/usr/bin/env node
// Operator script (dataset spec v2 §3, decision 5: Bruno codes by hand).
//
// Lists Audit intake records in the remote SESSIONS KV namespace that still
// hold raw free text, shows each note, asks for zero or more codes from the
// pain taxonomy, then rewrites the record with `notes_codes` + coded_by
// "human" and WITHOUT `notes`, keeping the key's existing absolute expiration.
// If the text holds sensitive data, enter no codes: the note is still deleted.
//
// Usage (from marketing-site/, logged in with `npx wrangler login`):
//   node scripts/code-intake-notes.mjs
//
// wrangler is spawned as `node <wrangler.js> ...args` with an args array, no
// shell, so record content is never interpreted by a shell. Notes are shown
// with control characters neutralized and never written anywhere else.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  INTAKE_NOTE_CODES,
  applyNoteCoding,
  parseNoteCodes,
  terminalSafe,
} from "../src/lib/dataset-intake.ts";

const require = createRequire(import.meta.url);
const WRANGLER = join(dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
const PREFIX = "intake:audit:";
const MIN_REMAINING_SEC = 60;

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER, ...args, "--binding", "SESSIONS", "--remote"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function main() {
  const keys = JSON.parse(wrangler(["kv", "key", "list", "--prefix", PREFIX]));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`Codes:\n  ${INTAKE_NOTE_CODES.join("\n  ")}\n`);
  let coded = 0;
  for (const { name, expiration } of keys) {
    if (typeof name !== "string" || !name.startsWith(PREFIX)) continue;
    let record;
    try {
      record = JSON.parse(wrangler(["kv", "key", "get", name, "--text"]));
    } catch {
      console.log(`${name}: unreadable, skipped`);
      continue;
    }
    if (typeof record.notes !== "string" || record.notes.length === 0) continue;
    if (typeof expiration !== "number" || expiration - Date.now() / 1000 <= MIN_REMAINING_SEC) {
      console.log(`${name}: expires within a minute, skipped (the note expires with it)`);
      continue;
    }
    console.log(`\n=== ${name}`);
    console.log(`answers: ${terminalSafe(JSON.stringify(record.answers ?? {}))}`);
    console.log(`notes:\n${terminalSafe(record.notes)}\n`);
    let codes;
    for (;;) {
      const answer = await rl.question("codes (comma/space separated, empty = none, 's' = skip): ");
      if (answer.trim() === "s") break;
      const parsed = parseNoteCodes(answer);
      if (parsed.ok) {
        codes = parsed.codes;
        break;
      }
      console.log(`unknown: ${terminalSafe(parsed.unknown.join(", "))}`);
    }
    if (!codes) continue;
    const next = applyNoteCoding(record, codes);
    wrangler(["kv", "key", "put", name, JSON.stringify(next), "--expiration", String(expiration)]);
    coded++;
    console.log(`${name}: coded [${codes.join(", ")}], notes removed`);
  }
  rl.close();
  console.log(`\nDone: ${coded} record(s) coded.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
