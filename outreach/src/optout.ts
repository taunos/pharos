// §9.2 opt-out: GET shows a confirm page and never changes state (link scanners
// prefetch GETs); POST (button or RFC 8058 one-click) suppresses email + domain.
import {
  OPTOUT_CONFIRM_BUTTON, OPTOUT_CONFIRM_QUESTION, OPTOUT_DONE, OPTOUT_INVALID, OPTOUT_PAGE_TITLE, OPTOUT_UNAVAILABLE,
} from "./copy";
import { verifyOptoutToken } from "./crypto";
import { eventStmt, moveLeadStmt } from "./db";
import { processScanDeletions, requestScanDeletionStmt, suppressStmts } from "./suppression";
import type { Env, LeadRow } from "./types";

function page(body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${OPTOUT_PAGE_TITLE}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111;background:#fff}button{font:inherit;padding:.6rem 1.2rem;cursor:pointer}</style>
</head><body>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" },
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function handleOptout(req: Request, env: Env, token: string, now: number): Promise<Response> {
  if (!env.OPTOUT_HMAC_SECRET) return page(`<p>${esc(OPTOUT_UNAVAILABLE)}</p>`, 503);
  const messageId = await verifyOptoutToken(env.OPTOUT_HMAC_SECRET, token);
  if (!messageId) return page(`<p>${esc(OPTOUT_INVALID)}</p>`, 404);

  if (req.method === "GET" || req.method === "HEAD") {
    return page(
      `<h1>${esc(OPTOUT_PAGE_TITLE)}</h1><p>${esc(OPTOUT_CONFIRM_QUESTION)}</p><form method="post"><button type="submit">${esc(OPTOUT_CONFIRM_BUTTON)}</button></form>`
    );
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, POST" } });

  const lead = await env.DB.prepare("SELECT l.* FROM messages ms JOIN leads l ON l.id = ms.lead_id WHERE ms.id = ?")
    .bind(messageId)
    .first<LeadRow>();
  if (!lead) return page(`<p>${esc(OPTOUT_DONE)}</p>`); // nothing left to stop (lead deleted)
  try {
    const db = env.DB;
    await db.batch([
      ...(await suppressStmts(env, now, { email: lead.contact_email, domain: lead.domain, reason: "opt_out_link" })),
      db.prepare("UPDATE messages SET status = 'cancelled', updated_at = ? WHERE lead_id = ? AND status IN ('draft','queued')").bind(now, lead.id),
      moveLeadStmt(db, now, lead.id, ["new", "scored", "contact_found", "drafted", "approved", "sent", "followup_sent", "send_unknown", "closed"], "opted_out", "opt_out_link"),
      requestScanDeletionStmt(db, lead.id, now),
      eventStmt(db, now, "opt_out_link", lead.id),
    ]);
  } catch (e) {
    console.error("optout_failed", e instanceof Error ? e.message : String(e));
    return page(`<p>${esc(OPTOUT_UNAVAILABLE)}</p>`, 503);
  }
  try {
    await processScanDeletions(env, now, 5);
  } catch {
    // retried by the daily job
  }
  return page(`<p>${esc(OPTOUT_DONE)}</p>`);
}
