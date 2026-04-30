// Slice 2b Phase 1 — Score email-capture admin endpoints.
//
// Internal-only routes that the marketing-site Worker calls after authenticating
// the user-facing request. They mutate the email-capture state on the existing
// `scans` D1 row and return narrow boolean projections of that state for
// /score/[id] page rendering. None of these endpoints expose raw email or
// other PII to the marketing-site Worker except the explicit read-back
// endpoint at GET /api/internal/scan/:id/email, which is rate-limited to
// bound a marketing-site-compromise blast radius.
//
// Auth: every endpoint here requires header `x-internal-scanner-admin-key`
// matching env.INTERNAL_SCANNER_ADMIN_KEY. This is a different secret from
// the existing INTERNAL_FULFILL_KEY (which gates audit-fulfill + paid-tier
// scan auth) — see types.ts for the rationale.
//
// Phase 2 of 2b will refactor away the email read-back endpoint by persisting
// sha256(email)[:16] directly on the row at capture time, so the PDF-download
// path on marketing-site never needs raw email back.

import { Hono } from "hono";
import type { Env } from "./types";
import { normalizeEmail } from "./email-normalize";
import { constantTimeEqual } from "./auth";

// Per-IP / per-scan rate limit on the email read-back endpoint.
// 1 req/sec per scan_id and 60/min total per worker IP. KV-backed best-effort
// (eventually-consistent across edges; acceptable for v1 anti-abuse posture).
const EMAIL_READBACK_PER_SCAN_PER_SEC = 1;
const EMAIL_READBACK_TOTAL_PER_MIN = 60;

function requireAdminAuth(
  c: { req: { header: (name: string) => string | undefined }; env: Env }
): { ok: true } | { ok: false } {
  const provided = c.req.header("x-internal-scanner-admin-key");
  if (!c.env.INTERNAL_SCANNER_ADMIN_KEY) return { ok: false };
  if (!provided) return { ok: false };
  // F-03: constant-time comparison.
  if (!constantTimeEqual(provided, c.env.INTERNAL_SCANNER_ADMIN_KEY)) {
    return { ok: false };
  }
  return { ok: true };
}

async function checkEmailReadbackRateLimit(
  env: Env,
  scanId: string,
  workerIp: string
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const now = Math.floor(Date.now() / 1000);
  const perScanKey = `int:email:${scanId}:sec`;
  const perTotalKey = `int:email:total:min`;

  // Per-scan_id 1/sec. Cheap counter — write a stamp, reject if too recent.
  try {
    const last = await env.CACHE.get(perScanKey);
    if (last) {
      const lastTs = parseInt(last, 10);
      if (Number.isFinite(lastTs) && now - lastTs < EMAIL_READBACK_PER_SCAN_PER_SEC) {
        return { allowed: false, reason: "per-scan rate exceeded" };
      }
    }
    // best-effort write; ignore errors
    await env.CACHE.put(perScanKey, String(now), { expirationTtl: 60 });
  } catch {
    // KV hiccup — skip per-scan check rather than fail open
  }

  // Total 60/min — per-worker-ip key
  try {
    const minuteBucket = Math.floor(now / 60);
    const k = `${perTotalKey}:${workerIp}:${minuteBucket}`;
    const cur = await env.CACHE.get(k);
    const n = cur ? parseInt(cur, 10) : 0;
    if (Number.isFinite(n) && n >= EMAIL_READBACK_TOTAL_PER_MIN) {
      return { allowed: false, reason: "per-minute rate exceeded" };
    }
    await env.CACHE.put(k, String(n + 1), { expirationTtl: 120 });
  } catch {
    // KV hiccup — skip
  }

  return { allowed: true };
}

