import { runProbeCycle, probeSingleTarget } from './storage';
import { runMonthlyDigest, aggregateAndRender, computeDefaultPeriod, deriveBrandForDigest } from './digest';
import { validateBrandName } from './validation';
import { issueAccountLink } from './lib/account-link';
import { ASTRANT_BASELINE, customerIdToProbeArg } from './probe-constants';
import { sendOperatorAlert } from './alerts';

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
  // B1.3 v1.1 cron-fix:
  MAX_PROBE_TARGETS: string;        // v1.1 ceiling primitive; replaces hardcoded CUSTOMER_CEILING=3 (default "30")
  OPERATOR_ALERT_TO: string;        // operator alert recipient (taunos@gmail.com); used by alerts.ts
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
      // F2 v6.1 §3.11 — F2 sweep steps run BEFORE the per-customer probe enqueue.
      //   A. stale-claim cleanup (D19 MED-1 retriability)
      //   B. Day-N audit dispatch (D19; HTTP to marketing-site /api/audit-fulfill)
      //   C. Day-91 expiration sweep (D7; conditional probe-target pause)
      await runF2SweepSteps(env);

      // B1.3 v1.1 cron-fix (was: await runProbeCycle(env)) — enqueue today's probe targets
      // to D1; drain handler (10,30,50 * * * *) processes one target per tick to avoid
      // scheduled-handler wall-time exhaustion (silent-truncation incident root cause).
      const jobDate = new Date(event.scheduledTime).toISOString().slice(0, 10);
      await enqueueDailyProbeJobs(env, jobDate);
    } else if (event.cron === '10,30,50 * * * *') {
      // B1.3 v1.1 cron-fix — drain dispatcher: claims one pending probe_jobs row + runs the
      // full probe (45 batches × 4 providers = 180 rows). Stale-claim recovery + alert
      // dispatch + enqueue-lag check live inside drainProbeJobsTick.
      await drainProbeJobsTick(env);
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

        // B1.3 v1.1 — endpoint validator (Locked Artifact H; rejects 'astrant' sentinel + non-sub_ shapes)
        const customerIdValidation = validateCustomerIdForProbeTarget(body.customer_id);
        if (!customerIdValidation.ok) {
          return jsonError(400, 'CUSTOMER_ID_INVALID', `customer_id ${customerIdValidation.reason}`);
        }

        // CUSTOMER_ID_NUL_BYTE (transport-safe NUL detection; pre-existing defensive check preserved)
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

        // CUSTOMER_CEILING_REACHED check (B1.3 v1.1: MAX_PROBE_TARGETS env binding replaces hardcoded 3)
        const maxProbeTargets = parseInt(env.MAX_PROBE_TARGETS ?? '30', 10);
        const countRow = await env.DB.prepare(
          `SELECT COUNT(*) AS c FROM customer_probe_targets WHERE status='active'`
        ).first<{ c: number }>();
        if ((countRow?.c ?? 0) >= maxProbeTargets) {
          return jsonError(503, 'CUSTOMER_CEILING_REACHED',
            `Customer ceiling reached (${maxProbeTargets} active customers). Contact ops to bypass via direct D1 INSERT if business case is urgent.`);
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

// ─── B1.3 v1.1 cron-fix — endpoint validator + enqueue + drain ─────────────

// Locked Artifact H — endpoint validator for customer_id-accepting probe-target endpoints.
// Rejects the 'astrant' sentinel + case variants + non-sub_ shapes. Duplicated at the marketing-site
// (i)-sites (Step 5.7). NOT applied at dodo-webhook (read-only ceiling check per V3).
function validateCustomerIdForProbeTarget(s: unknown): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof s !== 'string') return { ok: false, reason: 'not a string' };
  if (s === 'astrant') return { ok: false, reason: 'reserved sentinel' };
  if (s.toLowerCase() === 'astrant') return { ok: false, reason: 'case-mismatched reserved sentinel' };
  if (!/^sub_.+$/.test(s)) return { ok: false, reason: 'not a sub_<token> shape' };
  return { ok: true, value: s };
}

