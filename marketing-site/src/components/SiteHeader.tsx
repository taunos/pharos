import Image from "next/image";
import Link from "next/link";

// Logo + Foundation slice — chrome-only update. The bare "Astrant" text link
// becomes a mark + wordmark lockup. The mark renders at 32px (intrinsic 1254px
// source from public/brand/astrant-mark-dark.png), gap-0.5 keeps the wordmark
// visually anchored to the mark, and the wordmark uses text-2xl / font-bold /
// tracking-tight. `priority` is set because the header is above-the-fold on
// every route.
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-rule)] bg-[var(--color-bg)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-0.5">
          <Image
            src="/brand/astrant-mark-dark.png"
            alt=""
            width={32}
            height={32}
            priority
            className="h-8 w-8"
          />
          <span className="text-2xl font-bold tracking-tight">Astrant</span>
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
