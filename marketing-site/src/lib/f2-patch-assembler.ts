// F2 v6.1 D1 + D12 — git-am-compatible mailbox/email-style patch assembler.
//
// Customer runs `git am astrant-implementation.patch` from repo root → single commit
// lands with all F2 implementation artifacts. Per CLI MED-3 v3 fold: mailbox format
// (not bare `git apply`-style unified diff).
//
// Mailbox envelope per git-am format (RFC 2822 email shape with diff body):
//   From <hash>... Mon <date>
//   From: <author>
//   Date: <date>
//   Subject: [PATCH] <commit subject>
//
//   <commit message body>
//   ---
//   <unified diff body>
//
// Each new file in the patch is one `diff --git ... +++` block, all bundled into a
// single commit on apply.

export interface F2PatchInput {
  customer_domain: string;
  customer_email: string;
  session_id: string;
  fulfillment_time: Date;
  files: Record<string, string>;  // path → file content (all NEW files)
}

export function assembleGitAmPatch(input: F2PatchInput): string {
  const author = "Astrant <implementation@astrant.io>";
  const dateRfc = formatRfc2822Date(input.fulfillment_time);
  const subject = `[PATCH] astrant implementation — ${input.customer_domain}`;
  const commitBody = [
    `Astrant Implementation patch for ${input.customer_domain}.`,
    ``,
    `Generated at ${input.fulfillment_time.toISOString()}`,
    `Session: ${input.session_id}`,
    ``,
    `Includes: customized llms.txt, deployable MCP server (TypeScript Worker),`,
    `OpenAPI spec scaffold, JSON-LD schema blocks, static monitoring scripts,`,
    `and a per-stack README at ASTRANT_IMPLEMENTATION.md.`,
    ``,
    `Apply with: git am astrant-implementation.patch`,
    `Deploy the MCP server: cd mcp-server && npx wrangler deploy`,
  ].join("\n");

  // Sorted paths produce deterministic patch bytes (cache-friendly + diff-friendly).
  const paths = Object.keys(input.files).sort();

  const diffBlocks = paths.map((p) => buildNewFileDiff(p, input.files[p])).join("\n");

  return [
    `From 0000000000000000000000000000000000000000 Mon Sep 17 00:00:00 2001`,
    `From: ${author}`,
    `Date: ${dateRfc}`,
    `Subject: ${subject}`,
    ``,
    commitBody,
    `---`,
    diffBlocks,
    `-- `,
    `2.40.0`,
    ``,
  ].join("\n");
}

// Build a git-style diff for a NEW file (no /dev/null deletion handling; F2 only adds files).
function buildNewFileDiff(path: string, content: string): string {
  const lines = content.split("\n");
  // git uses LF lines; preserve trailing newline state.
  const hasTrailingNewline = content.endsWith("\n");
  const bodyLines = hasTrailingNewline ? lines.slice(0, -1) : lines;
  const noNewlineMarker = hasTrailingNewline ? "" : "\n\\ No newline at end of file";

  const hunkLineCount = bodyLines.length;
  const diffBody = bodyLines.map((l) => `+${l}`).join("\n");

  return [
    `diff --git a/${path} b/${path}`,
    `new file mode 100644`,
    `index 0000000..0000001`,
    `--- /dev/null`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${hunkLineCount} @@`,
    diffBody + noNewlineMarker,
  ].join("\n");
}

function formatRfc2822Date(d: Date): string {
  // RFC 2822 with explicit +0000 UTC offset. Avoid locale-dependent Date.prototype.toString().
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dn = days[d.getUTCDay()];
  const mo = months[d.getUTCMonth()];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${dn}, ${dd} ${mo} ${yyyy} ${hh}:${mm}:${ss} +0000`;
}
