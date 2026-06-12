// F2 v6.1 — patch-delivery email + 3 Day-N audit emails.
//
// Per spec D8 + §23.1 audit-discipline. Attachment pattern mirrors F3.1's
// sendAutoPilotAuditReadyEmail at score-email.ts:295-337.

import { Resend } from "resend";
import type { AuditRecsOutput } from "./f2-generators/audit-recs";

export interface F2EmailEnv {
  RESEND_API_KEY: string;
  AUDITS: R2Bucket;  // Patch + audit PDFs live here
}

const FROM_ADDRESS = "Astrant Implementation <reports@astrant.io>";

// ─── Patch delivery email (fires at end of impl-fulfill pipeline) ───────

export interface PatchDeliveryEmailInput {
  toEmail: string;
  brandName: string;
  patchR2Key: string;
  sessionId: string;
}

export async function sendF2PatchDeliveryEmail(
  env: F2EmailEnv,
  input: PatchDeliveryEmailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const patchObj = await env.AUDITS.get(input.patchR2Key);
  if (!patchObj) {
    return { ok: false, error: `patch_not_found:${input.patchR2Key}` };
  }
  const patchBytes = new Uint8Array(await patchObj.arrayBuffer());
  const patchBase64 = uint8ArrayToBase64Local(patchBytes);

  const subject = "Your Astrant Implementation is ready";
  const text = [
    `Your Astrant Implementation patch is ready.`,
    ``,
    `Apply your patch: git am astrant-implementation.patch  (run from your project root).`,
    ``,
    `Deploy your MCP server: cd mcp-server && npx wrangler login && npx wrangler deploy`,
    `(one-command deploy via "npx @astrant/deploy-mcp" coming shortly — F2-pre-1.)`,
    ``,
    `What's included:`,
    `  - Customized llms.txt for your brand and domain`,
    `  - Deployable MCP server (TypeScript Worker; your Cloudflare, your control)`,
    `  - OpenAPI spec scaffold for your category`,
    `  - JSON-LD schema blocks for your root layout`,
    `  - Static monitoring scripts`,
    `  - ASTRANT_IMPLEMENTATION.md with per-stack notes`,
    ``,
    `Over the next 90 days:`,
    `  - Day 30: trajectory check-in audit + scanner re-scan`,
    `  - Day 60: trajectory check`,
    `  - Day 90: outcome audit + Standard continuation option`,
    ``,
    `Citation-tracking probes run continuously over the 90-day window.`,
    ``,
    `Reply to this email with any questions.`,
    ``,
    `—Astrant`,
  ].join("\n");

  const resend = new Resend(env.RESEND_API_KEY);
  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: input.toEmail,
      subject,
      text,
      attachments: [
        {
          filename: `astrant-implementation.patch`,
          content: patchBase64,
        },
      ],
    });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Day-N audit emails (fire at Day 30 / 60 / 90 via citation-tracking cron) ───

export interface F2DayNAuditEmailInput {
  toEmail: string;
  brandName: string;
  dayN: 30 | 60 | 90;
  sessionId: string;
  auditPdfR2Key?: string;  // Optional v1.0: if absent, sends text-only audit email. PDF rendering deferred to v1.1+.
  recs: AuditRecsOutput;
  baselineScore: number;   // composite scanner score, pre-F2
  currentScore: number;    // composite scanner score, current
  citeShareBaselinePct: number;
  citeShareCurrentPct: number;
  autoPilotCheckoutUrl?: string;  // Day-90 only; CTA target
}

export async function sendF2DayNAuditEmail(
  env: F2EmailEnv,
  input: F2DayNAuditEmailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // v1.0: PDF attachment optional. If auditPdfR2Key provided, attach; else send text-only.
  let pdfBase64: string | null = null;
  if (input.auditPdfR2Key) {
    const pdfObj = await env.AUDITS.get(input.auditPdfR2Key);
    if (!pdfObj) {
      return { ok: false, error: `audit_pdf_not_found:${input.auditPdfR2Key}` };
    }
    const pdfBytes = new Uint8Array(await pdfObj.arrayBuffer());
    pdfBase64 = uint8ArrayToBase64Local(pdfBytes);
  }

  const subject =
    input.dayN === 90
      ? `Your Astrant Implementation — Day 90 audit + what's next`
      : `Your Astrant Implementation — Day ${input.dayN} audit`;

  const lines: string[] = [
    input.dayN === 90
      ? `Your 90-day Implementation arc is complete.`
      : `Your Day ${input.dayN} Implementation audit is ready.`,
    ``,
    `What changed:`,
    `  - Scanner score: ${input.baselineScore.toFixed(0)}/100 → ${input.currentScore.toFixed(0)}/100`,
    `  - Cite-share: ${input.citeShareBaselinePct.toFixed(1)}% → ${input.citeShareCurrentPct.toFixed(1)}% across 4 major-model providers`,
    `  - Trajectory: ${input.recs.trajectoryInterpretation}`,
    ``,
    input.recs.whatChanged,
    ``,
    `Recommendations:`,
    ...input.recs.recommendations.map((r) => `  - ${r}`),
    ``,
  ];

  if (input.dayN === 90 && input.autoPilotCheckoutUrl) {
    lines.push(
      `Continue the measurement rhythm — start Standard ($149/mo):`,
      input.autoPilotCheckoutUrl,
      `Monthly citation-tracking digests + ongoing scanner re-runs. Same methodology, monthly cadence.`,
      ``,
      `If you deployed your MCP, it keeps running on your Cloudflare account. Your patch + audit PDFs are yours unconditionally.`,
      ``,
    );
  }

  lines.push(
    `Reply to this email with any questions.`,
    ``,
    `—Astrant`,
  );

  const resend = new Resend(env.RESEND_API_KEY);
  try {
    const sendArgs: Parameters<typeof resend.emails.send>[0] = {
      from: FROM_ADDRESS,
      to: input.toEmail,
      subject,
      text: lines.join("\n"),
    };
    if (pdfBase64 !== null) {
      sendArgs.attachments = [
        {
          filename: `astrant-day${input.dayN}-audit-${input.sessionId}.pdf`,
          content: pdfBase64,
        },
      ];
    }
    const result = await resend.emails.send(sendArgs);
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function uint8ArrayToBase64Local(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
