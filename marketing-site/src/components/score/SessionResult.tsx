"use client";

// Score V3 — client helpers for the canonical /score/[id] result page.
//
// SessionResultCleanup: clears the sessionStorage stash on the NORMAL server
// path (the row exists, so the fallback is unnecessary). Server components
// can't touch browser storage, so this runs client-side.
//
// SessionResultFallback: the server-MISS path. Fires only when
// getPublicScan(scanId) returns no row — the rare best-effort-persist failure.
// getScanState/EmailGate/PDF all depend on that same missing row, so this is a
// DEGRADED, score-only view: ScorePanel from sessionStorage + the rescan note
// in place of the email CTA. If sessionStorage is also empty (e.g. a stranger
// opening a bad link), it shows the existing not-found UI.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ScanResult } from "@/lib/audit-types";
import ScorePanel from "@/components/ScorePanel";

export function SessionResultCleanup({ scanId }: { scanId: string }) {
  useEffect(() => {
    try {
      sessionStorage.removeItem(scanId);
    } catch {
      // sessionStorage unavailable — nothing to clean up.
    }
  }, [scanId]);
  return null;
}

export function SessionResultFallback({ scanId }: { scanId: string }) {
  // undefined = still checking (avoid flashing not-found before the read).
  const [scan, setScan] = useState<ScanResult | null | undefined>(undefined);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(scanId);
      setScan(raw ? (JSON.parse(raw) as ScanResult) : null);
    } catch {
      setScan(null);
    }
  }, [scanId]);

  if (scan === undefined) {
    return null;
  }

  if (!scan) {
    return (
      <section className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="text-3xl font-bold tracking-tight">Scan not found</h1>
        <p className="mt-4 text-[var(--color-muted)]">
          We don&apos;t have a record for that scan ID. Run a fresh scan at{" "}
          <Link href="/score" className="text-[var(--color-fg)] underline">
            /score
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-sm font-mono uppercase tracking-wider text-[var(--color-muted)]">
        Astrant Score · scan {scanId.slice(0, 8)}
      </p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
        <span className="font-mono text-[var(--color-fg)]">{scan.url}</span>
      </h1>
      <div className="mt-8">
        <ScorePanel composite={scan.composite} dimensions={scan.dimensions} />
      </div>
      <div className="mt-10 border border-amber-400/40 bg-amber-400/5 p-6 text-base">
        <p className="text-[var(--color-muted)]">
          This result wasn&apos;t saved — run the scan again to get your emailed
          report and PDF.
        </p>
      </div>
    </section>
  );
}