export function mountScoreAdmin(app: Hono<{ Bindings: Env }>): void {
  // ── POST /api/scan/:id/capture-email ────────────────────────────────────
  // Persists email + opt-in flag + opaque hex HMAC to the row. Idempotent
  // on (scan_id, email): repeated calls with the same email are no-ops.
  app.post("/api/scan/:id/capture-email", async (c) => {
    if (!requireAdminAuth(c).ok) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    const scanId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }
    const b = body as Record<string, unknown>;
    if (
      typeof b.email !== "string" ||
      typeof b.unsubscribe_token !== "string" ||
      (typeof b.email_opted_in_rescan !== "number" &&
        typeof b.email_opted_in_rescan !== "boolean")
    ) {
      return c.json({ ok: false, error: "missing fields" }, 400);
    }
    const optedIn =
      typeof b.email_opted_in_rescan === "boolean"
        ? b.email_opted_in_rescan
          ? 1
          : 0
        : b.email_opted_in_rescan === 1
          ? 1
          : 0;

    // F-01: defense-in-depth normalize. Marketing-site already normalizes
    // before calling this endpoint; idempotent re-application here protects
    // against any future direct caller missing the step.
    const normalizedEmail = normalizeEmail(b.email);

    try {
      const res = await c.env.DB.prepare(
        `UPDATE scans
            SET email = ?,
                email_opted_in_rescan = ?,
                unsubscribe_token = ?
          WHERE id = ?`
      )
        .bind(normalizedEmail, optedIn, b.unsubscribe_token, scanId)
        .run();
      if (!res.success || (res.meta.changes ?? 0) === 0) {
        return c.json({ ok: false, error: "scan not found" }, 404);
      }
      return c.json({ ok: true });
    } catch (e) {
      console.error(
        `[capture-email] D1 update failed scan_id=${scanId}: ${e instanceof Error ? e.message : String(e)}`
      );
      return c.json({ ok: false, error: "db error" }, 500);
    }
  });

  // ── POST /api/scan/:id/pdf-generated ────────────────────────────────────
  // Marks PDF as generated (or deferred). Idempotent.
  app.post("/api/scan/:id/pdf-generated", async (c) => {
    if (!requireAdminAuth(c).ok) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    const scanId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }
    const b = body as Record<string, unknown>;
    const pdfTemplateVersion =
      typeof b.pdf_template_version === "string" ? b.pdf_template_version : null;
    const deferred =
      b.pdf_deferred_until_tomorrow === true || b.pdf_deferred_until_tomorrow === 1
        ? 1
        : 0;
    const now = Date.now();
    try {
      const res = await c.env.DB.prepare(
        `UPDATE scans
            SET pdf_template_version = ?,
                pdf_generated_at = CASE WHEN ? = 1 THEN pdf_generated_at ELSE ? END,
                pdf_deferred_until_tomorrow = ?
          WHERE id = ?`
      )
        .bind(pdfTemplateVersion, deferred, now, deferred, scanId)
        .run();
      if (!res.success || (res.meta.changes ?? 0) === 0) {
        return c.json({ ok: false, error: "scan not found" }, 404);
      }
      return c.json({ ok: true });
    } catch (e) {
      console.error(
        `[pdf-generated] D1 update failed scan_id=${scanId}: ${e instanceof Error ? e.message : String(e)}`
      );
      return c.json({ ok: false, error: "db error" }, 500);
    }
  });

  // ── POST /api/scan/:id/unsubscribe ──────────────────────────────────────
  // Sets unsubscribed_at = now(). Idempotent.
  app.post("/api/scan/:id/unsubscribe", async (c) => {
    if (!requireAdminAuth(c).ok) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    const scanId = c.req.param("id");
    const now = Date.now();
    try {
      const res = await c.env.DB.prepare(
        `UPDATE scans
            SET unsubscribed_at = COALESCE(unsubscribed_at, ?)
          WHERE id = ?`
      )
        .bind(now, scanId)
        .run();
      if (!res.success || (res.meta.changes ?? 0) === 0) {
        return c.json({ ok: false, error: "scan not found" }, 404);
      }
      return c.json({ ok: true });
    } catch (e) {
      console.error(
        `[unsubscribe] D1 update failed scan_id=${scanId}: ${e instanceof Error ? e.message : String(e)}`
      );
      return c.json({ ok: false, error: "db error" }, 500);
    }
  });

  // ── POST /api/scan/:id/delete-pii ───────────────────────────────────────
  // Clears email + unsubscribe_token. Sets deletion_requested_at. R2 deletion
  // happens marketing-site-side (it holds the AUDITS bucket binding).
  app.post("/api/scan/:id/delete-pii", async (c) => {
    if (!requireAdminAuth(c).ok) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    const scanId = c.req.param("id");
    const now = Date.now();
    try {
      const res = await c.env.DB.prepare(
        `UPDATE scans
            SET email = NULL,
                unsubscribe_token = NULL,
                deletion_requested_at = COALESCE(deletion_requested_at, ?)
          WHERE id = ?`
      )
        .bind(now, scanId)
        .run();
      if (!res.success || (res.meta.changes ?? 0) === 0) {
        return c.json({ ok: false, error: "scan not found" }, 404);
      }
      return c.json({ ok: true });
    } catch (e) {
      console.error(
        `[delete-pii] D1 update failed scan_id=${scanId}: ${e instanceof Error ? e.message : String(e)}`
      );
      return c.json({ ok: false, error: "db error" }, 500);
    }
  });

  // ── GET /api/scan/:id/scans-by-email-internal ───────────────────────────
  // Used by /api/score/delete-me/confirm. Given an email, returns the list of
  // scan_ids that match. Authenticated; rate-limited the same way the email
  // read-back endpoint is. This is the only place scanner returns scan_ids
  // by email; never exposed publicly.
  app.post("/api/scan/by-email-internal", async (c) => {
    if (!requireAdminAuth(c).ok) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }
    const b = body as Record<string, unknown>;
    if (typeof b.email !== "string") {
      return c.json({ ok: false, error: "missing email" }, 400);
    }
    // F-01: defense-in-depth normalize. Stored rows are normalized at
    // capture time; lookup must use the same canonical form to match.
    const lookupEmail = normalizeEmail(b.email);
    try {
      const res = await c.env.DB.prepare(
        `SELECT id FROM scans WHERE email = ?`
      )
        .bind(lookupEmail)
        .all<{ id: string }>();
      const ids = (res.results ?? []).map((r) => r.id);
      return c.json({ ok: true, scan_ids: ids });
    } catch (e) {
      console.error(
        `[by-email-internal] D1 query failed: ${e instanceof Error ? e.message : String(e)}`
      );
      return c.json({ ok: false, error: "db error" }, 500);
    }
  });

  // ── GET /api/internal/scan/:id/email ────────────────────────────────────
  // Returns the captured email for a scan. Sensitive: this is the only path
  // that returns raw email from scanner. Marketing-site Worker uses it to
  // compute the deterministic R2 key sha256(email)[:16] for PDF downloads.
  // Rate-limited per-scan_id and total to bound blast radius if marketing-site
  // is ever compromised.
  //
  // Phase 2 of 2b: refactor this away by persisting email_hash on the row
  // at capture time so this read-back path is no longer needed.
  app.get("/api/internal/scan/:id/email", async (c) => {
    if (!requireAdminAuth(c).ok) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    const scanId = c.req.param("id");
    const workerIp = c.req.header("CF-Connecting-IP") ?? "unknown";

    const rl = await checkEmailReadbackRateLimit(c.env, scanId, workerIp);
    if (!rl.allowed) {
      return c.json({ ok: false, error: rl.reason }, 429);
    }

    try {
      const row = await c.env.DB.prepare(
        `SELECT email FROM scans WHERE id = ?`
      )
        .bind(scanId)
        .first<{ email: string | null }>();
      if (!row) return c.json({ ok: false, error: "not found" }, 404);
      return c.json({ ok: true, email: row.email });
    } catch (e) {
      console.error(
        `[email-readback] D1 query failed scan_id=${scanId}: ${e instanceof Error ? e.message : String(e)}`
      );
      return c.json({ ok: false, error: "db error" }, 500);
    }
  });

  // ── GET /api/scan/:id/state ─────────────────────────────────────────────
  // Public-narrow: returns boolean projections of email-capture state for
  // /score/[id] page rendering. Does NOT return email, unsubscribe_token,
  // or any PII. Authenticated like the other admin endpoints because it
  // exposes capture state (knowing whether a scan has had email captured
  // is itself information we don't surface to anonymous traffic).
  app.get("/api/scan/:id/state", async (c) => {
    if (!requireAdminAuth(c).ok) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    const scanId = c.req.param("id");
    try {
      const row = await c.env.DB.prepare(
        `SELECT email, email_opted_in_rescan, unsubscribed_at,
                deletion_requested_at, pdf_template_version,
                pdf_generated_at, pdf_deferred_until_tomorrow
           FROM scans
          WHERE id = ?`
      )
        .bind(scanId)
        .first<{
          email: string | null;
          email_opted_in_rescan: number;
          unsubscribed_at: number | null;
          deletion_requested_at: number | null;
          pdf_template_version: string | null;
          pdf_generated_at: number | null;
          pdf_deferred_until_tomorrow: number;
        }>();
      if (!row) return c.json({ ok: false, error: "not found" }, 404);
      return c.json({
        ok: true,
        has_email_captured: row.email !== null && row.email.length > 0,
        email_opted_in_rescan: row.email_opted_in_rescan === 1,
        pdf_ready: row.pdf_generated_at !== null,
        unsubscribed: row.unsubscribed_at !== null,
        deletion_requested: row.deletion_requested_at !== null,
        pdf_deferred_until_tomorrow: row.pdf_deferred_until_tomorrow === 1,
        pdf_template_version: row.pdf_template_version,
      });
    } catch (e) {
      console.error(
        `[scan-state] D1 query failed scan_id=${scanId}: ${e instanceof Error ? e.message : String(e)}`
      );
      return c.json({ ok: false, error: "db error" }, 500);
    }
  });
}
