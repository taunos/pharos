"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AuditReportBody,
  AuditReportHeader,
  AuditReportSummary,
} from "@/components/AuditReportView";
import type { AuditResult } from "@/lib/audit-types";
import {
  buildAuditReportModel,
  type AuditReportModel,
} from "@/lib/audit-report-model";

type StatusPayload =
  | { ok: true; status: "awaiting_payment"; message: string }
  | {
      ok: true;
      status: "fulfilling";
      message: string;
      started_at?: number;
    }
  | {
      ok: true;
      status: "ready";
      pdf_url: string;
      json_url: string;
      completed_at?: number;
      composite_score?: number;
      grade?: string;
    }
  | {
      ok: true;
      status: "error";
      error_message: string;
      can_retry: boolean;
    }
  | { ok: false; error: string };

const POLL_INTERVAL_MS = 2000;
const SOFT_TIMEOUT_MS = 5 * 60 * 1000;

function gradeColor(grade?: string): string {
  if (!grade) return "text-[var(--color-fg)]";
  if (grade.startsWith("A")) return "text-emerald-400";
  if (grade.startsWith("B")) return "text-emerald-300";
  if (grade === "C") return "text-yellow-400";
  if (grade === "D") return "text-orange-400";
  return "text-red-400";
}

// Minimal shape check on the stored JSON before handing it to the model
// builder. Anything else → no on-page report; the download buttons still work.
export function parseAuditResult(data: unknown): AuditResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Partial<AuditResult>;
  const scan = d.scan as Partial<AuditResult["scan"]> | undefined;
  if (!scan || typeof scan !== "object") return null;
  if (!Array.isArray(scan.dimensions) || !Array.isArray(d.gaps)) return null;
  if (!scan.composite || typeof scan.url !== "string") return null;
  return d as AuditResult;
}

type ReportState =
  | { state: "loading" }
  | { state: "ready"; model: AuditReportModel }
  | { state: "unavailable" };

function isTerminal(p: StatusPayload | null): boolean {
  if (!p || !p.ok) return false;
  return p.status === "ready" || p.status === "error";
}

