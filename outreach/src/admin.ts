// /admin/* (Bruno only: Cloudflare Access + JWT check). Internal pages, not prospect-facing.
import { verifyAccessJwt } from "./access";
import { approveBatch } from "./batch";
import { csrfToken, verifyCsrf } from "./crypto";
import { getControl, logEvent, resume, tripStop } from "./db";
import { normalizeCountry } from "./eligibility";
import { isPublicHostname, safeHttpsUrl } from "./safety";
import type { FactSheet } from "./facts";
import { modeOf } from "./mode";
import { isSuppressed } from "./suppression";
import type { Env, LeadRow, MessageRow } from "./types";
import { dailyCap, dnsWarmupDone } from "./warmup";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function html(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Outreach admin</title><style>body{font-family:system-ui,sans-serif;margin:1.5rem;max-width:70rem}pre{white-space:pre-wrap;background:#f4f4f4;padding:.75rem}td,th{padding:.25rem .5rem;border-bottom:1px solid #ddd;text-align:left}form{display:inline}</style></head><body>${body}</body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // Defence in depth on top of escaping: no scripts, no external loads, forms post only to this origin.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    }
  );
}
const forbidden = () => new Response("Forbidden", { status: 403 });

/** A link only for a validated public https URL; anything else is shown as escaped text. */
function link(url: unknown): string {
  const u = safeHttpsUrl(url);
  return u ? `<a href="${esc(u.toString())}" rel="noreferrer noopener">${esc(u.toString())}</a>` : esc(url);
}

export type AdminDeps = { fetch: typeof fetch; now: () => number };

