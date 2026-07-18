// P0-C2 Chunk G — gated privacy-delete integration + legacy-surface guard
// helper + authenticated dead-letter replay endpoint.
//
// Everything here is behind PRIVACY_INTEGRATION_MODE (fail-closed 'off'):
// with the gate off/absent/unknown the score-admin surfaces run their literal
// legacy bytes and the replay route 404s with zero statements. Privacy-delete
// acts on the scan op-lease plane ONLY — it never creates a retention_jobs
// row, never sets retention_locked_at, never hard-deletes the scan row. The
// only retention exports consumed are prepRetentionSql (the named→positional
// transform) and replayDeadLetter (wrapped, never reimplemented).
//
// Logging discipline (D14): all NEW log lines are counts + fixed error classes
// only — no scan UUID, job UUID, email, R2 key, or prefix. The D1 audit row is
// where real identifiers live.

import type { Hono } from "hono";
import type { Env } from "./types";
import { MarketingR2Client } from "./marketing-r2-client";
import { prepRetentionSql, replayDeadLetter } from "./retention-sweep";
import { requireScannerAdminAuth } from "./auth";
import { CAPTURE_SET_EMAIL_GUARDED_SQL } from "./score-sql";

// ── Locked constants (frozen spec GD6/GD10; grep-verified in Phase 4) ────────
export const PD_LEASE_MS = 300000;
export const PD_PURGE_BUDGET_MS = 10000;
export const PD_REQUEST_BUDGET_MS = 25000;
export const PD_TAIL_MARGIN_MS = 2000;
export const MIN_RPC_WINDOW_MS = 1000;
export const LEASE_RENEW_MARGIN_MS = 5000;
export const REPLAY_PER_MIN = 10;

// Sanity ceiling for the opts-injected budgets ("boundedInt-style" validation;
// opts are a test/ops knob — production dispatch passes no opts).
const MAX_BUDGET_MS = 3_600_000;

export type IntegrationMode = "off" | "on";

// GD1: exact lowercase match only; every other value (absent, case-variant,
// whitespace, unknown) fails closed to 'off'. Never log the raw env value.
export function parseIntegrationMode(v: unknown): IntegrationMode {
  return v === "on" ? "on" : "off";
}

// ── PRIVACY_SQL — byte-binding fragments (frozen spec §3 A4 + §4.2 P1–P10) ──
// Stored byte-verbatim, comment lines included (tG11 audits these strings;
// Phase 4 byte-diffs them against the deploy prompt's appendices). Execution
// goes through prepRetentionSql, which strips whole-line `--` comments and
// converts each :name to ?N in first-occurrence order.
export const PRIVACY_SQL = {
  a4Read: `SELECT id, op_lease_id, op_fence, op_lease_expires_at, tier, email_opted_in_rescan, created_at,
       retention_locked_at, retention_job_id
FROM scans WHERE id = :id;`,
  p1: `-- P1 acquire (binds: :cid, :live, :PD_LEASE_MS, :id) — exactly 1 + RETURNING fence; 0 → a4Read routing (GD9)
UPDATE scans SET op_owner='privacy_delete', op_lease_id=:cid, op_lease_expires_at=:live+:PD_LEASE_MS, op_fence=op_fence+1
WHERE id=:id AND (op_lease_id IS NULL OR op_lease_expires_at < :live)
RETURNING op_fence;`,
  p2: `-- P2 lease renewal (binds: :live, :PD_LEASE_MS, :id, :cid, :fence) — exactly 1; 0 → pd_lease_lost, abort before next destructive step
UPDATE scans SET op_lease_expires_at = :live + :PD_LEASE_MS
WHERE id = :id AND op_lease_id = :cid AND op_fence = :fence AND op_lease_expires_at > :live;`,
  p3: `-- P3 pre-purge authorization read (binds: :id, :cid, :fence) — exactly 1; expiry feeds GD6
--    0 rows → pd_lease_lost 409, NO purge RPC — this is the load-bearing pre-purge abort (CLI r1 MED-2)
SELECT op_lease_expires_at AS scan_expiry FROM scans
WHERE id = :id AND op_lease_id = :cid AND op_fence = :fence;`,
  p4: `-- P4 capture cancel (binds: :live, :id, :cid, :fence) — 0..N; transition stamps updated_at (D11)
UPDATE capture_jobs SET phase='cancelled', email=NULL, delivery_snapshot=NULL, updated_at=:live
WHERE scan_id = :id AND phase NOT IN ('done','cancelled')
  AND EXISTS (SELECT 1 FROM scans WHERE id=:id AND op_lease_id=:cid AND op_fence=:fence
              AND op_lease_expires_at > :live);`,
  p6: `-- P6 registry DELETE (binds: :id, :cid, :fence, :live) — 0..N; rows DELETEd, never marked (D7)
DELETE FROM r2_artifacts WHERE scan_id = :id
  AND EXISTS (SELECT 1 FROM scans WHERE id=:id AND op_lease_id=:cid AND op_fence=:fence
              AND op_lease_expires_at > :live);`,
  p7: `-- P7 capture scrub (binds: :id, :cid, :fence, :live) — 0..N; NO updated_at stamp (D11 preservation)
UPDATE capture_jobs SET email=NULL, pdf_r2_key=NULL, delivery_snapshot=NULL
WHERE scan_id = :id
  AND EXISTS (SELECT 1 FROM scans WHERE id=:id AND op_lease_id=:cid AND op_fence=:fence
              AND op_lease_expires_at > :live);`,
  p8: `-- P8 scan-row PII clear (binds: :live, :id, :cid, :fence) — exactly 1; authority IN-STATEMENT
--    (terminal-success-statement authority: 0 rows = lease lost → 409, NEVER a safe no-op)
UPDATE scans SET email=NULL, unsubscribe_token=NULL, user_ip=NULL, email_opted_in_rescan=0,
  pdf_r2_key=NULL, deletion_requested_at=COALESCE(deletion_requested_at,:live)
WHERE id=:id AND op_lease_id=:cid AND op_fence=:fence AND op_lease_expires_at > :live;`,
  p10: `-- P10 fenced release, finally (binds: :id, :cid, :fence) — 0..1; never a newer owner's lease
UPDATE scans SET op_owner=NULL, op_lease_id=NULL, op_lease_expires_at=NULL
WHERE id = :id AND op_lease_id = :cid AND op_fence = :fence;`,
} as const;

