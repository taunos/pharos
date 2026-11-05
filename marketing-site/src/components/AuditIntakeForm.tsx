"use client";

import { useState } from "react";
import {
  INTAKE_NOTES_HINT,
  INTAKE_NOTES_LABEL,
  INTAKE_NOTES_MAX,
  INTAKE_QUESTIONS,
} from "@/lib/dataset-intake";

// Dataset spec v2 §3 — optional post-purchase intake on the results page.
// Every field is skippable; nothing here gates the audit.

type Status = "idle" | "submitting" | "done" | "error";

export default function AuditIntakeForm({ sessionId }: { sessionId: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch("/api/audit-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, ...answers, notes }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      setStatus(data.ok || data.error === "ALREADY_SUBMITTED" ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <p className="mt-12 text-sm text-emerald-400">Thanks — saved.</p>
    );
  }

  const disabled = status === "submitting";
  const fieldClass =
    "border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-base text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60";

  return (
    <form onSubmit={onSubmit} className="mt-12 border-t border-[var(--color-border)] pt-8">
      <h2 className="text-xl font-semibold">A few optional questions</h2>
      <p className="mt-2 text-sm text-[var(--color-muted)]">Skip any or all of them.</p>
      <div className="mt-6 flex flex-col gap-5">
        {INTAKE_QUESTIONS.map((q) => (
          <label key={q.id} className="flex flex-col gap-2 text-sm">
            <span className="text-[var(--color-fg)]">{q.label}</span>
            <select
              name={q.id}
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              disabled={disabled}
              className={fieldClass}
            >
              <option value="">—</option>
              {q.options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-[var(--color-fg)]">{INTAKE_NOTES_LABEL}</span>
          <span className="text-[var(--color-muted)]">{INTAKE_NOTES_HINT}</span>
          <textarea
            name="notes"
            rows={4}
            maxLength={INTAKE_NOTES_MAX}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={disabled}
            className={fieldClass}
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={disabled}
        className="mt-6 border border-[var(--color-border)] px-6 py-3 text-base text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {disabled ? "Sending…" : "Send answers"}
      </button>
      {status === "error" ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          Couldn&apos;t save your answers. You can skip this step.
        </p>
      ) : null}
    </form>
  );
}
