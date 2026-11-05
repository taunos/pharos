// §9.5 weekly batch build, approval, expiry, and not_before spreading.
//
// Drafts-only (Bruno, 2026-11-04): in gated/auto the batch is approved as soon
// as it is built. Bruno reviews every email in the mailbox's Drafts and sends
// or deletes each one himself, so that click is the human gate (D8's two-batch
// /admin approval would be a second, redundant gate). In dry_run the batch
// stays pending (approval refused) and expires: log only.
import type { Alerter } from "./alerts";
import { DAY, HOUR, SEND_WINDOW_END_HOUR, SEND_WINDOW_START_HOUR, isWeekday, isoWeek, startOfUtcDay } from "./clock";
import { eventStmt, getControl, logEvent, moveLead, moveLeadStmt } from "./db";
import { euExclusion } from "./eligibility";
import type { FactSheet } from "./facts";
import { mayApprove, mayBuildBatch, modeOf } from "./mode";
import { finalizeBody, renderInitialBody, type RenderCtx } from "./render";
import { checkOutboundDraft, isAstrantUrl } from "./safety";
import { RESCAN_AFTER_MS } from "./research";
import { isSuppressed } from "./suppression";
import { crossListStatus } from "./cross-list";
import type { AiBinding, Env, LeadRow } from "./types";
import { dailyCap } from "./warmup";
import { draftEmail } from "./writer";

export const BATCH_TTL_MS = 72 * HOUR;
export const SEND_DAYS_PER_WEEK = 5;

export type BatchDeps = { ai: AiBinding | null; fetch: typeof fetch; now: () => number; alert: Alerter; random?: () => number };

/** Drafts-only: batches are approved on build in gated/auto (see header). */
export function autoApprovalAllowed(env: Env): boolean {
  return mayApprove(modeOf(env));
}

/** D14: the benchmark sentence is used only when BENCHMARK_URL is set and returns 200 now. */
export async function benchmarkUrlIfLive(env: Env, f: typeof fetch): Promise<string | null> {
  const u = (env.BENCHMARK_URL ?? "").trim();
  if (!isAstrantUrl(u)) return null; // allowlist: astrant.io only
  try {
    const r = await f(u, { method: "GET", redirect: "manual" });
    return r.status === 200 ? u : null;
  } catch {
    return null;
  }
}

export async function expireBatches(env: Env, now: number): Promise<number> {
  const db = env.DB;
  const rows = await db
    .prepare("SELECT id FROM batches WHERE status = 'pending_approval' AND expires_at < ?")
    .bind(now)
    .all<{ id: string }>();
  let n = 0;
  for (const b of rows.results ?? []) {
    const r = await db.prepare("UPDATE batches SET status = 'expired' WHERE id = ? AND status = 'pending_approval'").bind(b.id).run();
    if (r.meta.changes !== 1) continue;
    n++;
    // Leads return to contact_found and are redrafted next week; their 'draft'
    // message row is kept and updated in place on redraft (UNIQUE(lead_id, kind)).
    await db.batch([
      db
        .prepare("UPDATE leads SET state = 'contact_found', batch_id = NULL, updated_at = ? WHERE batch_id = ? AND state = 'drafted'")
        .bind(now, b.id),
      eventStmt(db, now, "batch_expired", null, { batch_id: b.id }),
    ]);
  }
  return n;
}

