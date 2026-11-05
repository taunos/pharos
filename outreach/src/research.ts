// §6 research: one step per tick (robots → scan → contact, or a rescan).
import { DAY, startOfUtcDay } from "./clock";
import { eventStmt, logEvent, moveLead } from "./db";
import { euExclusion, isDenylisted } from "./eligibility";
import { isPublicHostname, safeHttpsUrl, sameSite } from "./safety";
import { buildFactSheet, MIN_GAPS } from "./facts";
import { intEnv } from "./mode";
import { isSuppressed, requestScanDeletionStmt } from "./suppression";
import type { Env, LeadRow } from "./types";

export const OUTREACH_UA = "AstrantOutreach/1.0 (+https://astrant.io)";
export const FETCH_TIMEOUT_MS = 5000;
export const MAX_REDIRECTS = 3;
export const MAX_RESPONSE_BYTES = 1_000_000;
export const MAX_SCAN_ATTEMPTS = 2;
export const RESCAN_AFTER_MS = 7 * DAY;

type Fetch = typeof fetch;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type SafeResponse = { status: number; contentType: string; body: string; url: string };

/**
 * SSRF-safe GET (Bruno's security priority):
 *  - public https hosts on port 443 only, no IPs/localhost/private/.internal/.local
 *    (safeHttpsUrl), and the Worker runs with global_fetch_strictly_public;
 *  - redirects followed by hand (max MAX_REDIRECTS), each target re-validated and
 *    required to stay on the lead's own site (domain or www.domain);
 *  - one overall deadline (FETCH_TIMEOUT_MS) and a body cap (MAX_RESPONSE_BYTES).
 * Returns null on any violation or error: callers treat that as "nothing found".
 */
export async function safeFetch(f: Fetch, url: string, siteDomain: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<SafeResponse | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let current = safeHttpsUrl(url);
    for (let hop = 0; current && hop <= MAX_REDIRECTS; hop++) {
      if (!sameSite(current.hostname, siteDomain)) return null;
      const res = await f(current.toString(), { headers: { "User-Agent": OUTREACH_UA }, redirect: "manual", signal: ctl.signal });
      if (res.status >= 300 && res.status < 400) {
        // E14: only the five redirect statuses are followed; any other 3xx
        // (300/304/305/306) counts as "nothing found", like a 3xx with no Location.
        const loc = REDIRECT_STATUSES.has(res.status) ? res.headers.get("location") : null;
        await res.body?.cancel().catch(() => undefined);
        if (!loc) return null;
        let next: string;
        try {
          next = new URL(loc, current).toString();
        } catch {
          return null;
        }
        current = safeHttpsUrl(next);
        continue;
      }
      const body = await readCapped(res, MAX_RESPONSE_BYTES);
      if (body === null) return null;
      return { status: res.status, contentType: res.headers.get("content-type") ?? "", body, url: current.toString() };
    }
    return null; // invalid URL, or too many redirects
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > max) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** D12: true iff robots.txt disallows "/" for user-agent "*". */
export function robotsDisallowsAll(txt: string): boolean {
  const groups: { agents: string[]; rules: string[] }[] = [];
  let cur: { agents: string[]; rules: string[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (k === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (k === "disallow" || k === "allow")) cur.rules.push(`${k}:${v}`);
    }
  }
  const star = groups.filter((g) => g.agents.includes("*"));
  for (const g of star) {
    const disallowRoot = g.rules.includes("disallow:/");
    const allowRoot = g.rules.some((r) => r === "allow:/" || r === "allow:/$");
    if (disallowRoot && !allowRoot) return true;
  }
  return false;
}

export async function checkRobots(f: Fetch, domain: string): Promise<"ok" | "disallow"> {
  const res = await safeFetch(f, `https://${domain}/robots.txt`, domain);
  if (!res || res.status !== 200) return "ok"; // a fetch error does not disqualify
  return robotsDisallowsAll(res.body) ? "disallow" : "ok";
}

