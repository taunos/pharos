"use client";

import { useState } from "react";

type Status = "idle" | "submitting" | "success" | "error" | "rate_limited";

export default function DeleteMeForm() {
  const [email, setEmail] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryAfterSec, setRetryAfterSec] = useState<number | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const body: Record<string, unknown> = { email };
      if (referralCode) body.referral_code = referralCode;
      const res = await fetch("/api/score/delete-me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        setRetryAfterSec(retryAfter ? parseInt(retryAfter, 10) : null);
        setStatus("rate_limited");
        return;
      }
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setStatus("error");
        setErrorMsg(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMsg("Network error. Try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-6 text-base text-[var(--color-fg)]">
        <p className="font-semibold text-emerald-400">Check your email.</p>
        <p className="mt-2 text-[var(--color-muted)]">
          We&apos;ve sent a confirmation link to <strong>{email}</strong>. The
          link is valid for 24 hours. Click it to confirm deletion.
        </p>
        <p className="mt-3 text-sm italic text-[var(--color-muted)]">
          If you don&apos;t see the email in 5 minutes, check your spam folder.
          Nothing has been deleted yet — confirmation is required.
        </p>
      </div>
    );
  }

  if (status === "rate_limited") {
    const hours =
      retryAfterSec && retryAfterSec > 3600
        ? Math.ceil(retryAfterSec / 3600)
        : null;
    const minutes =
      retryAfterSec && retryAfterSec <= 3600
        ? Math.ceil(retryAfterSec / 60)
        : null;
    return (
      <div className="rounded-md border border-orange-400/40 bg-orange-400/5 p-6 text-base text-[var(--color-fg)]">
        <p className="font-semibold text-orange-400">
          We&apos;ve already sent you a confirmation link.
        </p>
        <p className="mt-2 text-[var(--color-muted)]">
          Check your spam folder, or wait{" "}
          {hours ? `${hours} hour${hours > 1 ? "s" : ""}` : null}
          {minutes ? `${minutes} minute${minutes > 1 ? "s" : ""}` : null} and
          try again. This rate limit prevents the deletion endpoint from being
          used to spam confirmation emails.
        </p>
      </div>
    );
  }

  const disabled = status === "submitting";

  return (
    <form onSubmit={onSubmit} className="w-full max-w-xl">
      {/* Honeypot — JSON key `referral_code`, input `name="website_url_2"`. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          height: 0,
          width: 0,
          overflow: "hidden",
        }}
      >
        <label htmlFor="website_url_2">Leave this field empty</label>
        <input
          type="text"
          id="website_url_2"
          name="website_url_2"
          tabIndex={-1}
          autoComplete="off"
          value={referralCode}
          onChange={(e) => setReferralCode(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-3">
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
          {disabled ? "Sending…" : "Send me a confirmation link"}
        </button>
      </div>
      {errorMsg ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {errorMsg}
        </p>
      ) : null}
    </form>
  );
}
