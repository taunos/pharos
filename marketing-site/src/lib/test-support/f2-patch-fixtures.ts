// F2-VALIDATE-1 — shared patch fixtures for the runtime-validator unit tests
// (f2-patch-validate.test.ts) and the real-`git am` CI layer
// (f2-patch-assembler.test.ts), so both layers judge the same bytes.

import { assembleGitAmPatch } from "../f2-patch-assembler";
import type { PatchFailureCategory } from "../f2-patch-validate";

export const FIXED_TIME = new Date("2026-06-27T00:00:00Z");

export function assemble(
  files: Record<string, string>,
  domain = "https://acme.example",
): string {
  return assembleGitAmPatch({
    customer_domain: domain,
    customer_email: "dev@acme.example",
    session_id: "impl-test",
    fulfillment_time: FIXED_TIME,
    files,
  });
}

// ── Hand-built patches (for shapes the assembler can never emit) ───────────

const NO_NL = "\\ No newline at end of file";

export function block(
  path: string,
  lines: string[],
  opts: { declared?: number; mode?: string; plusPath?: string; noNewline?: boolean } = {},
): string {
  const out = [
    `diff --git a/${path} b/${path}`,
    `new file mode ${opts.mode ?? "100644"}`,
    `index 0000000..0000001`,
    `--- /dev/null`,
    `+++ b/${opts.plusPath ?? path}`,
    `@@ -0,0 +1,${opts.declared ?? lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ];
  if (opts.noNewline) out.push(NO_NL);
  return out.join("\n") + "\n";
}

export function rawPatch(
  blocks: string[],
  opts: { subject?: string; body?: string[]; trailer?: string } = {},
): string {
  return [
    "From 0000000000000000000000000000000000000000 Mon Sep 17 00:00:00 2001",
    "From: Astrant <implementation@astrant.io>",
    "Date: Sat, 27 Jun 2026 00:00:00 +0000",
    `Subject: ${opts.subject ?? "[PATCH] astrant implementation — acme.example"}`,
    "",
    ...(opts.body ?? ["Astrant Implementation patch for acme.example."]),
    "---",
  ].join("\n") + "\n" + blocks.join("") + (opts.trailer ?? "-- \n2.40.0\n");
}

// ── Representative + edge-case inputs that MUST validate and apply ────────

export const REPRESENTATIVE: Record<string, string> = {
  "public/llms.txt": "# Acme\n\n> Acme provides Developer Tools services.\n",
  "public/openapi.yaml": "openapi: 3.1.0\ninfo:\n  title: Acme API\npaths: {}\n",
  "app/layout-jsonld.html": '<!-- astrant-jsonld:begin -->\n<script>{}</script>\n<!-- astrant-jsonld:end -->\n',
  "mcp-server/index.ts": "export default { async fetch() { return new Response('ok'); } };\n",
  "mcp-server/wrangler.jsonc": '{\n  "name": "acme-mcp"\n}\n',
  "mcp-server/package.json": '{\n  "name": "acme-mcp",\n  "version": "0.1.0"\n}\n',
  "mcp-server/README.md": "# Acme MCP Server\n\nDeploy with wrangler.\n",
  "monitoring/check-llms-txt.sh": "#!/usr/bin/env bash\nset -euo pipefail\necho ok\n",
  "monitoring/check-mcp-server.sh": "#!/usr/bin/env bash\nset -euo pipefail\necho ok\n",
  "ASTRANT_IMPLEMENTATION.md": "# Acme — Astrant Implementation\n\nApply with git am.\n",
};

export const GOOD_FIXTURES: { name: string; files: Record<string, string>; domain?: string }[] = [
  { name: "representative 10-file set", files: REPRESENTATIVE },
  { name: "no-trailing-newline content", files: { "public/llms.txt": "# Acme\nno final newline" } },
  { name: "unicode / em-dash content", files: { "ASTRANT_IMPLEMENTATION.md": "# Acme — São Paulo café\n\nNaïve — résumé.\n" } },
  {
    name: "wide unicode: emoji, CJK, RTL letters, NBSP, combining marks",
    files: { "public/llms.txt": "# 🚀 Acme 株式会社\n\nשלום · مرحبا\nnon\u00A0breaking · e\u0301\n" },
  },
  { name: "unicode with no trailing newline", files: { "public/llms.txt": "ünïcödé — 終" } },
  { name: "very long line", files: { "public/llms.txt": "x".repeat(5000) + "\n" } },
  { name: "content line beginning with 'From '", files: { "public/llms.txt": "From the Acme team\nhello\n" } },
  {
    name: "content lines that mimic patch/mailbox structure",
    files: {
      "public/llms.txt": [
        "-- ",
        "---",
        "diff --git a/x b/x",
        "@@ -0,0 +1,1 @@",
        NO_NL,
        "From 0000000000000000000000000000000000000000 Mon Sep 17 00:00:00 2001",
        "Subject: [PATCH] nope",
        "-- >8 --",
        "+++ b/evil",
        "",
      ].join("\n"),
    },
  },
  { name: "special chars in content", files: { "mcp-server/index.ts": "const s = `${x}` + \"q'q\" + '$ & < >';\n" } },
  {
    name: "multiple mcp-server files",
    files: {
      "mcp-server/index.ts": "export default {};\n",
      "mcp-server/wrangler.jsonc": "{}\n",
      "mcp-server/package.json": "{}\n",
      "mcp-server/README.md": "# x\n",
    },
  },
  { name: "empty file", files: { "public/llms.txt": "" } },
  { name: "single newline", files: { "public/llms.txt": "\n" } },
  { name: "only blank lines", files: { "public/llms.txt": "\n\n\n" } },
  { name: "whitespace only, no newline", files: { "public/llms.txt": "   " } },
  { name: "tab + trailing whitespace lines", files: { "public/llms.txt": "\t\n  \nend  \n" } },
  {
    name: "mix of empty-ish files alongside normal ones",
    files: { "a/empty.txt": "", "a/nl.txt": "\n", "b/normal.md": "# ok\n", "b/nonl.md": "x" },
  },
  { name: "unicode (IDN) domain in subject + body", files: { "public/llms.txt": "# x\n" }, domain: "https://café-münchen.example" },
  { name: "odd but valid domain", files: { "public/llms.txt": "# x\n" }, domain: "https://sub.example.co.uk" },
];

// ── Adversarial patches: each looks plausible (and most pass a naive
// "has From/Subject/--- and a hunk header" check), but must be rejected. ────
//
// `git` records what REAL `git am` does with it (verified in CI):
//   "rejects"   — git am fails; the gate saves us from sending a broken patch.
//   "accepts"   — git am applies it! Only the runtime gate stops it.
//   "unchecked" — platform-dependent or not meaningful to apply.

export interface AdversarialCase {
  name: string;
  patch: string | Uint8Array;
  expected: string[];
  category: PatchFailureCategory;
  git: "rejects" | "accepts" | "unchecked";
}

const ok1 = block("a.txt", ["x", "y"]);

export const ADVERSARIAL: AdversarialCase[] = [
  {
    name: "hunk count too large (eats the next file's header)",
    patch: rawPatch([block("a.txt", ["x", "y"], { declared: 3 }), block("b.txt", ["z"])]),
    expected: ["a.txt", "b.txt"],
    category: "hunk_count",
    git: "rejects",
  },
  {
    name: "hunk count too small (git silently truncates the file)",
    patch: rawPatch([block("a.txt", ["x", "y", "z"], { declared: 2 })]),
    expected: ["a.txt"],
    category: "hunk_count",
    git: "accepts",
  },
  {
    name: "hunk count too small before another file",
    patch: rawPatch([block("a.txt", ["x", "y", "z"], { declared: 2 }), block("b.txt", ["z"])]),
    expected: ["a.txt", "b.txt"],
    category: "hunk_count",
    git: "accepts",
  },
  {
    name: "hunk header with zero lines",
    patch: rawPatch([block("a.txt", [], { declared: 0 })]),
    expected: ["a.txt"],
    category: "hunk_count",
    git: "unchecked",
  },
  {
    name: "path traversal ../",
    patch: rawPatch([block("../escape.txt", ["x"])]),
    expected: ["../escape.txt"],
    category: "path_unsafe",
    git: "rejects",
  },
  {
    name: "nested traversal a/../../",
    patch: rawPatch([block("a/../../escape.txt", ["x"])]),
    expected: ["a/../../escape.txt"],
    category: "path_unsafe",
    git: "rejects",
  },
  {
    name: "absolute path",
    patch: rawPatch([block("/tmp/abs.txt", ["x"])]),
    expected: ["/tmp/abs.txt"],
    category: "path_unsafe",
    git: "rejects",
  },
  {
    name: "Windows drive path",
    patch: rawPatch([block("C:/Windows/evil.txt", ["x"])]),
    expected: ["C:/Windows/evil.txt"],
    category: "path_unsafe",
    git: "unchecked",
  },
  {
    name: "backslash path",
    patch: rawPatch([block("a\\..\\..\\evil.txt", ["x"])]),
    expected: ["a\\..\\..\\evil.txt"],
    category: "path_unsafe",
    git: "unchecked",
  },
  {
    name: "writes into .git/hooks",
    patch: rawPatch([block(".git/hooks/post-commit", ["#!/bin/sh", "echo pwned"])]),
    expected: [".git/hooks/post-commit"],
    category: "path_unsafe",
    git: "rejects",
  },
  {
    name: "writes into .GIT (case variant)",
    patch: rawPatch([block("sub/.GIT/config", ["x"])]),
    expected: ["sub/.GIT/config"],
    category: "path_unsafe",
    git: "unchecked",
  },
  {
    name: "symlink mode 120000",
    patch: rawPatch([block("link", ["../../../etc/passwd"], { mode: "120000", noNewline: true })]),
    expected: ["link"],
    category: "file_mode",
    git: "accepts",
  },
  {
    name: "executable mode 100755",
    patch: rawPatch([block("run.sh", ["echo hi"], { mode: "100755" })]),
    expected: ["run.sh"],
    category: "file_mode",
    git: "accepts",
  },
  {
    name: "+++ path disagrees with diff --git path",
    patch: rawPatch([block("a.txt", ["x"], { plusPath: "b.txt" })]),
    expected: ["b.txt"],
    category: "diff_structure",
    git: "rejects",
  },
  {
    name: "CRLF header injection in subject (via customer domain)",
    patch: assemble({ "a.txt": "x\n" }, "acme.example\r\nX-Evil: 1"),
    expected: ["a.txt"],
    category: "control_char",
    git: "accepts",
  },
  {
    name: "LF header injection in subject (via customer domain)",
    patch: assemble({ "a.txt": "x\n" }, "acme.example\nFrom: Evil <e@evil.example>"),
    expected: ["a.txt"],
    category: "mailbox_header",
    git: "accepts",
  },
  {
    name: "domain smuggles a --- and a whole extra file",
    patch: assemble(
      { "a.txt": "x\n" },
      "acme.example\n\n---\ndiff --git a/evil.sh b/evil.sh\nnew file mode 100644\nindex 0000000..0000001\n--- /dev/null\n+++ b/evil.sh\n@@ -0,0 +1,1 @@\n+rm -rf ~",
    ),
    expected: ["a.txt"],
    category: "hunk_count",
    git: "accepts",
  },
  {
    name: "RFC 2047 encoded-word in subject",
    patch: rawPatch([ok1], { subject: "[PATCH] =?utf-8?q?x=0AFrom:_evil?=" }),
    expected: ["a.txt"],
    category: "mailbox_header",
    git: "unchecked",
  },
  {
    name: "commit body line starts the diff early",
    patch: rawPatch([ok1], { body: ["Intro.", "diff --git a/evil b/evil"] }),
    expected: ["a.txt"],
    category: "mailbox_body",
    git: "rejects",
  },
  {
    name: "commit body carries an mbox From line (second message)",
    patch: rawPatch([ok1], {
      body: ["Intro.", "From 0000000000000000000000000000000000000000 Mon Sep 17 00:00:00 2001", "Subject: [PATCH] evil"],
    }),
    expected: ["a.txt"],
    category: "mailbox_body",
    git: "unchecked",
  },
  {
    name: "commit body first line is an in-body header",
    patch: rawPatch([ok1], { body: ["From: Evil <e@evil.example>", "", "x"] }),
    expected: ["a.txt"],
    category: "mailbox_body",
    git: "unchecked",
  },
  {
    name: "commit body scissors line",
    patch: rawPatch([ok1], { body: ["Intro.", "-- >8 --", "after"] }),
    expected: ["a.txt"],
    category: "mailbox_body",
    git: "unchecked",
  },
  {
    name: "duplicate path",
    patch: rawPatch([block("a.txt", ["x"]), block("a.txt", ["y"])]),
    expected: ["a.txt", "a.txt"],
    category: "path_duplicate",
    git: "unchecked",
  },
  {
    name: "paths differing only by case",
    patch: rawPatch([block("README.md", ["x"]), block("readme.md", ["y"])]),
    expected: ["README.md", "readme.md"],
    category: "path_collision",
    git: "unchecked",
  },
  {
    name: "file and directory with the same name",
    patch: rawPatch([block("a", ["x"]), block("a/b", ["y"])]),
    expected: ["a", "a/b"],
    category: "path_collision",
    git: "rejects",
  },
  {
    name: "Windows reserved device name",
    patch: rawPatch([block("docs/aux.md", ["x"])]),
    expected: ["docs/aux.md"],
    category: "path_unsafe",
    git: "unchecked",
  },
  {
    name: "extra unexpected file block",
    patch: rawPatch([ok1, block("extra.sh", ["echo hi"])]),
    expected: ["a.txt"],
    category: "file_set",
    git: "accepts",
  },
  {
    name: "junk between file blocks",
    patch: rawPatch([ok1, "garbage line\n", block("b.txt", ["z"])]),
    expected: ["a.txt", "b.txt"],
    category: "hunk_count",
    git: "unchecked",
  },
  {
    name: "trailing junk after the signature",
    patch: rawPatch([ok1], { trailer: "-- \n2.40.0\n\nextra\n" }),
    expected: ["a.txt"],
    category: "mailbox_trailer",
    git: "unchecked",
  },
  {
    name: "missing signature trailer",
    patch: rawPatch([ok1], { trailer: "" }),
    expected: ["a.txt"],
    category: "mailbox_trailer",
    git: "unchecked",
  },
  {
    name: "Trojan Source bidi override in generated code",
    patch: rawPatch([block("mcp-server/index.ts", ["const isAdmin = false; /* \u202E } \u2066if (isAdmin)\u2069 \u2066 begin admins only */"])]),
    expected: ["mcp-server/index.ts"],
    category: "bidi_control",
    git: "unchecked",
  },
  {
    name: "CR inside file content",
    patch: rawPatch([block("a.txt", ["x\r"])]),
    expected: ["a.txt"],
    category: "control_char",
    git: "unchecked",
  },
  {
    name: "NUL inside file content",
    patch: rawPatch([block("a.txt", ["x\u0000y"])]),
    expected: ["a.txt"],
    category: "control_char",
    git: "unchecked",
  },
  {
    name: "C1 control (U+0085 NEL) inside file content",
    patch: rawPatch([block("a.txt", ["x\u0085y"])]),
    expected: ["a.txt"],
    category: "control_char",
    git: "unchecked",
  },
  {
    name: "invalid UTF-8 bytes",
    patch: (() => {
      const bytes = new TextEncoder().encode(rawPatch([block("a.txt", ["xQy"])]));
      const at = bytes.indexOf("Q".charCodeAt(0), bytes.indexOf("+xQy".charCodeAt(0)));
      const out = new Uint8Array(bytes.length + 1);
      out.set(bytes.subarray(0, at), 0);
      out.set([0xc3, 0x28], at); // invalid 2-byte sequence
      out.set(bytes.subarray(at + 1), at + 2);
      return out;
    })(),
    expected: ["a.txt"],
    category: "encoding",
    git: "unchecked",
  },
  {
    name: "lone surrogate in content (string input)",
    patch: rawPatch([block("a.txt", ["x\uD800y"])]),
    expected: ["a.txt"],
    category: "encoding",
    git: "unchecked",
  },
  {
    name: "missing sentinel envelope line",
    patch: rawPatch([ok1]).split("\n").slice(1).join("\n"),
    expected: ["a.txt"],
    category: "mailbox_envelope",
    git: "unchecked",
  },
];