// Orchestration read for the GD7 hook (not a P-fragment; not authority-bearing).
const GD7_STATUS_READ = `SELECT status FROM retention_jobs WHERE scan_id = :id;`;

// ── Named-bind execution (mirrors the retention-sweep local idiom) ───────────
function bindOf(p: { text: string; order: string[] }, params: Record<string, unknown>): unknown[] {
  return p.order.map((n) => {
    if (!(n in params)) throw new Error(`pd_bad_bind_${n}`);
    return params[n];
  });
}
async function runNamed(db: Env["DB"], sql: string, params: Record<string, unknown>): Promise<number> {
  const p = prepRetentionSql(sql);
  const r = await db.prepare(p.text).bind(...bindOf(p, params)).run();
  return r.meta?.changes ?? 0;
}
async function firstNamed<T>(db: Env["DB"], sql: string, params: Record<string, unknown>): Promise<T | null> {
  const p = prepRetentionSql(sql);
  return (await db.prepare(p.text).bind(...bindOf(p, params)).first<T>()) ?? null;
}

// Typed error for expected throw paths the route adapter maps by class.
// pd_misconfigured is never collapsed into pd_internal.
export class PdError extends Error {
  constructor(public readonly cls: "pd_misconfigured") {
    super(cls);
    this.name = "PdError";
  }
}

// r2 error classes purgePrefix can throw — EXPECTED purge-path failures that
// map to pd_purge_failed (502, retain-on-failure). Anything else rethrows to
// the pd_internal arm of the exception matrix.
const R2_ERROR_CLASSES = new Set(["r2_transport", "r2_rpc_failed", "r2_malformed", "r2_purge_unconfirmed"]);

function boundedBudget(v: number | undefined, fallback: number, name: string): number {
  if (v === undefined) return fallback;
  if (!Number.isInteger(v) || v <= 0 || v > MAX_BUDGET_MS) throw new Error(`pd_bad_${name}`);
  return v;
}

type A4Row = {
  id: string;
  op_lease_id: string | null;
  op_fence: number;
  op_lease_expires_at: number | null;
  tier: string | null;
  email_opted_in_rescan: number;
  created_at: number;
  retention_locked_at: number | null;
  retention_job_id: string | null;
};

