// F2-VALIDATE-1 (layer b) — empirical CI guard: assemble patches via the live
// assembleGitAmPatch, apply them with REAL `git am` in a throwaway repo, and
// assert the applied tree (file set + byte-for-byte contents + mode) and the
// commit subject. The Worker can't run git; the test suite can — so this is
// the layer that catches an assembler / template regression before it ships.
//
// It also runs the shared adversarial patches through real git, pinning which
// ones git itself rejects and which ones git APPLIES (the cases only the
// runtime gate in f2-patch-validate.ts stops), and checks the runtime gate
// rejects every one of them, so the two layers cannot silently diverge.
//
// Locally the suite skips when git is missing; in CI (CI=true, set by GitHub
// Actions) a missing git is a hard failure, never a silent skip.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateGitAmPatch } from "./f2-patch-validate";
import { ADVERSARIAL, GOOD_FIXTURES, assemble } from "./test-support/f2-patch-fixtures";

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_GIT = gitAvailable();
const IN_CI = !!process.env.CI;

interface Applied {
  files: Record<string, string>;
  modes: Record<string, string>;
  subject: string;
}

// git with an isolated config: no global/system config (hooks, templates,
// mailinfo.scissors, autocrlf) can change the result.
function git(dir: string, args: string[], input?: Buffer): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: dir,
    stdio: "pipe",
    input,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(dir, "..", "f2-gitam-noglobal"),
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t.io",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t.io",
    },
  }).toString("utf8");
}

// Apply with real `git am`; null when git am refuses the patch.
function tryApply(patch: string | Uint8Array): Applied | null {
  const dir = mkdtempSync(join(tmpdir(), "f2-gitam-"));
  try {
    git(dir, ["init", "-q"]);
    const patchPath = join(dir, "..", `${dir.split(/[\\/]/).pop()}.patch`);
    writeFileSync(patchPath, typeof patch === "string" ? Buffer.from(patch, "utf8") : patch);
    try {
      git(dir, ["am", patchPath]);
    } catch {
      return null;
    } finally {
      rmSync(patchPath, { force: true });
    }
    const files: Record<string, string> = {};
    const modes: Record<string, string> = {};
    for (const row of git(dir, ["ls-files", "-s", "-z"]).split("\0").filter(Boolean)) {
      const [meta, path] = row.split("\t");
      modes[path] = meta.split(" ")[0];
      files[path] = git(dir, ["cat-file", "blob", `:${path}`]);
    }
    const subject = git(dir, ["log", "-1", "--format=%s"]).replace(/\n$/, "");
    return { files, modes, subject };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function apply(patch: string): Applied {
  const r = tryApply(patch);
  if (!r) throw new Error("git am refused a patch the pipeline would deliver");
  return r;
}

describe("git availability", () => {
  it("git is present in CI (the real-git layer must never silently skip there)", () => {
    if (IN_CI) expect(HAS_GIT).toBe(true);
    else if (!HAS_GIT) console.warn("git not available — skipping the real git am layer locally");
  });
});

(HAS_GIT ? describe : describe.skip)("assembleGitAmPatch — real git am applies cleanly", () => {
  for (const fx of GOOD_FIXTURES) {
    it(`applies + reproduces the tree: ${fx.name}`, () => {
      const patch = assemble(fx.files, fx.domain);

      // The runtime gate must agree the patch is deliverable.
      const v = validateGitAmPatch(new TextEncoder().encode(patch), Object.keys(fx.files));
      expect(v, JSON.stringify(v)).toEqual({ ok: true });

      const applied = apply(patch);
      expect(Object.keys(applied.files).sort()).toEqual(Object.keys(fx.files).sort());
      for (const [path, content] of Object.entries(fx.files)) {
        expect(applied.files[path], `content mismatch for ${path}`).toBe(content);
        expect(applied.modes[path], `mode for ${path}`).toBe("100644");
      }
      const domain = fx.domain ?? "https://acme.example";
      expect(applied.subject).toBe(`astrant implementation — ${domain}`);
    });
  }
});

(HAS_GIT ? describe : describe.skip)("adversarial patches — real git vs the runtime gate", () => {
  for (const c of ADVERSARIAL) {
    it(`${c.name}: gate rejects (${c.category}); git ${c.git}`, () => {
      const v = validateGitAmPatch(c.patch, c.expected);
      expect(v.ok).toBe(false);
      if (c.git === "unchecked") return;
      const applied = tryApply(c.patch);
      if (c.git === "rejects") expect(applied).toBeNull();
      else expect(applied, "git am applied it — only the runtime gate stops this").not.toBeNull();
    });
  }

  it("hunk count too small: git applies a silently truncated file", () => {
    const c = ADVERSARIAL.find((x) => x.name.startsWith("hunk count too small (git"))!;
    const applied = tryApply(c.patch)!;
    expect(applied.files["a.txt"]).toBe("x\ny\n"); // "z" was dropped without an error
  });

  it("CRLF-injected subject: git applies and swallows the injected text", () => {
    const c = ADVERSARIAL.find((x) => x.name.startsWith("CRLF header injection"))!;
    const applied = tryApply(c.patch)!;
    expect(applied.subject).not.toContain("acme.example\r\nX-Evil");
  });
});

describe("commit body lists only what the patch carries", () => {
  it("names the OpenAPI spec only when public/openapi.yaml is in the patch", () => {
    const withSpec = assemble({ "public/llms.txt": "# A\n", "public/openapi.yaml": "openapi: 3.1.0\n" });
    expect(withSpec).toContain("OpenAPI spec scaffold, JSON-LD schema blocks, static monitoring scripts,");
    const without = assemble({ "public/llms.txt": "# A\n" });
    expect(without).not.toContain("OpenAPI");
    expect(without).toContain(
      ["Includes: customized llms.txt, deployable MCP server (TypeScript Worker),", "JSON-LD schema blocks, static monitoring scripts,"].join(
        String.fromCharCode(10),
      ),
    );
  });
});
