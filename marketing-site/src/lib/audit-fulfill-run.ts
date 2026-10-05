// Test C-A (A3/A4 + R2-2) — the Audit fulfillment run, extracted from
// app/api/audit-fulfill/route.ts so the Queue consumer and the HTTP operator
// wrapper share one implementation. Must NOT import Next.
//
// Contract (R2-2):
//   - NEVER writes status "error". Failures THROW; the caller decides (the HTTP
//     wrapper keeps today's error write, the Queue consumer writes it only on
//     the final attempt / DLQ).
//   - Returns a typed result (see AuditRunResult).
//   - Resumable after `ready`: a standalone session that is `ready` with no
//     `email_sent_at` runs ONLY the buyer-email step.
//
// impl-day{30|60|90} session ids never reach here (the HTTP wrapper routes
// them to its own D1-backed handler before calling this).

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
} from "./audit-pipeline";
import type { AuditResult, SessionRecord, SessionStatus } from "./audit-types";
import { writeAuditToCorpus } from "./corpus-write";
import { isDim6CapReached, runDim6Paid, type RunDim6Result } from "./dim6/runDim6";
import { ALL_MODEL_IDS, type ModelId } from "./dim6/types";
import {
  AUDIT_READY_EMAIL_COPY,
  sendAuditReadyEmail,
  sendAutoPilotAuditReadyEmail,
  type AuditReadyEmailCopy,
} from "./score-email";
import { sendOperatorAlert } from "./operator-alerts";
import { isAuditCheckoutEnabled } from "./audit-gate";
import { updateFunnelStatus } from "./audit-funnel";

export interface AuditRunEnv extends AuditEnv {
  INTERNAL_FULFILL_KEY: string;
  PHAROS_CORPUS: D1Database;
  CORPUS_DEAD_LETTER: KVNamespace;
  CITATION_DB: D1Database;
  RESEND_API_KEY: string;
  UNSUBSCRIBE_SECRET: string;
  AUDIT_CHECKOUT_ENABLED?: string;
  OPERATOR_ALERT_EMAIL?: string;
}

export type AuditRunResult =
  | {
      kind: "done";
      composite_score?: number;
      grade?: string;
      gap_count?: number;
    }
  | { kind: "noop_terminal"; status: SessionStatus }
  | { kind: "not_yet_paid" }
  | { kind: "cap_deferred" }
  // Not in the R2-2 list: an unknown session id (e.g. the R2-8 synthetic
  // queue smoke). Callers log it and treat it as a no-op.
  | { kind: "not_found" };

// Injection seam for tests; production callers use the defaults.
export interface AuditRunDeps {
  emailCopy?: AuditReadyEmailCopy | null;
}

const SESSION_TTL_SEC = 30 * 24 * 60 * 60;
const OPERATOR_ALERT_FALLBACK = "contact@astrant.io";

export function parseAutoPilotSessionId(sessionId: string): string | null {
  const match = sessionId.match(/^ap-(sub_[A-Za-z0-9_-]+)-\d+$/);
  return match ? match[1] : null;
}

// Standalone = bought through /api/audit-create (neither ap- nor impl-day).
export function isStandaloneSession(sessionId: string): boolean {
  return !sessionId.startsWith("ap-") && !sessionId.startsWith("impl-day");
}

