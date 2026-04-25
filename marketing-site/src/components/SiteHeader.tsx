import Link from "next/link";

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Pharos
        </Link>
        <nav className="flex items-center gap-6 text-sm text-[var(--color-muted)]">
          <Link href="/#how-it-works" className="hover:text-[var(--color-fg)]">
            How it works
          </Link>
          <Link href="/#pricing" className="hover:text-[var(--color-fg)]">
            Pricing
          </Link>
          <Link href="/#dogfood" className="hover:text-[var(--color-fg)]">
            Dogfood
          </Link>
        </nav>
      </div>
    </header>
  );
}