// §6.3 contact discovery.
export const ROLE_ALLOW = [
  "founders", "marketing", "growth", "hello", "contact", "team", "info",
  "founder", "sales", "partnerships", "partners", "devrel", "community", "press",
] as const; // preference order: first wins
export const ROLE_DROP = new Set([
  "support", "help", "security", "abuse", "privacy", "legal", "dpo", "billing", "invoices", "jobs",
  "careers", "hr", "noreply", "no-reply", "postmaster", "webmaster",
]);
export const CONTACT_PATHS = ["/", "/contact", "/about", "/company"];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function extractEmails(html: string): string[] {
  const out = new Set<string>();
  const decoded = html.replace(/&#64;|&#x40;|&commat;/gi, "@").replace(/%40/g, "@");
  for (const m of decoded.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    try {
      out.add(decodeURIComponent(m[1]).toLowerCase());
    } catch {
      out.add(m[1].toLowerCase());
    }
  }
  for (const m of decoded.matchAll(EMAIL_RE)) out.add(m[0].toLowerCase());
  return [...out];
}

/** Picks the best role address on the lead's own registrable domain, or null. */
export function pickRoleAddress(emails: string[], domain: string): string | null {
  const own = emails.filter((e) => {
    const at = e.lastIndexOf("@");
    if (at < 1) return false;
    const host = e.slice(at + 1);
    return host === domain; // registrable domain only
  });
  for (const role of ROLE_ALLOW) {
    const hit = own.find((e) => e.slice(0, e.lastIndexOf("@")) === role);
    if (hit) return hit;
  }
  return null; // named-person or dropped local-parts are never auto-used
}

export async function discoverContact(f: Fetch, domain: string): Promise<{ email: string; sourceUrl: string } | null> {
  const found: { email: string; sourceUrl: string }[] = [];
  for (const p of CONTACT_PATHS) {
    const url = `https://${domain}${p}`;
    const res = await safeFetch(f, url, domain);
    if (!res || res.status !== 200) continue;
    if (!/text\/html|text\/plain/i.test(res.contentType)) continue;
    // Page text is only ever regex-scanned for addresses; it never reaches a model or a draft.
    for (const e of extractEmails(res.body)) found.push({ email: e, sourceUrl: url });
  }
  const best = pickRoleAddress(
    found.map((x) => x.email),
    domain
  );
  if (!best) return null;
  return found.find((x) => x.email === best)!;
}

export type ResearchDeps = { fetch: Fetch; now: () => number };

async function scansToday(env: Env, now: number): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM lead_scans WHERE created_at >= ?").bind(startOfUtcDay(now)).first<{ n: number }>();
  return r?.n ?? 0;
}

async function disqualify(env: Env, now: number, lead: LeadRow, reason: string): Promise<void> {
  const ok = await moveLead(env.DB, now, lead.id, lead.state, "disqualified", reason);
  if (ok) {
    // The Score page is public at astrant.io/score/<id>; no email will be sent, so remove it.
    await env.DB.batch([requestScanDeletionStmt(env.DB, lead.id, now), eventStmt(env.DB, now, "disqualified", lead.id, { reason })]);
  }
}

