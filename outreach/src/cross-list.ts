// E5: Astrant's other opt-out lists, checked before any draft to a lead.
//
// Someone who unsubscribed from Astrant's normal emails, or asked /score/delete-me
// to remove their data, must never get an outreach draft (privacy.md, prospecting:
// "We'll never contact that address again"). Those lists live in the marketing
// site's database (pharos-citation-tracking), bound here as OPTOUT_LISTS_DB:
//   - email_suppressions       (marketing List-Unsubscribe; citation-tracking 0011)
//   - outreach_do_not_contact  (written by /score/delete-me; citation-tracking 0017)
// Both key on SHA-256 hex of the lower-cased, trimmed address, exactly as
// marketing-site/src/lib/email-suppressions.ts hashEmailSha256 computes it. Neither
// stores a domain, so the match is per address.
//
// READ-ONLY: this file is the only place that touches OPTOUT_LISTS_DB and it only
// runs SELECTs (a static test enforces both). FAIL-CLOSED: no binding, a missing
// table or any query error is "unavailable", and every caller treats that as
// "do not draft".
import { startOfUtcDay } from "./clock";
import { logEvent } from "./db";
import type { Alerter } from "./alerts";
import type { Env } from "./types";

export type CrossListStatus = "clear" | "suppressed" | "unavailable";

/** Byte-identical to marketing-site hashEmailSha256. */
export async function marketingEmailHash(email: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.toLowerCase().trim()));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function crossListStatus(env: Env, email: string | null | undefined): Promise<CrossListStatus> {
  const db = env.OPTOUT_LISTS_DB;
  if (!db || !email || !email.trim()) return "unavailable";
  try {
    const h = await marketingEmailHash(email);
    const r = await db
      .prepare(
        "SELECT 1 AS x FROM email_suppressions WHERE email_hash = ? UNION ALL SELECT 1 AS x FROM outreach_do_not_contact WHERE email_hash = ? LIMIT 1"
      )
      .bind(h, h)
      .first<{ x: number }>();
    return r ? "suppressed" : "clear";
  } catch (e) {
    console.error("optout_lists_unavailable", e instanceof Error ? e.message : String(e));
    return "unavailable";
  }
}

/** One event + one alert per UTC day while the lists can't be read (drafting is held meanwhile). */
export async function noteOptoutListsUnavailable(env: Env, now: number, alert: Alerter): Promise<void> {
  const today =
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'optout_lists_unavailable' AND at >= ?").bind(startOfUtcDay(now)).first<{ n: number }>())
      ?.n ?? 0;
  if (today > 0) return;
  await logEvent(env.DB, now, "optout_lists_unavailable", null);
  await alert(
    "Opt-out lists unreachable: drafting held",
    "Outreach could not read the marketing opt-out lists (OPTOUT_LISTS_DB). No outreach draft is created until it can. Check the binding and the citation-tracking migration 0017."
  );
}
