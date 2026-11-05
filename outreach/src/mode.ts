// D10 fail-closed mode switch + the §4 per-mode gating table, as pure functions.
//
// Drafts-only mapping (Bruno, 2026-11-04). No mode ever sends; Bruno sends by hand.
//   off      inbox + opt-outs + Sent reconciliation + retention only
//   dry_run  + research, model calls, weekly batch in D1 (visible in /admin); no mailbox drafts (log only)
//   gated    + mailbox drafts (batches are approved automatically: Bruno's own send click is the human gate)
//   auto     same as gated (kept as a value so a deploy with "auto" isn't silently off)
import type { Env } from "./types";

export type OutreachMode = "off" | "dry_run" | "gated" | "auto";

export function parseMode(raw: string | undefined | null): OutreachMode {
  // Exact match only. Absent, empty, "OFF", " gated" ... all resolve to off.
  if (raw === "dry_run" || raw === "gated" || raw === "auto") return raw;
  return "off";
}

export function modeOf(env: Env): OutreachMode {
  return parseMode(env.OUTREACH_MODE);
}

/** Prospect scans, robots/contact fetches, LLM calls: any third-party traffic or spend. */
export function mayResearch(mode: OutreachMode): boolean {
  return mode !== "off";
}

/** Model calls (drafting, reply classification). Same gate as research. */
export function mayCallModel(mode: OutreachMode): boolean {
  return mode !== "off";
}

export function mayBuildBatch(mode: OutreachMode): boolean {
  return mode !== "off";
}

/** Approving a batch queues mailbox drafts, so it is refused outside gated/auto. */
export function mayApprove(mode: OutreachMode): boolean {
  return mode === "gated" || mode === "auto";
}

/** Saving drafts in the mailbox. Nothing in this Worker can send. */
export function mayCreateDrafts(mode: OutreachMode): boolean {
  return mode === "gated" || mode === "auto";
}

export function intEnv(raw: string | undefined, dflt: number, min: number, max: number): number {
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
