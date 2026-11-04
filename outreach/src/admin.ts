// /admin/* (Bruno only: Cloudflare Access + JWT check). Internal pages, not prospect-facing.
import { verifyAccessJwt } from "./access";
import { approveBatch } from "./batch";
import { addBusinessDays } from "./clock";
import { csrfToken, verifyCsrf } from "./crypto";
import { eventStmt, getControl, logEvent, resume, tripStop } from "./db";
import { normalizeCountry } from "./eligibility";
import type { FactSheet } from "./facts";
import { modeOf } from "./mode";
import { renderFollowup } from "./render";
import { FOLLOWUP_BUSINESS_DAYS } from "./send";
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
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}
const forbidden = () => new Response("Forbidden", { status: 403 });

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
    m = /^\/admin\/send-unknown\/([0-9a-f-]{36})$/.exec(path);
    if (m) return resolveSendUnknown(env, m[1], String(form.get("outcome")), now, back);
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
    const unknown = await db.prepare("SELECT id, lead_id, kind, claimed_at FROM messages WHERE status = 'send_unknown'").all<Record<string, unknown>>();
    return html(`<h1>Outreach</h1>
<p>Mode: <b>${esc(modeOf(env))}</b> · Paused: <b>${c.paused ? "yes (" + esc(c.pause_reason) + ")" : "no"}</b> · Drafting paused: ${c.drafting_paused ? "yes" : "no"}
 · Today's cap: ${dailyCap(env, c, now)} · DNS verified: ${c.dns_verified_at ? new Date(c.dns_verified_at).toISOString() : "not set"} (warm-up done: ${dnsWarmupDone(c, now) ? "yes" : "no"})
 · Approved batches: ${c.approved_batches} · POSTAL_ADDRESS set: ${(env.POSTAL_ADDRESS ?? "").trim() ? "yes" : "NO"}</p>
<form method="post" action="/admin/resume">${hidden}<button>Resume</button></form>
<form method="post" action="/admin/pause">${hidden}<input name="reason" placeholder="reason (e.g. postmaster)"><button>Pause</button></form>
<form method="post" action="/admin/drafting-resume">${hidden}<button>Resume drafting</button></form>
${c.dns_verified_at ? "" : `<form method="post" action="/admin/dns-verified">${hidden}<button>Mark DNS verified (starts 14-day wait)</button></form>`}
<h2>Leads</h2><table>${(counts.results ?? []).map((r) => `<tr><td>${esc(r.state)}</td><td>${r.n}</td></tr>`).join("")}</table><p><a href="/admin/leads">Review leads</a></p>
<h2>Batches</h2><table>${(batches.results ?? []).map((b) => `<tr><td><a href="/admin/batch/${esc(b.id)}">${esc(b.week)}</a></td><td>${esc(b.status)}</td><td>${esc(b.draft_count)} drafts</td><td>${esc(b.fallback_count)} template</td></tr>`).join("")}</table>
<h2>Send outcome unknown</h2>${(unknown.results ?? []).map((u) => `<p>${esc(u.kind)} ${esc(u.id)} (lead ${esc(u.lead_id)}): check the Sent folder, then
<form method="post" action="/admin/send-unknown/${esc(u.id)}">${hidden}<button name="outcome" value="sent">It was sent</button><button name="outcome" value="not_sent">It was not sent (close lead)</button></form></p>`).join("") || "<p>None.</p>"}`);
  }

  if (path === "/admin/leads") {
    const rows = await db
      .prepare("SELECT * FROM leads WHERE icp_ok IS NULL OR state IN ('scored','contact_found') ORDER BY icp_ok IS NOT NULL, domain LIMIT 500")
      .all<LeadRow>();
    return html(`<h1>Lead review</h1><form method="post" action="/admin/leads">${hidden}<table><tr><th>Domain</th><th>Source</th><th>State</th><th>ICP</th><th>Country</th></tr>
${(rows.results ?? [])
  .map(
    (l) => `<tr><td><a href="https://${esc(l.domain)}" rel="noreferrer">${esc(l.domain)}</a></td><td>${esc(l.source)}</td><td>${esc(l.state)} ${esc(l.state_reason ?? "")}</td>
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
    return html(`<h1>Batch ${esc(b.week)} — ${esc(b.status)}</h1><p>Mode: ${esc(modeOf(env))}. The opt-out link and postal address are filled in at send time.</p>
<form method="post" action="/admin/batch/${esc(b.id)}/approve">${hidden}
${(msgs.results ?? [])
  .map((m) => {
    const sheet = JSON.parse(m.fact_sheet_json || "{}") as Partial<FactSheet>;
    const report = JSON.parse(m.validator_report_json || "{}") as { path?: string };
    return `<hr><p><b>${esc(m.domain)}</b> → ${esc(m.contact_email)} (found on <a href="${esc(m.contact_source_url)}" rel="noreferrer">${esc(m.contact_source_url)}</a>) · Score page: <a href="${esc(sheet.score_url)}">${esc(sheet.score_url)}</a> · writer: ${esc(report.path)} · lead: ${esc(m.lead_state)}
${canApprove ? `<label><input type="checkbox" name="reject" value="${esc(m.lead_id)}"> reject</label>` : ""}</p>
<p>Subject: <b>${esc(m.subject)}</b></p><pre>${esc(m.body_text)}</pre>`;
  })
  .join("")}
${canApprove ? `<p><button>Approve batch</button></p>` : ""}</form>`);
  }
  return new Response("Not found", { status: 404 });
}

