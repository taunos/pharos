// Slice 2b Phase 1 — POST /api/score/capture-email
//
// Captures an email + opt-in flag for a Score scan, persists to scanner D1
// (via INTERNAL_SCANNER_ADMIN_KEY internal endpoint), generates the gap-report
// PDF, sends Resend email.
//
// E1 (code-quality audit 2026-11-05): the JSON response NEVER carries a
// token or token-bearing URL. The PDF/results links go only to the inbox.
// The scan's captured address is the only address that ever receives its
// report: a repeat request re-sends to the STORED address, and a different
// address for a scan that already has one is REFUSED (409). Refusing (rather
// than treating it as a new capture) keeps a stranger with the /score/<id>
// link from re-pointing the victim's scan — its rescan emails, unsubscribe
// state and report — at their own inbox, and from using any public scan id
// to mail arbitrary addresses. A user who mistyped can run a new scan.
//
// Multi-state idempotency:
//   - pdf_ready === true: re-issue token (fresh expiry), re-send email,
//     5-minute cool-down per (scan_id, email).
//   - pdf_deferred_until_tomorrow === true: short-circuit. Don't re-attempt
//     BR (cap is still tripped). Don't re-send email. 1-hour cool-down per
//     (scan_id, email). Response message: "still queued."
//
// Honeypot: byte-indistinguishable success on `referral_code` non-empty.
// Same JSON shape, plausible token-shaped values that 404 when followed.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  issueScanToken,
  PDF_TOKEN_TTL_SECONDS,
  UNSUB_TOKEN_TTL_SECONDS,
  hashEmailForLog,
} from "@/lib/score-tokens";
import { normalizeEmail } from "@/lib/email-normalize";
import { parseCapturePipelineMode } from "@/lib/capture-pipeline-mode";
import { requestOrigin } from "@/lib/origin";
import {
  generateScoreReportPDF,
  PDF_TEMPLATE_VERSION,
  BrowserRenderingCapError,
} from "@/lib/score-pdf-template";
import {
  sendGapReportReadyEmail,
  sendGapReportDeferredEmail,
} from "@/lib/score-email";
import {
  captureEmail,
  captureOutbox,
  getEmailForScan,
  getPublicScan,
  getScanState,
  markPdfGenerated,
} from "@/lib/score-scanner-client";
import type { ScanResult } from "@/lib/audit-types";
import { checkCaptureEmailRateLimit, type RateLimitBinding } from "@/lib/rate-limit-kv";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// P0-C2 capture cutover (CD3): flat resubmit cool-down under the deferred
// pipeline. Within the window → 200 deferred with NO outbox call and NO stamp.
const CAPTURE_RESUBMIT_COOLDOWN_S = 300;

interface CaptureEnv {
  AUDITS: R2Bucket;
  TRIAGE_CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  RESEND_API_KEY: string;
  UNSUBSCRIBE_SECRET: string;
  INTERNAL_SCANNER_ADMIN_KEY: string;
  CAPTURE_PIPELINE_MODE?: string;
  RATE_LIMIT_HASH_SECRET?: string;
  CAPTURE_RATE_LIMITER?: RateLimitBinding;
  SCANNER_SVC?: Fetcher;
}

// Honeypot success — byte-identical to a real fresh-capture success. Bots
// keep a 200 response in their "success" bucket; humans never see this branch.
function honeypotResponse() {
  return NextResponse.json({ success: true, deferred: false });
}

// E1: the visitor-facing refusal when the scan already has a different
// captured address.
const DIFFERENT_EMAIL_ERROR =
  "This scan's report has already been sent to a different address. To get a report at this address, run a new scan.";

