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

// F2-EMAIL-1 — escapeHtml + HTML shell, DUPLICATED from score-email.ts on purpose
// (score-email.ts serves live Score emails; we don't refactor a live module mid-slice).
// TODO: extract a shared lib/email-shell.ts once a 3rd consumer appears.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// `<meta charset="utf-8">` (F2-EMAIL-2) so em-dash / non-ASCII render in all clients.
function f2EmailShell(innerHtml: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"></head><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; line-height: 1.5; max-width: 640px; margin: 0 auto; padding: 24px;">
${innerHtml}
</body></html>`;
}

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
    `A one-command deploy wrapper (npx @astrant/deploy-mcp) is on the roadmap.`,
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

  // Static content (no interpolated/customer values), so no escapeHtml needed here.
  const html = f2EmailShell(`  <h2 style="margin-top:0;">Your Astrant Implementation patch is ready</h2>
  <p>Apply your patch: <code>git am astrant-implementation.patch</code> (run from your project root).</p>
  <p>Deploy your MCP server: <code>cd mcp-server &amp;&amp; npx wrangler login &amp;&amp; npx wrangler deploy</code><br>
  A one-command deploy wrapper (<code>npx @astrant/deploy-mcp</code>) is on the roadmap.</p>
  <h3>What&#39;s included</h3>
  <ul>
    <li>Customized llms.txt for your brand and domain</li>
    <li>Deployable MCP server (TypeScript Worker; your Cloudflare, your control)</li>
    <li>OpenAPI spec scaffold for your category</li>
    <li>JSON-LD schema blocks for your root layout</li>
    <li>Static monitoring scripts</li>
    <li><code>ASTRANT_IMPLEMENTATION.md</code> with per-stack notes</li>
  </ul>
  <h3>Over the next 90 days</h3>
  <ul>
    <li><strong>Day 30:</strong> trajectory check-in audit + scanner re-scan</li>
    <li><strong>Day 60:</strong> trajectory check</li>
    <li><strong>Day 90:</strong> outcome audit + Standard continuation option</li>
  </ul>
  <p>Citation-tracking probes run continuously over the 90-day window.</p>
  <p>Reply to this email with any questions.</p>
  <p>—Astrant</p>`);

  const resend = new Resend(env.RESEND_API_KEY);
  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: input.toEmail,
      subject,
      text,
      html,
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

  // escapeHtml every interpolated value (recs are deterministic today, LLM-fed later).
  const htmlParts: string[] = [
    `<h2 style="margin-top:0;">${escapeHtml(
      input.dayN === 90
        ? "Your 90-day Implementation arc is complete."
        : `Your Day ${input.dayN} Implementation audit is ready.`,
    )}</h2>`,
    `<h3>What changed</h3>`,
    `<ul>`,
    `<li>Scanner score: ${input.baselineScore.toFixed(0)}/100 → ${input.currentScore.toFixed(0)}/100</li>`,
    `<li>Cite-share: ${input.citeShareBaselinePct.toFixed(1)}% → ${input.citeShareCurrentPct.toFixed(1)}% across 4 major-model providers</li>`,
    `<li>Trajectory: ${escapeHtml(input.recs.trajectoryInterpretation)}</li>`,
    `</ul>`,
    `<p>${escapeHtml(input.recs.whatChanged)}</p>`,
    `<h3>Recommendations</h3>`,
    `<ul>${input.recs.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`,
  ];
  if (input.dayN === 90 && input.autoPilotCheckoutUrl) {
    htmlParts.push(
      `<p>Continue the measurement rhythm — <a href="${escapeHtml(input.autoPilotCheckoutUrl)}">start Standard ($149/mo)</a>. Monthly citation-tracking digests + ongoing scanner re-runs. Same methodology, monthly cadence.</p>`,
      `<p>If you deployed your MCP, it keeps running on your Cloudflare account. Your patch + audit PDFs are yours unconditionally.</p>`,
    );
  }
  htmlParts.push(`<p>Reply to this email with any questions.</p>`, `<p>—Astrant</p>`);
  const html = f2EmailShell(htmlParts.join("\n  "));

  const resend = new Resend(env.RESEND_API_KEY);
  try {
    const sendArgs: Parameters<typeof resend.emails.send>[0] = {
      from: FROM_ADDRESS,
      to: input.toEmail,
      subject,
      text: lines.join("\n"),
      html,
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