export type PrivacyDeleteOutcome =
  | { status: "ok"; purged: number }
  | { status: "not_found" }
  | { status: "pd_busy" }
  | { status: "pd_lease_lost" }
  | { status: "pd_purge_failed" };

// ── The coordinated privacy-delete machine (frozen spec §4.3, gate already on) ──
// Step order: config guard → P1 acquire (0-row → a4Read routing) → P4 capture
// cancel → P3-first pre-purge sequence → bounded prefix purge → unconditional
// P2 → P6 → P7 → P8 → GD7 replay hook → P10 fenced release in `finally`.
// Every statement carrying a :live bind gets a fresh clock() sample; P3 is
// predicate-only and the orchestration samples around it.
export async function runPrivacyDelete(
  env: Env,
  scanId: string,
  opts: { clock?: () => number; requestBudgetMs?: number; purgeBudgetMs?: number } = {}
): Promise<PrivacyDeleteOutcome> {
  const clock = opts.clock ?? (() => Date.now());
  const resolvedRequestBudgetMs = boundedBudget(opts.requestBudgetMs, PD_REQUEST_BUDGET_MS, "request_budget");
  const resolvedPurgeBudgetMs = boundedBudget(opts.purgeBudgetMs, PD_PURGE_BUDGET_MS, "purge_budget");
  // GD6 floor: a sub-MIN purge knob would forge a pd_busy collapse attributable
  // to the knob rather than the request budget — rejected at validation.
  if (resolvedPurgeBudgetMs < MIN_RPC_WINDOW_MS) throw new Error("pd_bad_purge_budget");

  // 1. Config guard — BEFORE any statement (F1 convention; tG14).
  if (!env.MARKETING_R2 || !env.RECONCILE_R2_KEY) throw new PdError("pd_misconfigured");
  const r2 = new MarketingR2Client(env.MARKETING_R2, env.RECONCILE_R2_KEY);
  const db = env.DB;

  const requestDeadline = clock() + resolvedRequestBudgetMs;
  const cid = crypto.randomUUID();

  // 2. P1 acquire → fence. 0-row → a4Read routing (GD9): no row → not_found;
  // every other state (live foreign lease, or free lease released post-P1) →
  // pd_busy. No mutation on either.
  const acquired = await firstNamed<{ op_fence: number }>(db, PRIVACY_SQL.p1, {
    cid,
    live: clock(),
    PD_LEASE_MS,
    id: scanId,
  });
  if (!acquired) {
    const row = await firstNamed<A4Row>(db, PRIVACY_SQL.a4Read, { id: scanId });
    if (!row) return { status: "not_found" };
    console.log(`[privacy-delete] pd_busy`);
    return { status: "pd_busy" };
  }
  const fence = acquired.op_fence;

  try {
    // 3. P4 capture cancel (cancel-before-purge).
    await runNamed(db, PRIVACY_SQL.p4, { live: clock(), id: scanId, cid, fence });

    // 4. P3-first pre-purge sequence. P3 is the sole scanExpiry source;
    // 0-row → pd_lease_lost, NO purge RPC (the load-bearing pre-purge abort).
    let p3 = await firstNamed<{ scan_expiry: number }>(db, PRIVACY_SQL.p3, { id: scanId, cid, fence });
    if (!p3) {
      console.log(`[privacy-delete] pd_lease_lost`);
      return { status: "pd_lease_lost" };
    }
    let scanExpiry = p3.scan_expiry;
    if (scanExpiry - clock() < resolvedPurgeBudgetMs + LEASE_RENEW_MARGIN_MS) {
      const renewed = await runNamed(db, PRIVACY_SQL.p2, { live: clock(), PD_LEASE_MS, id: scanId, cid, fence });
      if (renewed !== 1) {
        console.log(`[privacy-delete] pd_lease_lost`);
        return { status: "pd_lease_lost" };
      }
      p3 = await firstNamed<{ scan_expiry: number }>(db, PRIVACY_SQL.p3, { id: scanId, cid, fence });
      if (!p3) {
        console.log(`[privacy-delete] pd_lease_lost`);
        return { status: "pd_lease_lost" };
      }
      scanExpiry = p3.scan_expiry;
    }
    // GD6 timeout: min(purge budget, lease headroom, request headroom), each
    // with its margin; result ≥ MIN_RPC_WINDOW_MS or 409 BEFORE the RPC.
    // Honest class: with the lease just read (and renewed if headroom was low),
    // a sub-MIN window can only be the request-budget term, which renewal
    // cannot repair — pd_busy; pd_lease_lost stays reserved for authority 0-rows.
    const live = clock();
    const timeoutMs = Math.min(
      resolvedPurgeBudgetMs,
      scanExpiry - live - LEASE_RENEW_MARGIN_MS,
      requestDeadline - live - PD_TAIL_MARGIN_MS
    );
    if (timeoutMs < MIN_RPC_WINDOW_MS) {
      console.log(`[privacy-delete] pd_busy`);
      return { status: "pd_busy" };
    }
    let purged: number;
    try {
      purged = await r2.purgePrefix("score-reports/" + scanId + "/", timeoutMs);
    } catch (e) {
      const cls = e instanceof Error ? e.message : "";
      if (R2_ERROR_CLASSES.has(cls)) {
        // R2-deleted-FIRST, retain-on-failure: no scrub, no P8 — email retained,
        // the token retry re-runs the full path (idempotent).
        console.log(`[privacy-delete] pd_purge_failed class=${cls}`);
        return { status: "pd_purge_failed" };
      }
      throw e; // unexpected → the pd_internal arm (route adapter maps it)
    }

    // 5. Unconditional P2 after the purge returns → P6 → P7 → P8. Any 0-row on
    // P2/P8 → pd_lease_lost; post-purge P6/P7 are EXISTS-guarded and 0-row
    // inertly — zero effective mutation, terminal-detected at P8.
    const renewed = await runNamed(db, PRIVACY_SQL.p2, { live: clock(), PD_LEASE_MS, id: scanId, cid, fence });
    if (renewed !== 1) {
      console.log(`[privacy-delete] pd_lease_lost`);
      return { status: "pd_lease_lost" };
    }
    await runNamed(db, PRIVACY_SQL.p6, { id: scanId, cid, fence, live: clock() });
    await runNamed(db, PRIVACY_SQL.p7, { id: scanId, cid, fence, live: clock() });
    const cleared = await runNamed(db, PRIVACY_SQL.p8, { live: clock(), id: scanId, cid, fence });
    if (cleared !== 1) {
      console.log(`[privacy-delete] pd_lease_lost`);
      return { status: "pd_lease_lost" };
    }

    // 6. GD7 hook: dead-lettered job for this scan → audited replay via the
    // frozen replayDeadLetter (real actor 'privacy_delete'). Failure never
    // fails the delete — PII is already scrubbed.
    try {
      const job = await firstNamed<{ status: string }>(db, GD7_STATUS_READ, { id: scanId });
      if (job?.status === "dead_letter") {
        await replayDeadLetter(db, scanId, "privacy_delete", "privacy-delete completion", clock());
      }
    } catch {
      console.error(`[privacy-delete] pd_replay_failed`);
    }

    console.log(`[privacy-delete] ok purged=${purged}`);
    return { status: "ok", purged };
  } finally {
    // 8. P10 fenced release — own id+fence only; failure logs pd_release_failed
    // and never masks the prior outcome (crash recovery is lease expiry).
    // (No P10 attempt when no fence was acquired — P1's 0-row path returns
    // before this try/finally.)
    try {
      await runNamed(db, PRIVACY_SQL.p10, { id: scanId, cid, fence });
    } catch {
      console.error(`[privacy-delete] pd_release_failed`);
    }
  }
}

