"use client";

import { useState } from "react";

function mapErrorCode(code: string | undefined): string {
  switch (code) {
    case "INVALID_SIG":
      return "This link is no longer valid. Email support@astrant.io for a fresh link.";
    case "SUBSCRIPTION_NOT_FOUND":
      return "Subscription not found. Email support@astrant.io if you believe this is an error.";
    case "DODO_RATE_LIMITED":
      return "Too many requests. Wait a moment and try again.";
    case "DODO_API_ERROR":
      return "Couldn't reach our billing provider. Try again or email support@astrant.io.";
    default:
      return "Something went wrong. Try again or email support@astrant.io.";
  }
}

function readSigFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("sig") ?? "";
}

export function AccountActions({
  subscriptionId,
  actionMode,
}: {
  subscriptionId: string;
  actionMode: "cancel" | "reactivate" | "expired" | "fallback";
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingState, setPendingState] = useState<
    null | { kind: "cancelled" | "reactivated"; periodEnd: number }
  >(null);
  const [errorMsg, setErrorMsg] = useState<null | string>(null);
  const [submitting, setSubmitting] = useState(false);

  if (pendingState?.kind === "cancelled") {
    return (
      <p className="text-[var(--color-fg)]">
        Cancellation pending — access through{" "}
        {new Date(pendingState.periodEnd * 1000).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        })}
        .
      </p>
    );
  }
  if (pendingState?.kind === "reactivated") {
    return (
      <p className="text-[var(--color-fg)]">
        Reactivated — renews{" "}
        {new Date(pendingState.periodEnd * 1000).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        })}
        .
      </p>
    );
  }

  async function callApi(endpoint: "cancel" | "reactivate"): Promise<void> {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const sig = readSigFromUrl();
      const res = await fetch(`/api/account/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ s: subscriptionId, sig }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        code?: string;
        next_billing_date?: number;
      };
      if (data.ok && typeof data.next_billing_date === "number") {
        setPendingState({
          kind: endpoint === "cancel" ? "cancelled" : "reactivated",
          periodEnd: data.next_billing_date,
        });
        setModalOpen(false);
      } else {
        setErrorMsg(mapErrorCode(data.code));
      }
    } catch {
      setErrorMsg("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {errorMsg && (
        <div className="mb-4 border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-fg)]">
          {errorMsg}
        </div>
      )}

      {actionMode === "cancel" && (
        <>
          <button
            type="button"
            className="inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
            onClick={() => setModalOpen(true)}
          >
            Cancel subscription
          </button>
          {modalOpen && (
            <ConfirmModal
              title="Cancel subscription?"
              body="You'll keep access through the end of the current billing period. No refund."
              confirmLabel="Confirm cancel"
              onConfirm={() => callApi("cancel")}
              onClose={() => setModalOpen(false)}
              submitting={submitting}
            />
          )}
        </>
      )}

      {actionMode === "reactivate" && (
        <>
          <button
            type="button"
            className="inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
            onClick={() => setModalOpen(true)}
          >
            Reactivate subscription
          </button>
          {modalOpen && (
            <ConfirmModal
              title="Reactivate subscription?"
              body="Your subscription will resume auto-renewal. Billing continues at the end of the current period."
              confirmLabel="Confirm reactivate"
              onConfirm={() => callApi("reactivate")}
              onClose={() => setModalOpen(false)}
              submitting={submitting}
            />
          )}
        </>
      )}

      {actionMode === "expired" && (
        <p className="text-[var(--color-muted)]">
          <a
            href="/subscriptions"
            className="text-[var(--color-accent)] underline-offset-2 hover:underline"
          >
            Resubscribe via the subscriptions page
          </a>
        </p>
      )}

      {actionMode === "fallback" && (
        <p className="text-[var(--color-muted)]">
          <a
            href="mailto:support@astrant.io"
            className="text-[var(--color-accent)] underline-offset-2 hover:underline"
          >
            Contact support@astrant.io
          </a>
        </p>
      )}
    </>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  submitting,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  submitting: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-xl font-semibold text-[var(--color-fg)]">
          {title}
        </h2>
        <p className="mt-4 text-base text-[var(--color-muted)]">{body}</p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="inline-flex bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting…" : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex border border-[var(--color-border)] px-5 py-2.5 text-sm font-semibold text-[var(--color-fg)] transition hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Keep subscription
          </button>
        </div>
      </div>
    </div>
  );
}