export async function readAuditSession(
  env: { SESSIONS: KVNamespace },
  sessionId: string,
): Promise<SessionRecord | null> {
  const raw = await env.SESSIONS.get(`audit:${sessionId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

export async function writeAuditSession(
  env: { SESSIONS: KVNamespace },
  record: SessionRecord,
): Promise<void> {
  await env.SESSIONS.put(
    `audit:${record.session_id}`,
    JSON.stringify(record),
    { expirationTtl: SESSION_TTL_SEC },
  );
}

// Operator alerts go to OPERATOR_ALERT_EMAIL, falling back to contact@astrant.io.
// Callers pass session id + error class only — never buyer PII.
export async function alertOperator(
  env: { RESEND_API_KEY: string; OPERATOR_ALERT_EMAIL?: string },
  alert_code: string,
  session_id: string,
  notes?: string,
): Promise<void> {
  await sendOperatorAlert(
    {
      RESEND_API_KEY: env.RESEND_API_KEY,
      OPERATOR_ALERT_EMAIL: env.OPERATOR_ALERT_EMAIL || OPERATOR_ALERT_FALLBACK,
    },
    { alert_code, session_id, notes },
  );
}

// Providers (models) that produced ZERO measurable cells in this Dim 6 run.
export function providersWithZeroMeasurableCells(dim6: RunDim6Result): ModelId[] {
  return ALL_MODEL_IDS.filter(
    (m) => !dim6.cells.some((c) => c.modelId === m && !c.result.unmeasurable),
  );
}

// Standalone buyer email (A4 + R2-5). Throws on a failed send so the queue
// retries the email step alone; `ready` is never touched.
async function deliverBuyerEmail(
  env: AuditRunEnv,
  record: SessionRecord,
  origin: string,
  copy: AuditReadyEmailCopy | null,
): Promise<void> {
  const sessionId = record.session_id;
  if (record.email_sent_at) return;
  if (!isAuditCheckoutEnabled(env) || copy === null) {
    console.log(`AUDIT_READY_EMAIL_HELD session_id=${sessionId}`);
    return;
  }
  const result = await sendAuditReadyEmail(
    env,
    { toEmail: record.email, sessionId, url: record.url, origin },
    copy,
  );
  if (!result.ok) {
    console.error(`AUDIT_READY_EMAIL_FAILED session_id=${sessionId}`);
    await alertOperator(env, "AUDIT_READY_EMAIL_FAILED", sessionId);
    throw new Error("AUDIT_READY_EMAIL_FAILED");
  }
  await writeAuditSession(env, { ...record, email_sent_at: Date.now() });
  console.log(`AUDIT_READY_EMAIL_SENT session_id=${sessionId}`);
}

export async function runAuditFulfillment(
  env: AuditRunEnv,
  sessionId: string,
  origin: string,
  deps: AuditRunDeps = {},
): Promise<AuditRunResult> {
  const copy = deps.emailCopy === undefined ? AUDIT_READY_EMAIL_COPY : deps.emailCopy;
  const standalone = isStandaloneSession(sessionId);

  const record = await readAuditSession(env, sessionId);
  if (!record) return { kind: "not_found" };

  if (record.status === "awaiting_payment") return { kind: "not_yet_paid" };
  if (record.status === "error") return { kind: "noop_terminal", status: "error" };
  if (record.status === "ready") {
    if (standalone && !record.email_sent_at) {
      await deliverBuyerEmail(env, record, origin, copy);
      return {
        kind: "done",
        composite_score: record.composite_score,
        grade: record.grade,
      };
    }
    return { kind: "noop_terminal", status: "ready" };
  }

  // status === "fulfilling"
  // R2-4: peek the Dim 6 daily budget BEFORE spending a scan + LLM calls.
  if (await isDim6CapReached(env.SESSIONS)) return { kind: "cap_deferred" };

  const scannerScan = await runScan(record.url, env.INTERNAL_FULFILL_KEY);

  // Slice 3b: replace the scanner's free-tier Dim 6 demo preview with a
  // real paid Dim 6 audit. runDim6Paid handles its own daily-cap branch
  // (returns capped:true — deferred, never shipped as ready) and its own
  // all-unmeasurable branch (returns na:true). On success it returns the
  // real DimensionResult plus the cells for corpus persistence.
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
    record.url,
  );
  // R2-4: the cap was hit between the peek and the run (race) — still defer.
  if (dim6.capped) return { kind: "cap_deferred" };

  // A3 provider completeness: finish anyway (the report is honest about
  // unmeasured cells) but tell the operator which provider measured nothing.
  const silentProviders = providersWithZeroMeasurableCells(dim6);
  if (silentProviders.length > 0) {
    console.error(
      `AUDIT_DIM6_PROVIDER_ZERO_CELLS session_id=${sessionId} providers=${silentProviders.join(",")}`,
    );
    await alertOperator(
      env,
      "AUDIT_DIM6_PROVIDER_ZERO_CELLS",
      sessionId,
      `providers=${silentProviders.join(",")}`,
    );
  }

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
  await writeAuditSession(env, next);
  await updateFunnelStatus(env.SESSIONS, sessionId, "ready");

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
      },
    );
    console.error(
      `[corpus] wrote scan_event session=${sessionId} scan_id=${corpusScanId} gaps=${gaps.length} dim6_cells=${dim6.cells.length}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[corpus] write failed (session=${sessionId}, dead-lettered): ${msg}`,
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
        { expirationTtl: 60 * 60 * 24 * 30 }, // 30-day retention
      );
    } catch (dlqErr) {
      console.error(
        `[corpus] dead-letter write ALSO failed (session=${sessionId}): ${dlqErr instanceof Error ? dlqErr.message : String(dlqErr)}`,
      );
    }
  }

  const apSubscriptionId = parseAutoPilotSessionId(sessionId);
  if (apSubscriptionId !== null) {
    try {
      const sub = await env.CITATION_DB.prepare(
        `SELECT customer_email FROM subscriptions WHERE subscription_id = ?`,
      ).bind(apSubscriptionId).first<{ customer_email: string }>();
      if (!sub) {
        console.error(`F3_AUDIT_WELCOME_NO_SUBSCRIPTION session_id=${sessionId}`);
      } else {
        const sendResult = await sendAutoPilotAuditReadyEmail(env, {
          toEmail: sub.customer_email,
          sessionId,
          pdfR2Key: `audits/${sessionId}.pdf`,
          origin,
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
  } else if (standalone) {
    await deliverBuyerEmail(env, next, origin, copy);
  }

  return {
    kind: "done",
    composite_score: scan.composite.score,
    grade: scan.composite.grade,
    gap_count: gaps.length,
  };
}
