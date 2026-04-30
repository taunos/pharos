"use client";

import { useEffect, useState } from "react";

// Polls the scanner's state endpoint via a thin marketing-site proxy at
// /api/score/[id]/state until pdf_ready === true (or the user gives up).
// Mirrors /audit-results/[sessionId]'s polling-page UX.

interface State {
  pdf_ready: boolean;
  pdf_deferred_until_tomorrow: boolean;
}

const POLL_INTERVAL_MS = 15_000;
const MAX_POLLS = 16; // ~4 minutes

export default function ScorePdfPoller({
  scanId,
  token,
}: {
  scanId: string;
  token: string;
}) {
  const [state, setState] = useState<State | null>(null);
  const [polls, setPolls] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (done) return;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/score/${scanId}/state?t=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          setError("Couldn't reach the server.");
          return;
        }
        const data = (await res.json()) as State;
        setState(data);
        if (data.pdf_ready || data.pdf_deferred_until_tomorrow) {
          setDone(true);
        }
      } catch {
        setError("Network error.");
      }
    };
    void tick();
    const interval = setInterval(() => {
      setPolls((p) => p + 1);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polls, done, scanId, token]);

  if (state?.pdf_ready) {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-6">
        <p className="text-base font-semibold text-emerald-300">
          PDF ready. Refreshing…
        </p>
        <a
          href={`/api/score/${scanId}/pdf?t=${encodeURIComponent(token)}`}
          className="mt-4 inline-flex rounded-md bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
        >
          Download PDF gap report
        </a>
      </div>
    );
  }

  if (state?.pdf_deferred_until_tomorrow) {
    return (
      <div className="rounded-md border border-amber-400/40 bg-amber-400/5 p-6 text-base">
        <p className="font-semibold text-amber-300">Your PDF is queued.</p>
        <p className="mt-2 text-[var(--color-muted)]">
          We&apos;re generating gap-report PDFs at capacity right now. Yours
          will be ready within 24 hours.
        </p>
      </div>
    );
  }

  if (polls >= MAX_POLLS) {
    return (
      <div className="rounded-md border border-orange-400/40 bg-orange-400/5 p-6 text-base">
        <p className="font-semibold text-orange-300">
          PDF generation is taking longer than expected.
        </p>
        <p className="mt-2 text-[var(--color-muted)]">
          Refresh this page or check your email. If it&apos;s been more than
          an hour, email{" "}
          <a
            className="text-[var(--color-accent)] underline-offset-4 hover:underline"
            href="mailto:hello@astrant.io"
          >
            hello@astrant.io
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <div className="flex items-center gap-3">
        <div className="size-3 animate-pulse rounded-full bg-[var(--color-accent)]" />
        <p className="text-base font-semibold">Generating your PDF…</p>
      </div>
      <p className="mt-3 text-sm text-[var(--color-muted)]">
        We&apos;re rendering your gap report. Usually under 60 seconds. This
        page will refresh automatically. {error ? `(Last error: ${error}.)` : ""}
      </p>
    </div>
  );
}
