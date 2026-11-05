"use client";

import { useEffect, useState } from "react";
import { normalizeUrl } from "@/lib/normalize-url";
import {
  checkoutErrorMessage,
  parseSourceScanId,
} from "@/lib/audit-checkout-client";
import { CONSENT_SELLABLE_TEXT } from "@/lib/dataset-consent";

// Two modes, chosen server-side by isAuditCheckoutEnabled (lib/audit-gate.ts)
// and passed in as `checkoutEnabled`:
// - false (PRE-LAUNCH MODE): the form captures email + URL as a waitlist
//   entry instead of creating a Dodo checkout session.
// - true (Test C-B): the 54fa925 purchase flow — POST /api/audit-create, then
//   redirect to the Dodo checkout_url.

type Status = "idle" | "submitting" | "redirecting" | "done" | "error";

export default function AuditCheckoutForm({
  checkoutEnabled = false,
}: {
  checkoutEnabled?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sourceScanId, setSourceScanId] = useState<string | null>(null);
  // Dataset P2 opt-in: unticked by default, separate from the purchase.
  const [consentSellable, setConsentSellable] = useState(false);

  // The /score/[id] Audit CTA forwards the prior scan as ?source_scan_id=…
  // so the conversion arc is recoverable. Read once at mount (open mode only).
  useEffect(() => {
    if (!checkoutEnabled) return;
    setSourceScanId(
      parseSourceScanId(
        new URL(window.location.href).searchParams.get("source_scan_id"),
      ),
    );
  }, [checkoutEnabled]);

  // Back button from the Dodo checkout restores this page from the bfcache
  // with status "redirecting" (form disabled). Reset it so the buyer can retry.
  useEffect(() => {
    if (!checkoutEnabled) return;
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) {
        setStatus((s) => (s === "redirecting" ? "idle" : s));
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [checkoutEnabled]);

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
    if (checkoutEnabled) {
      try {
        const body: Record<string, string | boolean> = {
          url: normalized,
          email,
          consent_sellable: consentSellable,
        };
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
        };
        if (!res.ok || !data.ok || !data.checkout_url) {
          setStatus("error");
          setErrorMsg(checkoutErrorMessage(data.error, res.status));
          return;
        }
        setStatus("redirecting");
        window.location.href = data.checkout_url;
      } catch {
        setStatus("error");
        setErrorMsg("Network error. Try again in a moment.");
      }
      return;
    }
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized, email, source: "audit" }),
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

  const disabled =
    status === "submitting" || status === "redirecting" || status === "done";
  const buttonLabel = checkoutEnabled
    ? status === "submitting"
      ? "Creating checkout…"
      : status === "redirecting"
        ? "Redirecting to checkout…"
        : "Run my audit ($79)"
    : status === "submitting"
      ? "Saving…"
      : status === "done"
        ? "You're on the list ✓"
        : "Notify me when Audit launches";

  return (
    // Logo + Foundation slice — entire form is the 503-gated paid-checkout
    // waitlist (PRE-LAUNCH MODE comment at top of file). Per decision 5
    // EXCEPTION amber stays on the pre-launch banner + focus borders + CTA.
    // Only the radii are stripped per decision 4.
    <form onSubmit={onSubmit} className="w-full max-w-2xl">
      {checkoutEnabled ? null : (
      <div className="border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 p-4 text-sm text-[var(--color-fg)]">
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
        gives you all six dimensions — five scored live, with a Citation
        Visibility demo preview.
      </div>
      )}
      <div className={checkoutEnabled ? "flex flex-col gap-3" : "mt-4 flex flex-col gap-3"}>
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
        {checkoutEnabled ? (
          <label className="flex items-start gap-3 text-sm text-[var(--color-muted)]">
            <input
              name="consent_sellable"
              type="checkbox"
              checked={consentSellable}
              onChange={(e) => setConsentSellable(e.target.checked)}
              disabled={disabled}
              className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span>{CONSENT_SELLABLE_TEXT}</span>
          </label>
        ) : null}
        <button
          type="submit"
          disabled={disabled}
          className="bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonLabel}
        </button>
      </div>
      {checkoutEnabled ? (
        <p className="mt-3 text-sm italic text-[var(--color-muted)]">
          After payment you&apos;ll land on your results page, and we&apos;ll
          email you the PDF.
        </p>
      ) : null}
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
