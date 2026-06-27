// Implementation V2 (A1/A2) — static, labelled REPRESENTATIVE patch-evidence panel.
//
// Canonical-derived: the sender (implementation@astrant.io), subject shape, and
// apply command mirror the live generator lib/f2-patch-assembler.ts; the file set
// mirrors api/impl-fulfill's standard output (6 base files + the 4 mcp-server files
// renderMcpServerWorker emits) = 10 files. Header is framed as the delivery email
// (From → To → Subject) rather than git's raw mbox "From <hash>" sentinel line —
// reads correctly to a non-git reader (Bruno greenlight). The body is a diffstat
// SUMMARY for a clean hero panel — the delivered patch carries full unified diffs.
// Ordering + per-file insertion counts are illustrative. No fetch, all literals (I6).

const patch = `From: Astrant <implementation@astrant.io>
To: you@sample-saas.example
Subject: [PATCH] astrant implementation — sample-saas.example

 public/llms.txt                  | 48 ++++++++++++
 public/openapi.yaml              | 63 +++++++++++++++
 app/layout-jsonld.html           | 21 ++++++
 mcp-server/index.ts              | 84 +++++++++++++++++++
 mcp-server/wrangler.jsonc        | 18 ++++
 mcp-server/package.json          | 12 +++
 mcp-server/README.md             | 27 ++++++
 monitoring/check-llms-txt.sh     | 12 +++
 monitoring/check-mcp-server.sh   | 14 +++
 ASTRANT_IMPLEMENTATION.md        | 39 +++++++++
 10 files changed, 338 insertions(+)

→ git am astrant-implementation.patch
→ review diff · merge`;

export function ImplPatchEvidence() {
  return (
    <div className="min-w-0 border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <div className="flex flex-col gap-1 border-b border-[var(--color-border)] pb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <span className="min-w-0 font-mono text-sm text-[var(--color-fg)]">
          patch · astrant-implementation.patch
        </span>
        <span className="shrink-0 whitespace-nowrap font-mono text-xs text-[var(--color-dim)]">
          Representative sample
        </span>
      </div>
      <pre className="mt-4 overflow-x-auto font-mono text-xs leading-relaxed text-[var(--color-muted)]">
        {patch}
      </pre>
    </div>
  );
}
