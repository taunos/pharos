"use client";

// Slice 2b Phase 1 — email-capture gate that mounts below /score and on
// /score/[id] when no email is captured yet. Posts to /api/score/capture-email,
// which:
//   - server-enforces opt-in via strict equality (TF-05 / TP-3)
//   - issues a v1.<scan_id>.<expiry>.<hmac> token (no email in URL)
//   - triggers PDF generation (synchronously; defers if BR daily cap is hit)
//   - sends a Resend transactional email with the PDF + results-page links
//
// Honeypot: JSON payload key is `referral_code`; HTML input `name` is
// `website_url_2` for an extra layer of bot misdirection. Same pattern
// as TriageForm.

import { useState } from "react";

type Status = "idle" | "submitting" | "success" | "error";

interface CaptureResponse {
  success: boolean;
  results_url?: string;
  pdf_url?: string;
  pdf_deferred?: boolean;
  error?: string;
}

export default function EmailGate({
  scanId,
  scanUrl,
}: {
  scanId: string;
  scanUrl: string;
}) {
  const [email, setEmail] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultsUrl, setResultsUrl] = useState<string | null>(null);
  const [pdfDeferred, setPdfDeferred] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const body: Record<string, unknown> = {
        scan_id: scanId,
        email,
        opt_in_rescan: optIn,
      };
      if (referralCode) body.referral_code = referralCode;

      const res = await fetch("/api/score/capture-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as CaptureResponse;
      if (!res.ok || !data.success) {
        setStatus("error");
        setErrorMsg(
          data.error ??
            "Couldn't save that. Try again or email contact@astrant.io."
        );
        return;
      }
      setStatus("success");
      setResultsUrl(data.results_url ?? null);
      setPdfDeferred(!!data.pdf_deferred);
    } catch {
      setStatus("error");
      setErrorMsg("Network error. Try again in a moment.");
    }
  }

  if (status === "success") {
    return (
      <div className="border border-emerald-500/40 bg-emerald-500/5 p-6 text-base text-[var(--color-fg)]">
        <p className="font-semibold text-emerald-400">
          {pdfDeferred
            ? "Your gap report is queued."
            : "Your gap report is generating."}
        </p>
        <p className="mt-2 text-[var(--color-muted)]">
          {pdfDeferred
            ? `We've queued generation due to capacity limits — it'll be ready within 24 hours and we'll email it to ${email}.`
            : `We'll email it to ${email}.`}{" "}
          {resultsUrl ? (
            <>
              If you don&apos;t see an email in 5 minutes, view it directly at{" "}
              {/* Logo + Foundation slice: link demoted accent → fg. */}
              <a
                href={resultsUrl}
                className="text-[var(--color-fg)] underline-offset-4 hover:underline"
              >
                {resultsUrl}
              </a>
              .
            </>
          ) : null}
        </p>
      </div>
    );
  }

  const disabled = status === "submitting";

  return (
    <form onSubmit={onSubmit} className="w-full max-w-2xl">
      <h3 className="text-2xl font-bold tracking-tight">
        Get the full PDF gap report
      </h3>
      <p className="mt-2 text-base text-[var(--color-muted)]">
        5 of 6 dimensions analyzed. Predicted lift per gap. Remediation paths.
      </p>

      {/* Honeypot — visually hidden, attractive to bots. JSON key is
          `referral_code`; input `name` is `website_url_2` for misdirection. */}
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

      <div className="mt-6 flex flex-col gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={disabled}
          className="border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-base text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-fg)] focus:outline-none disabled:opacity-60"
        />
        <label className="flex items-start gap-2 text-sm text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
            disabled={disabled}
            className="mt-1"
          />
          <span>
            Send me a monthly auto-rescan email when my score for{" "}
            <span className="font-mono text-[var(--color-fg)]">{scanUrl}</span>{" "}
            changes.
          </span>
        </label>
        <p className="text-xs text-[var(--color-muted)]">
          By submitting, you agree to our{" "}
          {/* Logo + Foundation slice: legal links demoted accent → fg. */}
          <a
            href="/privacy"
            className="text-[var(--color-fg)] underline-offset-4 hover:underline"
          >
            Privacy Policy
          </a>{" "}
          and{" "}
          <a
            href="/terms"
            className="text-[var(--color-fg)] underline-offset-4 hover:underline"
          >
            Terms
          </a>
          .
        </p>
        {/* Logo + Foundation slice: primary CTA — Score email-gate is the
            user's main action to receive the PDF gap report. Amber retained
            per decision 5; radius stripped per decision 4. */}
        <button
          type="submit"
          disabled={disabled}
          className="bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {disabled ? "Sending…" : "Email me the PDF report"}
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
