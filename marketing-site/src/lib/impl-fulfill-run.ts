// Slice Q (Q1a-Q1d + v1.1 A2/A3/A4/A8) — the Implementation fulfillment run,
// extracted from app/api/impl-fulfill/route.ts so the astrant-fulfill Queue
// consumer and the HTTP operator-replay wrapper share one implementation.
// Must NOT import Next.
//
// Pipeline (unchanged from F2 v6.1 D9 apart from the claim, the catch block,
// the email idempotency key and the A3 delivered-marker resume):
//   1. Lease claim: queued → processing, or reclaim a processing row whose
//      lease (IMPL_LEASE_SEC) has expired
//   2. Read F2 session (+ A8 deterministic customer_id check, before any scan)
//   3. Baseline scan via scanner Worker
//   4-7. 4 patch-time LLM generators (audit-recs fires later at Day-N)
//   8. Patch assembly + R2 persist + structural validation
//   9. customer_probe_targets INSERT-with-CHECK + ON CONFLICT (D18 Stage 3 Fix A)
//   10. Audit due-dates + delivery email; patch_delivered_at written right after
//       a confirmed send (A3)
//   11. status='active', keyed on the claim (A4)
// A re-run that finds patch_delivered_at set skips Steps 3-10 (A3).

import { runScan, type AuditEnv } from "./audit-pipeline";
import { generateLlmsTxt } from "./f2-generators/llms-txt";
import { generateMcpServerConfig } from "./f2-generators/mcp-server-config";
import { generateOpenApi } from "./f2-generators/openapi";
import { generateJsonLd } from "./f2-generators/jsonld";
import { renderMcpServerWorker } from "./f2-mcp-server-template";
import { assembleGitAmPatch } from "./f2-patch-assembler";
import { validateGitAmPatch, type PatchValidation } from "./f2-patch-validate";
import { sendF2PatchDeliveryEmail } from "./f2-email";
import { sendOperatorAlert } from "./operator-alerts";
import type { ProbeCadence } from "./cadence";
import { parseMaxProbeTargets } from "@/lib/probe-ceiling";

export interface ImplRunEnv extends AuditEnv {
  INTERNAL_FULFILL_KEY: string;
  CITATION_DB: D1Database;
  RESEND_API_KEY: string;
  OPERATOR_ALERT_EMAIL: string;
  // B1.3 v1.1 — replaces hardcoded ceiling=3 (default "30").
  MAX_PROBE_TARGETS?: string;
}

// Lease on a `processing` claim. Longer than the 15-min consumer wall-clock
// limit, so a live run is never reclaimed from under itself.
export const IMPL_LEASE_SEC = 1200;

export type ImplRunResult =
  | { kind: "done" } // status → active
  | {
      kind: "terminal_outcome";
      status: "failed_validation" | "failed_ceiling" | "active_email_pending";
    } // existing writes + alerts, unchanged
  | { kind: "failed_final" } // final-attempt (or A8 permanent) catch path
  | { kind: "noop_terminal"; status: string } // claim lost; row in a terminal status
  | { kind: "in_flight"; processing_started_at: number } // claim lost; another delivery holds the lease
  | { kind: "not_found" }; // claim lost; no row

// A8: deterministic failures — terminal on the first attempt, no retry/re-scan.
export class ImplPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImplPermanentError";
  }
}

// B1.3 v1.1 Locked Artifact H — endpoint validator for customer_id-accepting probe-target writes.
// Mirrored at onboarding/submit + citation-tracking/src/index.ts (`/api/internal/probe-target-add`).
function validateCustomerIdForProbeTarget(s: unknown): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof s !== "string") return { ok: false, reason: "not a string" };
  if (s === "astrant") return { ok: false, reason: "reserved sentinel" };
  if (s.toLowerCase() === "astrant") return { ok: false, reason: "case-mismatched reserved sentinel" };
  if (!/^sub_.+$/.test(s)) return { ok: false, reason: "not a sub_<token> shape" };
  return { ok: true, value: s };
}

interface ImplementationSessionRow {
  session_id: string;
  dodo_payment_id: string;
  customer_email: string;
  customer_domain: string;
  brand_name: string;
  category: string;
  competitors: string | null;
  customer_id: string;
  payment_succeeded_at: number;
  status: string;
  patch_delivered_at: number | null;
}