// ── Gate-on capture-email guard helper (GD8) ─────────────────────────────────
// Executes the guarded statement (single-statement atomicity; no
// SELECT-then-UPDATE race) with a fresh Date.now() bind; on 0-row runs the
// inherited A4 read ONCE and routes: row absent → not_found (404, legacy
// parity); tombstoned → tombstoned (409); any other state → pd_busy (409,
// catch-all: live foreign lease, TOCTOU release-between-UPDATE-and-read,
// malformed lease pair). D1 byte-unchanged in every rejection case. Any throw
// propagates to the route adapter's pd_internal arm.
export type CaptureGuardOutcome = "captured" | "not_found" | "tombstoned" | "pd_busy";
export async function runGuardedCaptureEmail(
  env: Env,
  scanId: string,
  email: string,
  optedIn: number,
  unsubscribeToken: string
): Promise<CaptureGuardOutcome> {
  const res = await env.DB.prepare(CAPTURE_SET_EMAIL_GUARDED_SQL)
    .bind(email, optedIn, unsubscribeToken, scanId, Date.now())
    .run();
  if (res.success && (res.meta.changes ?? 0) > 0) return "captured";
  const row = await firstNamed<A4Row>(env.DB, PRIVACY_SQL.a4Read, { id: scanId });
  if (!row) return "not_found";
  if (row.retention_locked_at != null) {
    console.log(`[capture-email] tombstoned`);
    return "tombstoned";
  }
  console.log(`[capture-email] pd_busy`);
  return "pd_busy";
}