async function resolveSendUnknown(env: Env, id: string, outcome: string, now: number, back: () => Response): Promise<Response> {
  const db = env.DB;
  const m = await db.prepare("SELECT * FROM messages WHERE id = ? AND status = 'send_unknown'").bind(id).first<MessageRow>();
  if (!m) return back();
  if (outcome === "sent") {
    const stmts: D1PreparedStatement[] = [
      db.prepare("UPDATE messages SET status = 'sent', sent_at = claimed_at, updated_at = ? WHERE id = ? AND status = 'send_unknown'").bind(now, id),
      db
        .prepare("UPDATE leads SET state = ?, last_outbound_at = ?, updated_at = ? WHERE id = ? AND state = 'send_unknown'")
        .bind(m.kind === "initial" ? "sent" : "followup_sent", m.claimed_at ?? now, now, m.lead_id),
      eventStmt(db, now, "send_unknown_resolved", m.lead_id, { outcome: "sent" }),
    ];
    if (m.kind === "initial") {
      const lead = await db.prepare("SELECT fact_sheet_json FROM leads WHERE id = ?").bind(m.lead_id).first<{ fact_sheet_json: string | null }>();
      const sheet = JSON.parse(lead?.fact_sheet_json ?? "null") as FactSheet | null;
      if (sheet) {
        const f = renderFollowup(m.subject, sheet, { benchmarkUrl: null, privacyUrl: env.PRIVACY_URL || "https://astrant.io/privacy#prospecting" });
        stmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO messages (id, lead_id, kind, batch_id, subject, body_text, validator_report_json, status, not_before, created_at, updated_at)
               VALUES (?, ?, 'followup', ?, ?, ?, ?, 'queued', ?, ?, ?)`
            )
            .bind(crypto.randomUUID(), m.lead_id, m.batch_id, f.subject, f.body, JSON.stringify({ path: "fixed_followup" }), addBusinessDays(m.claimed_at ?? now, FOLLOWUP_BUSINESS_DAYS), now, now)
        );
      }
    }
    await db.batch(stmts);
  } else if (outcome === "not_sent") {
    // Not resent: the lead is closed. A duplicate cold email is worse than a missing one.
    await db.batch([
      db.prepare("UPDATE messages SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'send_unknown'").bind(now, id),
      db.prepare("UPDATE leads SET state = 'closed', state_reason = 'send_unknown_not_sent', terminal_at = ?, updated_at = ? WHERE id = ? AND state = 'send_unknown'").bind(now, now, m.lead_id),
      eventStmt(db, now, "send_unknown_resolved", m.lead_id, { outcome: "not_sent" }),
    ]);
  }
  return back();
}