const nowSec = () => Math.floor(Date.now() / 1000);

export async function runImplFulfillment(
  env: ImplRunEnv,
  sessionId: string,
  opts: { finalAttempt: boolean },
): Promise<ImplRunResult> {
  const claimedAt = nowSec();

  // Step 1 — Lease claim (Q1b).
  const casResult = await env.CITATION_DB.prepare(
    `UPDATE implementation_sessions
     SET status = 'processing', processing_started_at = ?1, updated_at = ?1
     WHERE session_id = ?2
       AND (status = 'queued' OR (status = 'processing' AND processing_started_at < ?1 - ?3))`,
  )
    .bind(claimedAt, sessionId, IMPL_LEASE_SEC)
    .run();

  if (casResult.meta.changes !== 1) {
    const row = await env.CITATION_DB.prepare(
      `SELECT status, processing_started_at FROM implementation_sessions WHERE session_id = ?`,
    )
      .bind(sessionId)
      .first<{ status: string; processing_started_at: number | null }>();
    if (!row) return { kind: "not_found" };
    if (row.status === "processing") {
      return { kind: "in_flight", processing_started_at: row.processing_started_at ?? 0 };
    }
    return { kind: "noop_terminal", status: row.status };
  }

  let f2: ImplementationSessionRow | null = null;
  const progress = { delivered: false };
  try {
    // Step 2 — Read F2 session row
    f2 = await env.CITATION_DB.prepare(
      `SELECT session_id, dodo_payment_id, customer_email, customer_domain,
              brand_name, category, competitors, customer_id, payment_succeeded_at, status,
              patch_delivered_at
       FROM implementation_sessions WHERE session_id = ?`,
    )
      .bind(sessionId)
      .first<ImplementationSessionRow>();

    if (!f2) {
      throw new ImplPermanentError(`F2_SESSION_NOT_FOUND session_id=${sessionId}`);
    }

    // B1.3 v1.1 — endpoint validator (Locked Artifact H): defend against an upstream
    // implementation_sessions row landing with a customer_id that collides with the 'astrant'
    // sentinel or fails the sub_ shape. A8: checked before any scan; permanent.
    const customerIdValidation = validateCustomerIdForProbeTarget(f2.customer_id);
    if (!customerIdValidation.ok) {
      throw new ImplPermanentError(
        `F2_CUSTOMER_ID_INVALID session_id=${sessionId} reason=${customerIdValidation.reason}`,
      );
    }

    if (f2.patch_delivered_at != null) {
      // A3: the patch email already went out (a previous delivery crashed or
      // threw after the send). Skip Steps 3-10; only the state write remains.
      console.log(`F2_FULFILLMENT_RESUME_AFTER_DELIVERY session_id=${sessionId}`);
    } else {
      const outcome = await buildAndDeliver(env, f2, sessionId, claimedAt, progress);
      if (outcome !== null) return outcome;
    }

    // Step 11 — Status flip → 'active' (A4: keyed on this claim).
    const completeTime = nowSec();
    const activeResult = await env.CITATION_DB.prepare(
      `UPDATE implementation_sessions
       SET status = 'active', updated_at = ?
       WHERE session_id = ? AND status = 'processing' AND processing_started_at = ?`,
    )
      .bind(completeTime, sessionId, claimedAt)
      .run();
    if (activeResult.meta.changes !== 1) {
      // The lease was reclaimed by another delivery; that delivery sees
      // patch_delivered_at and completes the write.
      console.error(`F2_FULFILLMENT_ACTIVE_WRITE_LOST session_id=${sessionId}`);
      return { kind: "noop_terminal", status: "lease_lost" };
    }

    console.log(`F2_FULFILLMENT_COMPLETE session_id=${sessionId}`);
    return { kind: "done" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof ImplPermanentError;

    if (!opts.finalAttempt && !permanent) {
      // Q1c: release the claim (keyed on claimedAt so it can't release a later
      // reclaim), then rethrow so the queue retries.
      console.error(`F2_FULFILLMENT_ATTEMPT_FAILED session_id=${sessionId} err=${msg}`);
      await env.CITATION_DB.prepare(
        `UPDATE implementation_sessions SET status = 'queued', updated_at = ?
         WHERE session_id = ? AND status = 'processing' AND processing_started_at = ?`,
      )
        .bind(nowSec(), sessionId, claimedAt)
        .run();
      throw err;
    }

    // Fix round: the patch already reached the customer (marker set, or sent in
    // this run). Never write `failed` over a delivered order — alert only; the
    // row keeps its claim for the operator.
    if (progress.delivered || f2?.patch_delivered_at != null) {
      console.error(`F2_DELIVERED_STATE_UNRECORDED session_id=${sessionId} err=${msg}`);
      await sendOperatorAlert(env, {
        alert_code: "F2_DELIVERED_STATE_UNRECORDED",
        customer_email: f2?.customer_email,
        session_id: sessionId,
        dodo_payment_id: f2?.dodo_payment_id,
        notes: `Patch email delivered; final state write failed: ${msg.slice(0, 400)}`,
      });
      return { kind: "failed_final" };
    }

    // Final attempt (or A8 permanent): alert FIRST, unconditionally (A2/A9),
    // then the terminal write keyed on this claim (A4). A failed write throws.
    console.error(`F2_FULFILLMENT_FAILED session_id=${sessionId} err=${msg}`);
    let contact: { customer_email?: string; dodo_payment_id?: string } | null = f2;
    if (!contact) {
      try {
        contact = await env.CITATION_DB.prepare(
          `SELECT customer_email, dodo_payment_id FROM implementation_sessions WHERE session_id = ?`,
        )
          .bind(sessionId)
          .first<{ customer_email: string; dodo_payment_id: string }>();
      } catch {
        contact = null;
      }
    }
    await sendOperatorAlert(env, {
      alert_code: "F2_FULFILLMENT_FAILED",
      customer_email: contact?.customer_email,
      session_id: sessionId,
      dodo_payment_id: contact?.dodo_payment_id,
      notes: msg.slice(0, 500),
    });
    const failResult = await env.CITATION_DB.prepare(
      `UPDATE implementation_sessions
       SET status = 'failed', failed_reason = ?, updated_at = ?
       WHERE session_id = ? AND status = 'processing' AND processing_started_at = ?`,
    )
      .bind(msg.slice(0, 500), nowSec(), sessionId, claimedAt)
      .run();
    if (failResult.meta.changes !== 1) {
      console.error(`F2_FULFILLMENT_FAILED_WRITE_SKIPPED session_id=${sessionId} reason=lease_lost`);
    }
    return { kind: "failed_final" };
  }
}

// Fix round: the failed_validation / failed_ceiling / active_email_pending
// writes are fenced on this run's claim. Returns false (no-op) when another
// delivery reclaimed the row; the caller's alert then says so.
async function writeTerminalStatus(
  env: ImplRunEnv,
  sessionId: string,
  claimedAt: number,
  status: "failed_validation" | "failed_ceiling" | "active_email_pending",
  reason: string,
): Promise<boolean> {
  const res = await env.CITATION_DB.prepare(
    `UPDATE implementation_sessions
     SET status = ?, failed_reason = ?, updated_at = ?
     WHERE session_id = ? AND status = 'processing' AND processing_started_at = ?`,
  )
    .bind(status, reason, nowSec(), sessionId, claimedAt)
    .run();
  if (res.meta.changes !== 1) {
    console.error(`F2_TERMINAL_WRITE_LEASE_LOST session_id=${sessionId} status=${status}`);
    return false;
  }
  return true;
}

const LEASE_LOST_NOTE = " [state write skipped: lease lost to another delivery]";

// Steps 3-10. Returns a terminal outcome, or null once the patch email is
// confirmed sent and patch_delivered_at is written. Sets progress.delivered as
// soon as Resend confirms the send.
async function buildAndDeliver(
  env: ImplRunEnv,
  f2: ImplementationSessionRow,
  sessionId: string,
  claimedAt: number,
  progress: { delivered: boolean },
): Promise<ImplRunResult | null> {
  const competitors = parseCompetitors(f2.competitors);

  // Step 3 — Baseline pre-F2 scan
  const baselineScan = await runScan(f2.customer_domain, env.INTERNAL_FULFILL_KEY);
  const baselineScanId = `f2-baseline-${sessionId}`;
  await env.AUDITS.put(
    `f2-baseline-scans/${baselineScanId}.json`,
    JSON.stringify(baselineScan),
  );
  await env.CITATION_DB.prepare(
    `UPDATE implementation_sessions SET baseline_scan_id = ?, updated_at = ?
     WHERE session_id = ?`,
  )
    .bind(baselineScanId, nowSec(), sessionId)
    .run();

  // Step 4-7 — Run 4 patch-time LLM generators (audit-recs fires at Day-N, not here)
  const generatorInput = {
    brand_name: f2.brand_name,
    domain: f2.customer_domain,
    category: f2.category,
    competitors,
    baseline_scan_summary: `composite=${baselineScan.composite.score} grade=${baselineScan.composite.grade}`,
  };

  const [llmsTxtContent, mcpConfig, openApiContent, jsonLdContent] = await Promise.all([
    generateLlmsTxt(env, generatorInput),
    generateMcpServerConfig(env, generatorInput),
    generateOpenApi(env, generatorInput),
    generateJsonLd(env, generatorInput),
  ]);

  // Step 5 — Template-render mcp-server-config JSON → TS Worker artifacts
  const mcpFiles = renderMcpServerWorker(mcpConfig);

  // Step 6 — Patch assembly (git-am mailbox format)
  const allFiles: Record<string, string> = {
    "public/llms.txt": llmsTxtContent,
    "public/openapi.yaml": openApiContent,
    "ASTRANT_IMPLEMENTATION.md": buildImplementationReadme(f2.brand_name, f2.customer_domain),
    "monitoring/check-llms-txt.sh": buildLlmsTxtMonitorScript(f2.customer_domain),
    "monitoring/check-mcp-server.sh": buildMcpServerMonitorScript(f2.brand_name),
    "app/layout-jsonld.html": jsonLdContent,  // insertion-instructions in README; not auto-inserted
    ...mcpFiles,
  };

  const patchContent = assembleGitAmPatch({
    customer_domain: f2.customer_domain,
    customer_email: f2.customer_email,
    session_id: sessionId,
    // A3: deterministic across re-runs (was `new Date()`).
    fulfillment_time: new Date(f2.payment_succeeded_at * 1000),
    files: allFiles,
  });

  // Step 7 — Persist patch to R2 (LOW-2 v3 fold — operator recovery path)
  // F2-VALIDATE-1: the gate below validates these exact bytes, which are the
  // bytes stored and later attached to the email.
  const patchR2Key = `f2-patches/${sessionId}.patch`;
  const patchBytes = new TextEncoder().encode(patchContent);
  await env.AUDITS.put(patchR2Key, patchBytes);
  await env.CITATION_DB.prepare(
    `UPDATE implementation_sessions SET patch_r2_key = ?, updated_at = ?
     WHERE session_id = ?`,
  )
    .bind(patchR2Key, nowSec(), sessionId)
    .run();

  // F2-VALIDATE-1 — fail-closed structural/encoding gate on the stored patch
  // bytes, BEFORE enrollment + email. Terminal, no retry: generation is
  // deterministic per session, so a retry re-emits identical bytes. On fail: no
  // probe-target enrollment, no email, patch retained in R2 for inspection.
  // The reason and alert carry failure CATEGORIES only — never patch text,
  // paths or customer values (the content is partly LLM-generated).
  let patchValidation: PatchValidation;
  try {
    patchValidation = validateGitAmPatch(patchBytes, Object.keys(allFiles));
  } catch {
    patchValidation = { ok: false, categories: ["validator_error"], failures: ["validator_error:threw"] };
  }
  if (!patchValidation.ok) {
    const categories = patchValidation.categories.join("|");
    console.error(
      `F2_PATCH_VALIDATION_FAILED session_id=${sessionId} failures=${patchValidation.failures.join(";").slice(0, 1000)}`,
    );
    const written = await writeTerminalStatus(
      env,
      sessionId,
      claimedAt,
      "failed_validation",
      `patch_validation_failed:${categories}`.slice(0, 500),
    );
    await sendOperatorAlert(env, {
      alert_code: "F2_PATCH_VALIDATION_FAILED",
      session_id: sessionId,
      dodo_payment_id: f2.dodo_payment_id,
      notes: `Patch failed pre-delivery validation (categories: ${categories}). No email was sent. Patch retained in R2 at ${patchR2Key}. Customer paid; refund or re-deliver manually.${written ? "" : LEASE_LOST_NOTE}`,
    });
    return { kind: "terminal_outcome", status: "failed_validation" };
  }

  // Step 8 — customer_probe_targets INSERT-with-CHECK + ON CONFLICT
  // (D18 Stage 3 Fix A: self-exclusion in count subquery; 6 cases verified V-H)
  // B1.3 v1.1 — MAX_PROBE_TARGETS env binding replaces hardcoded ceiling=3.
  // F4.1 D9 Site 2: append probe_cadence + next_probe_at. F2 customers default
  // 'twice_weekly' per Bruno lock #14. ON CONFLICT does NOT touch cadence per MED-NEW-O.
  const maxProbeTargets = parseMaxProbeTargets(env.MAX_PROBE_TARGETS);
  const probeInsertTime = nowSec();
  const competitorsJson = JSON.stringify(competitors);
  const cadence: ProbeCadence = 'twice_weekly';
  const insertResult = await env.CITATION_DB.prepare(
    `INSERT INTO customer_probe_targets
       (customer_id, domain, brand_name, category, competitors,
        status, created_at, updated_at, probe_cadence, next_probe_at)
     SELECT ?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?9
     WHERE (SELECT COUNT(*) FROM customer_probe_targets
            WHERE status='active' AND customer_id != ?1) < ?10
     ON CONFLICT(customer_id) DO UPDATE SET
       status = 'active', updated_at = ?7`,
  )
    .bind(
      f2.customer_id,
      f2.customer_domain,
      f2.brand_name,
      f2.category,
      competitorsJson,
      probeInsertTime,
      probeInsertTime,
      cadence,
      probeInsertTime,
      maxProbeTargets,
    )
    .run();

  if (insertResult.meta.changes !== 1) {
    // D18 Stage 3 at-capacity at atomic time (race between Stage 1 page-gate +
    // Stage 2 webhook-gate + this Stage 3). Fail-loud + operator alert.
    const written = await writeTerminalStatus(
      env,
      sessionId,
      claimedAt,
      "failed_ceiling",
      "F2_OVER_CAPACITY_ATOMIC_FAILED",
    );
    await sendOperatorAlert(env, {
      alert_code: "F2_OVER_CAPACITY_ATOMIC_FAILED",
      customer_email: f2.customer_email,
      session_id: sessionId,
      dodo_payment_id: f2.dodo_payment_id,
      notes: "Stage 3 atomic ceiling check rejected after Stage 1 + Stage 2 both passed. Customer paid; needs manual refund via Dodo dashboard." + (written ? "" : LEASE_LOST_NOTE),
    });
    return { kind: "terminal_outcome", status: "failed_ceiling" };
  }

  // Step 9 — Audit due-dates + bundle_expires_at persist
  const day30Due = f2.payment_succeeded_at + 30 * 86400;
  const day60Due = f2.payment_succeeded_at + 60 * 86400;
  const day90Due = f2.payment_succeeded_at + 90 * 86400;
  const bundleExpires = f2.payment_succeeded_at + 91 * 86400;

  await env.CITATION_DB.prepare(
    `UPDATE implementation_sessions
     SET day30_audit_due_at = ?, day60_audit_due_at = ?, day90_audit_due_at = ?,
         bundle_expires_at = ?, updated_at = ?
     WHERE session_id = ?`,
  )
    .bind(day30Due, day60Due, day90Due, bundleExpires, nowSec(), sessionId)
    .run();

  // Step 10 — Patch-delivery email (Resend idempotencyKey f2-patch:{session_id})
  const emailResult = await sendF2PatchDeliveryEmail(env, {
    toEmail: f2.customer_email,
    brandName: f2.brand_name,
    patchR2Key,
    sessionId,
  });

  if (!emailResult.ok) {
    // Email failed but everything else succeeded — operator can re-send from R2.
    const written = await writeTerminalStatus(
      env,
      sessionId,
      claimedAt,
      "active_email_pending",
      `email_send_failed:${emailResult.error}`,
    );
    await sendOperatorAlert(env, {
      alert_code: "F2_EMAIL_SEND_FAILED",
      customer_email: f2.customer_email,
      session_id: sessionId,
      dodo_payment_id: f2.dodo_payment_id,
      notes: `Pipeline succeeded; email send failed: ${emailResult.error}. Re-send patch from R2 key ${patchR2Key}.${written ? "" : LEASE_LOST_NOTE}`,
    });
    return { kind: "terminal_outcome", status: "active_email_pending" };
  }

  progress.delivered = true;
  // A3: delivered marker, in its own statement, immediately after the send.
  const deliveredAt = nowSec();
  await env.CITATION_DB.prepare(
    `UPDATE implementation_sessions SET patch_delivered_at = ?, updated_at = ?
     WHERE session_id = ?`,
  )
    .bind(deliveredAt, deliveredAt, sessionId)
    .run();
  return null;
}

function parseCompetitors(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return arr.filter((s): s is string => typeof s === "string");
    return [];
  } catch {
    return [];
  }
}

