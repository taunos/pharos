import { runProbeCycle } from './storage';
import { runMonthlyDigest, aggregateAndRender, computeDefaultPeriod, deriveBrandForDigest } from './digest';
import { validateBrandName } from './validation';
import { issueAccountLink } from './lib/account-link';

export interface Env {
  DB: D1Database;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  GEMINI_API_KEY: string;
  PROBE_AUTH_TOKEN: string;
  DEBUG_PROBE_LOGS?: string;
  RESEND_API_KEY: string;
  // F3.2 D9.2 + D10: mint account-link in digest footer (mirrored helper).
  ACCOUNT_LINK_SECRET: string;
  // F2 v6.1 D19 cross-Worker dispatch (Day-N audit → marketing-site /api/audit-fulfill):
  MARKETING_SITE_URL: string;       // e.g., "https://astrant.io"
  INTERNAL_FULFILL_KEY: string;     // Shared with marketing-site (per F3.2's ACCOUNT_LINK_SECRET mirror precedent)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function parsePeriodParam(value: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

async function resolvePeriod(
  env: Env,
  url: URL,
): Promise<{ periodStart: number; periodEnd: number }> {
  const startParam = parsePeriodParam(url.searchParams.get('period_start'));
  const endParam = parsePeriodParam(url.searchParams.get('period_end'));
  if (startParam !== null && endParam !== null) {
    return { periodStart: startParam, periodEnd: endParam };
  }
  return computeDefaultPeriod(env);
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 2 * * *') {
      // F2 v6.1 §3.11 — F2 sweep steps run BEFORE the per-customer probe loop.
      //   A. stale-claim cleanup (D19 MED-1 retriability)
      //   B. Day-N audit dispatch (D19; HTTP to marketing-site /api/audit-fulfill)
      //   C. Day-91 expiration sweep (D7; conditional probe-target pause)
      await runF2SweepSteps(env);

      await runProbeCycle(env);
    } else if (event.cron === '0 14 1 * *') {
      const fireTime = new Date(event.scheduledTime);
      const periodMonthIndex = fireTime.getUTCMonth() - 1;
      const periodYear = fireTime.getUTCFullYear();
      const nominalPeriodStart = Math.floor(Date.UTC(periodYear, periodMonthIndex, 1) / 1000);
      const periodEnd = Math.floor(Date.UTC(periodYear, periodMonthIndex + 1, 1) / 1000);

      const minTsRow = await env.DB.prepare('SELECT MIN(timestamp) AS min_ts FROM probe_runs').first<{ min_ts: number | null }>();
      const minTsTruncated = minTsRow?.min_ts ? Math.floor(minTsRow.min_ts / 86400) * 86400 : nominalPeriodStart;
      const periodStart = Math.max(nominalPeriodStart, minTsTruncated);

      // Astrant digest (customer_id=NULL; subscribedAt=null — no subscriptions row by design,
      // per B1.3 D5 artifact split. First-month-note short-circuits on null.)
      await runMonthlyDigest(env, periodStart, periodEnd, null, 'Astrant', null);

      // Per-customer digests (active targets only).
      // F3 §3.11: LEFT JOIN subscriptions for customer_email + current_period_start.
      // LEFT (not INNER) handles the rare case where customer_probe_targets has a row
      // but subscriptions doesn't (manual DB seed, race) — null email skips delivery + logs.
      const activeTargets = await env.DB.prepare(
        `SELECT cpt.customer_id, cpt.brand_name, s.customer_email, s.current_period_start, s.subscription_id
         FROM customer_probe_targets cpt
         LEFT JOIN subscriptions s ON s.customer_id = cpt.customer_id
         WHERE cpt.status='active'`
      ).all<{ customer_id: string; brand_name: string; customer_email: string | null; current_period_start: number | null; subscription_id: string | null }>();
      for (const target of activeTargets.results ?? []) {
        const result = await runMonthlyDigest(
          env,
          periodStart,
          periodEnd,
          target.customer_id,
          target.brand_name,
          target.current_period_start,
        );
        // F3: render PDF + send email if subscriptions row exists.
        // F3.2: include account-link footer when subscription_id is available (preserves
        //   unconditional send for the edge case of customer_email-without-subscription_id
        //   that the LEFT JOIN explicitly anticipates per line 77 comment).
        if (target.customer_email) {
          try {
            let markdownToSend = result.markdown;
            if (target.subscription_id) {
              const accountUrl = await issueAccountLink(env, target.subscription_id, 'https://astrant.io');
              markdownToSend = `${result.markdown}\n\n---\n\nManage your subscription anytime: ${accountUrl}\n\n—Astrant`;
            }
            const { renderDigestPdf } = await import('./pdf-renderer');
            const { sendDigestEmail } = await import('./digest-email');
            const pdfBytes = await renderDigestPdf(markdownToSend, target.brand_name);
            await sendDigestEmail(env, target.customer_id, target.customer_email, markdownToSend, pdfBytes, periodStart);
          } catch (err) {
            console.error(`F3_DIGEST_DELIVERY_FAILED customer_id=${target.customer_id}`, err);
          }
        } else {
          console.warn(`F3_DIGEST_NO_EMAIL customer_id=${target.customer_id} — probe target exists but no subscriptions row`);
        }
      }
    } else {
      console.warn(`Unrecognized cron expression: ${event.cron}`);
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/internal/')) {
      const auth = request.headers.get('Authorization') ?? '';
      const expected = `Bearer ${env.PROBE_AUTH_TOKEN}`;
      if (!constantTimeEqual(auth, expected)) {
        return new Response('Unauthorized', { status: 401 });
      }

      if (url.pathname === '/api/internal/probe-trigger' && request.method === 'POST') {
        ctx.waitUntil(runProbeCycle(env));
        return new Response(
          'Probe smoke-test initiated. Note: fetch-handler wall-time cap ~30s means only the first few batches will complete; full cycles run via scheduled cron only (daily 0 2 * * * UTC). Check D1 probe_runs for partial results.',
          { status: 202 },
        );
      }

      if (url.pathname === '/api/internal/digest-preview' && request.method === 'GET') {
        // Inline NUL-byte validation (per B1.3 D3 — transport-safe via String.fromCharCode(0))
        const customerIdRaw = url.searchParams.get('customer_id');
        let customerId: string | null;
        if (customerIdRaw === null || customerIdRaw === '') {
          customerId = null;
        } else {
          if (customerIdRaw.includes(String.fromCharCode(0))) {
            return jsonError(400, 'CUSTOMER_ID_NUL_BYTE', 'customer_id must not contain NUL bytes');
          }
          customerId = customerIdRaw;
        }

        const { periodStart, periodEnd } = await resolvePeriod(env, url);
        const brandResult = await deriveBrandForDigest(env, customerId);
        if (!brandResult.ok) {
          return jsonError(brandResult.status, brandResult.code, brandResult.message);
        }
        // Preview endpoint passes subscribedAt=null — first-month-note is delivery-path-only.
        const markdown = await aggregateAndRender(env, periodStart, periodEnd, customerId, brandResult.brand, null);
        return new Response(markdown, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        });
      }

