"use client";

import { useEffect, useState } from "react";

type Status = "idle" | "submitting" | "redirecting" | "error";

export default function AuditCheckoutForm() {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [sourceScanId, setSourceScanId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Read source_scan_id from the URL query string at mount. The /score page's
  // "Buy Audit" CTA forwards the prior scan_id as `?source_scan_id=…` so the
  // conversion arc is recoverable in the corpus.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sid = new URL(window.location.href).searchParams.get("source_scan_id");
    if (sid && sid.trim().length > 0) setSourceScanId(sid.trim());
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const body: Record<string, string> = { url, email };
      if (sourceScanId) body.source_scan_id = sourceScanId;
      const res = await fetch("/api/audit-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        checkout_url?: string;
        session_id?: string;
      };
      if (!res.ok || !data.ok || !data.checkout_url) {
        setStatus("error");
        setErrorMsg(
          data.error ??
            "Couldn't create your checkout session. Try again or email hello@pharos.dev."
        );
        return;
      }
      setStatus("redirecting");
      window.location.href = data.checkout_url;
    } catch {
      setStatus("error");
      setErrorMsg("Network error. Try again in a moment.");
    }
  }

  const disabled = status === "submitting" || status === "redirecting";
  const buttonLabel =
    status === "submitting"
      ? "Creating checkout…"
      : status === "redirecting"
        ? "Redirecting to payment…"
        : "Run my audit ($79)";

  return (
    <form onSubmit={onSubmit} className="w-full max-w-2xl">
      <div className="flex flex-col gap-3">
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
      <p className="mt-3 text-sm italic text-[var(--color-muted)]">
        After payment we redirect you to your audit results page — bookmark it.
        Audit usually finishes in ~60 seconds.
      </p>
      {errorMsg ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {errorMsg}
        </p>
      ) : null}
    </form>
  );
}
