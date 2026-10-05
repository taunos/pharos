import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { runScan } from "@/lib/audit-pipeline";
import { constantTimeEqual } from "@/lib/dodo";
import { sendF2DayNAuditEmail } from "@/lib/f2-email";
import { generateAuditRecs } from "@/lib/f2-generators/audit-recs";
import {
  readAuditSession,
  runAuditFulfillment,
  writeAuditSession,
  type AuditRunEnv,
} from "@/lib/audit-fulfill-run";

// Test C-A (A3): thin operator-replay wrapper. Paid standalone Audits are
// fulfilled by the AUDIT_FULFILL_QUEUE consumer; this route stays for operator
// replay and the ap- (onboarding) path. The run itself lives in
// lib/audit-fulfill-run.ts; the impl-day branch below is unchanged.
type FulfillEnv = AuditRunEnv;

// F2 v6.1 D19 — parse `impl-day{30|60|90}-impl-{dodo_payment_id}` shape.
// Returns {day_n, f2_session_id} where f2_session_id is the underlying
// implementation_sessions row's PRIMARY KEY (also `impl-{dodo_payment_id}` shape).
function parseImplementationAuditSessionId(
  sessionId: string,
): { day_n: 30 | 60 | 90; f2_session_id: string } | null {
  const match = sessionId.match(/^impl-day(30|60|90)-(impl-[A-Za-z0-9_-]+)$/);
  if (!match) return null;
  return {
    day_n: parseInt(match[1], 10) as 30 | 60 | 90,
    f2_session_id: match[2],
  };
}

export const maxDuration = 300;

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as FulfillEnv;

  const provided = req.headers.get("x-internal-fulfill-key");
  // F-03: constant-time comparison to deny timing-side-channel inference
  // of the secret. Length-mismatch short-circuits to false in the helper.
  if (
    !env.INTERNAL_FULFILL_KEY ||
    !provided ||
    !constantTimeEqual(provided, env.INTERNAL_FULFILL_KEY)
  ) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const sessionId =
    body && typeof body === "object" && typeof (body as { session_id?: unknown }).session_id === "string"
      ? ((body as { session_id: string }).session_id)
      : "";
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "session_id required" },
      { status: 400 }
    );
  }

  // F2 v6.1 D19 — discriminator BEFORE SESSIONS.get (per Codex HIGH v3 fold).
  // F2 day-N audit session_ids have shape `impl-day{30|60|90}-impl-{dodo_payment_id}`;
  // they don't exist in SESSIONS KV (records live in implementation_sessions D1 table).
  const implAudit = parseImplementationAuditSessionId(sessionId);
  if (implAudit !== null) {
    return await handleF2DayNAudit(env, implAudit);
  }

  try {
    const result = await runAuditFulfillment(env, sessionId, new URL(req.url).origin);
    switch (result.kind) {
      case "not_found":
        return NextResponse.json(
          { ok: false, error: "session not found" },
          { status: 404 }
        );
      case "not_yet_paid":
      case "noop_terminal":
        return NextResponse.json(
          {
            ok: false,
            error: `session not in fulfilling state (status=${result.kind === "not_yet_paid" ? "awaiting_payment" : result.status})`,
          },
          { status: 400 }
        );
      case "cap_deferred":
        // Session stays `fulfilling`; replay after the Dim 6 daily budget resets.
        console.error(`[audit-fulfill] session=${sessionId} dim6 daily cap reached; deferred`);
        return NextResponse.json(
          { ok: false, error: "dim6_cap_deferred" },
          { status: 503 }
        );
      case "done":
        return NextResponse.json({
          ok: true,
          session_id: sessionId,
          composite_score: result.composite_score,
          grade: result.grade,
          gap_count: result.gap_count,
        });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[audit-fulfill] session=${sessionId} failed: ${message}`
    );
    // Today's behaviour for the operator / ap- path: mark the session `error`.
    // A `ready` session (email-step failure) is never downgraded.
    const record = await readAuditSession(env, sessionId).catch(() => null);
    if (record && record.status !== "ready") {
      await writeAuditSession(env, {
        ...record,
        status: "error",
        error_message: message.slice(0, 500),
      }).catch(() => {});
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}

// ─── F2 v6.1 D19 — Day-N audit handler ─────────────────────────────────

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

async function handleF2DayNAudit(
  env: FulfillEnv,
  implAudit: { day_n: 30 | 60 | 90; f2_session_id: string },
): Promise<Response> {
  const { day_n, f2_session_id } = implAudit;
  const firedAtCol = `day${day_n}_audit_fired_at`;
  const succeededAtCol = `day${day_n}_audit_succeeded_at`;
  const failedAtCol = `day${day_n}_audit_failed_at`;
  const now = Math.floor(Date.now() / 1000);

  // CAS UPDATE to claim race-free. Column name is built from validated day_n
  // (30/60/90 only per regex) — no injection risk.
  const casResult = await env.CITATION_DB.prepare(
    `UPDATE implementation_sessions
     SET ${firedAtCol} = ?, updated_at = ?
     WHERE session_id = ? AND ${firedAtCol} IS NULL AND status = 'active'`,
  )
    .bind(now, now, f2_session_id)
    .run();

  if (casResult.meta.changes !== 1) {
    // Already fired, or session not in active state — idempotent no-op
    return NextResponse.json({ ok: true, deduped: true, day_n });
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
    return NextResponse.json({ ok: true, session_id: f2_session_id, day_n });
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
    return NextResponse.json({ error: "F2_AUDIT_FAILED" }, { status: 500 });
  }
}

