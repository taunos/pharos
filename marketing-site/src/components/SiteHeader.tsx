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
        {/* Mobile (< md): show Pricing + Dogfood only — "How it works" is
            the longest item and wraps when the viewport squeezes the nav.
            md+ shows all three with the wider gap. whitespace-nowrap prevents
            individual links wrapping internally even if the row gets tight. */}
        <nav className="flex items-center gap-3 whitespace-nowrap text-sm text-[var(--color-muted)] sm:gap-6">
          <Link
            href="/#how-it-works"
            className="hidden hover:text-[var(--color-fg)] md:inline"
          >
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
