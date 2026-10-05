"use client";

import { useState } from "react";
import { normalizeUrl } from "@/lib/normalize-url";

// Test C-B — waitlist for the tiers that stay pre-launch once the Audit opens
// (/audit#waitlist, rendered only while the Audit checkout gate is open).
// Every other tier's "Notify me" links here. Posts to /api/waitlist.
// (components/WaitlistForm.tsx is an older, unused scanner-launch form.)

type Status = "idle" | "submitting" | "done" | "error";

export default function TierWaitlistForm() {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setStatus("error");
      setErrorMsg("Please enter a valid URL (e.g. example.com or https://example.com).");
      return;
    }
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized, email, source: "other_plans" }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatus("error");
        setErrorMsg(
          data.error ??
            "Couldn't save that. Try again or email contact@astrant.io."
        );
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
      setErrorMsg("Network error. Try again in a moment.");
    }
  }

  const disabled = status === "submitting" || status === "done";
  const buttonLabel =
    status === "submitting"
      ? "Saving…"
      : status === "done"
        ? "You're on the list ✓"
        : "Notify me";

  return (
    <div className="w-full max-w-2xl">
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
        Waiting on another plan?
      </h2>
      <p className="mt-6 text-lg text-[var(--color-muted)]">
        Standard, Pro, Implementation and Custom are still in pre-launch. Leave
        your URL and email and we&apos;ll tell you when they open.
      </p>
      <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-3">
        <input
          name="url"
          type="text"
          required
          inputMode="url"
          autoComplete="url"
          placeholder="your-site.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={disabled}
          className="border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-base text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
        />
        <input
          name="email"
          type="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={disabled}
          className="border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-base text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
        />
        {/* Secondary action on a page whose primary CTA is the Audit buy
            button: ghost style, not the amber fill. */}
        <button
          type="submit"
          disabled={disabled}
          className="border border-[var(--color-border)] px-6 py-3 text-base font-semibold text-[var(--color-fg)] transition hover:border-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonLabel}
        </button>
      </form>
      {errorMsg ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {errorMsg}
        </p>
      ) : null}
    </div>
  );
}
