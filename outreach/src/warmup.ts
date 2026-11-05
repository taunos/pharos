// Daily cap + optional warm-up wait (drafts-only model, Bruno 2026-11-04).
//
// Bruno sends every email himself, ~10 a week. The cap only stops drafts from
// piling up in the mailbox: DRAFTS_PER_DAY (default 10) mailbox drafts per UTC
// day, never above DAILY_CAP_MAX (30). Follow-up drafts count against it.
// The spec's 5/10/15/20/25 ramp is dropped: at human-sent, ~10/week volume a
// formal warm-up is optional. WARMUP_DAYS (default 0) still lets Bruno require
// N days after "Mark DNS verified" before the first draft is created.
import { DAY } from "./clock";
import { intEnv } from "./mode";
import type { ControlRow, Env } from "./types";

export const DRAFTS_PER_DAY_DEFAULT = 10;

export function dailyCap(env: Env): number {
  const max = intEnv(env.DAILY_CAP_MAX, 30, 0, 30);
  return Math.min(intEnv(env.DRAFTS_PER_DAY, DRAFTS_PER_DAY_DEFAULT, 0, 30), max);
}

export function warmupMs(env: Env): number {
  return intEnv(env.WARMUP_DAYS, 0, 0, 60) * DAY;
}

/** dns_verified_at must be set (Bruno confirms SPF/DKIM/DMARC) and the optional wait must have passed. */
export function dnsWarmupDone(env: Env, c: Pick<ControlRow, "dns_verified_at">, now: number): boolean {
  return c.dns_verified_at != null && now >= c.dns_verified_at + warmupMs(env);
}
