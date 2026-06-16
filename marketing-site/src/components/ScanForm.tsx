"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ScanResult } from "@/lib/audit-types";
import { normalizeUrl } from "@/lib/normalize-url";

type Status = "idle" | "scanning" | "done" | "error";

export default function ScanForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setError("Please enter a valid URL (e.g. example.com or https://example.com).");
      setStatus("error");
      return;
    }
    setStatus("scanning");
    setError(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized }),
      });
      const data = (await res.json()) as ScanResult | { ok: false; error?: string };
      if (!res.ok) {
        if (res.status >= 500) {
          setError("Scanner is having a moment. Try again in a sec.");
        } else {
          const errMsg =
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : `Scan failed (HTTP ${res.status}).`;
          setError(errMsg);
        }
        setStatus("error");
        return;
      }
      // Score V3 — route to the canonical /score/[id] result page. Stash the
      // result in sessionStorage as a fallback for the rare best-effort-persist
      // miss (the result page reads it only if getPublicScan misses server-side).
      const scan = data as ScanResult;
      try {
        sessionStorage.setItem(scan.id, JSON.stringify(scan));
      } catch {
        // sessionStorage unavailable (private mode / quota) — the server path
        // still works; only the rare-miss fallback is forgone.
      }
      router.push(`/score/${scan.id}`);
    } catch {
      setError("Network error. Try again.");
      setStatus("error");
    }
  }

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="w-full max-w-2xl">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="scan-url"
            name="url"
            type="text"
            required
            inputMode="url"
            autoComplete="url"
            placeholder="your-site.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={status === "scanning"}
            // Logo + Foundation slice: input focus border demoted accent → fg.
            // Radius stripped.
            className="flex-1 border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-base text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-fg)] focus:outline-none disabled:opacity-60"
          />
          {/* Logo + Foundation slice: primary-CTA fill — amber retained per
              decision 5 (this IS the canonical primary CTA). Radius stripped. */}
          <button
            type="submit"
            disabled={status === "scanning"}
            className="bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "scanning" ? "Scanning…" : "Run free scan"}
          </button>
        </div>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Six dimensions. Citation Visibility appears as a demo preview on the free Score — live with the $79 Audit.
        </p>
        {status === "scanning" ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-[var(--color-muted)]">
            {/* Logo + Foundation slice: progress pulse demoted accent → muted.
                rounded-full retained — required to render the dot as a circle
                (functional shape, not aesthetic — radius-free allowlist). */}
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 animate-pulse rounded-full bg-[var(--color-muted)]"
            />
            Scanning your site… typically 10–20 seconds.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-400">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
