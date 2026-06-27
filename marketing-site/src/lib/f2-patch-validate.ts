// F2-VALIDATE-1 — structural + encoding integrity validator for the assembled
// git-am patch, run as a FAIL-CLOSED gate in impl-fulfill before delivery.
//
// Pure function: no I/O, no git binary (the Worker can't run git). It re-derives
// the git-am invariants the assembler (lib/f2-patch-assembler.ts) is supposed to
// satisfy, on the in-memory assembled `patchContent` string.
//
// Threat model (honest): the 5 generators are deterministic-only in v1.0
// (callModel hardcoded null), so today this is (a) a regression tripwire for when
// LLM generation is wired on, and (b) customer-input sanitization (a brand/domain
// /competitor string carrying control chars or replacement chars flowing into the
// patch). Hunk-count drift is already correct-by-construction in the assembler; the
// CI git-am test guards assembler regressions. The runtime gate is defense-in-depth.
//
// API note: `patch` is a JS string (the in-memory assembled patchContent, NOT an
// R2 re-fetch), so encoding checks are string-level (U+FFFD / mojibake signatures /
// disallowed control chars), not raw-byte UTF-8 validation.

const SENTINEL =
  "From 0000000000000000000000000000000000000000 Mon Sep 17 00:00:00 2001";

// Multi-char mojibake sequences (UTF-8 mis-decoded as Latin-1). Deliberately
// multi-char — we do NOT flag bare high-Latin chars (e.g. "Ã", "ã"), which are
// legitimate in customer brand names (Portuguese/Brazilian etc.). Only U+FFFD,
// disallowed C0 controls, and these specific sequences are rejected.
const MOJIBAKE_SIGNATURES = ["Ã¢â‚¬", "Ã¢â¬", "ÃƒÂ", "â€™", "â€œ", "Ã‚Â"];

// C0 controls + DEL, EXCEPT \t (\x09) and \n (\x0A). Disallowed anywhere in the
// patch (includes \r — the assembler is LF-only, so a CR signals contamination).
const DISALLOWED_CTRL = /[\x00-\x08\x0B-\x1F\x7F]/;
// Paths must contain no control chars at all (incl. \t / \n).
const PATH_CTRL = /[\x00-\x1F\x7F]/;

export function validateGitAmPatch(
  patch: string,
  expectedFiles: string[],
): { ok: true } | { ok: false; failures: string[] } {
  const failures: string[] = [];

  // ── Encoding + control chars (whole patch) ──────────────────────────────
  if (patch.includes("�")) {
    failures.push("patch:encoding:U+FFFD replacement char present");
  }
  for (const sig of MOJIBAKE_SIGNATURES) {
    if (patch.includes(sig)) {
      failures.push(`patch:encoding:mojibake signature ${JSON.stringify(sig)}`);
    }
  }
  const ctrl = DISALLOWED_CTRL.exec(patch);
  if (ctrl) {
    const cp = `U+${ctrl[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
    const line = patch.slice(0, ctrl.index).split("\n").length;
    failures.push(`patch:control-char:${cp}@line${line}`);
  }

  const lines = patch.split("\n");

  // ── Mailbox header ──────────────────────────────────────────────────────
  if (lines[0] !== SENTINEL) {
    failures.push("patch:mailbox:missing/!= git-am sentinel envelope line");
  }
  const sepIdx = lines.indexOf("---");
  if (sepIdx === -1) {
    failures.push("patch:mailbox:no `---` body/diff separator");
  }
  const headerRegion = sepIdx === -1 ? lines.slice(0, 5) : lines.slice(0, sepIdx);
  for (const h of ["From:", "Date:", "Subject:"]) {
    if (!headerRegion.some((l) => l.startsWith(h))) {
      failures.push(`patch:mailbox:missing ${h} header`);
    }
  }
  if (!lines.some((l) => l === "-- ")) {
    failures.push("patch:mailbox:missing `-- ` signature trailer");
  }

  // ── Per-file diff blocks (only parse if we found the separator) ─────────
  const seenPaths: string[] = [];
  if (sepIdx !== -1) {
    const body = lines.slice(sepIdx + 1);
    let i = 0;
    while (i < body.length) {
      const line = body[i];
      if (line.startsWith("-- ")) break; // trailer
      if (!line.startsWith("diff --git ")) {
        i++;
        continue;
      }
      // Expect the canonical new-file block shape (6 header lines).
      const block = body.slice(i, i + 6);
      const pathMatch = /^\+\+\+ b\/(.+)$/.exec(block[4] ?? "");
      const path = pathMatch?.[1];
      const label = path ?? `block@${i}`;

      if (!/^new file mode 100644$/.test(block[1] ?? "")) {
        failures.push(`${label}:all-additions:missing "new file mode 100644"`);
      }
      if (!/^index /.test(block[2] ?? "")) {
        failures.push(`${label}:diff:missing index line`);
      }
      if (block[3] !== "--- /dev/null") {
        failures.push(`${label}:all-additions:missing "--- /dev/null" (not a new-file block)`);
      }
      if (!pathMatch) {
        failures.push(`${label}:diff:missing "+++ b/<path>" line`);
      }
      const hunkMatch = /^@@ -0,0 \+1,(\d+) @@$/.exec(block[5] ?? "");
      if (!hunkMatch) {
        failures.push(`${label}:diff:missing/malformed "@@ -0,0 +1,N @@" hunk header`);
        i += 6;
        continue;
      }
      const declaredN = parseInt(hunkMatch[1], 10);

      // Count consecutive `+`-prefixed body lines after the hunk header.
      let j = i + 6;
      let plusCount = 0;
      while (j < body.length && body[j].startsWith("+")) {
        plusCount++;
        j++;
      }
      if (j < body.length && body[j] === "\\ No newline at end of file") {
        j++;
      }
      if (plusCount !== declaredN) {
        failures.push(
          `${label}:hunk-count:declared N=${declaredN} but found ${plusCount} +lines`,
        );
      }

      if (path) {
        if (path.startsWith("/")) failures.push(`${path}:path:leading slash`);
        if (path.includes("..")) failures.push(`${path}:path:".." traversal`);
        if (PATH_CTRL.test(path)) failures.push(`${path}:path:control char`);
        seenPaths.push(path);
      }
      i = j;
    }
  }

  // ── Path uniqueness + file-set coherence ────────────────────────────────
  const dupes = seenPaths.filter((p, idx) => seenPaths.indexOf(p) !== idx);
  for (const d of new Set(dupes)) failures.push(`${d}:path:duplicate`);

  const seenSorted = [...seenPaths].sort();
  const expectedSorted = [...expectedFiles].sort();
  if (
    seenSorted.length !== expectedSorted.length ||
    seenSorted.some((p, idx) => p !== expectedSorted[idx])
  ) {
    failures.push(
      `patch:file-set:diff paths [${seenSorted.join(",")}] != expected [${expectedSorted.join(",")}]`,
    );
  }

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