function buildImplementationReadme(brandName: string, customerDomain: string): string {
  return `# ${brandName} — Astrant Implementation

This patch contains the agent-discoverability stack Astrant generated for ${customerDomain}.

## Apply this patch

\`\`\`bash
git am astrant-implementation.patch
\`\`\`

If \`git am\` reports conflicts (e.g., \`public/llms.txt\` already exists), use
\`git am --abort\` to back out, then move/rename your existing files before
re-applying.

## What was added

- \`public/llms.txt\` — your customized llms.txt content
- \`public/openapi.yaml\` — OpenAPI 3.1 scaffold (extend paths[] post-deploy)
- \`mcp-server/\` — deployable Cloudflare Worker for your MCP server
- \`monitoring/\` — bash uptime checks for llms.txt + MCP server
- \`app/layout-jsonld.html\` — JSON-LD blocks to insert into your root layout

### JSON-LD insertion (manual step)

The patch ships JSON-LD as a separate \`app/layout-jsonld.html\` file rather
than auto-modifying your root layout, because layout paths differ across stacks
(Next.js App Router: \`app/layout.tsx\`; Pages Router: \`pages/_app.tsx\`; Vue:
\`app.vue\`; Astro: \`src/layouts/Layout.astro\`).

Insert the contents of \`app/layout-jsonld.html\` inside your root layout's
\`<head>\` section, between the marker comments \`<!-- astrant-jsonld:begin -->\`
and \`<!-- astrant-jsonld:end -->\` (already in the file). These markers enable
future automated refresh flows.

## Deploy your MCP server

\`\`\`bash
cd mcp-server
npm install
npx wrangler login    # one-time, opens browser
npx wrangler deploy
\`\`\`

After deploy, your MCP server is live at \`<worker-name>.<your-account>.workers.dev\`.

A one-command \`npx @astrant/deploy-mcp\` wrapper that automates the
\`login + deploy + mcp.json URL update\` sequence is on the roadmap.

## Over the next 90 days

You'll receive:
- **Day 30**: trajectory check-in audit + scanner re-scan
- **Day 60**: trajectory check
- **Day 90**: outcome audit + Standard continuation option

Citation-tracking probes run continuously over the 90-day window — they
measure how often AI agents cite your brand accurately across 4 major-model
providers.

## Per-stack adjustments

If your project layout differs from the assumed structure (Next.js App Router
+ \`public/\` static-serving), you may need to move:
- \`public/llms.txt\` → wherever static files are served from
- \`public/openapi.yaml\` → same
- \`mcp-server/\` → standalone Worker, deploys independently of your main app

The Astrant scoring rubric is path-agnostic — it discovers via well-known
locations + linked references.
`;
}

function buildLlmsTxtMonitorScript(customerDomain: string): string {
  const host = customerDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `#!/usr/bin/env bash
# Astrant — llms.txt uptime monitor. Wire into your CI / monitoring system.
set -euo pipefail
URL="https://${host}/llms.txt"
code=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
if [ "$code" != "200" ]; then
  echo "llms.txt unhealthy: HTTP $code at $URL"
  exit 1
fi
echo "llms.txt healthy: 200 at $URL"
`;
}

function buildMcpServerMonitorScript(brandName: string): string {
  return `#!/usr/bin/env bash
# Astrant — MCP server uptime monitor. Edit MCP_URL below to point at your
# deployed Worker (workers.dev URL OR your CNAME).
set -euo pipefail
MCP_URL="\${MCP_URL:-https://CHANGE-ME.workers.dev}"
code=$(curl -s -o /dev/null -w "%{http_code}" "$MCP_URL/.well-known/mcp.json")
if [ "$code" != "200" ]; then
  echo "${brandName} MCP unhealthy: HTTP $code at $MCP_URL"
  exit 1
fi
echo "${brandName} MCP healthy: 200 at $MCP_URL"
`;
}