export async function handleAdmin(req: Request, env: Env, deps: AdminDeps): Promise<Response> {
  const who = await verifyAccessJwt(req, env, deps.fetch, deps.now());
  if (!who) return forbidden();
  const csrfSecret = env.OPTOUT_HMAC_SECRET;
  if (!csrfSecret) return new Response("OPTOUT_HMAC_SECRET missing", { status: 503 });
  const csrf = await csrfToken(csrfSecret, who.email, "admin");
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/admin";
  const now = deps.now();
  const db = env.DB;
  const hidden = `<input type="hidden" name="csrf" value="${esc(csrf)}">`;

  if (req.method === "POST") {
    const form = await req.formData();
    if (!(await verifyCsrf(csrfSecret, who.email, "admin", String(form.get("csrf") ?? "")))) return forbidden();
    const back = (to = "/admin") => Response.redirect(new URL(to, url).toString(), 303);

    if (path === "/admin/resume") {
      await resume(db, now, who.email);
      return back();
    }
    if (path === "/admin/pause") {
      await tripStop(db, now, String(form.get("reason") || "manual"));
      return back();
    }
    if (path === "/admin/drafting-resume") {
      await db.prepare("UPDATE control SET drafting_paused = 0 WHERE id = 1").run();
      await logEvent(db, now, "drafting_resumed", null);
      return back();
    }
    if (path === "/admin/dns-verified") {
      // LB2: Bruno sets this after checking spf/dkim/dmarc pass. Starts the 14-day wait. Set once.
      await db.prepare("UPDATE control SET dns_verified_at = COALESCE(dns_verified_at, ?) WHERE id = 1").bind(now).run();
      await logEvent(db, now, "dns_verified", null);
      return back();
    }
    let m = /^\/admin\/batch\/([0-9a-f-]{36})\/approve$/.exec(path);
    if (m) {
      const rejected = form.getAll("reject").map(String);
      const r = await approveBatch(env, { batchId: m[1], rejectedLeadIds: rejected, now, by: "admin" });
      if (!r.ok) return html(`<p>Not approved: ${esc(r.reason)}</p><p><a href="/admin/batch/${esc(m[1])}">Back</a></p>`, 409);
      return back(`/admin/batch/${m[1]}`);
    }
    if (path === "/admin/leads") {
      for (const [k, v] of form as unknown as Iterable<[string, string]>) {
        const lm = /^icp_([0-9a-f-]{36})$/.exec(k);
        if (lm && (v === "1" || v === "0")) {
          await db.prepare("UPDATE leads SET icp_ok = ?, updated_at = ? WHERE id = ?").bind(Number(v), now, lm[1]).run();
        }
        const cm = /^country_([0-9a-f-]{36})$/.exec(k);
        if (cm && String(v).trim()) {
          await db.prepare("UPDATE leads SET country = ?, updated_at = ? WHERE id = ?").bind(normalizeCountry(String(v)), now, cm[1]).run();
        }
      }
      return back("/admin/leads");
    }
    m = /^\/admin\/leads\/([0-9a-f-]{36})\/contact$/.exec(path);
    if (m) {
      // Manual named-person address, only when that person published it for business contact (§6.3).
      const email = String(form.get("email") ?? "").trim().toLowerCase();
      const src = String(form.get("source_url") ?? "").trim();
      const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(m[1]).first<LeadRow>();
      if (!lead || !/^[^\s@]+@[^\s@]+$/.test(email) || !/^https:\/\//.test(src) || !email.endsWith("@" + lead.domain)) {
        return html("<p>Invalid: the address must be on the lead's domain and the source must be an https URL.</p>", 400);
      }
      if (await isSuppressed(env, { email, domain: lead.domain })) return html("<p>That address or domain is suppressed.</p>", 409);
      await db
        .prepare("UPDATE leads SET contact_email = ?, contact_source_url = ?, state = CASE WHEN state = 'scored' THEN 'contact_found' ELSE state END, updated_at = ? WHERE id = ? AND state IN ('scored','contact_found')")
        .bind(email, src, now, m[1])
        .run();
      return back("/admin/leads");
    }
    return new Response("Not found", { status: 404 });
  }

  if (path === "/admin") {
    const c = await getControl(db);
    const counts = await db.prepare("SELECT state, COUNT(*) AS n FROM leads GROUP BY state").all<{ state: string; n: number }>();
    const batches = await db.prepare("SELECT * FROM batches ORDER BY created_at DESC LIMIT 8").all<Record<string, unknown>>();
    const alerts = await db.prepare("SELECT at, detail_json FROM events WHERE kind = 'alert' ORDER BY id DESC LIMIT 30").all<Record<string, unknown>>();
    const waiting = await db
      .prepare("SELECT ms.kind, ms.status, ms.drafted_at, l.domain FROM messages ms JOIN leads l ON l.id = ms.lead_id WHERE ms.status IN ('in_drafts','draft_unknown') ORDER BY ms.drafted_at")
      .all<Record<string, unknown>>();
    return html(`<h1>Outreach</h1><p><b>Drafts only:</b> this agent never sends. Emails appear in the mailbox's Drafts; you send or delete each one.</p>
<p>Mode: <b>${esc(modeOf(env))}</b> · Paused: <b>${c.paused ? "yes (" + esc(c.pause_reason) + ")" : "no"}</b> · Drafting paused: ${c.drafting_paused ? "yes" : "no"}
 · Drafts per day: ${dailyCap(env)} · DNS verified: ${c.dns_verified_at ? new Date(c.dns_verified_at).toISOString() : "not set"} (wait done: ${dnsWarmupDone(env, c, now) ? "yes" : "no"})
 · Approved batches: ${c.approved_batches} · POSTAL_ADDRESS set: ${(env.POSTAL_ADDRESS ?? "").trim() ? "yes" : "NO"}</p>
<form method="post" action="/admin/resume">${hidden}<button>Resume</button></form>
<form method="post" action="/admin/pause">${hidden}<input name="reason" placeholder="reason (e.g. postmaster)"><button>Pause</button></form>
<form method="post" action="/admin/drafting-resume">${hidden}<button>Resume drafting</button></form>
${c.dns_verified_at ? "" : `<form method="post" action="/admin/dns-verified">${hidden}<button>Mark DNS verified</button></form>`}
<h2>Leads</h2><table>${(counts.results ?? []).map((r) => `<tr><td>${esc(r.state)}</td><td>${r.n}</td></tr>`).join("")}</table><p><a href="/admin/leads">Review leads</a></p>
<h2>Batches</h2><table>${(batches.results ?? []).map((b) => `<tr><td><a href="/admin/batch/${esc(b.id)}">${esc(b.week)}</a></td><td>${esc(b.status)}</td><td>${esc(b.draft_count)} drafts</td><td>${esc(b.fallback_count)} template</td></tr>`).join("")}</table>
<h2>Recent alerts</h2><p>In off and dry_run, alerts appear only here. In gated/auto they also arrive as drafts addressed to you.</p><table>${(alerts.results ?? []).map((a) => { const d = JSON.parse(String(a.detail_json ?? "{}")) as { kind?: string; text?: string }; return `<tr><td>${new Date(Number(a.at)).toISOString().slice(0, 16)}</td><td><b>${esc(d.kind)}</b></td><td>${esc(d.text)}</td></tr>`; }).join("") || "<tr><td>None.</td></tr>"}</table>
<h2>Waiting in Drafts</h2><p>Marked sent automatically when they show up in the Sent folder. Unsent drafts expire after ${esc(env.DRAFT_EXPIRE_DAYS || "14")} days.</p><table>${(waiting.results ?? []).map((w) => `<tr><td>${esc(w.domain)}</td><td>${esc(w.kind)}</td><td>${esc(w.status === "draft_unknown" ? "unknown: check Drafts" : "in Drafts")}</td><td>${w.drafted_at ? new Date(Number(w.drafted_at)).toISOString().slice(0, 10) : ""}</td></tr>`).join("") || "<tr><td>None.</td></tr>"}</table>`);
  }

  if (path === "/admin/leads") {
    const rows = await db
      .prepare("SELECT * FROM leads WHERE icp_ok IS NULL OR state IN ('scored','contact_found') ORDER BY icp_ok IS NOT NULL, domain LIMIT 500")
      .all<LeadRow>();
    return html(`<h1>Lead review</h1><form method="post" action="/admin/leads">${hidden}<table><tr><th>Domain</th><th>Source</th><th>State</th><th>ICP</th><th>Country</th></tr>
${(rows.results ?? [])
  .map(
    (l) => `<tr><td>${isPublicHostname(l.domain) ? link(`https://${l.domain}/`) : esc(l.domain)}</td><td>${esc(l.source)}</td><td>${esc(l.state)} ${esc(l.state_reason ?? "")}</td>
<td><label><input type="radio" name="icp_${esc(l.id)}" value="1"${l.icp_ok === 1 ? " checked" : ""}>yes</label> <label><input type="radio" name="icp_${esc(l.id)}" value="0"${l.icp_ok === 0 ? " checked" : ""}>no</label></td>
<td><input name="country_${esc(l.id)}" value="${esc(l.country ?? "")}" size="3"></td></tr>`
  )
  .join("")}</table><button>Save</button></form>`);
  }

  const bm = /^\/admin\/batch\/([0-9a-f-]{36})$/.exec(path);
  if (bm) {
    const b = await db.prepare("SELECT * FROM batches WHERE id = ?").bind(bm[1]).first<Record<string, unknown>>();
    if (!b) return new Response("Not found", { status: 404 });
    const msgs = await db
      .prepare("SELECT ms.*, l.domain, l.contact_email, l.contact_source_url, l.fact_sheet_json, l.state AS lead_state FROM messages ms JOIN leads l ON l.id = ms.lead_id WHERE ms.batch_id = ? AND ms.kind = 'initial' ORDER BY l.domain")
      .bind(bm[1])
      .all<MessageRow & { domain: string; contact_email: string; contact_source_url: string; fact_sheet_json: string; lead_state: string }>();
    const canApprove = b.status === "pending_approval";
    return html(`<h1>Batch ${esc(b.week)} — ${esc(b.status)}</h1><p>Mode: ${esc(modeOf(env))}. The opt-out link and postal address are filled in when the mailbox draft is created.</p>
<form method="post" action="/admin/batch/${esc(b.id)}/approve">${hidden}
${(msgs.results ?? [])
  .map((m) => {
    const sheet = JSON.parse(m.fact_sheet_json || "{}") as Partial<FactSheet>;
    const report = JSON.parse(m.validator_report_json || "{}") as { path?: string };
    return `<hr><p><b>${esc(m.domain)}</b> → ${esc(m.contact_email)} (found on ${link(m.contact_source_url)}) · Score page: ${link(sheet.score_url)} · writer: ${esc(report.path)} · lead: ${esc(m.lead_state)}
${canApprove ? `<label><input type="checkbox" name="reject" value="${esc(m.lead_id)}"> reject</label>` : ""}</p>
<p>Subject: <b>${esc(m.subject)}</b></p><pre>${esc(m.body_text)}</pre>`;
  })
  .join("")}
${canApprove ? `<p><button>Approve batch</button></p>` : ""}</form>`);
  }
  return new Response("Not found", { status: 404 });
}
