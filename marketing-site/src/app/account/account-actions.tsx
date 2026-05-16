"use client";

import { useState, useEffect } from "react";

const OVERLAY_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};
const MODAL_STYLE: React.CSSProperties = {
  background: "#fff",
  color: "#111",
  maxWidth: 480,
  width: "92%",
  padding: "1.5rem",
  borderRadius: "8px",
  boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
  fontFamily: "system-ui, sans-serif",
};
const BUTTON_PRIMARY: React.CSSProperties = {
  padding: "0.625rem 1rem",
  fontSize: "1rem",
  borderRadius: "6px",
  border: "none",
  background: "#0e1116",
  color: "#fff",
  cursor: "pointer",
  marginRight: "0.5rem",
};
const BUTTON_SECONDARY: React.CSSProperties = {
  ...BUTTON_PRIMARY,
  background: "transparent",
  color: "#111",
  border: "1px solid #ccc",
};
const ERROR_BANNER: React.CSSProperties = {
  padding: "0.75rem 1rem",
  background: "#fee",
  border: "1px solid #c66",
  borderRadius: "6px",
  color: "#900",
  marginBottom: "1rem",
};

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
      {errorMsg && <div style={ERROR_BANNER}>{errorMsg}</div>}

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
  const [countdown, setCountdown] = useState(2);
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const disabled = countdown > 0 || submitting;
  const label = submitting
    ? "Submitting…"
    : countdown > 0
      ? `${confirmLabel} (${countdown}s)`
      : confirmLabel;

  return (
    <div style={OVERLAY_STYLE} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div style={MODAL_STYLE}>
        <h2 id="confirm-title" style={{ marginTop: 0 }}>
          {title}
        </h2>
        <p>{body}</p>
        <button style={BUTTON_PRIMARY} onClick={onConfirm} disabled={disabled}>
          {label}
        </button>
        <button style={BUTTON_SECONDARY} onClick={onClose} disabled={submitting}>
          Keep subscription
        </button>
      </div>
    </div>
  );
}