/** Runs the scan via the Service Binding and records it. Returns false on a scan error (lead stays put). */
async function scanLead(env: Env, now: number, lead: LeadRow): Promise<"scored" | "lt_2_gaps" | "error"> {
  await env.DB.prepare("UPDATE leads SET scan_attempts = scan_attempts + 1, updated_at = ? WHERE id = ?").bind(now, lead.id).run();
  let scan;
  try {
    scan = await env.SCANNER.scan(`https://${lead.domain}/`);
  } catch (e) {
    await logEvent(env.DB, now, "scan_error", lead.id, { message: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    if (lead.scan_attempts + 1 >= MAX_SCAN_ATTEMPTS) await disqualify(env, now, lead, "scan_error");
    return "error";
  }
  let sheet;
  try {
    sheet = buildFactSheet(scan, lead.domain, env.SCORE_BASE_URL || "https://astrant.io/score/");
  } catch (e) {
    await logEvent(env.DB, now, "scan_invalid", lead.id, { message: e instanceof Error ? e.message.slice(0, 80) : "invalid" });
    if (typeof scan?.id === "string") {
      await env.DB.prepare("INSERT OR IGNORE INTO lead_scans (scan_id, lead_id, created_at, delete_requested_at) VALUES (?, ?, ?, ?)").bind(scan.id, lead.id, now, now).run();
    }
    await disqualify(env, now, lead, "scan_invalid");
    return "lt_2_gaps";
  }
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT OR IGNORE INTO lead_scans (scan_id, lead_id, created_at) VALUES (?, ?, ?)").bind(scan.id, lead.id, now),
  ];
  if (lead.scan_id && lead.scan_id !== scan.id) {
    // Old scan row is superseded: delete it.
    stmts.push(
      env.DB.prepare("UPDATE lead_scans SET delete_requested_at = COALESCE(delete_requested_at, ?) WHERE scan_id = ? AND deleted_at IS NULL").bind(now, lead.scan_id)
    );
  }
  stmts.push(
    env.DB.prepare("UPDATE leads SET scan_id = ?, scanned_at = ?, fact_sheet_json = ?, updated_at = ? WHERE id = ? AND state = ?").bind(
      scan.id,
      now,
      JSON.stringify(sheet),
      now,
      lead.id,
      lead.state
    )
  );
  await env.DB.batch(stmts);
  if (sheet.gaps.length < MIN_GAPS) {
    await disqualify(env, now, lead, "lt_2_gaps");
    return "lt_2_gaps";
  }
  return "scored";
}

/**
 * One research step. Callers enforce the mode gate (mayResearch) and pause.
 * Priority: contact discovery for scored leads, then rescans of stale contact_found
 * leads, then new leads.
 */
export async function researchStep(env: Env, deps: ResearchDeps): Promise<string> {
  const now = deps.now();
  const db = env.DB;

  const scored = await db.prepare("SELECT * FROM leads WHERE state = 'scored' ORDER BY updated_at LIMIT 1").first<LeadRow>();
  if (scored) {
    if (!isPublicHostname(scored.domain)) {
      await disqualify(env, now, scored, "invalid_host");
      return "invalid_host";
    }
    // Codex review #6: eligibility is re-checked before EVERY stage (country can be set later in /admin).
    if (euExclusion(scored.domain, scored.country)) {
      await disqualify(env, now, scored, "eu_eea_excluded");
      return "eu_eea_excluded";
    }
    const c = await discoverContact(deps.fetch, scored.domain);
    if (!c) {
      await disqualify(env, now, scored, "no_contact");
      return "no_contact";
    }
    if (await isSuppressed(env, { email: c.email, domain: scored.domain })) {
      await disqualify(env, now, scored, "suppressed");
      return "suppressed";
    }
    const r = await db
      .prepare("UPDATE leads SET state = 'contact_found', contact_email = ?, contact_source_url = ?, updated_at = ? WHERE id = ? AND state = 'scored'")
      .bind(c.email, c.sourceUrl, now, scored.id)
      .run();
    if (r.meta.changes === 1) await logEvent(db, now, "contact_found", scored.id);
    return "contact_found";
  }

  const budget = intEnv(env.PROSPECT_SCANS_PER_DAY, 40, 0, 200);
  if ((await scansToday(env, now)) >= budget) return "scan_budget_exhausted";

  const stale = await db
    .prepare("SELECT * FROM leads WHERE state = 'contact_found' AND rescanned = 0 AND scanned_at < ? ORDER BY scanned_at LIMIT 1")
    .bind(now - RESCAN_AFTER_MS)
    .first<LeadRow>();
  if (stale) {
    if (!isPublicHostname(stale.domain)) {
      await disqualify(env, now, stale, "invalid_host");
      return "invalid_host";
    }
    if (euExclusion(stale.domain, stale.country)) {
      await disqualify(env, now, stale, "eu_eea_excluded");
      return "eu_eea_excluded";
    }
    if (await isSuppressed(env, { email: stale.contact_email, domain: stale.domain })) {
      await disqualify(env, now, stale, "suppressed");
      return "suppressed";
    }
    await db.prepare("UPDATE leads SET rescanned = 1 WHERE id = ?").bind(stale.id).run();
    // One rescan at most: a rescan error disqualifies (no second try).
    const r = await scanLead(env, now, { ...stale, scan_attempts: MAX_SCAN_ATTEMPTS - 1 });
    return `rescan_${r}`;
  }

  const lead = await db
    .prepare("SELECT * FROM leads WHERE state = 'new' AND icp_ok = 1 ORDER BY created_at LIMIT 1")
    .first<LeadRow>();
  if (!lead) return "idle";
  if (!isPublicHostname(lead.domain)) {
    await disqualify(env, now, lead, "invalid_host");
    return "invalid_host";
  }
  if (euExclusion(lead.domain, lead.country)) {
    await disqualify(env, now, lead, "eu_eea_excluded");
    return "eu_eea_excluded";
  }
  if (isDenylisted(lead.domain)) {
    await disqualify(env, now, lead, "icp_denylist");
    return "icp_denylist";
  }
  if (await isSuppressed(env, { domain: lead.domain })) {
    await disqualify(env, now, lead, "suppressed");
    return "suppressed";
  }
  if ((await checkRobots(deps.fetch, lead.domain)) === "disallow") {
    await disqualify(env, now, lead, "robots_disallow");
    return "robots_disallow";
  }
  const r = await scanLead(env, now, lead);
  if (r === "scored") {
    await moveLead(db, now, lead.id, "new", "scored");
  }
  return `scan_${r}`;
}