// enqueueDailyProbeJobs — runs once daily at 0 2 UTC. Inserts one probe_jobs row per active probe
// target (plus Astrant baseline). Drain handler picks these up at 10/30/50 every hour.
// V11.C: SELECT does NOT pull brand_name — preserves B1.3 v1.0 probe-input semantics (domain in slot 6
// for customers, literal 'Astrant' for baseline; per deploy-prompt C8).
async function enqueueDailyProbeJobs(env: Env, jobDate: string): Promise<void> {
  const activeTargets = await env.DB.prepare(
    "SELECT customer_id, domain, category FROM customer_probe_targets WHERE status='active'"
  ).all<{ customer_id: string; domain: string; category: string }>();

  // ?? [] defensive guard matches shipped storage.ts:47 pattern (per spec N1-v5).
  const customerRows = (activeTargets.results ?? []).map((t) => ({
    customer_id: t.customer_id,
    probe_subject: t.domain,
    target_category: t.category,
  }));
  const allTargets = [ASTRANT_BASELINE, ...customerRows];

  let inserted = 0, ignored = 0, skipped = 0;
  const enqueuedAt = Math.floor(Date.now() / 1000);
  for (const t of allTargets) {
    if (!t.probe_subject || !t.target_category) {
      console.error(`B1_3_ENQUEUE_INCOMPLETE_TARGET customer_id=${t.customer_id}`);
      skipped++;
      continue;
    }
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO probe_jobs (job_date, customer_id, status, enqueued_at, retry_count, probe_subject, target_category) VALUES (?, ?, 'pending', ?, 0, ?, ?)"
    ).bind(jobDate, t.customer_id, enqueuedAt, t.probe_subject, t.target_category).run();
    if (result.meta.changes === 1) inserted++; else ignored++;
  }

  console.log(`B1_3_ENQUEUE_TICK job_date=${jobDate} target_count=${allTargets.length} inserted=${inserted} ignored=${ignored} skipped=${skipped}`);
  if (inserted + ignored + skipped < allTargets.length) {
    console.error(`B1_3_ENQUEUE_MISMATCH job_date=${jobDate} expected=${allTargets.length} processed=${inserted + ignored + skipped}`);
  }
}