export async function buildWeeklyBatch(env: Env, deps: BatchDeps): Promise<{ status: string; batchId?: string; drafted?: number }> {
  const db = env.DB;
  const now = deps.now();
  const mode = modeOf(env);
  if (!mayBuildBatch(mode)) return { status: "mode_off" };
  await expireBatches(env, now);
  const c = await getControl(db);
  if (c.paused) return { status: "paused" };
  if (c.drafting_paused) return { status: "drafting_paused" };
  const week = isoWeek(now);
  const existing = await db.prepare("SELECT id FROM batches WHERE week = ?").bind(week).first<{ id: string }>();
  if (existing) return { status: "exists", batchId: existing.id };

  const size = dailyCap(env) * SEND_DAYS_PER_WEEK;
  if (size <= 0) return { status: "zero_cap" };
  const candidates = await db
    .prepare(
      "SELECT * FROM leads WHERE state = 'contact_found' AND icp_ok = 1 AND scanned_at >= ? AND contact_email IS NOT NULL ORDER BY scanned_at LIMIT ?"
    )
    .bind(now - RESCAN_AFTER_MS - DAY, size * 2)
    .all<LeadRow>();

  const batchId = crypto.randomUUID();
  await db
    .prepare("INSERT INTO batches (id, week, status, mode_at_build, created_at, expires_at) VALUES (?, ?, 'pending_approval', ?, ?, ?)")
    .bind(batchId, week, mode, now, now + BATCH_TTL_MS)
    .run();

  const ctx: RenderCtx = {
    benchmarkUrl: await benchmarkUrlIfLive(env, deps.fetch),
    privacyUrl: isAstrantUrl(env.PRIVACY_URL) ? env.PRIVACY_URL! : "https://astrant.io/privacy#prospecting",
  };
  const variantBase = (await db.prepare("SELECT COUNT(*) AS n FROM messages").first<{ n: number }>())?.n ?? 0;
  let drafted = 0;
  let fallback = 0;
  for (const lead of candidates.results ?? []) {
    if (drafted >= size) break;
    if (euExclusion(lead.domain, lead.country)) {
      await moveLead(db, now, lead.id, "contact_found", "disqualified", "eu_eea_excluded");
      continue;
    }
    if (await isSuppressed(env, { email: lead.contact_email, domain: lead.domain })) {
      await moveLead(db, now, lead.id, "contact_found", "disqualified", "suppressed");
      continue;
    }
    // E5: not offered for approval if on Astrant's other opt-out lists; skipped (not
    // disqualified) while those can't be read. createMailboxDraft re-checks anyway.
    const cross = await crossListStatus(env, lead.contact_email);
    if (cross === "suppressed") {
      await moveLead(db, now, lead.id, "contact_found", "disqualified", "suppressed");
      continue;
    }
    if (cross === "unavailable") continue;
    const sheet = JSON.parse(lead.fact_sheet_json ?? "null") as FactSheet | null;
    if (!sheet) continue;
    const out = await draftEmail({ sheet, ctx, templateVariant: variantBase + drafted });
    if (!out.ok) {
      await moveLead(db, now, lead.id, "contact_found", "disqualified", "draft_failed");
      await logEvent(db, now, "draft_failed", lead.id, { report: out.report });
      continue;
    }
    const body = renderInitialBody(out.fields, sheet, ctx);
    // Same safety gate the mailbox draft passes, with placeholder opt-out link and postal line.
    const probe = checkOutboundDraft({
      to: lead.contact_email ?? "",
      subject: out.fields.subject,
      text: finalizeBody(body, "https://go.getastrant.com/u/PROBE", "Postal address line"),
      domain: lead.domain,
      postal: "Postal address line",
      optoutUrl: "https://go.getastrant.com/u/PROBE",
    });
    if (!probe.ok) {
      await moveLead(db, now, lead.id, "contact_found", "disqualified", "draft_unsafe");
      await logEvent(db, now, "draft_unsafe", lead.id, { reason: probe.reason.slice(0, 60) });
      continue;
    }
    const report = JSON.stringify({ ...out.report, fact_sheet_scan_id: sheet.scan_id });
    const msgId = crypto.randomUUID();
    const res = await db.batch([
      // Update in place on redraft; never delete+reinsert.
      db
        .prepare(
          `INSERT INTO messages (id, lead_id, kind, batch_id, subject, body_text, validator_report_json, status, not_before, created_at, updated_at)
           VALUES (?, ?, 'initial', ?, ?, ?, ?, 'draft', ?, ?, ?)
           ON CONFLICT(lead_id, kind) DO UPDATE SET batch_id = excluded.batch_id, subject = excluded.subject, body_text = excluded.body_text,
             validator_report_json = excluded.validator_report_json, updated_at = excluded.updated_at
           WHERE messages.status = 'draft'`
        )
        .bind(msgId, lead.id, batchId, out.fields.subject, body, report, now, now, now),
      db
        .prepare("UPDATE leads SET state = 'drafted', batch_id = ?, updated_at = ? WHERE id = ? AND state = 'contact_found'")
        .bind(batchId, now, lead.id),
    ]);
    if (res[0].meta.changes === 1 && res[1].meta.changes === 1) drafted++;
  }
  await db.prepare("UPDATE batches SET draft_count = ?, fallback_count = ? WHERE id = ?").bind(drafted, fallback, batchId).run();

  // (The §9.3 "validator fallback rate" stop is gone: there is no model in the writing path.)

  if (drafted > 0 && autoApprovalAllowed(env)) {
    const r = await approveBatch(env, { batchId, rejectedLeadIds: [], now, by: "auto", random: deps.random });
    await deps.alert(
      "Weekly batch: drafts on the way",
      `Batch ${week}: ${drafted} emails will appear in Drafts over the week (at most ${dailyCap(env)} a day). Send or delete each one yourself.`
    );
    return { status: r.ok ? "auto_approved" : `auto_approve_failed:${r.reason}`, batchId, drafted };
  }
  await deps.alert(
    "Weekly batch ready for approval",
    `Batch ${week}: ${drafted} drafts. Review and approve: ${(env.PUBLIC_BASE_URL || "https://go.getastrant.com") + "/admin/batch/" + batchId}${mode === "dry_run" ? " (dry_run: approval is disabled)" : ""}`
  );
  return { status: "pending_approval", batchId, drafted };
}

