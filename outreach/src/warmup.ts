// §8.2 warm-up ramp and daily cap.
import { DAY, inSendWindow } from "./clock";
import { intEnv } from "./mode";
import type { ControlRow, Env } from "./types";

export const DNS_WARMUP_MS = 14 * DAY;

// Ramp weeks 1..4 → 5, 10, 15, 20 cold sends per weekday. Week 5+ → STEADY_CAP.
const RAMP = [5, 10, 15, 20];
// Spec table says 25 for week 5+; OQ-1 holds the steady cap at 10–15/day until
// the directory leads are imported, so STEADY_CAP (default 15) is the knob.
export const STEADY_CAP_DEFAULT = 15;
export const STEADY_CAP_SPEC_MAX = 25;

/** Effective ramp elapsed time: the ramp does not advance while paused. */
export function rampElapsedMs(c: Pick<ControlRow, "ramp_start_at" | "ramp_paused_ms" | "paused" | "paused_at">, now: number): number | null {
  if (c.ramp_start_at == null) return null;
  let pausedMs = c.ramp_paused_ms;
  if (c.paused && c.paused_at != null && c.paused_at > c.ramp_start_at) pausedMs += now - c.paused_at;
  return Math.max(0, now - c.ramp_start_at - pausedMs);
}

/** Schedule cap for a day, before DAILY_CAP_MAX. 0 when the ramp hasn't started. */
export function scheduleCap(elapsedMs: number | null, steadyCap: number): number {
  if (elapsedMs == null) return 0;
  const week = Math.floor(elapsedMs / (7 * DAY)); // 0-based ramp week
  if (week < RAMP.length) return RAMP[week];
  return steadyCap;
}

export function dailyCap(env: Env, c: ControlRow, now: number): number {
  const max = intEnv(env.DAILY_CAP_MAX, 30, 0, 30);
  const steady = intEnv(env.STEADY_CAP, STEADY_CAP_DEFAULT, 0, STEADY_CAP_SPEC_MAX);
  return Math.min(scheduleCap(rampElapsedMs(c, now), steady), max);
}

/** Cap for a batch week that may begin before the ramp has started (first approval starts it). */
export function capForWeekStartingAt(env: Env, c: ControlRow, at: number): number {
  const max = intEnv(env.DAILY_CAP_MAX, 30, 0, 30);
  const steady = intEnv(env.STEADY_CAP, STEADY_CAP_DEFAULT, 0, STEADY_CAP_SPEC_MAX);
  const elapsed = c.ramp_start_at == null ? 0 : rampElapsedMs(c, at);
  return Math.min(scheduleCap(elapsed, steady), max);
}

export function dnsWarmupDone(c: Pick<ControlRow, "dns_verified_at">, now: number): boolean {
  return c.dns_verified_at != null && now >= c.dns_verified_at + DNS_WARMUP_MS;
}

export { inSendWindow };
