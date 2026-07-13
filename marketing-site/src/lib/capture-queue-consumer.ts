// P0-C2 Chunk E2 — marketing-owned capture Queue consumer / orchestrator.
//
// Marketing owns the Queue consumer, Browser Rendering, R2, and Resend; scanner
// owns ALL D1 state, the lease, and the artifact registry, reached ONLY through
// the Service Binding RPC client. Resume-by-phase pipeline. RPC outcome handling
// is EXHAUSTIVE and FAILS CLOSED: only explicitly classified outcomes ack; every
// unknown status, malformed field, or poison semantic error THROWS (no ack) so
// Queue automatic retry / DLQ semantics apply. Logs carry a fixed class only.

import { renderScoreReportPDF, BrowserRenderingCapError } from "./score-pdf-template";
import { buildGapReportReadyPayload, sendFrozenGapReport, type GapReportPayload } from "./score-email";
import { issueScanToken, PDF_TOKEN_TTL_SECONDS, UNSUB_TOKEN_TTL_SECONDS } from "./score-tokens";
import type { ScanResult } from "./audit-types";
import { ScannerCaptureClient } from "./scanner-capture-client";

export interface CaptureConsumerEnv {
  SCANNER_CAPTURE?: Fetcher;
  CAPTURE_CONSUMER_KEY?: string;
  CAPTURE_DLQ_NAME?: string;
  AUDITS: R2Bucket;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  RESEND_API_KEY: string;
  UNSUBSCRIBE_SECRET: string;
  ASTRANT_BASE_URL: string;
}

export type CaptureJobMessage = { job_id: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const BR_RATE_LIMIT_DEFAULT_MS = 30_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PER-OPERATION repairable reasons — EXACTLY the ownership/lease races each
// scanner op can actually emit (an ack means "the watchdog will re-enqueue").
// A reason valid for a DIFFERENT op is a malformed response for this one and is
// NOT accepted here — it falls through to a throw (fail closed).
const REPAIR = {
  register: new Set<string>(["claim", "lease_lost", "fence_lost"]),
  upload: new Set<string>(["claim", "lease_lost"]),
  commit: new Set<string>(["claim"]),
  freeze: new Set<string>(["claim", "lease_lost", "cas_failed", "claim_or_lease"]),
  defer: new Set<string>(["claim", "lease_lost"]),
  ambiguity: new Set<string>(["claim", "lease_lost", "fence_lost"]),
} as const;

class CaptureError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
const fail = (code: string): never => {
  throw new CaptureError(code);
};
const classOf = (e: unknown): string => (e instanceof CaptureError ? e.code : "unexpected");

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// The Queue body must be EXACTLY { job_id: <uuid> }.
function jobIdOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "job_id") return null;
  const id = (body as Record<string, unknown>).job_id;
  return isUuid(id) ? id : null;
}

// Documented versioned key form: score-reports/<scan UUID>/<16-hex email hash>/<positive fence>.pdf
function validVersionedKey(key: unknown, scanId: string): key is string {
  if (typeof key !== "string" || !isUuid(scanId)) return false;
  return new RegExp(`^score-reports/${scanId}/[0-9a-f]{16}/[1-9][0-9]*\\.pdf$`).test(key);
}

// results_json must parse to a ScanResult whose id matches the expected scan id.
function parseScanResult(json: unknown, expectedId: string): ScanResult | null {
  if (typeof json !== "string") return null;
  let o: unknown;
  try {
    o = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null) return null;
  const r = o as Record<string, unknown>;
  if (r.id !== expectedId || typeof r.url !== "string" || typeof r.composite !== "object" || !Array.isArray(r.dimensions)) return null;
  return o as ScanResult;
}

