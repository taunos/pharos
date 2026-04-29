"use client";

import { useState } from "react";

// PRE-LAUNCH MODE — paid checkouts disabled. The form below captures email
// + URL as a waitlist entry instead of creating a Dodo checkout session.
// To re-enable real purchases, restore the audit-create POST + redirect logic
// from git history (commit 54fa925 or earlier).

type Status = "idle" | "submitting" | "done" | "error";

export default function AuditCheckoutForm() {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, email }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatus("error");
        setErrorMsg(
          data.error ??
            "Couldn't save that. Try again or email hello@astrant.io."
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
        : "Notify me when Audit launches";

  return (
    <form onSubmit={onSubmit} className="w-full max-w-2xl">
      <div className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 p-4 text-sm text-[var(--color-fg)]">
        <strong className="text-[var(--color-accent)]">Pre-launch.</strong>{" "}
        Astrant Audit is in final pre-launch verification. Drop your URL and
        email — we&apos;ll notify you the moment paid checkouts open (next
        few days). Until then, the free Score scan at{" "}
        <a
          href="/score"
          className="underline-offset-4 hover:underline"
        >
          astrant.io/score
        </a>{" "}
        gives you 4 of 6 dimensions immediately.
      </div>
      <div className="mt-4 flex flex-col gap-3">
        <input
          name="url"
          type="url"
          required
          inputMode="url"
          placeholder="https://your-site.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={disabled}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
        />
        <input
          name="email"
          type="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={disabled}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-md bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonLabel}
        </button>
      </div>
      {status === "done" ? (
        <p className="mt-3 text-sm text-emerald-400">
          Thanks. We&apos;ll email you the moment Audit goes live.
        </p>
      ) : null}
      {errorMsg ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {errorMsg}
        </p>
      ) : null}
    </form>
  );
}
