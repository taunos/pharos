// F2 v6.1 D9 — POST /api/impl-fulfill.
//
// Internal fulfillment route mirroring `audit-fulfill/route.ts` (maxDuration:300).
// Dispatched fire-and-forget from /api/dodo-webhook F2 branch after webhook
// idempotency INSERT lands.
//
// 10-step pipeline:
//   1. CAS UPDATE status='queued' → 'processing' (race-free claim)
//   2. Read F2 session
//   3. Baseline scan via scanner Worker
//   4-7. 5 LLM generators (4 patch-time; audit-recs fires later at Day-N)
//   8. Patch assembly + R2 persist
//   9. customer_probe_targets INSERT-with-CHECK + ON CONFLICT (D18 Stage 3 Fix A)
//   10. Audit due-dates + delivery email + status='active'

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { constantTimeEqual } from "@/lib/dodo";
import { runScan, type AuditEnv } from "@/lib/audit-pipeline";
import { generateLlmsTxt } from "@/lib/f2-generators/llms-txt";
import { generateMcpServerConfig } from "@/lib/f2-generators/mcp-server-config";
import { generateOpenApi } from "@/lib/f2-generators/openapi";
import { generateJsonLd } from "@/lib/f2-generators/jsonld";
import { renderMcpServerWorker } from "@/lib/f2-mcp-server-template";
import { assembleGitAmPatch } from "@/lib/f2-patch-assembler";
import { sendF2PatchDeliveryEmail } from "@/lib/f2-email";
import { sendOperatorAlert } from "@/lib/operator-alerts";
import type { ProbeCadence } from "@/lib/cadence";

export const maxDuration = 300;

