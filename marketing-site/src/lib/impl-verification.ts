// Implementation verification report v1 (DECISION 2026-11-05, TODO.md;
// migration 0018). Fulfillment-side flow only. Must NOT import Next.
//
//   delivery → status 'awaiting_application' (lib/impl-fulfill-run.ts Step 11)
//   mark applied (from awaiting_application or active_email_pending) →
//     acceptance checks → Day-0 record + status 'active' + Day-30 due date and
//     bundle_expires_at anchored on applied_at (no Day 60/90 for verified rows)
//   Day 30 → rescan + acceptance checks again (lib/impl-day-audit-run.ts),
//     compared check-by-check to Day 0 and score-wise to the baseline. While
//     the email copy is unapproved the result is stored once and held.
//
// Proves delivery, not outcomes: nothing here reads or reports citations,
// traffic or AI recommendations.
//
// The acceptance checker (./impl-verify) is injected as an ImplVerifier;
// lib/impl-verify-adapter.ts supplies the real one. The MCP check needs the
// deployed Worker URL, which the patch does not fix: the operator passes it at
// mark applied (stored as mcp_url, reused at Day 30); without it the checker
// reports mcp_server as unobservable ("no deployed MCP URL reported").

export const AWAITING_APPLICATION = "awaiting_application";

export type CheckState = "working" | "absent" | "blocked" | "mismatch" | "unobservable";

// Same shape as ArtifactCheck in ./impl-verify.
export type VerificationCheck = {
  artifact: string;
  state: CheckState;
  url: string;
  evidence: { status?: number; contentType?: string; matched?: string[]; missing?: string[]; note?: string };
  checkedAt: string;
};

// Method syntax on purpose: parameters are checked bivariantly, so the real
// module's ExpectedArtifacts-typed functions are assignable to this interface.
export interface ImplVerifier {
  expectedFromDelivery(delivery: unknown): unknown;
  verifyArtifacts(input: {
    siteUrl: string;
    expected: unknown;
    mcpUrl?: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  }): Promise<VerificationCheck[]>;
}

// What expectedFromDelivery receives: the delivered patch bytes (as text) plus
// where it was delivered for.
export interface ImplDelivery {
  sessionId: string;
  siteUrl: string;
  patchR2Key: string;
  patch: string;
}

export interface ImplVerificationEnv {
  CITATION_DB: D1Database;
  AUDITS: R2Bucket;
}

