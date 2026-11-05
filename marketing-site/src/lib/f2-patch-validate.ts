// F2-VALIDATE-1 — fail-closed integrity gate for the assembled git-am patch,
// run in impl-fulfill BEFORE probe-target enrollment and the delivery email.
//
// Pure function: no I/O, no git binary (the Worker cannot run git). It is a
// strict re-parser of the exact shape lib/f2-patch-assembler.ts emits: anything
// that is not that shape fails. The CI layer (f2-patch-assembler.test.ts)
// applies the same shapes with real `git am`, so the two layers cannot drift
// silently.
//
// Threat model: file contents are partly LLM-generated per customer, and the
// customer's domain / brand flow into the mail headers and commit body. Treat
// the whole patch as hostile. The gate defends against:
//   - patches git am rejects (hunk-count drift, broken mailbox, bad trailer)
//   - patches git am ACCEPTS but that do something we never meant to ship:
//     paths escaping the repo or writing into .git, symlink / executable modes,
//     header or in-body-header injection, mbox splits, scissors lines,
//     Trojan-Source bidi controls, invalid UTF-8.
//
// Output discipline: `failures` carry a fixed category plus numeric locators
// only (file #, line #) — never patch text, paths or customer values — so they
// are safe to log, store in failed_reason and put in an operator alert.

export type PatchFailureCategory =
  | "size"
  | "encoding"
  | "control_char"
  | "bidi_control"
  | "mailbox_envelope"
  | "mailbox_header"
  | "mailbox_body"
  | "mailbox_trailer"
  | "diff_structure"
  | "file_mode"
  | "hunk_count"
  | "path_unsafe"
  | "path_duplicate"
  | "path_collision"
  | "file_set"
  | "validator_error";

export type PatchValidation =
  | { ok: true }
  | { ok: false; categories: PatchFailureCategory[]; failures: string[] };

const SENTINEL =
  "From 0000000000000000000000000000000000000000 Mon Sep 17 00:00:00 2001";
const AUTHOR_LINE = "From: Astrant <implementation@astrant.io>";
const DATE_LINE =
  /^Date: (Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) \+0000$/;
const SUBJECT_PREFIX = "Subject: [PATCH] ";
const NO_NEWLINE_MARKER = "\\ No newline at end of file";

// Resend caps a message at 40 MB including base64 overhead; the real patch is
// tens of KB. Anything near this is not a patch we generated.
export const MAX_PATCH_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 64;
const MAX_PATH_LEN = 200;
const MAX_HEADER_LINE = 998; // RFC 5322 line limit

// Multi-char mojibake sequences (UTF-8 mis-decoded as CP1252/Latin-1).
// Deliberately multi-char — bare high-Latin chars ("Ã", "ã") are legitimate in
// customer brand names (Portuguese/Brazilian etc.).
const MOJIBAKE_SIGNATURES = ["Ã¢â‚¬", "Ã¢â¬", "ÃƒÂ", "â€™", "â€œ", "Ã‚Â"];

// C0 controls + DEL except \t and \n (CR included: the assembler is LF-only, so
// a CR is header-injection or contamination), plus C1 controls.
const DISALLOWED_CTRL = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/;
// Bidi controls (CVE-2021-42574 "Trojan Source"): they make generated code
// read differently from how it executes. The full Unicode Bidi_Control set,
// marks included (U+061C, U+200E, U+200F, U+202A-202E, U+2066-2069).
const BIDI_CTRL = new RegExp(
  `[${[0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]
    .map((cp) => String.fromCharCode(cp))
    .join("")}]`,
);
// Built from code points: escape sequences in source have been silently
// turned into raw invisible characters by tooling before.
const BOM = String.fromCharCode(0xfeff);
// git mailinfo scissors marks (0x2702 is the scissors glyph).
const SCISSORS_MARKS = [">8", "8<", ">%", "%<", String.fromCharCode(0x2702)];
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// One path segment: a conservative ASCII allowlist. Every path the pipeline
// emits is a code constant, so this costs nothing and rules out quoting,
// whitespace, backslashes, drive letters, and non-ASCII lookalikes.
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
// Windows device names (with or without an extension) break checkout there.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

