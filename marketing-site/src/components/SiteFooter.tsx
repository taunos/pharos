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
        {/* flex-wrap lets the 5-link row wrap onto multiple lines on narrow
            viewports (332px iPhone-SE-class) instead of overflowing horizontally
            and forcing a body-level scrollbar. gap-x-4 + gap-y-1 on mobile,
            gap-6 (single-row) at sm+ where the full row fits comfortably. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-dim)] sm:gap-x-6">
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
          <a href="/methodology/calibration" className="hover:text-[var(--color-fg)]">
            Methodology
          </a>
          <a href="/privacy" className="hover:text-[var(--color-fg)]">
            Privacy
          </a>
          <a href="/terms" className="hover:text-[var(--color-fg)]">
            Terms
          </a>
          {/* Visible label is the verb "Contact" matching the capitalization
              style of the other 4 links. mailto target is the canonical
              contact@astrant.io address. Shorter label keeps the row from
              overflowing on narrow viewports even after flex-wrap kicks in. */}
          <a href="mailto:contact@astrant.io" className="hover:text-[var(--color-fg)]">
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
