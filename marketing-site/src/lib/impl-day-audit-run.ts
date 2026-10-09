// Slice Q (Q4 + v1.1 A6) — F2 Day-N audit run, moved from
// app/api/audit-fulfill/route.ts (handleF2DayNAudit) so the astrant-fulfill
// Queue consumer runs it. Must NOT import Next.
//
// Logic unchanged apart from:
//   - returns a typed result instead of a NextResponse;
//   - A6: the claim CAS clears day{N}_audit_failed_at atomically, so a
//     claimed row never carries a stale failed_at (citation-tracking's
//     stale-claim cleanup can then reset a crashed re-claim);
//   - the Day-N email carries Resend idempotencyKey f2-day{N}:{f2_session_id}.
// day{N}_audit_succeeded_at is the per-day delivered marker (A3): it is written
// right after a confirmed send, and the claim CAS (fired_at IS NULL) never
// re-claims a delivered day because fired_at stays set on success.

import { runScan, type AuditEnv } from "./audit-pipeline";
import { sendF2DayNAuditEmail } from "./f2-email";
import { generateAuditRecs } from "./f2-generators/audit-recs";

export interface ImplDayRunEnv extends AuditEnv {
  INTERNAL_FULFILL_KEY: string;
  CITATION_DB: D1Database;
  RESEND_API_KEY: string;
}

export type ImplDayRunResult =
  | { kind: "done" }
  | { kind: "deduped" }
  // Error after the claim: fired_at cleared + failed_at set, so the next daily
  // citation-tracking sweep re-sends it. The queue does NOT also retry.
  | { kind: "failed_reset" };

interface F2ImplementationRow {
  session_id: string;
  customer_email: string;
  customer_domain: string;
  brand_name: string;
  customer_id: string;
  baseline_scan_id: string | null;
  payment_succeeded_at: number;
  status: string;
}

export async function runImplDayAudit(
  env: ImplDayRunEnv,
  implAudit: { day_n: 30 | 60 | 90; f2_session_id: string },
): Promise<ImplDayRunResult> {
  const { day_n, f2_session_id } = implAudit;
  const firedAtCol = `day${day_n}_audit_fired_at`;
  const succeededAtCol = `day${day_n}_audit_succeeded_at`;
  const failedAtCol = `day${day_n}_audit_failed_at`;
  const now = Math.floor(Date.now() / 1000);

  // CAS UPDATE to claim race-free. Column name is built from validated day_n
  // (30/60/90 only per regex) — no injection risk. A6: clears failed_at.
  const casResult = await env.CITATION_DB.prepare(
    `UPDATE implementation_sessions
     SET ${firedAtCol} = ?, ${failedAtCol} = NULL, updated_at = ?
     WHERE session_id = ? AND ${firedAtCol} IS NULL AND status = 'active'`,
  )
    .bind(now, now, f2_session_id)
    .run();

  if (casResult.meta.changes !== 1) {
    // Already fired, or session not in active state — idempotent no-op
    return { kind: "deduped" };
  }

  let f2: F2ImplementationRow | null = null;
  try {
    f2 = await env.CITATION_DB.prepare(
      `SELECT session_id, customer_email, customer_domain, brand_name,
              customer_id, baseline_scan_id, payment_succeeded_at, status
       FROM implementation_sessions WHERE session_id = ?`,
    )
      .bind(f2_session_id)
      .first<F2ImplementationRow>();

    if (!f2) {
      throw new Error(`F2_SESSION_NOT_FOUND f2_session_id=${f2_session_id}`);
    }

    // Read baseline scan
    let baselineScore = 0;
    if (f2.baseline_scan_id) {
      const baselineObj = await env.AUDITS.get(`f2-baseline-scans/${f2.baseline_scan_id}.json`);
      if (baselineObj) {
        const baseline = JSON.parse(await baselineObj.text()) as { composite?: { score?: number } };
        baselineScore = baseline.composite?.score ?? 0;
      }
    }

    // Re-scan customer domain at Day-N
    const currentScan = await runScan(f2.customer_domain, env.INTERNAL_FULFILL_KEY);
    const currentScore = currentScan.composite.score;

    // v1.0: cite-share delta values come from citation-tracking probe data; for
    // now pass 0% placeholders. v1.1+ wires the actual cite-share aggregator.
    const citeShareBaselinePct = 0;
    const citeShareCurrentPct = 0;

    // Generate audit-recs prose (deterministic-fallback path at v1.0)
    const recs = await generateAuditRecs(env, {
      brand_name: f2.brand_name,
      domain: f2.customer_domain,
      day_n,
      baseline_scan_summary: `composite=${baselineScore}`,
      current_scan_summary: `composite=${currentScore}`,
      cite_share_baseline_pct: citeShareBaselinePct,
      cite_share_current_pct: citeShareCurrentPct,
    });

    // Day-90 includes Standard CTA (D8 spec)
    const autoPilotCheckoutUrl =
      day_n === 90 ? "https://astrant.io/subscriptions" : undefined;

    // Send Day-N audit email (text-only at v1.0; PDF rendering deferred to v1.1+)
    const emailResult = await sendF2DayNAuditEmail(env, {
      toEmail: f2.customer_email,
      brandName: f2.brand_name,
      dayN: day_n,
      sessionId: f2_session_id,
      recs,
      baselineScore,
      currentScore,
      citeShareBaselinePct,
      citeShareCurrentPct,
      autoPilotCheckoutUrl,
    });

    if (!emailResult.ok) {
      throw new Error(`F2_AUDIT_EMAIL_SEND_FAILED day_n=${day_n} err=${emailResult.error}`);
    }

    // Mark succeeded
    const succeedTime = Math.floor(Date.now() / 1000);
    await env.CITATION_DB.prepare(
      `UPDATE implementation_sessions
       SET ${succeededAtCol} = ?, updated_at = ?
       WHERE session_id = ?`,
    )
      .bind(succeedTime, succeedTime, f2_session_id)
      .run();

    console.log(`F2_AUDIT_DAYN_COMPLETED session_id=${f2_session_id} day_n=${day_n}`);
    return { kind: "done" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`F2_AUDIT_DAYN_FAILED session_id=${f2_session_id} day_n=${day_n} err=${msg}`);
    // Mark failed + clear fired_at so next sweep can retry
    const failTime = Math.floor(Date.now() / 1000);
    await env.CITATION_DB.prepare(
      `UPDATE implementation_sessions
       SET ${firedAtCol} = NULL, ${failedAtCol} = ?, failed_reason = ?, updated_at = ?
       WHERE session_id = ?`,
    )
      .bind(failTime, msg.slice(0, 500), failTime, f2_session_id)
      .run()
      .catch(() => {});
    return { kind: "failed_reset" };
  }
}
