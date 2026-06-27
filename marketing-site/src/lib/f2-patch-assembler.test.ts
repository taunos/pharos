// F2-VALIDATE-1 (D6) — empirical CI guard: assemble a patch via the live
// assembleGitAmPatch, apply it with REAL `git am` in a throwaway repo, and assert
// the applied working tree (file set + byte-for-byte contents). The Worker can't
// run git; the test suite can — so this is the layer that catches an assembler /
// template regression before it ever reaches a customer.
//
// Also cross-checks each fixture against validateGitAmPatch (the runtime gate),
// so the two layers can't silently diverge.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleGitAmPatch } from "./f2-patch-assembler";
import { validateGitAmPatch } from "./f2-patch-validate";

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const FIXED_TIME = new Date("2026-06-27T00:00:00Z");

// Apply a patch with real `git am` in an isolated temp repo; return the tracked
// working tree (path -> content). core.autocrlf=false so byte-for-byte holds on Windows.
function applyInThrowawayRepo(patch: string): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "f2-gitam-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t.io"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir });
    const patchPath = join(dir, "incoming.patch");
    writeFileSync(patchPath, patch, "utf8");
    // Throws if git am fails (corrupt patch / does not apply) — the test fails loudly.
    execFileSync("git", ["am", patchPath], { cwd: dir, stdio: "pipe" });
    const tracked = execFileSync("git", ["ls-files"], { cwd: dir })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    const tree: Record<string, string> = {};
    for (const f of tracked) tree[f] = readFileSync(join(dir, f), "utf8");
    return tree;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Representative standard 10-file set (mirrors impl-fulfill's allFiles shape).
const REPRESENTATIVE: Record<string, string> = {
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

const FIXTURES: { name: string; files: Record<string, string>; domain?: string }[] = [
  { name: "representative 10-file set", files: REPRESENTATIVE },
  { name: "no-trailing-newline content", files: { "public/llms.txt": "# Acme\nno final newline" } },
  { name: "unicode / em-dash content", files: { "ASTRANT_IMPLEMENTATION.md": "# Acme — São Paulo café\n\nNaïve — résumé.\n" } },
  { name: "very long line", files: { "public/llms.txt": "x".repeat(5000) + "\n" } },
  { name: "content line beginning with 'From '", files: { "public/llms.txt": "From the Acme team\nhello\n" } },
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
  { name: "single-blank-line content (N=1)", files: { "public/llms.txt": "" } },
];

const HAS_GIT = gitAvailable();

(HAS_GIT ? describe : describe.skip)("assembleGitAmPatch — real git am applies cleanly", () => {
  if (!HAS_GIT) {
    // eslint-disable-next-line no-console
    console.warn("git not available — skipping the git-am application test");
  }

  for (const fx of FIXTURES) {
    it(`applies + reproduces the tree: ${fx.name}`, () => {
      const patch = assembleGitAmPatch({
        customer_domain: fx.domain ?? "https://acme.example",
        customer_email: "dev@acme.example",
        session_id: "impl-test",
        fulfillment_time: FIXED_TIME,
        files: fx.files,
      });

      // The runtime validator must agree the patch is well-formed.
      const v = validateGitAmPatch(patch, Object.keys(fx.files));
      expect(v, JSON.stringify(v)).toEqual({ ok: true });

      // Real git am must apply it, and the applied tree must equal the inputs byte-for-byte.
      const tree = applyInThrowawayRepo(patch);
      expect(Object.keys(tree).sort()).toEqual(Object.keys(fx.files).sort());
      for (const [path, content] of Object.entries(fx.files)) {
        expect(tree[path], `content mismatch for ${path}`).toBe(content);
      }
    });
  }

  it("odd domain in subject does not break application", () => {
    const patch = assembleGitAmPatch({
      customer_domain: "https://sub.example.co.uk",
      customer_email: "dev@example.co.uk",
      session_id: "impl-odd",
      fulfillment_time: FIXED_TIME,
      files: { "public/llms.txt": "# x\n" },
    });
    const tree = applyInThrowawayRepo(patch);
    expect(tree["public/llms.txt"]).toBe("# x\n");
  });
});