class Collector {
  private cats = new Set<PatchFailureCategory>();
  readonly failures: string[] = [];
  add(cat: PatchFailureCategory, detail: string) {
    this.cats.add(cat);
    if (this.failures.length < 50) this.failures.push(`${cat}:${detail}`);
  }
  get categories(): PatchFailureCategory[] {
    return [...this.cats];
  }
  get empty() {
    return this.cats.size === 0;
  }
}

export function validateGitAmPatch(
  patch: string | Uint8Array,
  expectedFiles: readonly string[],
): PatchValidation {
  const c = new Collector();
  try {
    run(patch, expectedFiles, c);
  } catch {
    c.add("validator_error", "threw");
  }
  return c.empty ? { ok: true } : { ok: false, categories: c.categories, failures: c.failures };
}

function run(input: string | Uint8Array, expectedFiles: readonly string[], c: Collector): void {
  // ── Bytes → text (strict UTF-8) ─────────────────────────────────────────
  let patch: string;
  if (typeof input === "string") {
    if (LONE_SURROGATE.test(input)) {
      c.add("encoding", "lone surrogate (not encodable as UTF-8)");
      return;
    }
    patch = input;
    if (new TextEncoder().encode(patch).byteLength > MAX_PATCH_BYTES) {
      c.add("size", "patch exceeds limit");
      return;
    }
  } else {
    if (input.byteLength > MAX_PATCH_BYTES) {
      c.add("size", "patch exceeds limit");
      return;
    }
    try {
      patch = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
    } catch {
      c.add("encoding", "invalid UTF-8 byte sequence");
      return;
    }
  }

  // ── Whole-patch character checks ────────────────────────────────────────
  if (patch.includes(BOM)) c.add("encoding", "byte-order mark present");
  if (patch.includes(REPLACEMENT_CHAR)) c.add("encoding", "U+FFFD replacement char present");
  for (const sig of MOJIBAKE_SIGNATURES) {
    if (patch.includes(sig)) {
      c.add("encoding", "mojibake signature");
      break;
    }
  }
  const ctrl = DISALLOWED_CTRL.exec(patch);
  if (ctrl) {
    const cp = ctrl[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
    c.add("control_char", `U+${cp}@line${lineOf(patch, ctrl.index)}`);
  }
  const bidi = BIDI_CTRL.exec(patch);
  if (bidi) c.add("bidi_control", `@line${lineOf(patch, bidi.index)}`);

  if (!patch.endsWith("\n")) {
    c.add("mailbox_trailer", "patch does not end with a newline");
  }
  const lines = patch.split("\n");
  if (patch.endsWith("\n")) lines.pop(); // the "" after the final LF

  // ── Envelope + headers (fixed positions; no folding, no extra headers) ──
  if (lines[0] !== SENTINEL) c.add("mailbox_envelope", "line1 is not the git-am From sentinel");
  if (lines[1] !== AUTHOR_LINE) c.add("mailbox_header", "line2 is not the fixed From: author");
  if (!validDateLine(lines[2] ?? "")) c.add("mailbox_header", "line3 is not a valid RFC 2822 UTC Date:");
  const subject = lines[3] ?? "";
  if (!subject.startsWith(SUBJECT_PREFIX) || subject.length <= SUBJECT_PREFIX.length) {
    c.add("mailbox_header", "line4 is not a [PATCH] Subject:");
  } else {
    if (subject.length > MAX_HEADER_LINE) c.add("mailbox_header", "Subject: too long");
    // RFC 2047 encoded-words are decoded by git mailinfo and can smuggle a
    // newline or other headers back in.
    if (subject.includes("=?")) c.add("mailbox_header", "Subject: contains an encoded-word");
    if (/\s$/.test(subject)) c.add("mailbox_header", "Subject: trailing whitespace");
  }
  if (lines[4] !== "") c.add("mailbox_header", "no blank line ends the header block (header injection?)");

  // ── Commit message body: lines 6..(first "---") ─────────────────────────
  const sepIdx = lines.indexOf("---", 5);
  if (sepIdx === -1) {
    c.add("mailbox_body", "no `---` message/diff separator");
    return;
  }
  // ALLOWLIST, not a blocklist: git mailinfo has many body forms with meaning
  // (patch starts "diff -", "Index: ", "--- ", "+++ "; in-body headers after
  // "[PATCH]" or blank lines; scissors with 8< >8 %< >% and the scissors
  // glyph; continuation lines). The assembler's body lines are all either
  // blank or start with an ASCII letter/digit, so require exactly that; then
  // reject the few letter-initial forms git still treats specially.
  if (sepIdx === 5 || lines[5] === "") c.add("mailbox_body", "commit body starts blank or is empty");
  for (let k = 5; k < sepIdx; k++) {
    const l = lines[k];
    const at = `line${k + 1}`;
    if (l.length > MAX_HEADER_LINE) c.add("mailbox_body", `${at} too long`);
    if (l !== "" && !/^[A-Za-z0-9]/.test(l)) {
      c.add("mailbox_body", `${at} does not start with a letter or digit`);
      continue;
    }
    // git mailinfo starts the patch at the first "diff -" / "Index: " line.
    if (/^diff\s/.test(l) || /^Index:/.test(l)) c.add("mailbox_body", `${at} would start the diff early`);
    // git mailsplit cuts a new message at an mbox "From " line.
    if (l.startsWith("From ")) c.add("mailbox_body", `${at} looks like an mbox From line`);
    if (SCISSORS_MARKS.some((m) => l.includes(m))) c.add("mailbox_body", `${at} could be a scissors line`);
  }
  // The first body line is read as an in-body header if it is header-shaped.
  if (/^[A-Za-z][A-Za-z0-9-]*\s*:/.test(lines[5] ?? "")) {
    c.add("mailbox_body", "first body line would be read as an in-body header");
  }

  // ── Diff blocks: a strict sequence up to the `-- ` trailer ──────────────
  const seenPaths: string[] = [];
  let k = sepIdx + 1;
  let fileNo = 0;
  while (k < lines.length && lines[k] !== "-- ") {
    fileNo++;
    if (fileNo > MAX_FILES) {
      c.add("diff_structure", "too many files");
      return;
    }
    const tag = `file#${fileNo}`;
    if (!lines[k].startsWith("diff --git ")) {
      c.add("diff_structure", `${tag} expected "diff --git" header@line${k + 1}`);
      return; // cannot resynchronise safely
    }
    const plus = lines[k + 4] ?? "";
    const path = plus.startsWith("+++ b/") ? plus.slice("+++ b/".length) : null;
    if (path === null) {
      c.add("diff_structure", `${tag} missing "+++ b/<path>"`);
      return;
    }
    if (lines[k] !== `diff --git a/${path} b/${path}`) {
      c.add("diff_structure", `${tag} diff --git paths disagree with +++`);
    }
    if (lines[k + 1] !== "new file mode 100644") {
      c.add("file_mode", `${tag} not "new file mode 100644"`);
    }
    if (!/^index 0{7}\.\.[0-9a-f]{7,40}$/.test(lines[k + 2] ?? "")) {
      c.add("diff_structure", `${tag} bad index line`);
    }
    if (lines[k + 3] !== "--- /dev/null") {
      c.add("diff_structure", `${tag} not a new-file block ("--- /dev/null")`);
    }
    const hunk = /^@@ -0,0 \+1(?:,(\d{1,7}))? @@$/.exec(lines[k + 5] ?? "");
    if (!hunk) {
      c.add("diff_structure", `${tag} missing/malformed "@@ -0,0 +1,N @@"`);
      return;
    }
    const declared = hunk[1] === undefined ? 1 : parseInt(hunk[1], 10);
    if (declared < 1) {
      c.add("hunk_count", `${tag} declares zero lines`);
      return;
    }
    let j = k + 6;
    let counted = 0;
    while (counted < declared && j < lines.length && lines[j].startsWith("+")) {
      counted++;
      j++;
    }
    if (counted !== declared) {
      c.add("hunk_count", `${tag} declared ${declared}, found ${counted}`);
      return;
    }
    if (lines[j] === NO_NEWLINE_MARKER) j++;
    const next = lines[j];
    if (next !== undefined && next !== "-- " && !next.startsWith("diff --git ")) {
      // e.g. more "+" lines than declared, or junk between blocks.
      c.add("hunk_count", `${tag} unexpected line after hunk@line${j + 1}`);
      return;
    }
    checkPath(path, tag, c);
    seenPaths.push(path);
    k = j;
  }
  if (fileNo === 0) c.add("diff_structure", "no diff blocks");

  // ── Trailer: exactly "-- ", a version line, end of patch ────────────────
  if (lines[k] !== "-- ") {
    c.add("mailbox_trailer", "missing `-- ` signature delimiter");
  } else if (!/^\d+(\.\d+)+$/.test(lines[k + 1] ?? "") || k + 2 !== lines.length) {
    c.add("mailbox_trailer", "signature is not exactly a version line");
  }

  // ── Path set ────────────────────────────────────────────────────────────
  checkPathSet(seenPaths, c);
  const seenSorted = [...seenPaths].sort();
  const expectedSorted = [...expectedFiles].sort();
  if (
    seenSorted.length !== expectedSorted.length ||
    seenSorted.some((p, idx) => p !== expectedSorted[idx])
  ) {
    c.add("file_set", `patch has ${seenSorted.length} files, expected ${expectedSorted.length}, or names differ`);
  }
}

function checkPath(path: string, tag: string, c: Collector): void {
  if (path.length === 0 || path.length > MAX_PATH_LEN) {
    c.add("path_unsafe", `${tag} empty or too long`);
    return;
  }
  for (const seg of path.split("/")) {
    if (seg === "" || seg === "." || seg === "..") {
      c.add("path_unsafe", `${tag} absolute, empty or dot segment`);
      return;
    }
    if (!SEGMENT.test(seg)) {
      c.add("path_unsafe", `${tag} disallowed characters`);
      return;
    }
    const lower = seg.toLowerCase();
    // .git (any case) — plus the NTFS 8.3 alias and trailing-dot forms.
    if (lower === ".git" || lower === "git~1" || /^\.git\.+$/.test(lower)) {
      c.add("path_unsafe", `${tag} writes into .git`);
      return;
    }
    if (seg.endsWith(".")) {
      c.add("path_unsafe", `${tag} segment ends with a dot`);
      return;
    }
    if (WINDOWS_RESERVED.test(seg)) {
      c.add("path_unsafe", `${tag} Windows reserved name`);
      return;
    }
  }
}

function checkPathSet(paths: string[], c: Collector): void {
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  for (const p of paths) {
    if (exact.has(p)) {
      c.add("path_duplicate", `duplicate path (file #${paths.indexOf(p) + 1})`);
      continue;
    }
    exact.add(p);
    const f = p.toLowerCase();
    if (folded.has(f)) c.add("path_collision", "paths differ only by case");
    folded.set(f, p);
  }
  // A file and a directory of the same name cannot both exist (case-folded,
  // since customers check out on macOS/Windows too).
  for (const f of folded.keys()) {
    const parts = f.split("/");
    for (let n = 1; n < parts.length; n++) {
      if (folded.has(parts.slice(0, n).join("/"))) {
        c.add("path_collision", "a file path is also used as a directory");
        return;
      }
    }
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Shape AND value: git's date parser rejects e.g. day 99 or hour 99.
function validDateLine(line: string): boolean {
  const m = DATE_LINE.exec(line);
  if (!m) return false;
  const [, wd, dd, mon, yyyy, hh, mi, ss] = m;
  const y = +yyyy, mo = MONTHS.indexOf(mon), d = +dd, h = +hh, n = +mi, s = +ss;
  if (y < 2000 || y > 2100 || h > 23 || n > 59 || s > 59) return false;
  const t = new Date(Date.UTC(y, mo, d, h, n, s));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo &&
    t.getUTCDate() === d &&
    WEEKDAYS[t.getUTCDay()] === wd
  );
}

function lineOf(s: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}
