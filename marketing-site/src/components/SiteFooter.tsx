export default function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-border)]">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-8 text-sm text-[var(--color-muted)] sm:flex-row sm:items-center">
        <div>© 2026 Astrant</div>
        <div className="flex items-center gap-6">
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
