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
  buildRemediationGaps,
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
import { alertOperator } from "./operator-alerts";
import { isAuditCheckoutEnabled } from "./audit-gate";
import { updateFunnelStatus } from "./audit-funnel";
import { buildRightsRecord, scheduleRightsWrite } from "./dataset-consent";
import {
  claimReviewGeneration,
  claimReviewSend,
  decideReviewHold,
  dropReviewGenerationClaim,
  dropReviewSendClaim,
  markReviewDelivered,
  markReviewGenerated,
  parseReviewHoldCount,
  readReviewHold,
  reviewEvidenceKey,
} from "./audit-review-hold";

export interface AuditRunEnv extends AuditEnv {
  INTERNAL_FULFILL_KEY: string;
  PHAROS_CORPUS: D1Database;
  CORPUS_DEAD_LETTER: KVNamespace;
  CITATION_DB: D1Database;
  RESEND_API_KEY: string;
  UNSUBSCRIBE_SECRET: string;
  AUDIT_CHECKOUT_ENABLED?: string;
  OPERATOR_ALERT_EMAIL?: string;
  // Review hold (lib/audit-review-hold.ts): how many paid standalone orders
  // are held for review. Absent/malformed → 10 (fail-closed).
  AUDIT_REVIEW_HOLD_COUNT?: string;
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
  // Review hold: another run holds the generation lease for this held order
  // (still running, or dead with the lease not yet expired). Retry after the
  // lease (REVIEW_GEN_LEASE_MS).
  | { kind: "generation_in_progress" }
  // Review hold: a held order reached generation through a caller that may
  // not generate held reports (deps.mayGenerateHeld false). Nothing was run.
  | { kind: "held_requires_queue" }
  // Not in the R2-2 list: an unknown session id (e.g. the R2-8 synthetic
  // queue smoke). Callers log it and treat it as a no-op.
  | { kind: "not_found" };

export interface AuditRunDeps {
  // Dim 6 daily-cap handling. "defer" (default; the Queue consumer) returns
  // cap_deferred and never ships a partial report. "partial" (the HTTP
  // operator / ap- wrapper) keeps pre-C-A behaviour: ship `ready` with Dim 6
  // n/a (the cap note) instead of deferring.
  onCap?: "partial" | "defer";
  // Review hold: only a writer with an enforced lifetime (the Queue consumer,
  // 15 min wall time) may write a held report's artifacts — the generation
  // lease relies on it. The HTTP replay passes false and gets
  // `held_requires_queue` instead (it hands the run to the queue).
  mayGenerateHeld?: boolean;
  // Injection seam for tests; production callers use the default constant.
  emailCopy?: AuditReadyEmailCopy | null;
}

// Thrown when the standalone buyer email fails; the Queue consumer alerts
// AUDIT_READY_EMAIL_FAILED once, on the final attempt.
// `reason` is a fixed classification (no message text, no PII).
export type AuditReadyEmailFailReason = "pdf_not_found" | "copy_not_set" | "send_error";
export class AuditReadyEmailError extends Error {
  readonly reason: AuditReadyEmailFailReason;
  // The send threw: Resend may have accepted it.
  readonly ambiguous: boolean;
  constructor(reason: AuditReadyEmailFailReason, ambiguous = false) {
    super("AUDIT_READY_EMAIL_FAILED");
    this.name = "AuditReadyEmailError";
    this.reason = reason;
    this.ambiguous = ambiguous;
  }
}

export function classifyAuditReadyEmailError(error: string): AuditReadyEmailFailReason {
  if (error.startsWith("pdf_not_found")) return "pdf_not_found";
  if (error === "copy_not_set") return "copy_not_set";
  return "send_error";
}

const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

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

// Providers (models) that produced ZERO measurable cells in this Dim 6 run.
// Provider diagnostics can carry request URLs (Gemini's API key is a URL query
// param), key-shaped tokens, or email addresses. Strip all three before the
// text reaches logs or the operator email.
export function redactDiagnostic(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [redacted]")
    .replace(
      /("?(?:key|api[_-]?key|apikey|token|access[_-]?token|secret|authorization|x-api-key)"?\s*[:=]\s*"?)[^\s"',&}]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(sk|pk|pplx|AIza|xox[a-z]?|ghp|gho)[-_A-Za-z0-9]{12,}/g, "[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
}

export function providersWithZeroMeasurableCells(dim6: RunDim6Result): ModelId[] {
  return ALL_MODEL_IDS.filter(
    (m) => !dim6.cells.some((c) => c.modelId === m && !c.result.unmeasurable),
  );
}

export function reviewHoldLimit(env: { AUDIT_REVIEW_HOLD_COUNT?: string }): number {
  return parseReviewHoldCount(env.AUDIT_REVIEW_HOLD_COUNT);
}

export type BuyerEmailOutcome =
  | "sent"
  | "already_sent"
  | "gate_closed"
  | "review_hold"
  | "send_in_progress";

async function sendBuyerEmailOrThrow(
  env: AuditRunEnv,
  record: SessionRecord,
  origin: string,
  copy: AuditReadyEmailCopy,
): Promise<void> {
  const sessionId = record.session_id;
  const result = await sendAuditReadyEmail(
    env,
    { toEmail: record.email, sessionId, url: record.url, origin },
    copy,
  );
  if (!result.ok) {
    const reason = classifyAuditReadyEmailError(result.error);
    // (`ambiguous`: the send may have gone out; see sendAuditReadyEmail.)
    console.error(`AUDIT_READY_EMAIL_FAILED session_id=${sessionId} reason=${reason}`);
    throw new AuditReadyEmailError(reason, result.ambiguous === true);
  }
}

// Standalone buyer email (A4 + R2-5). Throws AuditReadyEmailError on a failed
// send so the queue retries the email step alone; `ready` is never touched.
// The operator alert is sent once, by the consumer's final-attempt handling.
// Every standalone buyer email goes through here, so the review hold is
// enforced here: a held, unreleased session is skipped and logged; a released
// one is sent once, under a D1 send claim (double release / queue duplicate
// after release → one email).
export async function deliverBuyerEmail(
  env: AuditRunEnv,
  record: SessionRecord,
  origin: string,
  copy: AuditReadyEmailCopy | null,
): Promise<BuyerEmailOutcome> {
  const sessionId = record.session_id;
  if (record.email_sent_at) return "already_sent";
  if (!isAuditCheckoutEnabled(env) || copy === null) {
    console.log(`AUDIT_READY_EMAIL_HELD session_id=${sessionId}`);
    return "gate_closed";
  }
  const hold = await decideReviewHold(env.CITATION_DB, sessionId, reviewHoldLimit(env));
  if (hold.held === 1) {
    if (hold.released_at === null) {
      console.log(`AUDIT_REVIEW_HOLD_DELIVERY_SKIPPED session_id=${sessionId}`);
      return "review_hold";
    }
    if (hold.delivered_at !== null) {
      await writeAuditSession(env, { ...record, email_sent_at: hold.delivered_at });
      return "already_sent";
    }
    const claimedAt = Date.now();
    if (!(await claimReviewSend(env.CITATION_DB, sessionId, claimedAt))) {
      // Another sender holds the claim, or a send's outcome is unknown.
      console.log(`AUDIT_REVIEW_SEND_IN_PROGRESS session_id=${sessionId}`);
      return "send_in_progress";
    }
    try {
      await sendBuyerEmailOrThrow(env, record, origin, copy);
    } catch (err) {
      if (err instanceof AuditReadyEmailError && err.ambiguous) {
        // Outcome unknown: keep the claim (no automatic resend); operator checks Resend.
        console.error(`AUDIT_REVIEW_SEND_OUTCOME_UNKNOWN session_id=${sessionId}`);
        await alertOperator(
          env,
          "AUDIT_REVIEW_SEND_OUTCOME_UNKNOWN",
          sessionId,
          "buyer email send threw; it may have gone out. Send claim left set: check Resend, then clear send_claimed_at to resend",
        ).catch(() => {});
      } else {
        await dropReviewSendClaim(env.CITATION_DB, sessionId, claimedAt).catch(() => {});
      }
      throw err;
    }
    const sentAt = Date.now();
    // Email is out. If the marker is not written the send claim stays set (it
    // never expires), so nothing resends automatically; the operator is told.
    const marked = await markReviewDelivered(env.CITATION_DB, sessionId, claimedAt, sentAt).catch(() => false);
    if (!marked) {
      console.error(`AUDIT_REVIEW_DELIVERED_MARK_FAILED session_id=${sessionId}`);
      await alertOperator(
        env,
        "AUDIT_REVIEW_DELIVERED_MARK_FAILED",
        sessionId,
        "buyer email sent but delivered_at not recorded; send claim left set (no automatic resend)",
      ).catch(() => {});
    }
    await writeAuditSession(env, { ...record, email_sent_at: sentAt });
    console.log(`AUDIT_READY_EMAIL_SENT session_id=${sessionId} review_released=1`);
    return "sent";
  }
  await sendBuyerEmailOrThrow(env, record, origin, copy);
  await writeAuditSession(env, { ...record, email_sent_at: Date.now() });
  console.log(`AUDIT_READY_EMAIL_SENT session_id=${sessionId}`);
  return "sent";
}

export async function runAuditFulfillment(
  env: AuditRunEnv,
  sessionId: string,
  origin: string,
  deps: AuditRunDeps = {},
): Promise<AuditRunResult> {
  const copy = deps.emailCopy === undefined ? AUDIT_READY_EMAIL_COPY : deps.emailCopy;
  const deferOnCap = (deps.onCap ?? "defer") === "defer";
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
  if (deferOnCap && (await isDim6CapReached(env.SESSIONS))) return { kind: "cap_deferred" };

  // Review hold: decide BEFORE any report object exists, so the PDF/JSON/status
  // gates see the hold row from the moment the PDF is stored. Throws on a D1
  // error (fail-closed: the queue retries; nothing is delivered).
  const hold = standalone
    ? await decideReviewHold(env.CITATION_DB, sessionId, reviewHoldLimit(env))
    : null;
  if (hold?.held === 1 && deps.mayGenerateHeld === false) return { kind: "held_requires_queue" };

  const scannerScan = await runScan(record.url, env.INTERNAL_FULFILL_KEY, env.SCANNER_SVC);

  // Slice 3b: replace the scanner's free-tier Dim 6 demo preview with a
  // real paid Dim 6 audit. runDim6Paid handles its own daily-cap branch
  // (returns capped:true + an n/a dimension — deferred under onCap "defer",
  // shipped as-is under onCap "partial") and its own
  // all-unmeasurable branch (returns na:true). On success it returns the
  // real DimensionResult plus the cells for corpus persistence.
  const dim6 = await runDim6Paid(
    {
      AI: env.AI,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      GOOGLE_AI_API_KEY: env.GOOGLE_AI_API_KEY,
      PERPLEXITY_API_KEY: env.PERPLEXITY_API_KEY,
      // Reuse the SESSIONS KV for the Dim 6 cell cache + daily-cap counter.
      // Distinct key prefixes (`dim6:vN:` for cache, `dim6:budget:` for the
      // counter) ensure no collision with audit-fulfill's session keys.
      cacheKv: env.SESSIONS,
      // Stable Dim 6 question set per canonical domain (dim6/question-set.ts).
      questionSetDb: env.PHAROS_CORPUS,
    },
    record.url,
  );
  // R2-4: the cap was hit between the peek and the run (race) — still defer.
  if (dim6.capped && deferOnCap) return { kind: "cap_deferred" };

  // A3 provider completeness: finish anyway (the report is honest about
  // unmeasured cells) but tell the operator which provider measured nothing.
  const silentProviders = providersWithZeroMeasurableCells(dim6);
  if (silentProviders.length > 0) {
    // First failure reason per silent provider — unmeasurable cells are not
    // cached, so this alert/log is the only record of why.
    const reasons = silentProviders
      .map((m) => {
        const cell = dim6.cells.find((c) => c.modelId === m);
        return `${m}: ${redactDiagnostic(cell?.result.notes ?? "no cells").slice(0, 200)}`;
      })
      .join(" | ");
    console.error(
      `AUDIT_DIM6_PROVIDER_ZERO_CELLS session_id=${sessionId} providers=${silentProviders.join(",")} reasons=${reasons}`,
    );
    await alertOperator(
      env,
      "AUDIT_DIM6_PROVIDER_ZERO_CELLS",
      sessionId,
      `providers=${silentProviders.join(",")}\nreasons: ${reasons}`,
    );
  }

  const scan = splicePaidDim6(scannerScan, dim6.dimension);

  const gaps = buildRemediationGaps(scan);
  const audit: AuditResult = {
    scan,
    gaps,
    engine_version: REMEDIATION_ENGINE_VERSION_TAG,
  };
  const html = renderAuditHtml(audit, sessionId);
  const pdf = await generatePdf(env, html);

  // Held report: exactly one run writes its artifacts, and never after it was
  // generated, so a duplicate run cannot replace what the reviewer read/released.
  let genClaim: number | null = null;
  if (hold?.held === 1) {
    genClaim = Date.now();
    if (!(await claimReviewGeneration(env.CITATION_DB, sessionId, genClaim))) {
      const cur = await readReviewHold(env.CITATION_DB, sessionId);
      if (cur && cur.generated_at === null && cur.released_at === null) {
        console.log(`AUDIT_REVIEW_GENERATION_IN_PROGRESS session_id=${sessionId}`);
        return { kind: "generation_in_progress" };
      }
      console.log(`AUDIT_REVIEW_GENERATION_SKIPPED session_id=${sessionId} reason=already_generated`);
      return { kind: "noop_terminal", status: record.status };
    }
  }

  const next: SessionRecord = {
    ...record,
    status: "ready",
    completed_at: Date.now(),
    pdf_url: `/audit-results/${sessionId}/pdf`,
    json_url: `/audit-results/${sessionId}/json`,
    composite_score: scan.composite.score,
    grade: scan.composite.grade,
  };
  try {
    if (genClaim !== null) {
      // Full Dim 6 evidence for the reviewer (cells carry the accuracy-check
      // fields the report summarises). `summary` = the run result minus its
      // cells (stored once, below).
      const summary = dim6.raw ? { ...dim6.raw, cells: undefined } : null;
      await env.AUDITS.put(
        reviewEvidenceKey(sessionId),
        JSON.stringify({ dimension: dim6.dimension, summary, cells: dim6.cells }, null, 2),
        { httpMetadata: { contentType: "application/json" } },
      );
    }
    await storePdf(env, sessionId, pdf);
    await storeJson(env, sessionId, audit);
    await writeAuditSession(env, next);
  } catch (err) {
    if (genClaim !== null) {
      await dropReviewGenerationClaim(env.CITATION_DB, sessionId, genClaim).catch(() => {});
    }
    throw err;
  }
  if (genClaim !== null && !(await markReviewGenerated(env.CITATION_DB, sessionId, genClaim))) {
    // Lease lost (expired and retaken). Release requires generated_at, so the
    // report stays held; the operator checks it by hand.
    console.error(`AUDIT_REVIEW_GENERATED_MARK_LOST session_id=${sessionId}`);
    await alertOperator(env, "AUDIT_REVIEW_GENERATED_MARK_LOST", sessionId, "generation lease lost; check before release");
  }
  await updateFunnelStatus(env.SESSIONS, sessionId, "ready");
  // Best-effort second attempt at the dataset rights record (the webhook
  // tries first). Fire-and-forget with a timeout (the queue handler has no
  // ExecutionContext here); never awaited, so the corpus write and buyer
  // email below never wait on it. A lost record fails safe
  // (lib/dataset-consent.ts FAIL-SAFE SEMANTICS).
  if (standalone && typeof record.paid_at === "number") {
    const rights = buildRightsRecord("audit", record);
    if (rights) void scheduleRightsWrite(env.SESSIONS, sessionId, rights);
  }

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
    const outcome = await deliverBuyerEmail(env, next, origin, copy);
    if (outcome === "review_hold") {
      await alertOperator(
        env,
        "AUDIT_REVIEW_HOLD_READY",
        sessionId,
        "report generated and held for review; release via POST /api/internal/audit-review",
      );
    }
  }

  return {
    kind: "done",
    composite_score: scan.composite.score,
    grade: scan.composite.grade,
    gap_count: gaps.length,
  };
}
