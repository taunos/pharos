"use client";

import { useState } from "react";
import {
  BUDGET_RANGES,
  COMPLEXITY_FACTORS,
  SITE_TYPES,
  TIMELINES,
} from "@/lib/triage";
import TriageResults, { type TriageResultData } from "./TriageResults";

type Status = "idle" | "submitting" | "done" | "error";

export default function TriageForm() {
  const [siteUrl, setSiteUrl] = useState("");
  const [siteType, setSiteType] = useState<string>("");
  const [customNeeds, setCustomNeeds] = useState("");
  const [factors, setFactors] = useState<string[]>([]);
  const [budget, setBudget] = useState<string>("");
  const [timeline, setTimeline] = useState<string>("");
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TriageResultData | null>(null);

  function toggleFactor(f: string) {
    setFactors((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]
    );
  }

  function reset() {
    setStatus("idle");
    setResult(null);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      const payload = {
        site_url: siteUrl,
        site_type: siteType,
        custom_needs: customNeeds,
        complexity_factors: factors,
        budget_range: budget,
        timeline,
        ...(email ? { email } : {}),
        ...(honeypot ? { honeypot } : {}),
      };
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as
        | { ok: true; recommendation: TriageResultData["recommendation"]; explanation: string; cta: TriageResultData["cta"]; cached: boolean }
        | { ok: false; error: string };
      if (!res.ok || !data.ok) {
        setStatus("error");
        setError(("error" in data && data.error) || "Something went wrong. Try again.");
        return;
      }
      setResult({
        recommendation: data.recommendation,
        explanation: data.explanation,
        cta: data.cta,
        cached: !!data.cached,
      });
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Network error. Try again.");
    }
  }

  if (status === "done" && result) {
    return <TriageResults data={result} onReset={reset} />;
  }

  const customNeedsLen = customNeeds.trim().length;
  const customNeedsHint =
    customNeedsLen === 0
      ? "50–500 characters"
      : customNeedsLen < 50
        ? `${50 - customNeedsLen} more characters needed`
        : customNeedsLen > 500
          ? `${customNeedsLen - 500} characters over the 500 limit`
          : `${customNeedsLen}/500 — looks good`;

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-8" noValidate>
      {/* Honeypot — hidden from real users, attractive to bots */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0">
        <label htmlFor="website_url_2">Leave this field empty</label>
        <input
          type="text"
          id="website_url_2"
          name="website_url_2"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {/* Site URL */}
      <div className="flex flex-col gap-2">
        <label htmlFor="site_url" className="text-base font-semibold">
          Site URL
        </label>
        <input
          id="site_url"
          name="site_url"
          type="url"
          required
          placeholder="https://your-company.com"
          value={siteUrl}
          onChange={(e) => setSiteUrl(e.target.value)}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </div>

      {/* Site type */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-semibold">Site type</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SITE_TYPES.map((t) => (
            <label
              key={t}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm hover:border-[var(--color-accent)]"
            >
              <input
                type="radio"
                name="site_type"
                value={t}
                checked={siteType === t}
                onChange={() => setSiteType(t)}
                required
                className="accent-[var(--color-accent)]"
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Custom needs */}
      <div className="flex flex-col gap-2">
        <label htmlFor="custom_needs" className="text-base font-semibold">
          Tell us what makes your situation special
        </label>
        <textarea
          id="custom_needs"
          name="custom_needs"
          required
          minLength={50}
          maxLength={500}
          rows={4}
          placeholder="e.g. We have a multi-region presence with content in 5 languages, and need MCP tools that expose our booking inventory in real time."
          value={customNeeds}
          onChange={(e) => setCustomNeeds(e.target.value)}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <p className="text-xs text-[var(--color-muted)]">{customNeedsHint}</p>
      </div>

      {/* Complexity factors */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-semibold">
          Complexity factors{" "}
          <span className="text-sm font-normal text-[var(--color-muted)]">
            (check all that apply)
          </span>
        </legend>
        <div className="flex flex-col gap-2">
          {COMPLEXITY_FACTORS.map((f) => (
            <label
              key={f}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm hover:border-[var(--color-accent)]"
            >
              <input
                type="checkbox"
                name="complexity_factors"
                value={f}
                checked={factors.includes(f)}
                onChange={() => toggleFactor(f)}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <span>{f}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Budget */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-semibold">Budget range</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {BUDGET_RANGES.map((b) => (
            <label
              key={b}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm hover:border-[var(--color-accent)]"
            >
              <input
                type="radio"
                name="budget_range"
                value={b}
                checked={budget === b}
                onChange={() => setBudget(b)}
                required
                className="accent-[var(--color-accent)]"
              />
              <span>{b}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Timeline */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-semibold">Timeline</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TIMELINES.map((t) => (
            <label
              key={t}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm hover:border-[var(--color-accent)]"
            >
              <input
                type="radio"
                name="timeline"
                value={t}
                checked={timeline === t}
                onChange={() => setTimeline(t)}
                required
                className="accent-[var(--color-accent)]"
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Email (optional) */}
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-base font-semibold">
          Email{" "}
          <span className="text-sm font-normal text-[var(--color-muted)]">
            (optional — we&apos;ll send you a copy of the recommendation)
          </span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </div>

      {/* Submit */}
      <div>
        <button
          type="submit"
          disabled={status === "submitting"}
          className="rounded-md bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "submitting" ? "Analyzing…" : "Get my recommendation"}
        </button>
        {status === "submitting" ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Triage agent is reading your submission… typically 5–10 seconds.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