// ── Replay endpoint (GD10) ───────────────────────────────────────────────────
// Local copy of the score-admin KV rate-limit pattern (checkEmailReadbackRateLimit
// is module-private there); same recorded fail-open-on-KV-error posture — auth
// is the primary gate, the limiter is defense-in-depth.
async function checkReplayRateLimit(env: Env, workerIp: string): Promise<boolean> {
  try {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const k = `int:replay:min:${workerIp}:${minuteBucket}`;
    const cur = await env.CACHE.get(k);
    const n = cur ? parseInt(cur, 10) : 0;
    if (Number.isFinite(n) && n >= REPLAY_PER_MIN) return false;
    await env.CACHE.put(k, String(n + 1), { expirationTtl: 120 });
  } catch {
    // KV hiccup — fail open (defense-in-depth, not the primary gate)
  }
  return true;
}

export function mountPrivacyDelete(app: Hono<{ Bindings: Env }>): void {
  // POST /api/internal/retention/replay — authenticated wrapper around the
  // frozen D15 replayDeadLetter batch. Dispatch order is binding (GD10):
  // gate → auth → rate limit → body validation → replay.
  app.post("/api/internal/retention/replay", async (c) => {
    // (1) gate parse — off ⇒ the route is effectively absent pre-activation
    // (404 matching the app's generic not-found shape, zero statements).
    if (parseIntegrationMode(c.env.PRIVACY_INTEGRATION_MODE) === "off") {
      return c.notFound();
    }
    // (2) auth — constant-time, fail-closed on absent secret/header.
    if (!requireScannerAdminAuth(c.env.INTERNAL_SCANNER_ADMIN_KEY, c.req.header("x-internal-scanner-admin-key"))) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    // (3) KV rate limit — per worker-IP, REPLAY_PER_MIN, fail-open on KV errors.
    const workerIp = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!(await checkReplayRateLimit(c.env, workerIp))) {
      return c.json({ ok: false, error: "rate limited" }, 429);
    }
    // (4) body validation — zero statements on any rejection.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }
    const b = body as Record<string, unknown>;
    if (typeof b.scan_id !== "string" || b.scan_id.length === 0 || b.scan_id.length > 128) {
      return c.json({ ok: false, error: "invalid scan_id" }, 400);
    }
    const actorSuffix = typeof b.actor === "string" ? b.actor.trim() : "";
    if (actorSuffix.length < 1 || actorSuffix.length > 50) {
      return c.json({ ok: false, error: "invalid actor" }, 400);
    }
    if (typeof b.reason !== "string") {
      return c.json({ ok: false, error: "invalid reason" }, 400);
    }
    // (5) stored actor = server-derived trust-domain prefix + caller-asserted
    // suffix (composite ≤ 64 = the D15 CHECK bound exactly); D15 revalidates
    // actor/reason before any statement.
    const composedActor = "scanner-admin/" + actorSuffix;
    const trimmedReason = b.reason.trim();
    // (6) the frozen D15 batch, wrapped — never reimplemented.
    try {
      const { replayed } = await replayDeadLetter(c.env.DB, b.scan_id, composedActor, trimmedReason, Date.now());
      return c.json({ ok: true, replayed });
    } catch (e) {
      const cls = e instanceof Error ? e.message : "";
      if (cls === "retention_replay_invalid") {
        return c.json({ ok: false, error: "retention_replay_invalid" }, 400);
      }
      if (cls === "retention_replay_integrity") {
        console.error(`[retention-replay] retention_replay_integrity`);
        return c.json({ ok: false, error: "retention_replay_integrity" }, 500);
      }
      console.error(`[retention-replay] pd_internal`);
      return c.json({ ok: false, error: "pd_internal" }, 500);
    }
  });
}