export default function AuditResultsPoller({
  sessionId,
  intro,
  afterPaid,
}: {
  sessionId: string;
  // The page's "Hold tight…" paragraph: shown until the audit is ready.
  intro?: ReactNode;
  // Shown under the status once payment is confirmed (fulfilling / ready).
  afterPaid?: ReactNode;
}) {
  const [payload, setPayload] = useState<StatusPayload | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [softTimedOut, setSoftTimedOut] = useState(false);
  const startTsRef = useRef<number>(Date.now());
  const [report, setReport] = useState<ReportState>({ state: "loading" });
  const jsonUrl = payload?.ok && payload.status === "ready" ? payload.json_url : null;

  // Once ready, pull the stored audit JSON (the same object the PDF was
  // rendered from) and shape it with the PDF's own model builder.
  useEffect(() => {
    if (!jsonUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(jsonUrl);
        if (!res.ok) throw new Error(`json ${res.status}`);
        const audit = parseAuditResult(await res.json());
        if (!audit) throw new Error("json shape");
        if (!cancelled) {
          setReport({ state: "ready", model: buildAuditReportModel(audit, sessionId) });
        }
      } catch {
        if (!cancelled) setReport({ state: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jsonUrl, sessionId]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/audit-status/${sessionId}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as StatusPayload;
      setPayload(data);
      setNetworkError(null);
    } catch {
      setNetworkError("Couldn't reach the server. Retrying…");
    }
  }, [sessionId]);

  // Initial fetch on mount.
  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Schedule the next poll based on current payload.
  useEffect(() => {
    if (isTerminal(payload)) return;
    const handle = setTimeout(() => {
      if (Date.now() - startTsRef.current > SOFT_TIMEOUT_MS) {
        setSoftTimedOut(true);
      }
      void fetchStatus();
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(handle);
  }, [payload, fetchStatus]);

  async function onRetry() {
    await fetchStatus();
  }

  const isReady = !!payload && payload.ok && payload.status === "ready";
  const isPaid =
    !!payload && payload.ok && (payload.status === "fulfilling" || payload.status === "ready");
  const frame = (body: ReactNode) => (
    <>
      {isReady ? null : intro}
      <p className="mt-2 text-xs font-mono text-[var(--color-muted)]">
        Session: {sessionId}
      </p>
      {body}
      {isPaid ? afterPaid : null}
    </>
  );

  if (networkError && !payload) {
    return frame(
      <div className="mt-8 border border-red-400/40 bg-red-500/10 p-6">
        <p className="text-red-300">{networkError}</p>
      </div>
    );
  }

  if (!payload) {
    return frame(
      <div className="mt-8 border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
        <p className="text-[var(--color-muted)]">Loading status…</p>
      </div>
    );
  }

  if (!payload.ok) {
    return frame(
      <div className="mt-8 border border-red-400/40 bg-red-500/10 p-6">
        <p className="text-red-300">{payload.error}</p>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Email{" "}
          <a
            className="text-[var(--color-fg)] hover:underline"
            href={`mailto:contact@astrant.io?subject=Astrant%20audit%20issue%20%E2%80%94%20session%20${encodeURIComponent(sessionId)}`}
          >
            contact@astrant.io
          </a>{" "}
          with session ID <code className="font-mono">{sessionId}</code> if you just
          paid and this isn&apos;t resolving.
        </p>
      </div>
    );
  }

  if (payload.status === "ready") {
    return frame(
      <div className="mt-8 flex flex-col gap-6">
        <div className="border border-emerald-500/40 bg-emerald-500/10 p-6">
          <p className="text-sm font-mono uppercase tracking-wider text-emerald-300">
            Audit ready
          </p>
          {report.state === "ready" ? (
            <AuditReportHeader model={report.model} />
          ) : typeof payload.composite_score === "number" ? (
            <div className="mt-3 flex items-baseline gap-4">
              <span className="text-5xl font-bold text-[var(--color-fg)]">
                {payload.composite_score}
              </span>
              <span className={`text-2xl font-mono ${gradeColor(payload.grade)}`}>
                {payload.grade ?? ""}
              </span>
            </div>
          ) : null}
        </div>

        {report.state === "ready" ? (
          <AuditReportSummary model={report.model} />
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Logo + Foundation slice: primary download CTA — amber retained
              (this is the user's main outcome); secondary CTA is outline.
              Radii stripped per decision 4. */}
          <a
            href={payload.pdf_url}
            className="inline-flex justify-center bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
          >
            Download PDF audit
          </a>
          <a
            href={payload.json_url}
            className="inline-flex justify-center border border-[var(--color-border)] px-6 py-3 text-base text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)]"
          >
            Download JSON export
          </a>
        </div>

        <p className="text-sm italic text-[var(--color-muted)]">
          This page expires after 30 days; the PDF and JSON download links
          keep working, and the PDF is in your inbox. Forward to teammates or
          your dev team as-is.
        </p>

        {report.state === "ready" ? (
          <div className="mt-4">
            <AuditReportBody model={report.model} />
          </div>
        ) : report.state === "loading" ? (
          // Same spinner as the in-progress state; no visible copy.
          // rounded-full retained (functional shape — radius-free allowlist).
          <div
            role="status"
            aria-label="Loading report"
            className="size-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-fg)] motion-reduce:animate-[spin_3s_linear_infinite]"
          />
        ) : null}
      </div>
    );
  }

  if (payload.status === "error") {
    return frame(
      <div className="mt-8 border border-red-400/40 bg-red-500/10 p-6">
        <p className="font-semibold text-red-300">Something went wrong.</p>
        <p className="mt-2 text-sm text-red-200">{payload.error_message}</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={onRetry}
            className="border border-red-400/40 px-5 py-2 text-sm text-red-200 transition hover:bg-red-500/20"
          >
            Re-check status
          </button>
          <a
            href={`mailto:contact@astrant.io?subject=Astrant%20audit%20error%20%E2%80%94%20session%20${encodeURIComponent(sessionId)}`}
            className="border border-[var(--color-border)] px-5 py-2 text-sm text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)]"
          >
            Email us
          </a>
        </div>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Session ID: <code className="font-mono">{sessionId}</code>
        </p>
      </div>
    );
  }

  // awaiting_payment / fulfilling
  return frame(
    <div className="mt-8 border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
      <div className="flex items-center gap-3">
        {/* Spinner (was a muted pulsing dot — too subtle to read as "working").
            Neutral fg, not accent. rounded-full retained (functional shape —
            radius-free allowlist). */}
        <div
          role="status"
          aria-label="In progress"
          className="size-5 shrink-0 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-fg)] motion-reduce:animate-[spin_3s_linear_infinite]"
        />
        <p className="font-semibold text-[var(--color-fg)]">
          {payload.status === "awaiting_payment"
            ? "Waiting on payment confirmation"
            : "Audit running"}
        </p>
      </div>
      <p className="mt-3 text-[var(--color-muted)]">{payload.message}</p>
      {softTimedOut ? (
        <p className="mt-4 text-sm text-orange-300">
          This is taking longer than expected. We&apos;ve been notified. Email{" "}
          <a
            className="text-[var(--color-fg)] hover:underline"
            href={`mailto:contact@astrant.io?subject=Astrant%20audit%20slow%20%E2%80%94%20session%20${encodeURIComponent(sessionId)}`}
          >
            contact@astrant.io
          </a>{" "}
          with session ID <code className="font-mono">{sessionId}</code>.
        </p>
      ) : null}
    </div>
  );
}
