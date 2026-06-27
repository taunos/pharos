// F2-VALIDATE-1 — validator unit tests. A valid assembled patch passes; each
// invariant violation is caught with a targeted failure string. Built by mutating
// the live assembleGitAmPatch output (so the "valid" baseline is genuinely valid).

import { describe, it, expect } from "vitest";
import { assembleGitAmPatch } from "./f2-patch-assembler";
import { validateGitAmPatch } from "./f2-patch-validate";

const FIXED_TIME = new Date("2026-06-27T00:00:00Z");

function base(files: Record<string, string> = { "public/llms.txt": "# Acme\nhello\n" }): string {
  return assembleGitAmPatch({
    customer_domain: "https://acme.example",
    customer_email: "dev@acme.example",
    session_id: "impl-test",
    fulfillment_time: FIXED_TIME,
    files,
  });
}

const EXPECTED = ["public/llms.txt"];
const hasFailure = (r: ReturnType<typeof validateGitAmPatch>, frag: string) =>
  r.ok === false && r.failures.some((f) => f.includes(frag));

describe("validateGitAmPatch", () => {
  it("passes a valid assembled patch", () => {
    expect(validateGitAmPatch(base(), EXPECTED)).toEqual({ ok: true });
  });

  it("passes a no-trailing-newline file (honors the \\ No newline marker)", () => {
    const files = { "public/llms.txt": "no final newline" };
    expect(validateGitAmPatch(base(files), Object.keys(files))).toEqual({ ok: true });
  });

  it("catches a hunk-count mismatch", () => {
    const p = base().replace("@@ -0,0 +1,2 @@", "@@ -0,0 +1,9 @@");
    expect(hasFailure(validateGitAmPatch(p, EXPECTED), "hunk-count")).toBe(true);
  });

  it("catches a .. path traversal", () => {
    const p = base().replace("+++ b/public/llms.txt", "+++ b/../etc/passwd");
    expect(hasFailure(validateGitAmPatch(p, EXPECTED), 'path:".." traversal')).toBe(true);
  });

  it("catches a duplicate path", () => {
    const p = base({ "a.txt": "x\n", "b.txt": "y\n" }).replace(/b\/b\.txt/g, "b/a.txt");
    expect(hasFailure(validateGitAmPatch(p, ["a.txt", "b.txt"]), "path:duplicate")).toBe(true);
  });

  it("catches a U+FFFD replacement char", () => {
    const p = base().replace("hello", "hel�lo");
    expect(hasFailure(validateGitAmPatch(p, EXPECTED), "U+FFFD")).toBe(true);
  });

  it("catches a mojibake signature", () => {
    const p = base().replace("hello", "helloâ€™"); // "â€™"
    expect(hasFailure(validateGitAmPatch(p, EXPECTED), "mojibake")).toBe(true);
  });

  it("catches a disallowed control char in content", () => {
    const p = base().replace("hello", "hel\x07lo"); // bell
    expect(hasFailure(validateGitAmPatch(p, EXPECTED), "control-char")).toBe(true);
  });

  it("catches a missing Date: header", () => {
    const p = base().replace(/^Date:.*\n/m, "");
    expect(hasFailure(validateGitAmPatch(p, EXPECTED), "missing Date:")).toBe(true);
  });

  it("catches a broken mailbox (no --- separator)", () => {
    const p = base().replace("\n---\n", "\n");
    expect(hasFailure(validateGitAmPatch(p, EXPECTED), "body/diff separator")).toBe(true);
  });

  it("catches a modification (non-new-file) block", () => {
    const p = base().replace("--- /dev/null", "--- a/public/llms.txt");
    expect(hasFailure(validateGitAmPatch(p, EXPECTED), "all-additions")).toBe(true);
  });

  it("catches a missing sentinel envelope", () => {
    const p = base().split("\n").slice(1).join("\n");
    expect(hasFailure(validateGitAmPatch(p, EXPECTED), "sentinel")).toBe(true);
  });

  it("catches a file-set mismatch vs expectedFiles", () => {
    expect(hasFailure(validateGitAmPatch(base(), ["public/llms.txt", "extra.txt"]), "file-set")).toBe(true);
  });
});