// EXACTLY the six immutable Resend fields; no extras; flat string→string headers.
function parseSnapshot(str: unknown): GapReportPayload | null {
  if (typeof str !== "string") return null;
  let o: unknown;
  try {
    o = JSON.parse(str);
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
  const p = o as Record<string, unknown>;
  const allowed = ["from", "to", "subject", "text", "html", "headers"];
  const keys = Object.keys(p);
  if (keys.length !== allowed.length || !allowed.every((k) => k in p)) return null;
  for (const k of ["from", "to", "subject", "text", "html"]) if (typeof p[k] !== "string") return null;
  const h = p.headers;
  if (typeof h !== "object" || h === null || Array.isArray(h)) return null;
  for (const v of Object.values(h as Record<string, unknown>)) if (typeof v !== "string") return null;
  return o as GapReportPayload;
}

type JobProj = {
  job_id: string; phase: string; op_fence: number; claim_id: string; claim_expires_at: number;
  email: string | null; pdf_r2_key: string | null; delivery_snapshot: string | null;
  created_at: number; updated_at: number;
};
type ScanProj = { id: string; results_json: string | null; pdf_r2_key: string | null };

function validClaim(job: unknown, scan: unknown, queuedJobId: string): { job: JobProj; scan: ScanProj } | null {
  if (typeof job !== "object" || job === null || typeof scan !== "object" || scan === null) return null;
  const j = job as Record<string, unknown>; const s = scan as Record<string, unknown>;
  if (!isUuid(j.job_id) || j.job_id !== queuedJobId) return null; // claimed id must equal the queued id
  if (!isUuid(j.claim_id) || typeof j.phase !== "string") return null;
  if (typeof j.op_fence !== "number" || typeof j.created_at !== "number" || typeof j.updated_at !== "number") return null;
  if (!isUuid(s.id)) return null; // scan id must be a UUID
  return { job: job as JobProj, scan: scan as ScanProj };
}

// BR backpressure → a bounded deferral time (never beyond E1's inclusive 24h bound).
export function backpressureDeferral(err: BrowserRenderingCapError, now: number): number {
  if (err.reason === "rate_limit") {
    const ms = typeof err.retryAfterMs === "number" && err.retryAfterMs > 0 ? Math.min(err.retryAfterMs, DAY_MS) : BR_RATE_LIMIT_DEFAULT_MS;
    return now + ms;
  }
  // daily_cap → the ACTUAL next UTC-midnight quota window, bounded by the RPC's
  // inclusive 24h max (next midnight is always ≤ now + 24h).
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return Math.min(d.getTime(), now + DAY_MS);
}

// Independent 24h anchor check, then Resend (idempotency key = job_id), then complete.
async function sendAndComplete(
  env: CaptureConsumerEnv, client: ScannerCaptureClient, jobId: string, claimId: string, snapshotStr: string, anchor: number,
): Promise<void> {
  if (typeof anchor !== "number") fail("bad_anchor");
  if (Date.now() - anchor >= DAY_MS) {
    // Past Resend's dedupe window — NEVER call Resend; flip to ambiguous + ack.
    const amb = await client.markAmbiguous(jobId, claimId);
    if (amb.status === "ambiguous") return; // confirmed
    if (amb.status === "error" && REPAIR.ambiguity.has(amb.reason)) return; // repairable race
    fail("ambiguity_failed"); // unknown / poison
  }
  const snapshot = parseSnapshot(snapshotStr);
  if (!snapshot) fail("bad_snapshot");
  const send = await sendFrozenGapReport(env, snapshot!, jobId);
  if (!send.ok) throw new Error("resend_failed"); // unexpected Resend failure → throw (retry)
  const done = await client.complete(jobId, claimId);
  if (done.status === "done" || done.status === "already_done") return;
  // Completion failure AFTER provider acceptance → throw; the frozen snapshot stays
  // for byte-identical replay on the next claim.
  throw new Error("complete_failed");
}

// Build the candidate payload for a freshly-committed uploaded job, freeze it,
// then deliver whichever payload E1 canonicalizes.
async function deliverFresh(
  env: CaptureConsumerEnv, client: ScannerCaptureClient, jobId: string, claimId: string, job: JobProj, scan: ScanProj,
): Promise<void> {
  const scanResult = parseScanResult(scan.results_json, scan.id);
  if (!scanResult || !job.email) fail("poison_deliver_inputs");
  const scanToken = await issueScanToken(scan.id, PDF_TOKEN_TTL_SECONDS, env.UNSUBSCRIBE_SECRET);
  const unsubToken = await issueScanToken(scan.id, UNSUB_TOKEN_TTL_SECONDS, env.UNSUBSCRIBE_SECRET);
  const requestedDate = new Date(job.created_at).toISOString().slice(0, 10); // deterministic, from created_at
  const candidate = buildGapReportReadyPayload({
    toEmail: job.email!, scan: scanResult!, scanToken, unsubscribeToken: unsubToken, origin: env.ASTRANT_BASE_URL, requestedDate,
  });
  const froze = await client.freezeSnapshot(jobId, claimId, candidate);
  if (froze.status === "frozen") {
    await sendAndComplete(env, client, jobId, claimId, JSON.stringify(candidate), froze.updated_at);
  } else if (froze.status === "already_frozen") {
    await sendAndComplete(env, client, jobId, claimId, froze.snapshot, froze.updated_at); // stored WINS
  } else if (froze.status === "error" && REPAIR.freeze.has(froze.reason)) {
    return; // ack — watchdog re-enqueues
  } else {
    fail("poison_freeze");
  }
}

async function handleCaptureMessage(env: CaptureConsumerEnv, client: ScannerCaptureClient, body: unknown): Promise<void> {
  const jobId = jobIdOf(body);
  if (!jobId) fail("poison_body");

  const claimR = await client.claim(jobId!);
  if (claimR.status === "ack_no_work" || claimR.status === "deferred") return; // expected → ack
  if (claimR.status !== "claimed") fail("poison_claim");
  const proj = validClaim(claimR.job, claimR.scan, jobId!);
  if (!proj) fail("poison_projection");
  const { job, scan } = proj!;
  const claimId = job.claim_id;
  let pdfKey = job.pdf_r2_key;

  // ── rendering ──────────────────────────────────────────────────────────────
  if (job.phase === "rendering") {
    const reg = await client.registerArtifact(jobId!, claimId);
    if (reg.status === "registered" || reg.status === "already_registered") pdfKey = reg.r2_key;
    else if (reg.status === "error" && REPAIR.register.has(reg.reason)) return; // ack
    else fail("poison_register");
    if (!validVersionedKey(pdfKey, scan.id)) fail("poison_key");

    const scanResult = parseScanResult(scan.results_json, scan.id);
    if (!scanResult || !job.email) fail("poison_render_inputs");
    let bytes: ArrayBuffer;
    try {
      const r = await renderScoreReportPDF(env, scanResult!, job.email!, scanResult!.scoring_version ?? "unknown");
      bytes = r.pdf;
    } catch (e) {
      if (e instanceof BrowserRenderingCapError) {
        const d = await client.defer(jobId!, claimId, backpressureDeferral(e, Date.now())); // releases lease
        if (d.status === "deferred") return; // ack
        if (d.status === "error" && REPAIR.defer.has(d.reason)) return; // ack
        fail("defer_failed"); // bad_next_attempt / not_found / unknown
      }
      throw e; // non-429 render failure → throw
    }
    await env.AUDITS.put(pdfKey as string, bytes, { httpMetadata: { contentType: "application/pdf" } }); // R2 failure → throw
    const up = await client.markUploaded(jobId!, claimId, pdfKey as string);
    if (up.status === "uploaded" || up.status === "already_uploaded") {
      /* continue to uploaded */
    } else if (up.status === "error" && REPAIR.upload.has(up.reason)) return; // ack
    else fail("poison_upload");
  }

  // ── uploaded ─────────────────────────────────────────────── (also after rendering)
  if (job.phase === "rendering" || job.phase === "uploaded") {
    if (!pdfKey) fail("poison_no_key");
    const commit = await client.commitPointer(jobId!, claimId, pdfKey!);
    if (commit.status === "compensation_required") {
      const key = commit.r2_key;
      if (!validVersionedKey(key, scan.id)) fail("poison_comp_key");
      await env.AUDITS.delete(key); // idempotent; throws → confirm NOT reached
      const conf = await client.confirmCompensation(jobId!, key);
      if (conf.status !== "confirmed") fail("compensation_unconfirmed"); // refused / other → throw
      return; // ack ONLY after confirmed deletion
    }
    if (commit.status === "preserved_for_retry") return; // ack, NEVER delete R2
    if (commit.status === "error" && REPAIR.commit.has(commit.reason)) return; // ack (stale claim/lease)
    if (commit.status !== "committed" && commit.status !== "already_committed") fail("poison_commit");
    await deliverFresh(env, client, jobId!, claimId, job, scan);
    return; // ack
  }

  // ── email_sending resume ─────────────────────────────────────────────────────
  if (job.phase === "email_sending") {
    if (!job.delivery_snapshot) fail("poison_no_snapshot");
    await sendAndComplete(env, client, jobId!, claimId, job.delivery_snapshot!, job.updated_at);
    return; // ack
  }

  fail("poison_phase");
}

async function handleDlqMessage(client: ScannerCaptureClient, body: unknown): Promise<void> {
  const jobId = jobIdOf(body);
  if (!jobId) return; // can't disposition an invalid body — ack it (nothing else to do)
  const r = await client.markDeadLetter(jobId);
  if (r.status === "dead_lettered" || r.status === "noop" || r.status === "ack_no_work") return; // confirmed
  fail("dlq_disposition_failed"); // unknown / error → throw
}

export async function captureQueueHandler(batch: MessageBatch<CaptureJobMessage>, env: CaptureConsumerEnv): Promise<void> {
  // Fail closed on missing required bindings/secrets — INCLUDING the DLQ identity
  // (without it a DLQ delivery is indistinguishable from a normal one) — BEFORE
  // inspecting or acknowledging any message.
  if (
    !env.SCANNER_CAPTURE || !env.CAPTURE_CONSUMER_KEY || !env.CAPTURE_DLQ_NAME || !env.AUDITS ||
    !env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RESEND_API_KEY || !env.UNSUBSCRIBE_SECRET || !env.ASTRANT_BASE_URL
  ) {
    throw new Error("capture consumer misconfigured");
  }
  const client = new ScannerCaptureClient(env.SCANNER_CAPTURE, env.CAPTURE_CONSUMER_KEY);
  const isDlq = batch.queue === env.CAPTURE_DLQ_NAME;

  for (const msg of batch.messages) {
    try {
      if (isDlq) await handleDlqMessage(client, msg.body);
      else await handleCaptureMessage(env, client, msg.body);
      msg.ack(); // explicit ack for expected / no-work / success outcomes
    } catch (e) {
      console.error(`[capture-consumer] class=${classOf(e)}`); // fixed class only — no identifiers
      throw e; // unexpected → do NOT ack → Queue automatic retry / DLQ
    }
  }
}