export const maxDuration = 120;

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as CaptureEnv;
  const mode = parseCapturePipelineMode(env.CAPTURE_PIPELINE_MODE);
  const origin = requestOrigin(req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { success: false, error: "Body must be a JSON object." },
      { status: 400 }
    );
  }
  const b = body as Record<string, unknown>;

  // Honeypot check FIRST — before any DB lookup or expensive work.
  if (typeof b.referral_code === "string" && b.referral_code.trim().length > 0) {
    return honeypotResponse();
  }

  if (typeof b.scan_id !== "string" || b.scan_id.length === 0) {
    return NextResponse.json(
      { success: false, error: "scan_id is required." },
      { status: 400 }
    );
  }
  if (typeof b.email !== "string" || !EMAIL_RE.test(b.email.trim())) {
    return NextResponse.json(
      { success: false, error: "email must be a valid email address." },
      { status: 400 }
    );
  }
  const scanId = b.scan_id;
  // F-01: normalize at entry. Every downstream use (HMAC, R2, D1, log hash)
  // must see the canonical form so the same address with different casing
  // resolves to the same row / token / key / hash.
  const email = normalizeEmail(b.email);
  const optInRescan = b.opt_in_rescan === true; // strict equality (TF-05 / TP-3)

  if (!env.UNSUBSCRIBE_SECRET || !env.INTERNAL_SCANNER_ADMIN_KEY) {
    console.error(
      "[capture-email] missing required env: UNSUBSCRIBE_SECRET or INTERNAL_SCANNER_ADMIN_KEY"
    );
    return NextResponse.json(
      { success: false, error: "Server not configured." },
      { status: 500 }
    );
  }

  const emailLogHash = await hashEmailForLog(email, env.UNSUBSCRIBE_SECRET);

  // E2: per-IP + per-scan distinct-recipient send limits, before any scanner
  // call or send. Over-limit reuses the existing generic save-failure copy.
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const rl = await checkCaptureEmailRateLimit(
    env.SESSIONS,
    ip,
    scanId,
    emailLogHash,
    env.RATE_LIMIT_HASH_SECRET,
    env.CAPTURE_RATE_LIMITER
  );
  if (!rl.allowed) {
    if (rl.misconfigured) {
      console.error("RATE_LIMIT_MISCONFIGURED: RATE_LIMIT_HASH_SECRET is not set");
      return NextResponse.json(
        { success: false, error: "Server not configured." },
        { status: 503 }
      );
    }
    console.warn("[capture-email] rate_limited");
    return NextResponse.json(
      { success: false, error: "Could not save your email. Please try again." },
      {
        status: 429,
        headers: rl.retryAfterSec ? { "Retry-After": String(rl.retryAfterSec) } : undefined,
      }
    );
  }

  // ── State check + idempotency cool-downs ───────────────────────────────
  const stateRes = await getScanState(env, scanId);
  if (!stateRes.ok) {
    console.error(
      `[capture-email] scan-state failed scan=${scanId} email_hash=${emailLogHash}: ${stateRes.error}`
    );
    return NextResponse.json(
      { success: false, error: "Scan not found." },
      { status: 404 }
    );
  }
  const state = stateRes;

  // ── E1: bind the scan to its captured address ──────────────────────────
  // A scan that already has an address only ever mails THAT address.
  let recipient = email;
  let recipientIsStored = false;
  if (state.has_email_captured) {
    const stored = await getEmailForScan(env, scanId);
    if (!stored.ok) {
      console.error(
        `[capture-email] stored-email read failed scan=${scanId} email_hash=${emailLogHash}: ${stored.error}`
      );
      return NextResponse.json(
        { success: false, error: "Could not load scan." },
        { status: 502 }
      );
    }
    if (stored.email) {
      if (normalizeEmail(stored.email) !== email) {
        return NextResponse.json(
          { success: false, error: DIFFERENT_EMAIL_ERROR },
          { status: 409 }
        );
      }
      recipient = normalizeEmail(stored.email);
      recipientIsStored = true;
    }
  }

  // Idempotency keys live in TRIAGE_CACHE under the existing pattern. Bound
  // resubmission frequency to prevent re-send abuse + capacity-event self-DoS.
  const idemKey = `idem:capture:${scanId}:${emailLogHash}`;
  const idemPrev = await env.TRIAGE_CACHE.get(idemKey);
  const nowSec = Math.floor(Date.now() / 1000);

  // ── Token issuance (always re-issue with fresh expiry on re-submit) ────
  // Purpose-bound (E1): the report token cannot unsubscribe and vice versa.
  // Neither ever appears in this route's response; both go only by email.
  const scanToken = await issueScanToken(
    scanId,
    PDF_TOKEN_TTL_SECONDS,
    env.UNSUBSCRIBE_SECRET,
    "report"
  );
  const unsubToken = await issueScanToken(
    scanId,
    UNSUB_TOKEN_TTL_SECONDS,
    env.UNSUBSCRIBE_SECRET,
    "unsub"
  );

  // ── P0-C2 capture cutover (CD1/CD3): gate ON → deferred pipeline; ALWAYS returns.
  // The shared legacy prefix above (honeypot → validation → env guard → state →
  // idem-key read → token issuance) ran unchanged. Legacy Branches 1–3 below are
  // the gate-off path and stay byte-unchanged.
  if (mode === "on") {
    if (idemPrev) {
      const prevTs = parseInt(idemPrev, 10);
      if (Number.isFinite(prevTs) && nowSec - prevTs < CAPTURE_RESUBMIT_COOLDOWN_S) {
        return NextResponse.json({
          success: true,
          deferred: true,
        });
      }
    }
    const outcome = await captureOutbox(env, scanId, {
      email: recipient,
      email_opted_in_rescan: optInRescan,
      unsubscribe_token: scanToken,
    });
    switch (outcome.status) {
      case "deferred":
        await env.TRIAGE_CACHE.put(idemKey, String(nowSec), {
          expirationTtl: 86400,
        });
        return NextResponse.json({
          success: true,
          deferred: true,
        });
      case "conflict":
        console.error("[capture-email] outbox_conflict");
        return NextResponse.json(
          // E1: a different address is in flight and will stay bound to the scan.
          { success: false, error: DIFFERENT_EMAIL_ERROR },
          { status: 409 }
        );
      case "not_found":
        return NextResponse.json(
          { success: false, error: "Scan not found." },
          { status: 404 }
        );
      case "unavailable":
      case "transport_error":
        console.error("[capture-email] outbox_unavailable");
        return NextResponse.json(
          { success: false, error: "We couldn't queue your report just now. Please try again in a minute." },
          { status: 503 }
        );
    }
  }

  // ── Branch 1: BR cap was tripped earlier; PDF deferred ─────────────────
  // 1-hour cool-down — repeated submits during a deferred state would
  // otherwise re-attempt BR against a still-tripped cap and re-send the
  // deferred-variant email on every refresh.
  //
  // KNOWN EDGE CASE (review pass 3 issue #6, punted intentionally): if a
  // user submits at 23:55 UTC and gets deferred, then resubmits at 00:30 UTC
  // the next day (BR cap reset at 00:00), this 1-hour window suppresses
  // their resubmit even though BR is now actually available. They wait up
  // to 24h longer than necessary. At pre-launch volume this is vanishingly
  // unlikely; Phase 2's BR-deferred cron sweep makes it a non-issue. If the
  // path becomes real before Phase 2: change the check to "until next UTC
  // midnight after deferral set", which makes the deferred state self-healing
  // without a cron.
  if (state.pdf_deferred_until_tomorrow) {
    if (idemPrev) {
      const prevTs = parseInt(idemPrev, 10);
      if (Number.isFinite(prevTs) && nowSec - prevTs < 3600) {
        return NextResponse.json({
          success: true,
          deferred: true,
          message:
            "Your gap report is still queued for generation. We'll email it when ready — usually within 24 hours.",
        });
      }
    }
    // Outside the 1-hour window — the user is patient enough that we should
    // re-confirm the deferred state to them, but still not re-attempt BR.
    await env.TRIAGE_CACHE.put(idemKey, String(nowSec), {
      expirationTtl: 86400,
    });
    return NextResponse.json({
      success: true,
      deferred: true,
      message:
        "Your gap report is queued for generation. We'll email it within 24 hours.",
    });
  }

  // ── Branch 2: PDF is already ready — skip regen, re-issue token, re-send ─
  // 5-minute cool-down on resend.
  if (state.has_email_captured && state.pdf_ready) {
    const cooldownOk =
      !idemPrev ||
      (() => {
        const prevTs = parseInt(idemPrev, 10);
        return !Number.isFinite(prevTs) || nowSec - prevTs >= 300;
      })();
    if (!cooldownOk) {
      return NextResponse.json({
        success: true,
        message: "Your gap report is ready — check your inbox.",
      });
    }
    // Fail closed: the state said captured but the stored address read back
    // empty (e.g. a concurrent delete-me). Never fall back to the request's
    // address here — this branch sends without binding.
    if (!recipientIsStored) {
      return NextResponse.json(
        { success: false, error: "Could not load scan." },
        { status: 502 }
      );
    }
    // Re-send. Need the public scan record for email body composition.
    const scanFetch = await getPublicScan(scanId, env);
    if (!scanFetch.ok) {
      console.error(
        `[capture-email] scan fetch failed for resend scan=${scanId} email_hash=${emailLogHash}: ${scanFetch.error}`
      );
      return NextResponse.json(
        { success: false, error: "Could not load scan." },
        { status: 502 }
      );
    }
    const scan = scanFetch.data as ScanResult;
    const sendRes = await sendGapReportReadyEmail(env, {
      toEmail: recipient,
      scan,
      scanToken,
      unsubscribeToken: unsubToken,
      origin,
    });
    if (!sendRes.ok) {
      console.error(
        `[capture-email] resend failed scan=${scanId} email_hash=${emailLogHash}: ${sendRes.error}`
      );
    }
    await env.TRIAGE_CACHE.put(idemKey, String(nowSec), {
      expirationTtl: 86400,
    });
    return NextResponse.json({
      success: true,
    });
  }

  // ── Branch 3: fresh capture — persist + generate + send ────────────────

  // Persist email + opaque HMAC to scanner D1.
  // Note the unsubscribe_token field stores the FULL scan-bound HMAC value
  // (scanner treats it as opaque hex; never relied on for authority — every
  // request recomputes from secret + URL claim).
  const persist = await captureEmail(env, scanId, {
    email: recipient,
    email_opted_in_rescan: optInRescan,
    unsubscribe_token: scanToken,
  });
  if (!persist.ok && persist.emailBound) {
    // E1: lost a concurrent first-capture race to a different address. The
    // scanner write is atomic; nothing was stored, rendered or sent.
    return NextResponse.json(
      { success: false, error: DIFFERENT_EMAIL_ERROR },
      { status: 409 }
    );
  }
  if (!persist.ok) {
    console.error(
      `[capture-email] persist failed scan=${scanId} email_hash=${emailLogHash}: ${persist.error}`
    );
    return NextResponse.json(
      { success: false, error: "Could not save your email. Please try again." },
      { status: 502 }
    );
  }

  // Fetch the public scan record (needed for PDF gen + email body).
  const scanFetch = await getPublicScan(scanId, env);
  if (!scanFetch.ok) {
    console.error(
      `[capture-email] scan fetch failed scan=${scanId} email_hash=${emailLogHash}: ${scanFetch.error}`
    );
    return NextResponse.json(
      { success: false, error: "Could not load scan." },
      { status: 502 }
    );
  }
  const scan = scanFetch.data as ScanResult;

  // Generate PDF. On BR daily-cap miss, defer.
  let deferred = false;
  try {
    await generateScoreReportPDF(
      env,
      scan,
      recipient,
      scan.scoring_version ?? "unknown"
    );
    await markPdfGenerated(env, scanId, {
      pdf_template_version: PDF_TEMPLATE_VERSION,
      pdf_deferred_until_tomorrow: false,
    });
  } catch (err) {
    if (err instanceof BrowserRenderingCapError) {
      console.warn(
        `[capture-email] BR cap reached — deferring scan=${scanId} email_hash=${emailLogHash}`
      );
      deferred = true;
      await markPdfGenerated(env, scanId, {
        pdf_template_version: PDF_TEMPLATE_VERSION,
        pdf_deferred_until_tomorrow: true,
      });
    } else {
      console.error(
        `[capture-email] PDF gen failed scan=${scanId} email_hash=${emailLogHash}: ${err instanceof Error ? err.message : String(err)}`
      );
      // Email captured, PDF failed — surface a friendly retry. Don't error
      // out the whole request: the row is saved and a resubmit regenerates.
      return NextResponse.json({
        success: true,
        message:
          "We saved your email but couldn't generate the PDF right now. Refresh the results page in a few minutes or email contact@astrant.io for help.",
      });
    }
  }

  // Send the appropriate email variant.
  const sendInput = {
    toEmail: recipient,
    scan,
    scanToken,
    unsubscribeToken: unsubToken,
    origin,
  };
  const sendRes = deferred
    ? await sendGapReportDeferredEmail(env, sendInput)
    : await sendGapReportReadyEmail(env, sendInput);
  if (!sendRes.ok) {
    console.error(
      `[capture-email] resend failed scan=${scanId} email_hash=${emailLogHash} deferred=${deferred}: ${sendRes.error}`
    );
    // Still return success — the address is saved and a repeat submit
    // re-sends (5-minute cool-down); EmailGate points to contact@astrant.io.
  }

  await env.TRIAGE_CACHE.put(idemKey, String(nowSec), {
    expirationTtl: 86400,
  });

  return NextResponse.json({
    success: true,
    deferred,
  });
}
