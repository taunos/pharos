import Image from "next/image";

// Logo + Foundation slice — minimal footer chrome.
// Left cluster: 24px mark + "© 2026 Astrant" wordmark in standard fg.
// Right cluster: mono caption row (links) at 11px / uppercase / tracking-[0.08em]
//   in --color-dim. Border uses the new --color-rule (the faintest divider in
//   the surface ladder), and inner padding is 32px top/bottom (py-8) per spec.
export default function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-rule)]">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-8 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5 text-sm text-[var(--color-fg)]">
          <Image
            src="/brand/astrant-mark-dark.png"
            alt=""
            width={24}
            height={24}
            className="h-6 w-6"
          />
          <span>&copy; 2026 Astrant</span>
        </div>
        <div className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-dim)]">
          <a
            href="https://mcp.astrant.io/mcp"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--color-fg)]"
          >
            MCP
          </a>
          <a href="/llms.txt" className="hover:text-[var(--color-fg)]">
            llms.txt
          </a>
          <a href="/privacy" className="hover:text-[var(--color-fg)]">
            Privacy
          </a>
          <a href="/terms" className="hover:text-[var(--color-fg)]">
            Terms
          </a>
          <a href="mailto:hello@astrant.io" className="hover:text-[var(--color-fg)]">
            hello@astrant.io
          </a>
        </div>
      </div>
    </footer>
  );
}
