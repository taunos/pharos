import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { PRIVACY_MD } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "Privacy Policy — Astrant",
  description:
    "Astrant's privacy policy. What we collect, what we don't, what we do with it. Plain English.",
  alternates: {
    types: { "text/markdown": "/privacy.md" },
  },
};

const md = PRIVACY_MD;

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <article className="prose prose-invert mx-auto max-w-3xl px-6 py-16 prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-4xl prose-h1:sm:text-5xl prose-h2:mt-12 prose-h2:text-2xl prose-h3:mt-8 prose-h3:text-xl prose-p:text-[var(--color-muted)] prose-li:text-[var(--color-muted)] prose-strong:text-[var(--color-fg)] prose-a:text-[var(--color-accent)] prose-a:no-underline hover:prose-a:underline prose-code:bg-[var(--color-surface)] prose-code:px-1 prose-code:rounded">
          <ReactMarkdown>{md}</ReactMarkdown>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
