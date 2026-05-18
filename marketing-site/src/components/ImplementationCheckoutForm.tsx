"use client";

// F2 v6.1 D21 + D22 — client component for the /implementation page CTA.
//
// State-render-state:
//   - atCapacity (Stage 2 page-CTA gate) → Waitlist CTA only
//   - codebaseType not selected → Stage 1 gate (radio + disabled Buy button)
//   - codebaseType === "non-git" → Custom tier CTA (out-of-scope for F2 v1.0)
//   - codebaseType === "git" → Active Buy button → POSTs /api/f2-checkout-create
//     with codebase_type_confirmed: true → window.location = checkout_url

import { useState } from "react";

export function ImplementationCheckoutForm({ atCapacity }: { atCapacity: boolean }) {
  const [codebaseType, setCodebaseType] = useState<"git" | "non-git" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (atCapacity) {
    return (
      <div className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
        <h3 className="text-lg font-semibold">Currently at capacity</h3>
        <p className="mt-3 text-[var(--color-muted)]">
          Astrant Implementation is currently full (we cap concurrent
          implementations to maintain quality + measurement discipline). Join
          the waitlist and we&apos;ll notify you when a slot opens.
        </p>
        <a
          href="/audit#waitlist"
          className="mt-6 inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
        >
          Join waitlist
        </a>
      </div>
    );
  }

  async function handleBuy() {
    if (codebaseType !== "git") return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/f2-checkout-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codebase_type_confirmed: true }),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => null)) as { error?: string } | null;
        const code = data?.error ?? `HTTP_${resp.status}`;
        if (code === "AT_CAPACITY") {
          setError("Astrant Implementation is at capacity. Refresh to see the waitlist option.");
        } else if (code === "RATE_LIMITED") {
          setError("Too many requests in the last minute. Try again shortly.");
        } else {
          setError("Could not create checkout session. Try again in a moment.");
        }
        setLoading(false);
        return;
      }
      const data = (await resp.json()) as { checkout_url?: string };
      if (!data.checkout_url) {
        setError("Checkout URL missing from response. Try again.");
        setLoading(false);
        return;
      }
      window.location.href = data.checkout_url;
    } catch {
      setError("Network error. Try again in a moment.");
      setLoading(false);
    }
  }

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
      <h3 className="text-lg font-semibold">Before you start</h3>
      <p className="mt-3 text-[var(--color-muted)]">
        Implementation v1.0 ships as a Git-applicable patch. Confirm your site
        is on a git-based codebase to continue.
      </p>

      <fieldset className="mt-6 flex flex-col gap-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="radio"
            name="codebase_type"
            value="git"
            checked={codebaseType === "git"}
            onChange={() => setCodebaseType("git")}
            className="mt-1"
          />
          <span className="text-[var(--color-fg)]">
            My site is on a git-based codebase (Next.js, Vue, Astro, SvelteKit,
            vanilla HTML+JS, or similar).
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="radio"
            name="codebase_type"
            value="non-git"
            checked={codebaseType === "non-git"}
            onChange={() => setCodebaseType("non-git")}
            className="mt-1"
          />
          <span className="text-[var(--color-fg)]">
            My site is on a no-code platform (Shopify, Webflow, Wix,
            Squarespace).
          </span>
        </label>
      </fieldset>

      {codebaseType === "non-git" && (
        <div className="mt-6 border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-[var(--color-fg)]">
          <p>
            Implementation v1.0 doesn&apos;t fit no-code platforms. The Custom
            tier covers your stack with a tailored deploy path.
          </p>
          <a
            href="/custom"
            className="mt-3 inline-flex border border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-2 text-sm font-semibold text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
          >
            See the Custom tier →
          </a>
        </div>
      )}

      {codebaseType === "git" && (
        <button
          onClick={handleBuy}
          disabled={loading}
          className="mt-6 inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {loading ? "Setting up checkout…" : "Buy Implementation — $1,299"}
        </button>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
