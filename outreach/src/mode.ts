// D10 fail-closed mode switch + the §4 per-mode gating table, as pure functions.
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

/** Approving a batch queues real sends, so it is refused outside gated/auto. */
export function mayApprove(mode: OutreachMode): boolean {
  return mode === "gated" || mode === "auto";
}

export function maySend(mode: OutreachMode): boolean {
  return mode === "gated" || mode === "auto";
}

export function intEnv(raw: string | undefined, dflt: number, min: number, max: number): number {
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