/** Spreads n drafts over the coming weekdays (13:00–21:00 UTC), within each day's cap. */
export async function scheduleSlots(env: Env, start: number, n: number, random: () => number): Promise<number[]> {
  const db = env.DB;
  const out: number[] = [];
  let day = startOfUtcDay(start);
  for (let guard = 0; out.length < n && guard < 60; guard++, day += DAY) {
    if (!isWeekday(day)) continue;
    const cap = dailyCap(env);
    const already =
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM messages WHERE status IN ('queued','drafting','in_drafts','sent','draft_unknown') AND not_before >= ? AND not_before < ?")
          .bind(day, day + DAY)
          .first<{ n: number }>()
      )?.n ?? 0;
    let free = cap - already;
    const winStart = Math.max(day + SEND_WINDOW_START_HOUR * HOUR, start);
    const winEnd = day + SEND_WINDOW_END_HOUR * HOUR;
    if (winStart >= winEnd) continue;
    while (free > 0 && out.length < n) {
      out.push(Math.floor(winStart + random() * (winEnd - winStart - 1)));
      free--;
    }
  }
  return out;
}

export type ApproveResult = { ok: true; queued: number; rejected: number } | { ok: false; reason: string };

export async function approveBatch(
  env: Env,
  a: { batchId: string; rejectedLeadIds: string[]; now: number; by: "admin" | "auto"; random?: () => number }
): Promise<ApproveResult> {
  const db = env.DB;
  const { now } = a;
  if (!mayApprove(modeOf(env))) return { ok: false, reason: "mode" };
  const newStatus = a.by === "auto" ? "auto_approved" : "approved";
  const cas = await db
    .prepare("UPDATE batches SET status = ?, approved_at = ? WHERE id = ? AND status = 'pending_approval' AND expires_at >= ?")
    .bind(newStatus, now, a.batchId, now)
    .run();
  if (cas.meta.changes !== 1) return { ok: false, reason: "not_pending" };

  // Counters + ramp start (first approval) before scheduling, so caps are right.
  await db
    .prepare(
      `UPDATE control SET approved_batches = approved_batches + 1,
         second_approval_at = CASE WHEN approved_batches + 1 = 2 THEN ? ELSE second_approval_at END,
         ramp_start_at = COALESCE(ramp_start_at, ?) WHERE id = 1`
    )
    .bind(now, startOfUtcDay(now))
    .run();
  const leads = await db.prepare("SELECT id FROM leads WHERE batch_id = ? AND state = 'drafted' ORDER BY created_at").bind(a.batchId).all<{ id: string }>();
  const rejected = new Set(a.rejectedLeadIds);
  const keep = (leads.results ?? []).filter((l) => !rejected.has(l.id));
  const slots = await scheduleSlots(env, now, keep.length, a.random ?? Math.random);
  let queued = 0;
  let nRejected = 0;
  for (const l of leads.results ?? []) {
    if (rejected.has(l.id)) {
      await db.batch([
        moveLeadStmt(db, now, l.id, ["drafted"], "rejected", "rejected_by_bruno"),
        db.prepare("UPDATE messages SET status = 'cancelled', updated_at = ? WHERE lead_id = ? AND kind = 'initial' AND status = 'draft'").bind(now, l.id),
      ]);
      nRejected++;
    }
  }
  for (let i = 0; i < keep.length; i++) {
    const nb = slots[i];
    if (nb === undefined) break; // capacity exhausted (should not happen: batch size = week cap)
    const r = await db.batch([
      db
        .prepare("UPDATE messages SET status = 'queued', not_before = ?, updated_at = ? WHERE lead_id = ? AND kind = 'initial' AND status = 'draft'")
        .bind(nb, now, keep[i].id),
      moveLeadStmt(db, now, keep[i].id, ["drafted"], "approved"),
    ]);
    if (r[0].meta.changes === 1) queued++;
  }
  await logEvent(db, now, "batch_approved", null, { batch_id: a.batchId, by: a.by, queued, rejected: nRejected });
  return { ok: true, queued, rejected: nRejected };
}