// drainProbeJobsTick — runs every 20 min (10,30,50 * * * *). Four-step pipeline:
//   A. stale-claim recovery (D7) — three-statement: bound failed-bound for DELETE, then UPDATE+1.
//   B. alert dispatch (D8) — UUID-claim pattern (M3-v3); per-row try-catch reset-on-throw.
//   C. drain one pending row + run probe + verify rows_written === 180.
//   D. enqueue-lag check (D6) — MAX(now - enqueued_at) > 14400s ⇒ log alert threshold.
async function drainProbeJobsTick(env: Env): Promise<void> {
  // ─── Step A: pre-drain stale-claim recovery ─────────────────────────────
  const staleThreshold = Math.floor(Date.now() / 1000) - 1800;

  const failedBound = await env.DB.prepare(
    "SELECT id, probe_run_id FROM probe_jobs WHERE status='processing' AND claimed_at < ? AND retry_count + 1 >= 3"
  ).bind(staleThreshold).all<{ id: number; probe_run_id: string | null }>();

  for (const row of (failedBound.results ?? [])) {
    if (row.probe_run_id) {
      await env.DB.prepare("DELETE FROM probe_runs WHERE probe_run_id = ?").bind(row.probe_run_id).run();
    }
  }

  await env.DB.prepare(
    "UPDATE probe_jobs SET status = CASE WHEN retry_count + 1 >= 3 THEN 'failed' ELSE 'pending' END, claimed_at = NULL, retry_count = retry_count + 1 WHERE status='processing' AND claimed_at < ?"
  ).bind(staleThreshold).run();

  // ─── Step B: alert-fire on 'failed' rows (UUID-claim per M3-v3) ─────────
  const alertClaimId = crypto.randomUUID();
  const alertFiredAt = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    "UPDATE probe_jobs SET alert_claim_id = ?, alert_fired_at = ? WHERE status='failed' AND alert_claim_id IS NULL"
  ).bind(alertClaimId, alertFiredAt).run();

  const claimedJobs = await env.DB.prepare(
    "SELECT id, customer_id FROM probe_jobs WHERE status='failed' AND alert_claim_id = ?"
  ).bind(alertClaimId).all<{ id: number; customer_id: string }>();

  for (const job of (claimedJobs.results ?? [])) {
    try {
      await sendOperatorAlert(env, `B1_3_PROBE_JOB_FAILED job_id=${job.id} customer_id=${job.customer_id}`);
    } catch (err) {
      await env.DB.prepare(
        "UPDATE probe_jobs SET alert_claim_id = NULL, alert_fired_at = NULL WHERE id = ? AND alert_claim_id = ?"
      ).bind(job.id, alertClaimId).run();
      console.error(`B1_3_PROBE_JOB_ALERT_THROW job_id=${job.id} error=${String(err)}`);
    }
  }

  // ─── Step C: drain ONE pending row (D11 + D12; one-target-per-tick) ─────
  const pending = await env.DB.prepare(
    "SELECT id, customer_id, probe_run_id AS prior_probe_run_id, probe_subject, target_category FROM probe_jobs WHERE status='pending' ORDER BY job_date, customer_id LIMIT 1"
  ).first<{ id: number; customer_id: string; prior_probe_run_id: string | null; probe_subject: string; target_category: string }>();
  if (!pending) {
    console.log("B1_3_DRAIN_TICK_NO_PENDING");
    return;
  }

  if (pending.prior_probe_run_id) {
    await env.DB.prepare("DELETE FROM probe_runs WHERE probe_run_id = ?").bind(pending.prior_probe_run_id).run();
  }

  const newProbeRunId = crypto.randomUUID();
  const claimTs = Math.floor(Date.now() / 1000);
  const casResult = await env.DB.prepare(
    "UPDATE probe_jobs SET status='processing', claimed_at=?, probe_run_id=? WHERE id=? AND status='pending'"
  ).bind(claimTs, newProbeRunId, pending.id).run();
  if (casResult.meta.changes === 0) {
    console.log(`B1_3_DRAIN_CAS_LOST job_id=${pending.id}`);
    return;
  }

  const customerIdArg = customerIdToProbeArg(pending.customer_id);
  let probeError: string | null = null;
  try {
    await probeSingleTarget(env, customerIdArg, pending.probe_subject, pending.target_category, newProbeRunId);
  } catch (err) {
    probeError = String(err);
    console.error(`B1_3_PROBE_THROW job_id=${pending.id} error=${probeError}`);
  }

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM probe_runs WHERE probe_run_id = ?"
  ).bind(newProbeRunId).first<{ c: number }>();
  const rowsWritten = countRow?.c ?? 0;

  if (rowsWritten === 180 && !probeError) {
    await env.DB.prepare(
      "UPDATE probe_jobs SET status='done', completed_at=?, rows_written=? WHERE id=? AND status='processing'"
    ).bind(Math.floor(Date.now() / 1000), rowsWritten, pending.id).run();
    console.log(`B1_3_DRAIN_PROBE_DONE job_id=${pending.id} customer_id=${pending.customer_id} probe_run_id=${newProbeRunId} rows_written=${rowsWritten}`);
  } else {
    await env.DB.prepare("DELETE FROM probe_runs WHERE probe_run_id = ?").bind(newProbeRunId).run();
    await env.DB.prepare(
      "UPDATE probe_jobs SET status = CASE WHEN retry_count + 1 >= 3 THEN 'failed' ELSE 'pending' END, claimed_at = NULL, completed_at = NULL, retry_count = retry_count + 1, rows_written = ?, last_error = ? WHERE id = ? AND status='processing'"
    ).bind(rowsWritten, probeError, pending.id).run();
    console.log(`B1_3_DRAIN_PROBE_RETRY job_id=${pending.id} customer_id=${pending.customer_id} probe_run_id=${newProbeRunId} rows_written=${rowsWritten} probe_error=${probeError ?? 'none'}`);
  }

  // ─── Step D: enqueue-lag check (lightweight; logs threshold breach only) ─
  const nowTs = Math.floor(Date.now() / 1000);
  const lagRow = await env.DB.prepare(
    "SELECT MAX(? - enqueued_at) AS max_lag FROM probe_jobs WHERE status='pending'"
  ).bind(nowTs).first<{ max_lag: number | null }>();
  const maxLag = lagRow?.max_lag ?? 0;
  if (maxLag > 14400) {
    console.error(`B1_3_PROBE_ENQUEUE_LAG_THRESHOLD max_lag=${maxLag}`);
  }
}
