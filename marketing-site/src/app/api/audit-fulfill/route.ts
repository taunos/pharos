import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  llmEnrichGaps,
  renderAuditHtml,
  generatePdf,
  runScan,
  splicePaidDim6,
  storeJson,
  storePdf,
  REMEDIATION_ENGINE_VERSION_TAG,
  type AuditEnv,
} from "@/lib/audit-pipeline";
import type { AuditResult, SessionRecord } from "@/lib/audit-types";
import { writeAuditToCorpus } from "@/lib/corpus-write";
import { runDim6Paid } from "@/lib/dim6/runDim6";
import { constantTimeEqual } from "@/lib/dodo";
import { sendAutoPilotAuditReadyEmail } from "@/lib/score-email";
import { sendF2DayNAuditEmail } from "@/lib/f2-email";
import { generateAuditRecs } from "@/lib/f2-generators/audit-recs";

interface FulfillEnv extends AuditEnv {
  INTERNAL_FULFILL_KEY: string;
  PHAROS_CORPUS: D1Database;
  CORPUS_DEAD_LETTER: KVNamespace;
  CITATION_DB: D1Database;
  RESEND_API_KEY: string;
  UNSUBSCRIBE_SECRET: string;
}

function parseAutoPilotSessionId(sessionId: string): string | null {
  const match = sessionId.match(/^ap-(sub_[A-Za-z0-9_-]+)-\d+$/);
  return match ? match[1] : null;
}

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

const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

export const maxDuration = 300;

async function readSession(
  env: FulfillEnv,
  sessionId: string
): Promise<SessionRecord | null> {
  const raw = await env.SESSIONS.get(`audit:${sessionId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

async function writeSession(
  env: FulfillEnv,
  record: SessionRecord
): Promise<void> {
  await env.SESSIONS.put(
    `audit:${record.session_id}`,
    JSON.stringify(record),
    { expirationTtl: SESSION_TTL_SEC }
  );
}

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

  const record = await readSession(env, sessionId);
  if (!record) {
    return NextResponse.json(
      { ok: false, error: "session not found" },
      { status: 404 }
    );
  }

  if (record.status !== "fulfilling") {
    return NextResponse.json(
      {
        ok: false,
        error: `session not in fulfilling state (status=${record.status})`,
      },
      { status: 400 }
    );
  }

  try {
    const scannerScan = await runScan(record.url, env.INTERNAL_FULFILL_KEY);

    // Slice 3b: replace the scanner's free-tier Dim 6 demo preview with a
    // real paid Dim 6 audit. runDim6Paid handles its own daily-cap branch
    // (returns na:true with a "queued for tomorrow" note when over cap) and
    // its own all-unmeasurable branch (returns na:true). On success it
    // returns the real DimensionResult plus the cells for corpus persistence.
    const dim6 = await runDim6Paid(
      {
        AI: env.AI,
        OPENAI_API_KEY: env.OPENAI_API_KEY,
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        GOOGLE_AI_API_KEY: env.GOOGLE_AI_API_KEY,
        PERPLEXITY_API_KEY: env.PERPLEXITY_API_KEY,
        // Reuse the SESSIONS KV for the dim6:v1 cache + daily-cap counter.
        // Distinct key prefixes (`dim6:v1:` for cache, `dim6:budget:` for the
        // counter) ensure no collision with audit-fulfill's session keys.
        cacheKv: env.SESSIONS,
      },
      record.url
    );
    const scan = splicePaidDim6(scannerScan, dim6.dimension);

    const gaps = await llmEnrichGaps(env, scan, sessionId);
    const audit: AuditResult = {
      scan,
      gaps,
      engine_version: REMEDIATION_ENGINE_VERSION_TAG,
    };
    const html = renderAuditHtml(audit, sessionId);
    const pdf = await generatePdf(env, html);
    await storePdf(env, sessionId, pdf);
    await storeJson(env, sessionId, audit);

    const next: SessionRecord = {
      ...record,
      status: "ready",
      completed_at: Date.now(),
      pdf_url: `/audit-results/${sessionId}/pdf`,
      json_url: `/audit-results/${sessionId}/json`,
      composite_score: scan.composite.score,
      grade: scan.composite.grade,
    };
    await writeSession(env, next);

    // ── Corpus write — non-blocking on customer delivery ────────────────────
    // Per pharos-corpus-layer-spec.md and the dead-letter design: a corpus
    // write failure NEVER blocks the customer Audit. The PDF + JSON have
    // already been stored above; the session is already "ready". Best-effort
    // from here. Failures land in CORPUS_DEAD_LETTER for manual replay.
    try {
      const corpusScanId = await writeAuditToCorpus(
        env.PHAROS_CORPUS,
        REMEDIATION_ENGINE_VERSION_TAG,
        {
          sessionRecord: next,
          audit,
          dim6Cells: dim6.cells,
        }
      );
      console.error(
        `[corpus] wrote scan_event session=${sessionId} scan_id=${corpusScanId} gaps=${gaps.length} dim6_cells=${dim6.cells.length}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[corpus] write failed (session=${sessionId}, dead-lettered): ${msg}`
      );
      try {
        await env.CORPUS_DEAD_LETTER.put(
          `dlq:${Date.now()}:${sessionId}`,
          JSON.stringify({
            session_id: sessionId,
            url: next.url,
            error: msg,
            audit_engine_version: REMEDIATION_ENGINE_VERSION_TAG,
            failed_at: Date.now(),
            // Enough to manually replay: include the audit payload itself
            // (already in R2 too, but having a copy in DLQ avoids a fetch).
            payload: audit,
          }),
          { expirationTtl: 60 * 60 * 24 * 30 } // 30-day retention
        );
      } catch (dlqErr) {
        console.error(
          `[corpus] dead-letter write ALSO failed (session=${sessionId}): ${dlqErr instanceof Error ? dlqErr.message : String(dlqErr)}`
        );
      }
    }

    const apSubscriptionId = parseAutoPilotSessionId(sessionId);
    if (apSubscriptionId !== null) {
      try {
        const sub = await env.CITATION_DB.prepare(
          `SELECT customer_email FROM subscriptions WHERE subscription_id = ?`
        ).bind(apSubscriptionId).first<{ customer_email: string }>();
        if (!sub) {
          console.error(`F3_AUDIT_WELCOME_NO_SUBSCRIPTION session_id=${sessionId}`);
        } else {
          const sendResult = await sendAutoPilotAuditReadyEmail(env, {
            toEmail: sub.customer_email,
            sessionId,
            pdfR2Key: `audits/${sessionId}.pdf`,
            origin: new URL(req.url).origin,
          });
          if (sendResult.ok) {
            console.log(`F3_AUDIT_WELCOME_SENT session_id=${sessionId}`);
          } else {
            console.error(`F3_AUDIT_WELCOME_FAILED session_id=${sessionId} reason=${sendResult.error}`);
          }
        }
      } catch (err) {
        console.error(`F3_AUDIT_WELCOME_FAILED session_id=${sessionId} reason=exception`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      composite_score: scan.composite.score,
      grade: scan.composite.grade,
      gap_count: gaps.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[audit-fulfill] session=${sessionId} failed: ${message}`
    );
    const next: SessionRecord = {
      ...record,
      status: "error",
      error_message: message.slice(0, 500),
    };
    await writeSession(env, next).catch(() => {});
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