      if (url.pathname === '/api/internal/digest-trigger' && request.method === 'POST') {
        // Inline NUL-byte validation (per B1.3 D3 — transport-safe via String.fromCharCode(0))
        const customerIdRaw = url.searchParams.get('customer_id');
        let customerId: string | null;
        if (customerIdRaw === null || customerIdRaw === '') {
          customerId = null;
        } else {
          if (customerIdRaw.includes(String.fromCharCode(0))) {
            return jsonError(400, 'CUSTOMER_ID_NUL_BYTE', 'customer_id must not contain NUL bytes');
          }
          customerId = customerIdRaw;
        }

        const { periodStart, periodEnd } = await resolvePeriod(env, url);
        const brandResult = await deriveBrandForDigest(env, customerId);
        if (!brandResult.ok) {
          return jsonError(brandResult.status, brandResult.code, brandResult.message);
        }
        // Trigger endpoint passes subscribedAt=null — first-month-note is delivery-path-only.
        const result = await runMonthlyDigest(env, periodStart, periodEnd, customerId, brandResult.brand, null);
        return new Response(JSON.stringify({
          row_id: result.row_id,
          period_start: result.period_start,
          period_end: result.period_end,
          generated_at: result.generated_at,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/api/internal/preview-digest' && request.method === 'POST') {
        // F3.2 operator tool: render full digest pipeline + send to specified email.
        // Useful for preview before customer sees a digest + ad-hoc support resend.
        // Requires subscription_id (mints account-link footer); customer_id + brand_name + email overridable.
        let body: { subscription_id?: string; email?: string; customer_id?: string; brand_name?: string };
        try {
          body = await request.json();
        } catch {
          return jsonError(400, 'INVALID_JSON', 'request body must be valid JSON');
        }
        const subscriptionId = body.subscription_id ?? '';
        const email = body.email ?? '';
        const customerId = body.customer_id ?? '';
        const brandName = body.brand_name ?? '';
        if (!subscriptionId || !email || !customerId || !brandName) {
          return jsonError(400, 'MISSING_FIELDS', 'subscription_id + email + customer_id + brand_name required');
        }

        const { periodStart, periodEnd } = await resolvePeriod(env, url);
        const result = await runMonthlyDigest(env, periodStart, periodEnd, customerId, brandName, null);
        const accountUrl = await issueAccountLink(env, subscriptionId, 'https://astrant.io');
        const markdownWithFooter = `${result.markdown}\n\n---\n\nManage your subscription anytime: ${accountUrl}\n\n—Astrant`;

        const { renderDigestPdf } = await import('./pdf-renderer');
        const { sendDigestEmail } = await import('./digest-email');
        const pdfBytes = await renderDigestPdf(markdownWithFooter, brandName);
        await sendDigestEmail(env, customerId, email, markdownWithFooter, pdfBytes, periodStart);
        console.log(`F3_PREVIEW_DIGEST_SENT subscription_id=${subscriptionId.substring(0, 12)} email=${email}`);
        return new Response(JSON.stringify({ ok: true, period_start: periodStart, period_end: periodEnd }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/api/internal/probe-target-add' && request.method === 'POST') {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return jsonError(400, 'INVALID_JSON', 'request body must be valid JSON');
        }

        // CUSTOMER_ID_REQUIRED
        if (typeof body.customer_id !== 'string' || body.customer_id === '') {
          return jsonError(400, 'CUSTOMER_ID_REQUIRED', 'customer_id must be a non-empty string');
        }

        // CUSTOMER_ID_NUL_BYTE (transport-safe NUL detection)
        if (body.customer_id.includes(String.fromCharCode(0))) {
          return jsonError(400, 'CUSTOMER_ID_NUL_BYTE', 'customer_id must not contain NUL bytes');
        }

        // BRAND_NAME validation (per spec §2.1; rejects empty, too long, control/zero-width/bidi, disallowed chars)
        const brandResult = validateBrandName(body.brand_name);
        if (!brandResult.ok) {
          return jsonError(400, brandResult.code, brandResult.message);
        }
        const brandTrimmed = brandResult.value;

        if (typeof body.domain !== 'string' || body.domain === '') {
          return jsonError(400, 'DOMAIN_REQUIRED', 'domain must be a non-empty string');
        }
        if (typeof body.category !== 'string' || body.category === '') {
          return jsonError(400, 'CATEGORY_REQUIRED', 'category must be a non-empty string');
        }

        // CUSTOMER_CEILING_REACHED check (v1.0 single-cron ceiling per spec D8)
        const countRow = await env.DB.prepare(
          `SELECT COUNT(*) AS c FROM customer_probe_targets WHERE status='active'`
        ).first<{ c: number }>();
        if ((countRow?.c ?? 0) >= 3) {
          return jsonError(503, 'CUSTOMER_CEILING_REACHED',
            'Customer ceiling reached (3 active customers under v1.0 single-cron). Provision blocked until cron-split or cadence-reduction ships in v1.1+. Contact ops to bypass via direct D1 INSERT if business case is urgent.');
        }

        // INSERT (CUSTOMER_ID_COLLISION on UNIQUE constraint failure)
        try {
          const now = Math.floor(Date.now() / 1000);
          await env.DB.prepare(`
            INSERT INTO customer_probe_targets (customer_id, domain, category, brand_name, competitors, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
          `).bind(
            body.customer_id,
            body.domain,
            body.category,
            brandTrimmed,
            body.competitors ? JSON.stringify(body.competitors) : null,
            now,
            now,
          ).run();
          return new Response(JSON.stringify({ added_at: now, customer_id: body.customer_id }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (e: any) {
          if (typeof e?.message === 'string' && e.message.includes('UNIQUE constraint failed')) {
            return jsonError(409, 'CUSTOMER_ID_COLLISION', `customer_id ${body.customer_id} already exists`);
          }
          throw e;
        }
      }

      if (url.pathname === '/api/internal/probe-target-remove' && request.method === 'POST') {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return jsonError(400, 'INVALID_JSON', 'request body must be valid JSON');
        }
        if (typeof body.customer_id !== 'string' || body.customer_id === '') {
          return jsonError(400, 'CUSTOMER_ID_REQUIRED', 'customer_id must be a non-empty string');
        }

        const now = Math.floor(Date.now() / 1000);
        const updateResult = await env.DB.prepare(
          `UPDATE customer_probe_targets SET status='paused', updated_at=? WHERE customer_id=?`
        ).bind(now, body.customer_id).run();
        const changed = updateResult.meta?.changes ?? 0;
        if (changed === 0) {
          return jsonError(404, 'CUSTOMER_NOT_FOUND', `customer_id ${body.customer_id} not found`);
        }
        return new Response(JSON.stringify({ removed_at: now, status: 'paused' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/api/internal/probe-target-list' && request.method === 'POST') {
        const result = await env.DB.prepare(
          `SELECT customer_id, domain, category, brand_name, status, created_at FROM customer_probe_targets ORDER BY created_at`
        ).all();
        return new Response(JSON.stringify({ targets: result.results ?? [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Unknown internal endpoint', { status: 404 });
    }

    return new Response('pharos-citation-tracking — internal instrumentation Worker. No public endpoints.', { status: 200 });
  },
};

// ─── F2 v6.1 §3.11 — Day-N audit dispatch + Day-91 expiration sweep ───────

async function runF2SweepSteps(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // STEP A — Stale-claim cleanup (v5 MED-1; per `feedback_spec_drafting_pattern_analogy_trap.md`).
  // If a Day-N audit was claimed (fired_at set) but didn't complete (no succeeded_at / no
  // failed_at) and fired_at is older than 30 min, the handler hard-killed mid-pipeline.
  // Reset fired_at to NULL so the due-audit query below picks it up for re-fire.
  const STALE_THRESHOLD_SEC = 1800;
  for (const dayN of [30, 60, 90]) {
    await env.DB.prepare(
      `UPDATE implementation_sessions
       SET day${dayN}_audit_fired_at = NULL
       WHERE day${dayN}_audit_fired_at IS NOT NULL
         AND day${dayN}_audit_fired_at < ?
         AND day${dayN}_audit_succeeded_at IS NULL
         AND day${dayN}_audit_failed_at IS NULL`,
    )
      .bind(now - STALE_THRESHOLD_SEC)
      .run();
  }

  // STEP B — Day-N audit dispatch. Find F2 sessions with due audits + fire HTTP to
  // marketing-site /api/audit-fulfill with `impl-day{N}-{f2_session_id}` discriminator.
  const dueAudits = await env.DB.prepare(
    `SELECT session_id,
            day30_audit_due_at, day30_audit_fired_at,
            day60_audit_due_at, day60_audit_fired_at,
            day90_audit_due_at, day90_audit_fired_at
     FROM implementation_sessions
     WHERE status='active' AND (
       (day30_audit_due_at < ? AND day30_audit_fired_at IS NULL) OR
       (day60_audit_due_at < ? AND day60_audit_fired_at IS NULL) OR
       (day90_audit_due_at < ? AND day90_audit_fired_at IS NULL)
     )`,
  )
    .bind(now, now, now)
    .all<{
      session_id: string;
      day30_audit_due_at: number | null;
      day30_audit_fired_at: number | null;
      day60_audit_due_at: number | null;
      day60_audit_fired_at: number | null;
      day90_audit_due_at: number | null;
      day90_audit_fired_at: number | null;
    }>();

  for (const row of dueAudits.results ?? []) {
    let dayN: 30 | 60 | 90 | null = null;
    if ((row.day30_audit_due_at ?? Infinity) < now && row.day30_audit_fired_at === null) {
      dayN = 30;
    } else if ((row.day60_audit_due_at ?? Infinity) < now && row.day60_audit_fired_at === null) {
      dayN = 60;
    } else if ((row.day90_audit_due_at ?? Infinity) < now && row.day90_audit_fired_at === null) {
      dayN = 90;
    }
    if (dayN === null) continue;

    const auditSessionId = `impl-day${dayN}-${row.session_id}`;
    try {
      const resp = await fetch(`${env.MARKETING_SITE_URL}/api/audit-fulfill`, {
        method: 'POST',
        headers: {
          'x-internal-fulfill-key': env.INTERNAL_FULFILL_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ session_id: auditSessionId }),
      });
      if (!resp.ok) {
        console.error(
          `F2_AUDIT_DISPATCH_HTTP_FAIL session_id=${row.session_id} day_n=${dayN} status=${resp.status}`,
        );
      }
    } catch (err) {
      console.error(
        `F2_AUDIT_DISPATCH_FAILED session_id=${row.session_id} day_n=${dayN} err=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // STEP C — Day-91 expiration sweep (D7 + Codex MED v3 + LOW-1 simplification).
  // Pre-query candidates to emit per-category logs (NIT-2 illustrative pattern).
  const candidates = await env.DB.prepare(
    `SELECT i.customer_id,
            EXISTS(SELECT 1 FROM subscriptions s
                   WHERE s.customer_id = i.customer_id AND s.status='active') AS has_active_f3,
            EXISTS(SELECT 1 FROM implementation_sessions i2
                   WHERE i2.customer_id = i.customer_id
                     AND i2.status='active'
                     AND i2.bundle_expires_at >= ?
                     AND i2.bundle_expired_at IS NULL) AS has_unexpired_f2
     FROM implementation_sessions i
     WHERE i.bundle_expires_at < ? AND i.bundle_expired_at IS NULL`,
  )
    .bind(now, now)
    .all<{ customer_id: string; has_active_f3: number; has_unexpired_f2: number }>();

  // Atomic Step 1 — always mark F2 bundle_expired_at for newly-expired sessions.
  await env.DB.prepare(
    `UPDATE implementation_sessions
     SET bundle_expired_at = ?
     WHERE bundle_expires_at < ? AND bundle_expired_at IS NULL`,
  )
    .bind(now, now)
    .run();

  // Step 2 — partition candidates by exclusion reason + log + targeted UPDATE on probe-targets.
  const toPause: string[] = [];
  for (const row of candidates.results ?? []) {
    console.log(`F2_BUNDLE_EXPIRED customer_id=${row.customer_id}`);
    if (row.has_active_f3) {
      console.log(`F2_PROBE_RETAINED_VIA_F3 customer_id=${row.customer_id}`);
    } else if (row.has_unexpired_f2) {
      console.log(`F2_PROBE_RETAINED_VIA_OVERLAP customer_id=${row.customer_id}`);
    } else {
      console.log(`F2_PROBE_PAUSED customer_id=${row.customer_id}`);
      toPause.push(row.customer_id);
    }
  }

  if (toPause.length > 0) {
    const placeholders = toPause.map(() => '?').join(',');
    await env.DB.prepare(
      `UPDATE customer_probe_targets
       SET status = 'paused', updated_at = ?
       WHERE customer_id IN (${placeholders})`,
    )
      .bind(now, ...toPause)
      .run();
  }
}
