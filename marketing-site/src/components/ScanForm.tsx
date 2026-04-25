"use client";

import { useState } from "react";
import ScanResults, { type ScanResultData } from "./ScanResults";

type Status = "idle" | "scanning" | "done" | "error";

export default function ScanForm() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResultData | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("scanning");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as ScanResultData | { ok: false; error?: string };
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
      setResult(data as ScanResultData);
      setStatus("done");
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
            type="url"
            required
            inputMode="url"
            placeholder="https://your-site.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={status === "scanning"}
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={status === "scanning"}
            className="rounded-md bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "scanning" ? "Scanning…" : "Run free scan"}
          </button>
        </div>
        <p className="mt-3 text-sm italic text-[var(--color-muted)]">
          Free public scan. Slice 1 covers 3 of 6 dimensions; the rest ship soon.
        </p>
        {status === "scanning" ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 animate-pulse rounded-full bg-[var(--color-accent)]"
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

      {status === "done" && result ? (
        <div className="mt-12">
          <ScanResults data={result} />
        </div>
      ) : null}
    </div>
  );
}
