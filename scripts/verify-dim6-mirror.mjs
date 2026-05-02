// Cross-shell-compatible MIRROR diff for Dim 6 disclosure constants.
//
// Per Slice 3b locked decision 10: disclosure copy must stay byte-equal
// across marketing-site (SOT) and mcp-server (mirror). This script reads
// both .ts files as TEXT, extracts the DIM6_DISCLOSURE object literal via
// regex, and diffs the captured string-literal block. No TS compile needed —
// works in any shell that has Node.js installed (PowerShell, bash, zsh).
//
// Exit codes:
//   0 — mirror matches
//   1 — mirror diverges; prints the divergence
//   2 — script error (file not found, regex didn't match, etc.)

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const SOT_PATH = resolve(
  repoRoot,
  "marketing-site/src/lib/dim6/disclosure.ts"
);
const MIRROR_PATH = resolve(repoRoot, "mcp-server/src/dim6-disclosure.ts");

// Capture from `export const DIM6_DISCLOSURE = {` through the matching
// `} as const;`. The block is balanced-brace-free under our coding style
// (no nested object literals inside DIM6_DISCLOSURE at this time).
const BLOCK_RE = /export const DIM6_DISCLOSURE = \{([\s\S]*?)\} as const;/;

async function extractBlock(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    console.error(`[verify-dim6-mirror] cannot read ${path}: ${e.message}`);
    process.exit(2);
  }
  const m = BLOCK_RE.exec(text);
  if (!m) {
    console.error(
      `[verify-dim6-mirror] could not find DIM6_DISCLOSURE block in ${path}`
    );
    process.exit(2);
  }
  return m[1].trim();
}

const sot = await extractBlock(SOT_PATH);
const mirror = await extractBlock(MIRROR_PATH);

if (sot === mirror) {
  console.log("[verify-dim6-mirror] OK — DIM6_DISCLOSURE matches across SOT + mirror.");
  process.exit(0);
}

// Divergence — show first 200 chars of each, plus the first differing line.
console.error("[verify-dim6-mirror] MIRROR DIVERGENCE");
const sotLines = sot.split("\n");
const mirrorLines = mirror.split("\n");
const max = Math.max(sotLines.length, mirrorLines.length);
for (let i = 0; i < max; i++) {
  if (sotLines[i] !== mirrorLines[i]) {
    console.error(`  first diff at line ${i + 1}:`);
    console.error(`    SOT:    ${(sotLines[i] ?? "<missing>").slice(0, 160)}`);
    console.error(`    MIRROR: ${(mirrorLines[i] ?? "<missing>").slice(0, 160)}`);
    break;
  }
}
process.exit(1);