export interface VerifyDeps {
  verifier: ImplVerifier | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const DAY = 86400;

async function loadDelivery(
  env: ImplVerificationEnv,
  row: { session_id: string; customer_domain: string; patch_r2_key: string | null },
): Promise<ImplDelivery | null> {
  if (!row.patch_r2_key) return null;
  const obj = await env.AUDITS.get(row.patch_r2_key);
  if (!obj) return null;
  return {
    sessionId: row.session_id,
    siteUrl: row.customer_domain,
    patchR2Key: row.patch_r2_key,
    patch: new TextDecoder().decode(await obj.arrayBuffer()),
  };
}

async function runChecks(
  verifier: ImplVerifier,
  delivery: ImplDelivery,
  deps: VerifyDeps,
  mcpUrl: string | null,
): Promise<VerificationCheck[]> {
  const expected = verifier.expectedFromDelivery(delivery);
  return verifier.verifyArtifacts({
    siteUrl: delivery.siteUrl,
    expected,
    mcpUrl: mcpUrl ?? undefined,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
}

// ─── Mark applied (Day 0) ────────────────────────────────────────────────

export type MarkAppliedResult =
  | { kind: "applied"; applied_at: number; checks: VerificationCheck[] }
  | { kind: "already_applied"; applied_at: number }
  // No artifact is working: Day 0 is NOT anchored, nothing is written.
  | { kind: "not_verified"; checks: VerificationCheck[] }
  | { kind: "not_found" }
  | { kind: "wrong_status"; status: string }
  | { kind: "bundle_expired" }
  | { kind: "patch_missing" }
  | { kind: "verifier_unavailable" };

interface AwaitingRow {
  session_id: string;
  customer_domain: string;
  patch_r2_key: string | null;
  status: string;
  applied_at: number | null;
  bundle_expired_at: number | null;
}

// Statuses mark-applied accepts: delivered and awaiting application, or
// 'active_email_pending' (the patch email failed and the operator re-sent the
// patch by hand). Both have the patch in R2 and the probe target enrolled.
export const MARKABLE_STATUSES = [AWAITING_APPLICATION, "active_email_pending"] as const;
const MARKABLE_SQL = MARKABLE_STATUSES.map((s) => `'${s}'`).join(", ");

// Automatic rule: Day 0 is anchored when at least one artifact is working.
// opts.force (operator) anchors it whatever the states; the checks are still
// stored and applied_by gets a "+forced" marker.
// Only Day 30 is scheduled: verified sessions get no Day-60/90 audits.
// opts.mcpUrl: deployed MCP Worker URL; stored with the flip so Day 30 rechecks it.
export async function markImplementationApplied(
  env: ImplVerificationEnv,
  sessionId: string,
  appliedBy: "operator",
  deps: VerifyDeps,
  opts: { force?: boolean; mcpUrl?: string } = {},
): Promise<MarkAppliedResult> {
  const mcpUrl = opts.mcpUrl ?? null;
  const row = await readAwaitingRow(env, sessionId);
  const early = classify(row);
  if (early) return early;
  if (!deps.verifier) return { kind: "verifier_unavailable" };

  const delivery = await loadDelivery(env, row!);
  if (!delivery) return { kind: "patch_missing" };

  const checks = await runChecks(deps.verifier, delivery, deps, mcpUrl);
  if (!opts.force && !checks.some((c) => c.state === "working")) return { kind: "not_verified", checks };

  const by = opts.force ? `${appliedBy}+forced` : appliedBy;
  const appliedAt = Math.floor((deps.now ? deps.now() : new Date()).getTime() / 1000);
  // One transaction; both statements carry the same predicate, so the Day-0
  // record exists iff this call made the markable → active flip.
  const [, flip] = await env.CITATION_DB.batch([
    env.CITATION_DB.prepare(
      `INSERT OR REPLACE INTO implementation_verifications
         (session_id, checkpoint, checks_json, composite_score, scoring_version, scan_r2_key, verified_at)
       SELECT ?1, 'day0', ?2, NULL, NULL, NULL, ?3
       WHERE EXISTS (SELECT 1 FROM implementation_sessions
                     WHERE session_id = ?1 AND status IN (${MARKABLE_SQL})
                       AND applied_at IS NULL AND bundle_expired_at IS NULL)`,
    ).bind(sessionId, JSON.stringify(checks), appliedAt),
    env.CITATION_DB.prepare(
      `UPDATE implementation_sessions
       SET status = 'active', applied_at = ?1, applied_by = ?2, mcp_url = ?4,
           day30_audit_due_at = ?1 + ${30 * DAY},
           day60_audit_due_at = NULL,
           day90_audit_due_at = NULL,
           bundle_expires_at = ?1 + ${91 * DAY},
           updated_at = ?1
       WHERE session_id = ?3 AND status IN (${MARKABLE_SQL})
         AND applied_at IS NULL AND bundle_expired_at IS NULL`,
    ).bind(appliedAt, by, sessionId, mcpUrl),
  ]);

  if (flip.meta.changes !== 1) {
    // A concurrent mark won (or the row moved on): report its state.
    return classify(await readAwaitingRow(env, sessionId)) ?? { kind: "wrong_status", status: "unknown" };
  }
  console.log(`F2_APPLIED_VERIFIED session_id=${sessionId} by=${by}`);
  return { kind: "applied", applied_at: appliedAt, checks };
}

async function readAwaitingRow(env: ImplVerificationEnv, sessionId: string): Promise<AwaitingRow | null> {
  return env.CITATION_DB.prepare(
    `SELECT session_id, customer_domain, patch_r2_key, status, applied_at, bundle_expired_at
     FROM implementation_sessions WHERE session_id = ?`,
  )
    .bind(sessionId)
    .first<AwaitingRow>();
}

// null = the row is markable.
function classify(row: AwaitingRow | null): MarkAppliedResult | null {
  if (!row) return { kind: "not_found" };
  if (row.applied_at != null) return { kind: "already_applied", applied_at: row.applied_at };
  if (!(MARKABLE_STATUSES as readonly string[]).includes(row.status)) {
    return { kind: "wrong_status", status: row.status };
  }
  if (row.bundle_expired_at != null) return { kind: "bundle_expired" };
  return null;
}

// ─── Day-30 recheck ──────────────────────────────────────────────────────

export interface CheckDiffRow {
  artifact: string;
  url: string;
  day0: CheckState | null; // null: not checked at Day 0
  current: CheckState | null; // null: not checked now
  changed: boolean;
}

export interface RecheckReport {
  baselineScore: number;
  currentScore: number;
  baselineScoringVersion: string | null;
  currentScoringVersion: string | null;
  rows: CheckDiffRow[];
}

// Day-0 order first, then artifacts only seen now.
export function diffChecks(day0: VerificationCheck[], current: VerificationCheck[]): CheckDiffRow[] {
  const now = new Map(current.map((c) => [c.artifact, c]));
  const seen = new Set<string>();
  const rows: CheckDiffRow[] = [];
  for (const d of day0) {
    if (seen.has(d.artifact)) continue;
    seen.add(d.artifact);
    const c = now.get(d.artifact);
    rows.push({ artifact: d.artifact, url: c?.url ?? d.url, day0: d.state, current: c?.state ?? null, changed: d.state !== (c?.state ?? null) });
  }
  for (const c of current) {
    if (seen.has(c.artifact)) continue;
    seen.add(c.artifact);
    rows.push({ artifact: c.artifact, url: c.url, day0: null, current: c.state, changed: true });
  }
  return rows;
}

export interface RecheckInput {
  session_id: string;
  customer_domain: string;
  patch_r2_key: string | null;
  checkpoint: "day30";
  baselineScore: number;
  baselineScoringVersion: string | null;
  currentScore: number;
  currentScoringVersion: string | null;
  scanR2Key: string;
}

// Runs the acceptance checks again, stores the checkpoint record (INSERT OR
// REPLACE on (session_id, checkpoint): a retried day overwrites, never
// duplicates) and returns the comparison. Throws when it cannot run, so the
// Day-N run takes its failed_reset path and the next sweep retries.
export async function runRecheckVerification(
  env: ImplVerificationEnv,
  input: RecheckInput,
  deps: VerifyDeps,
): Promise<RecheckReport> {
  if (!deps.verifier) throw new Error("F2_VERIFIER_UNAVAILABLE");
  const delivery = await loadDelivery(env, input);
  if (!delivery) throw new Error(`F2_VERIFY_PATCH_MISSING session_id=${input.session_id}`);

  const day0Row = await env.CITATION_DB.prepare(
    `SELECT checks_json FROM implementation_verifications WHERE session_id = ? AND checkpoint = 'day0'`,
  )
    .bind(input.session_id)
    .first<{ checks_json: string }>();
  const day0 = day0Row ? (JSON.parse(day0Row.checks_json) as VerificationCheck[]) : [];
  const session = await env.CITATION_DB.prepare(`SELECT mcp_url FROM implementation_sessions WHERE session_id = ?`)
    .bind(input.session_id)
    .first<{ mcp_url: string | null }>();

  const checks = await runChecks(deps.verifier, delivery, deps, session?.mcp_url ?? null);
  const verifiedAt = Math.floor((deps.now ? deps.now() : new Date()).getTime() / 1000);
  await env.CITATION_DB.prepare(
    `INSERT OR REPLACE INTO implementation_verifications
       (session_id, checkpoint, checks_json, composite_score, scoring_version, scan_r2_key, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.session_id,
      input.checkpoint,
      JSON.stringify(checks),
      input.currentScore,
      input.currentScoringVersion,
      input.scanR2Key,
      verifiedAt,
    )
    .run();

  return {
    baselineScore: input.baselineScore,
    currentScore: input.currentScore,
    baselineScoringVersion: input.baselineScoringVersion,
    currentScoringVersion: input.currentScoringVersion,
    rows: diffChecks(day0, checks),
  };
}

// Rebuilds the Day-30 comparison from the stored records (no rescan, no
// checks). Used once the email copy is approved for a recheck that was held.
export async function loadRecheckReport(
  env: ImplVerificationEnv,
  sessionId: string,
  baseline: { score: number; scoringVersion: string | null },
): Promise<RecheckReport> {
  const rows = await env.CITATION_DB.prepare(
    `SELECT checkpoint, checks_json, composite_score, scoring_version
     FROM implementation_verifications WHERE session_id = ? AND checkpoint IN ('day0', 'day30')`,
  )
    .bind(sessionId)
    .all<{ checkpoint: string; checks_json: string; composite_score: number | null; scoring_version: string | null }>();
  const byCp = new Map((rows.results ?? []).map((r) => [r.checkpoint, r]));
  const day30 = byCp.get("day30");
  if (!day30) throw new Error(`F2_VERIFY_DAY30_RECORD_MISSING session_id=${sessionId}`);
  const day0 = byCp.get("day0");
  return {
    baselineScore: baseline.score,
    currentScore: day30.composite_score ?? 0,
    baselineScoringVersion: baseline.scoringVersion,
    currentScoringVersion: day30.scoring_version,
    rows: diffChecks(
      day0 ? (JSON.parse(day0.checks_json) as VerificationCheck[]) : [],
      JSON.parse(day30.checks_json) as VerificationCheck[],
    ),
  };
}