interface ImplFulfillEnv extends AuditEnv {
  INTERNAL_FULFILL_KEY: string;
  CITATION_DB: D1Database;
  RESEND_API_KEY: string;
  OPERATOR_ALERT_EMAIL: string;
  // B1.3 v1.1 — replaces hardcoded ceiling=3 (default "30").
  MAX_PROBE_TARGETS?: string;
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
}

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as ImplFulfillEnv;

  // Auth — constant-time compare to deny timing-side-channel inference
  const provided = req.headers.get("x-internal-fulfill-key");
  if (
    !env.INTERNAL_FULFILL_KEY ||
    !provided ||
    !constantTimeEqual(provided, env.INTERNAL_FULFILL_KEY)
  ) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: { session_id?: unknown };
  try {
    body = (await req.json()) as { session_id?: unknown };
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  // Step 1 — CAS UPDATE status='queued' → 'processing' (race-free claim)
  const casResult = await env.CITATION_DB.prepare(
    `UPDATE implementation_sessions
     SET status = 'processing', processing_started_at = ?, updated_at = ?
     WHERE session_id = ? AND status = 'queued'`,
  )
    .bind(now, now, sessionId)
    .run();

  if (casResult.meta.changes !== 1) {
    // Already claimed by another invocation OR not in queued state
    return NextResponse.json({ ok: true, deduped: true });
  }

  let f2: ImplementationSessionRow | null = null;
  try {
    // Step 2 — Read F2 session row
    f2 = await env.CITATION_DB.prepare(
      `SELECT session_id, dodo_payment_id, customer_email, customer_domain,
              brand_name, category, competitors, customer_id, payment_succeeded_at, status
       FROM implementation_sessions WHERE session_id = ?`,
    )
      .bind(sessionId)
      .first<ImplementationSessionRow>();

    if (!f2) {
      throw new Error(`F2_SESSION_NOT_FOUND session_id=${sessionId}`);
    }

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
      .bind(baselineScanId, Math.floor(Date.now() / 1000), sessionId)
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
      fulfillment_time: new Date(),
      files: allFiles,
    });

    // Step 7 — Persist patch to R2 (LOW-2 v3 fold — operator recovery path)
    const patchR2Key = `f2-patches/${sessionId}.patch`;
    await env.AUDITS.put(patchR2Key, patchContent);
    await env.CITATION_DB.prepare(
      `UPDATE implementation_sessions SET patch_r2_key = ?, updated_at = ?
       WHERE session_id = ?`,
    )
      .bind(patchR2Key, Math.floor(Date.now() / 1000), sessionId)
      .run();

    // B1.3 v1.1 — endpoint validator (Locked Artifact H): defend against an upstream
    // implementation_sessions row landing with a customer_id that collides with the 'astrant'
    // sentinel or fails the sub_ shape.
    const customerIdValidation = validateCustomerIdForProbeTarget(f2.customer_id);
    if (!customerIdValidation.ok) {
      throw new Error(`F2_CUSTOMER_ID_INVALID session_id=${sessionId} reason=${customerIdValidation.reason}`);
    }

    // Step 8 — customer_probe_targets INSERT-with-CHECK + ON CONFLICT
    // (D18 Stage 3 Fix A: self-exclusion in count subquery; 6 cases verified V-H)
    // B1.3 v1.1 — MAX_PROBE_TARGETS env binding replaces hardcoded ceiling=3.
    // F4.1 D9 Site 2: append probe_cadence + next_probe_at. F2 customers default
    // 'twice_weekly' per Bruno lock #14. ON CONFLICT does NOT touch cadence per MED-NEW-O.
    const maxProbeTargets = parseInt(env.MAX_PROBE_TARGETS ?? "30", 10);
    const probeInsertTime = Math.floor(Date.now() / 1000);
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
      const failTime = Math.floor(Date.now() / 1000);
      await env.CITATION_DB.prepare(
        `UPDATE implementation_sessions
         SET status = 'failed_ceiling', failed_reason = ?, updated_at = ?
         WHERE session_id = ?`,
      )
        .bind("F2_OVER_CAPACITY_ATOMIC_FAILED", failTime, sessionId)
        .run();
      await sendOperatorAlert(env, {
        alert_code: "F2_OVER_CAPACITY_ATOMIC_FAILED",
        customer_email: f2.customer_email,
        session_id: sessionId,
        dodo_payment_id: f2.dodo_payment_id,
        notes: "Stage 3 atomic ceiling check rejected after Stage 1 + Stage 2 both passed. Customer paid; needs manual refund via Dodo dashboard.",
      });
      return NextResponse.json({ error: "AT_CAPACITY" }, { status: 503 });
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
      .bind(day30Due, day60Due, day90Due, bundleExpires, Math.floor(Date.now() / 1000), sessionId)
      .run();

    // Step 10 — Patch-delivery email
    const emailResult = await sendF2PatchDeliveryEmail(env, {
      toEmail: f2.customer_email,
      brandName: f2.brand_name,
      patchR2Key,
      sessionId,
    });

    if (!emailResult.ok) {
      // Email failed but everything else succeeded — operator can re-send from R2.
      const failTime = Math.floor(Date.now() / 1000);
      await env.CITATION_DB.prepare(
        `UPDATE implementation_sessions
         SET status = 'active_email_pending', failed_reason = ?, updated_at = ?
         WHERE session_id = ?`,
      )
        .bind(`email_send_failed:${emailResult.error}`, failTime, sessionId)
        .run();
      await sendOperatorAlert(env, {
        alert_code: "F2_EMAIL_SEND_FAILED",
        customer_email: f2.customer_email,
        session_id: sessionId,
        dodo_payment_id: f2.dodo_payment_id,
        notes: `Pipeline succeeded; email send failed: ${emailResult.error}. Re-send patch from R2 key ${patchR2Key}.`,
      });
      return NextResponse.json({ ok: true, status: "active_email_pending" });
    }

    // Step 11 — Status flip → 'active'
    const completeTime = Math.floor(Date.now() / 1000);
    await env.CITATION_DB.prepare(
      `UPDATE implementation_sessions
       SET status = 'active', patch_delivered_at = ?, updated_at = ?
       WHERE session_id = ?`,
    )
      .bind(completeTime, completeTime, sessionId)
      .run();

    console.log(`F2_FULFILLMENT_COMPLETE session_id=${sessionId}`);
    return NextResponse.json({ ok: true, session_id: sessionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`F2_FULFILLMENT_FAILED session_id=${sessionId} err=${msg}`);
    const failTime = Math.floor(Date.now() / 1000);
    await env.CITATION_DB.prepare(
      `UPDATE implementation_sessions
       SET status = 'failed', failed_reason = ?, updated_at = ?
       WHERE session_id = ?`,
    )
      .bind(msg.slice(0, 500), failTime, sessionId)
      .run()
      .catch(() => {});
    if (f2) {
      await sendOperatorAlert(env, {
        alert_code: "F2_FULFILLMENT_FAILED",
        customer_email: f2.customer_email,
        session_id: sessionId,
        dodo_payment_id: f2.dodo_payment_id,
        notes: msg.slice(0, 500),
      });
    }
    return NextResponse.json({ error: "FULFILLMENT_FAILED" }, { status: 500 });
  }
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

The one-command \`npx @astrant/deploy-mcp\` wrapper (F2-pre-1) automates the
\`login + deploy + mcp.json URL update\` sequence; it's shipping shortly.

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
