// F2-VALIDATE-1 — runtime validator unit tests (pure JS; no git needed).
// The "good" baseline is genuine assembler output; adversarial cases are
// shared with the real-git CI layer (f2-patch-assembler.test.ts).

import { describe, it, expect } from "vitest";
import { validateGitAmPatch, MAX_PATCH_BYTES } from "./f2-patch-validate";
import { ADVERSARIAL, GOOD_FIXTURES, assemble, block, rawPatch } from "./test-support/f2-patch-fixtures";

const base = () => assemble({ "public/llms.txt": "# Acme\nhello\n" });
const EXPECTED = ["public/llms.txt"];

function cats(r: ReturnType<typeof validateGitAmPatch>) {
  return r.ok ? [] : r.categories;
}

describe("validateGitAmPatch — accepts what the assembler emits", () => {
  for (const fx of GOOD_FIXTURES) {
    it(fx.name, () => {
      const p = assemble(fx.files, fx.domain);
      expect(validateGitAmPatch(p, Object.keys(fx.files))).toEqual({ ok: true });
      // Same verdict on the exact bytes stored in R2.
      expect(validateGitAmPatch(new TextEncoder().encode(p), Object.keys(fx.files))).toEqual({ ok: true });
    });
  }

  it("accepts the bare `+1` hunk-header form for one line", () => {
    const p = rawPatch([block("a.txt", ["x"]).replace("@@ -0,0 +1,1 @@", "@@ -0,0 +1 @@")]);
    expect(validateGitAmPatch(p, ["a.txt"])).toEqual({ ok: true });
  });
});

describe("validateGitAmPatch — adversarial patches are rejected", () => {
  for (const c of ADVERSARIAL) {
    it(`${c.name} → ${c.category}`, () => {
      const r = validateGitAmPatch(c.patch, c.expected);
      expect(r.ok).toBe(false);
      expect(cats(r)).toContain(c.category);
    });
  }
});

describe("validateGitAmPatch — targeted mutations of real assembler output", () => {
  it("hunk count drift up", () => {
    const p = base().replace("@@ -0,0 +1,2 @@", "@@ -0,0 +1,9 @@");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("hunk_count");
  });

  it("hunk count drift down", () => {
    const p = base().replace("@@ -0,0 +1,2 @@", "@@ -0,0 +1,1 @@");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("hunk_count");
  });

  it("missing Date: header", () => {
    const p = base().replace(/^Date:.*\n/m, "");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("mailbox_header");
  });

  it("malformed Date: header", () => {
    const p = base().replace(/^Date:.*$/m, "Date: yesterday");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("mailbox_header");
  });

  it("forged author", () => {
    const p = base().replace("From: Astrant <implementation@astrant.io>", "From: Evil <e@evil.example>");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("mailbox_header");
  });

  it("extra header line before the blank line", () => {
    const p = base().replace(/^(Subject:.*)$/m, "$1\nX-Extra: 1");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("mailbox_header");
  });

  it("no --- separator", () => {
    const p = base().replace("\n---\n", "\n");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("mailbox_body");
  });

  it("modification (non-new-file) block", () => {
    const p = base().replace("--- /dev/null", "--- a/public/llms.txt");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("diff_structure");
  });

  it("deleted-file mode", () => {
    const p = base().replace("new file mode 100644", "deleted file mode 100644");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("file_mode");
  });

  it("U+FFFD replacement char", () => {
    const p = base().replace("hello", "hel�lo");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("encoding");
  });

  it("mojibake signature", () => {
    const p = base().replace("hello", "helloâ€™");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("encoding");
  });

  it("BEL control char", () => {
    const p = base().replace("hello", "hel\u0007lo");
    expect(cats(validateGitAmPatch(p, EXPECTED))).toContain("control_char");
  });

  it("BOM at the start of the patch", () => {
    expect(cats(validateGitAmPatch("﻿" + base(), EXPECTED))).toContain("encoding");
  });

  it("patch without a final newline", () => {
    expect(cats(validateGitAmPatch(base().slice(0, -1), EXPECTED))).toContain("mailbox_trailer");
  });

  it("file-set mismatch vs expectedFiles", () => {
    expect(cats(validateGitAmPatch(base(), ["public/llms.txt", "extra.txt"]))).toContain("file_set");
  });

  it("oversized patch", () => {
    const big = new Uint8Array(MAX_PATCH_BYTES + 1);
    expect(cats(validateGitAmPatch(big, EXPECTED))).toEqual(["size"]);
  });

  it("empty input", () => {
    expect(validateGitAmPatch("", EXPECTED).ok).toBe(false);
  });
});

describe("validateGitAmPatch — failure output never echoes patch content", () => {
  it("failures are category-prefixed with numeric locators only", () => {
    const secret = "SECRET-CUSTOMER-VALUE";
    for (const c of ADVERSARIAL) {
      const patch =
        typeof c.patch === "string" ? c.patch.replace("a.txt", `${secret}.txt`) : c.patch;
      const r = validateGitAmPatch(patch, c.expected);
      if (r.ok) continue;
      for (const f of r.failures) {
        expect(f).not.toContain(secret);
        expect(f).not.toContain("evil");
        expect(r.categories.some((cat) => f.startsWith(`${cat}:`))).toBe(true);
      }
    }
  });
});
