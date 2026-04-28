"use client";

import { useState } from "react";

export type SubCheck = {
  id: string;
  name: string;
  weight: number;
  score: number;
  passed: boolean;
  notes: string;
  na?: boolean;
};

export type DimensionResult = {
  dimension_id: number;
  dimension_name: string;
  score: number;
  grade: string;
  sub_checks: SubCheck[];
};

export type ScanResultData = {
  id: string;
  url: string;
  composite: { score: number; grade: string };
  dimensions: DimensionResult[];
  dimensions_scored: number;
  dimensions_total: number;
  created_at: number;
};

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "text-emerald-400";
  if (grade.startsWith("B")) return "text-emerald-300";
  if (grade === "C") return "text-yellow-400";
  if (grade === "D") return "text-orange-400";
  return "text-red-400";
}

function ScoreBar({ score }: { score: number }) {
  const w = Math.max(0, Math.min(100, score));
  const color =
    score >= 70
      ? "bg-emerald-500"
      : score >= 60
        ? "bg-yellow-500"
        : score >= 40
          ? "bg-orange-500"
          : "bg-red-500";
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg)]"
      role="progressbar"
      aria-valuenow={w}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function DimensionCard({ dim }: { dim: DimensionResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-semibold">{dim.dimension_name}</h3>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold text-[var(--color-fg)]">{dim.score}</span>
          <span className={`text-sm font-mono ${gradeColor(dim.grade)}`}>{dim.grade}</span>
        </div>
      </div>
      <div className="mt-3">
        <ScoreBar score={dim.score} />
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-4 text-sm text-[var(--color-accent)] hover:underline"
        aria-expanded={open}
      >
        {open ? "Hide details" : "Show details"}
      </button>
      {open ? (
        <ul className="mt-4 flex flex-col gap-3 border-t border-[var(--color-border)] pt-4">
          {dim.sub_checks.map((s) => {
            const freeTierBadge = s.notes.includes(
              "Full render diff (Puppeteer-vs-static) available in $79 Audit"
            );
            const naBadge = !!s.na;
            return (
              <li key={s.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-[var(--color-fg)]">
                    {s.name}
                    {naBadge ? (
                      <span className="ml-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted)]">
                        N/A
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[var(--color-muted)]">
                    {naBadge ? "—" : `${s.score}/100`} · weight {s.weight}%
                  </span>
                </div>
                <p className="mt-1 text-[var(--color-muted)]">{s.notes}</p>
                {freeTierBadge ? (
                  <a
                    href="/audit"
                    className="mt-2 inline-flex items-center gap-2 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1 text-xs font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent)] hover:text-black"
                  >
                    Run the $79 Audit for the full render diff →
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export default function ScanResults({ data }: { data: ScanResultData }) {
  const [email, setEmail] = useState("");
  const [waitlistStatus, setWaitlistStatus] = useState<"idle" | "submitting" | "done" | "error">(
    "idle"
  );
  const [waitlistMsg, setWaitlistMsg] = useState<string | null>(null);

  async function onWaitlistSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setWaitlistStatus("submitting");
    setWaitlistMsg(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: data.url, email }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (res.ok && j.ok) {
        setWaitlistStatus("done");
        setWaitlistMsg("Got it. We'll send the next monthly rescan to your inbox.");
        setEmail("");
      } else {
        setWaitlistStatus("error");
        setWaitlistMsg(j.error ?? "Couldn't save that — try again.");
      }
    } catch {
      setWaitlistStatus("error");
      setWaitlistMsg("Network error. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <p className="text-sm text-[var(--color-muted)]">Scanned</p>
        <p className="mt-1 break-all font-mono text-base text-[var(--color-fg)]">{data.url}</p>
        <div className="mt-6 flex items-baseline gap-6">
          <span className="text-7xl font-bold text-[var(--color-fg)]">
            {data.composite.score}
          </span>
          <span className={`text-3xl font-mono ${gradeColor(data.composite.grade)}`}>
            {data.composite.grade}
          </span>
        </div>
        <p className="mt-4 text-sm italic text-[var(--color-muted)]">
          Scored on {data.dimensions_scored} of {data.dimensions_total} dimensions — full report
          when remaining dimensions ship.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {data.dimensions.map((d) => (
          <DimensionCard key={d.dimension_id} dim={d} />
        ))}
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h3 className="text-lg font-semibold">Watch your score over time</h3>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Optional: drop your email and we&apos;ll auto-rescan this URL each month and email you
          the diff. Unsubscribe anytime.
        </p>
        <form onSubmit={onWaitlistSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            type="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={waitlistStatus === "submitting"}
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2 text-base text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={waitlistStatus === "submitting" || waitlistStatus === "done"}
            className="rounded-md border border-[var(--color-accent)] px-5 py-2 text-base font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent)] hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {waitlistStatus === "submitting"
              ? "Sending…"
              : waitlistStatus === "done"
                ? "Subscribed"
                : "Send me a monthly auto-rescan"}
          </button>
        </form>
        {waitlistMsg ? (
          <p
            className={`mt-3 text-sm ${
              waitlistStatus === "done" ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {waitlistMsg}
          </p>
        ) : null}
      </div>
    </div>
  );
}
