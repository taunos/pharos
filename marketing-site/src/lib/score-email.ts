// Slice 2b Phase 1 — Resend transactional send for the Score gap report.
//
// Two send templates:
//   1. Gap-report ready (PDF generated immediately).
//   2. Gap-report deferred (BR daily cap hit; PDF queued for next-day cron).
//   3. Deletion confirmation (sent to user's own inbox after they request deletion).
//
// Send failures are caught + logged; the user-facing capture-email response
// still returns success because EmailGate's "if you don't see an email in
// 5 minutes, view it directly at <link>" fallback covers silent send
// failures. Phase 2's bounce webhook will surface real bounces.
//
// All sends use From: `Astrant Score <reports@astrant.io>` — Bruno added
// the `reports@astrant.io` Cloudflare Email Routing forwarder pre-flight.

import { Resend } from "resend";
import type { ScanResult } from "./audit-types";
import { hashEmailForLog } from "./score-tokens";
import { dimensionCountPhrase } from "./score-display";
import {
  renderEmailLayout,
  escapeHtml,
  EMAIL_PALETTE,
  emailButton,
  emailLink,
  emailCode,
  emailCardHeading,
  emailStack,
  emailList,
} from "./email-layout";

const FROM_ADDRESS = "Astrant Score <reports@astrant.io>";
const REPLY_TO = "contact@astrant.io";
export const COMPANY_FOOTER =
  "Astrant — Agent Discoverability for B2B SaaS · contact@astrant.io";

export type SendEnv = {
  RESEND_API_KEY: string;
  UNSUBSCRIBE_SECRET: string;
  AUDITS: R2Bucket;
};

interface BaseSendInput {
  toEmail: string;
  scan: ScanResult;
  scanToken: string; // 30-day TTL, used in PDF + results-page links
  unsubscribeToken: string; // 365-day TTL, RFC 8058 List-Unsubscribe
  origin: string; // e.g. "https://astrant.io"
}

function topGapsText(scan: ScanResult, max = 3): string {
  const gaps: { name: string; score: number; notes: string }[] = [];
  for (const dim of scan.dimensions) {
    // Slice 3a defense-in-depth: skip whole-dim N/A. Sub-check `na` filter
    // below would already drop these (every sub-check on an N/A dim is na:true)
    // but the dim-level skip makes the contract explicit and cheap.
    if (dim.na) continue;
    for (const sub of dim.sub_checks) {
      if (sub.na || sub.score >= 80) continue;
      gaps.push({ name: sub.name, score: sub.score, notes: sub.notes });
    }
  }
  gaps.sort((a, b) => a.score - b.score);
  return gaps
    .slice(0, max)
    .map((g) => `  • ${g.name} — ${g.score}/100. ${g.notes}`)
    .join("\n");
}

// List items for emailList (E1).
function topGapsHtml(scan: ScanResult, max = 3): string[] {
  const gaps: { name: string; score: number; notes: string }[] = [];
  for (const dim of scan.dimensions) {
    if (dim.na) continue;
    for (const sub of dim.sub_checks) {
      if (sub.na || sub.score >= 80) continue;
      gaps.push({ name: sub.name, score: sub.score, notes: sub.notes });
    }
  }
  gaps.sort((a, b) => a.score - b.score);
  return gaps
    .slice(0, max)
    .map(
      (g) =>
        `<strong>${escapeHtml(g.name)}</strong> — ${escapeHtml(String(g.score))}/100. ${escapeHtml(g.notes)}`
    );
}

// Large composite score + muted caption (#1, #3).
function scoreDisplayHtml(scan: ScanResult, captionHtml: string): string {
  const p = EMAIL_PALETTE;
  return (
    `<div style="font-size: 32px; font-weight: 700; line-height: 1.2;">${escapeHtml(String(scan.composite.score))} <span style="font-size: 22px; font-weight: 600; color: ${p.muted};">${escapeHtml(scan.composite.grade)}</span></div>` +
    `<div style="color: ${p.muted}; font-size: 13px;">${captionHtml}</div>`
  );
}

// Footer lines with the unsubscribe + delete-my-data links (#1, #3).
function scoreFooterHtmlLines(input: {
  requestedDate: string;
  unsubUrl: string;
  deleteUrl: string;
}): string[] {
  return [
    `You requested this report on ${escapeHtml(input.requestedDate)}.`,
    `${emailLink(input.unsubUrl, "Unsubscribe from rescan emails", EMAIL_PALETTE.muted)} &nbsp;·&nbsp; ${emailLink(input.deleteUrl, "Delete all my data", EMAIL_PALETTE.muted)}`,
  ];
}

function commonHeaders(input: {
  unsubscribeUrl: string;
}): Record<string, string> {
  // RFC 8058 one-click unsubscribe. Mail clients honoring this header POST
  // automatically without showing our confirmation page. Bare GET on the
  // same URL renders a confirmation page (defeats preview-bot CSRF).
  return {
    "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// ─── PDF-ready email ─────────────────────────────────────────────────────

// The EXACT Resend request. P0-C2 v2.9: the deferred-capture consumer freezes
// one of these into `capture_jobs.delivery_snapshot` before entering
// email_sending, then re-sends it VERBATIM under the stable `job_id`
// idempotency key — so a retry is byte-identical (Resend dedups within 24h;
// a differing payload under the same key would 409).
//
// Stays EXACTLY six fields: the scanner's /freeze-snapshot (validSnapshotShape)
// and the consumer's parseSnapshot both reject any other shape. E1's replyTo is
// added at SEND time in sendResendPayload, never stored in the snapshot.
export type GapReportPayload = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
};

// PURE + DETERMINISTIC: no `Date.now()`, no ambient state. `requestedDate` and
// the tokens are INPUTS, so identical inputs → byte-identical output. Freezing
// THIS payload (not the inputs) is the v2.9 acceptance gate: a later code deploy
// or secret rotation cannot alter an already-stored snapshot.
export function buildGapReportReadyPayload(
  input: BaseSendInput & { requestedDate: string }
): GapReportPayload {
  const pdfUrl = `${input.origin}/api/score/${input.scan.id}/pdf?t=${input.scanToken}`;
  const resultsUrl = `${input.origin}/score/${input.scan.id}?t=${input.scanToken}`;
  const unsubUrl = `${input.origin}/api/score/unsubscribe?t=${input.unsubscribeToken}`;
  const requestedDate = input.requestedDate;

  const subject = "Your Astrant Score gap report is ready";
  const text = [
    `Hi —`,
    ``,
    `Your Astrant Score gap report for ${input.scan.url} is ready.`,
    ``,
    `Composite score: ${input.scan.composite.score} (${input.scan.composite.grade})`,
    `Dimensions scored: ${dimensionCountPhrase(input.scan.dimensions_applicable, input.scan.dimensions_scored, input.scan.dimensions_total)} applicable`,
    ``,
    `Top gaps to focus on:`,
    topGapsText(input.scan),
    ``,
    `View full PDF:    ${pdfUrl}`,
    `Results page:     ${resultsUrl}`,
    `Re-run anytime:   ${input.origin}/score`,
    ``,
    `You requested this report on ${requestedDate}.`,
    ``,
    `Unsubscribe from rescan emails: ${unsubUrl}`,
    `Delete all your data: ${input.origin}/score/delete-me`,
    ``,
    COMPANY_FOOTER,
  ].join("\n");

  const phrase = dimensionCountPhrase(input.scan.dimensions_applicable, input.scan.dimensions_scored, input.scan.dimensions_total);
  const html = renderEmailLayout({
    preheader: `Your Astrant Score gap report for ${input.scan.url} is ready.`,
    heading: "Your Astrant Score gap report is ready",
    cards: [
      emailStack([
        `We just scanned ${emailCode(input.scan.url)}.`,
        scoreDisplayHtml(input.scan, `Scored on ${escapeHtml(phrase)} dimensions applicable to this site.`),
      ]),
      emailCardHeading("Top gaps") + emailList(topGapsHtml(input.scan)),
      emailStack([
        `${emailButton("View full PDF", pdfUrl)} &nbsp; ${emailLink(resultsUrl, "View results page")}`,
        `Made changes? ${emailLink(`${input.origin}/score`, "Re-run the scan")} to see your updated score.`,
      ]),
    ],
    footerHtmlLinesTrusted: scoreFooterHtmlLines({
      requestedDate,
      unsubUrl,
      deleteUrl: `${input.origin}/score/delete-me`,
    }),
    footerLines: [COMPANY_FOOTER],
  });

  return {
    from: FROM_ADDRESS,
    to: input.toEmail,
    subject,
    text,
    html,
    headers: commonHeaders({ unsubscribeUrl: unsubUrl }),
  };
}

// Shared thin sender. A non-empty idempotencyKey enables Resend's 24h dedup.
// replyTo (E1) is added here, at send time, so the frozen six-field payload is
// unchanged; the request is still deterministic per payload, so a retry under
// the same key sends identical bytes.
async function sendResendPayload(
  env: SendEnv,
  payload: GapReportPayload,
  idempotencyKey?: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const resend = new Resend(env.RESEND_API_KEY);
  const request = { ...payload, replyTo: REPLY_TO };
  try {
    const result = idempotencyKey
      ? await resend.emails.send(request, { idempotencyKey })
      : await resend.emails.send(request);
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true, id: result.data?.id ?? "" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Legacy synchronous path (behavior preserved): resolve today's date, build the
// payload, send without an idempotency key.
export async function sendGapReportReadyEmail(
  env: SendEnv,
  input: BaseSendInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const requestedDate = new Date().toISOString().slice(0, 10);
  const payload = buildGapReportReadyPayload({ ...input, requestedDate });
  return sendResendPayload(env, payload);
}

// Deferred-capture consumer path (P0-C2 v2.9): send a PRE-FROZEN payload verbatim
// under the stable job_id idempotency key. A crash-retry re-sends identical bytes;
// Resend dedups within its 24h window.
export async function sendFrozenGapReport(
  env: SendEnv,
  payload: GapReportPayload,
  idempotencyKey: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return sendResendPayload(env, payload, idempotencyKey);
}

// ─── PDF-deferred email ──────────────────────────────────────────────────

export async function sendGapReportDeferredEmail(
  env: SendEnv,
  input: BaseSendInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const resend = new Resend(env.RESEND_API_KEY);
  const resultsUrl = `${input.origin}/score/${input.scan.id}?t=${input.scanToken}`;
  const unsubUrl = `${input.origin}/api/score/unsubscribe?t=${input.unsubscribeToken}`;
  const requestedDate = new Date().toISOString().slice(0, 10);

  const subject = "Your Astrant Score gap report is queued";
  const text = [
    `Hi —`,
    ``,
    `Your Astrant Score gap report for ${input.scan.url} is queued for generation.`,
    `We've reached today's PDF rendering capacity; your PDF will be ready within 24 hours,`,
    `and we'll email a link the moment it's available.`,
    ``,
    `Composite score: ${input.scan.composite.score} (${input.scan.composite.grade})`,
    `Dimensions scored: ${dimensionCountPhrase(input.scan.dimensions_applicable, input.scan.dimensions_scored, input.scan.dimensions_total)} applicable`,
    ``,
    `Top gaps (preview):`,
    topGapsText(input.scan),
    ``,
    `Results page (refresh for PDF when ready): ${resultsUrl}`,
    ``,
    `You requested this report on ${requestedDate}.`,
    ``,
    `Unsubscribe from rescan emails: ${unsubUrl}`,
    `Delete all your data: ${input.origin}/score/delete-me`,
    ``,
    COMPANY_FOOTER,
  ].join("\n");

  const html = renderEmailLayout({
    preheader: `Your Astrant Score gap report for ${input.scan.url} is queued for generation.`,
    heading: subject,
    cards: [
      emailStack([
        `Hi —`,
        `Your Astrant Score gap report for ${escapeHtml(input.scan.url)} is queued for generation. We've reached today's PDF rendering capacity; your PDF will be ready within 24 hours, and we'll email a link the moment it's available.`,
      ]),
      scoreDisplayHtml(
        input.scan,
        `Dimensions scored: ${escapeHtml(dimensionCountPhrase(input.scan.dimensions_applicable, input.scan.dimensions_scored, input.scan.dimensions_total))} applicable`,
      ),
      emailStack([`Top gaps (preview):`, emailList(topGapsHtml(input.scan))]),
      `Results page (refresh for PDF when ready):<br />${emailLink(resultsUrl)}`,
    ],
    footerHtmlLinesTrusted: scoreFooterHtmlLines({
      requestedDate,
      unsubUrl,
      deleteUrl: `${input.origin}/score/delete-me`,
    }),
    footerLines: [COMPANY_FOOTER],
  });

  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: input.toEmail,
      replyTo: REPLY_TO,
      subject,
      text,
      html,
      headers: commonHeaders({ unsubscribeUrl: unsubUrl }),
    });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true, id: result.data?.id ?? "" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Deletion-confirmation email ─────────────────────────────────────────

export async function sendDeletionConfirmEmail(
  env: SendEnv,
  input: { toEmail: string; deletionToken: string; origin: string }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const resend = new Resend(env.RESEND_API_KEY);
  const confirmUrl = `${input.origin}/api/score/delete-me/confirm?t=${input.deletionToken}`;

  const subject = "Confirm deletion of your Astrant data";
  const text = [
    `Hi —`,
    ``,
    `Someone — possibly you — requested deletion of all Astrant Score data`,
    `associated with this email address (${input.toEmail}).`,
    ``,
    `If this was you, click the link below within 24 hours to confirm:`,
    confirmUrl,
    ``,
    `If this wasn't you, ignore this email. The link expires in 24 hours and`,
    `nothing will be deleted without confirmation.`,
    ``,
    COMPANY_FOOTER,
  ].join("\n");

  const html = renderEmailLayout({
    preheader: `Someone — possibly you — requested deletion of all Astrant Score data associated with this email address (${input.toEmail}).`,
    heading: subject,
    cards: [
      emailStack([
        `Hi —`,
        `Someone — possibly you — requested deletion of all Astrant Score data associated with this email address (${escapeHtml(input.toEmail)}).`,
        `If this was you, click the link below within 24 hours to confirm:<br />${emailLink(confirmUrl)}`,
        `If this wasn't you, ignore this email. The link expires in 24 hours and nothing will be deleted without confirmation.`,
      ]),
    ],
    footerLines: [COMPANY_FOOTER],
  });

  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: input.toEmail,
      replyTo: REPLY_TO,
      subject,
      text,
      html,
    });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true, id: result.data?.id ?? "" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Log-redacted email identifier ───────────────────────────────────────

export async function logRedactedEmail(
  email: string,
  secret: string
): Promise<string> {
  return hashEmailForLog(email, secret);
}

// ─── F3.1 AutoPilot welcome audit-ready email ────────────────────────────

export type AutoPilotAuditReadyInput = {
  toEmail: string;
  sessionId: string;
  pdfR2Key: string;
  origin: string;
};

export async function sendAutoPilotAuditReadyEmail(
  env: SendEnv,
  input: AutoPilotAuditReadyInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pdfObj = await env.AUDITS.get(input.pdfR2Key);
  if (!pdfObj) {
    return { ok: false, error: `pdf_not_found:${input.pdfR2Key}` };
  }
  const pdfBytes = new Uint8Array(await pdfObj.arrayBuffer());
  const pdfBase64 = uint8ArrayToBase64Local(pdfBytes);

  const auditUrl = `${input.origin}/audit-results/${input.sessionId}/pdf`;
  const subject = "Your Astrant audit is ready";
  const dimLines = [
    "Dim 1-5: llms.txt, MCP server, OpenAPI catalog, structured data, agent-parsable content",
    "Dim 6: how often 4 major AI models name and cite your brand (Perplexity via live web search; the others from model knowledge)",
  ];
  const digestLine =
    "Your first monthly tracking digest arrives on the 1st of next month, with citation-tracking data from your subscription start onward.";
  const html = renderEmailLayout({
    preheader: "Your 6-dimension AEO audit is ready.",
    heading: "Your Astrant Audit is ready",
    cards: [
      emailStack([
        `Your 6-dimension AEO audit is ready.`,
        `View your audit (PDF attached; permanent link below):<br />${emailLink(auditUrl)}`,
      ]),
      emailStack([`What you'll see:`, emailList(dimLines.map(escapeHtml))]),
      emailStack([escapeHtml(digestLine), `—Astrant`]),
    ],
    footerLines: [COMPANY_FOOTER],
  });

  const resend = new Resend(env.RESEND_API_KEY);
  try {
    const result = await resend.emails.send({
      from: "Astrant <reports@astrant.io>",
      to: input.toEmail,
      replyTo: REPLY_TO,
      subject,
      text: `Your 6-dimension AEO audit is ready.

View your audit (PDF attached; permanent link below):
${auditUrl}

What you'll see:
${dimLines.map((l) => `- ${l}`).join("\n")}

${digestLine}

—Astrant`,
      html,
      attachments: [
        {
          filename: `astrant-autopilot-audit-${input.sessionId}.pdf`,
          content: pdfBase64,
        },
      ],
    });
    // Resend v6 does not throw on API errors — it returns { error }.
    if (result.error) return { ok: false, error: result.error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Test C-A (A4) standalone Audit buyer "ready" email ─────────────────
//
// Copy set by Test C-B (copy table C5). A null copy still HOLDS the send in
// lib/audit-fulfill-run.ts (R2-5). The send is also gated there on
// isAuditCheckoutEnabled. The PDF is attached and linked (pdfUrl reads R2
// directly, so the link outlives the 30-day session TTL).
export type AuditReadyEmailCopy = {
  subject: string;
  // `url` is the audited site; `pdfUrl` is the R2-backed PDF route.
  text: (args: { url: string; pdfUrl: string }) => string;
  html: (args: { url: string; pdfUrl: string }) => string;
};
export const AUDIT_READY_EMAIL_COPY: AuditReadyEmailCopy | null = {
  subject: "Your Astrant Audit is ready",
  text: ({ url, pdfUrl }) =>
    `Your Astrant Audit for ${url} is ready.\n\nThe PDF is attached. You can also open it here:\n${pdfUrl}\n\nQuestions or something looks wrong? Reply to this email or write to contact@astrant.io.\n\n—Astrant`,
  html: ({ url, pdfUrl }) =>
    renderEmailLayout({
      preheader: `Your Astrant Audit for ${url} is ready.`,
      heading: "Your Astrant Audit is ready",
      cards: [
        `<p style="margin: 0 0 12px 0;">Your Astrant Audit for ${escapeHtml(url)} is ready.</p>` +
          `<p style="margin: 0 0 12px 0;">The PDF is attached. You can also open it here:<br /><a href="${escapeHtml(pdfUrl)}" style="color: ${EMAIL_PALETTE.fg}; word-break: break-all;">${escapeHtml(pdfUrl)}</a></p>` +
          `<p style="margin: 0 0 12px 0;">Questions or something looks wrong? Reply to this email or write to <a href="mailto:contact@astrant.io" style="color: ${EMAIL_PALETTE.fg};">contact@astrant.io</a>.</p>` +
          `<p style="margin: 0;">—Astrant</p>`,
      ],
      cta: { label: "Open your Audit (PDF)", href: pdfUrl },
      footerLines: [COMPANY_FOOTER],
    }),
};

export type AuditReadyInput = {
  toEmail: string;
  sessionId: string;
  url: string;
  origin: string;
};

export async function sendAuditReadyEmail(
  env: { RESEND_API_KEY: string; AUDITS: R2Bucket },
  input: AuditReadyInput,
  copy: AuditReadyEmailCopy | null = AUDIT_READY_EMAIL_COPY,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!copy) return { ok: false, error: "copy_not_set" };
  const pdfUrl = `${input.origin}/audit-results/${input.sessionId}/pdf`;
  const resend = new Resend(env.RESEND_API_KEY);
  try {
    // C5 says "The PDF is attached" — attach it (same pattern as the
    // AutoPilot sender). A missing object fails the send so the queue retries.
    const pdfKey = `audits/${input.sessionId}.pdf`;
    const pdfObj = await env.AUDITS.get(pdfKey);
    if (!pdfObj) return { ok: false, error: `pdf_not_found:${pdfKey}` };
    const pdfBase64 = uint8ArrayToBase64Local(new Uint8Array(await pdfObj.arrayBuffer()));
    const args = { url: input.url, pdfUrl };
    const result = await resend.emails.send(
      {
        from: "Astrant <reports@astrant.io>",
        to: input.toEmail,
        replyTo: REPLY_TO,
        subject: copy.subject,
        text: copy.text(args),
        html: copy.html(args),
        attachments: [
          { filename: `astrant-audit-${input.sessionId}.pdf`, content: pdfBase64 },
        ],
      },
      { idempotencyKey: `audit-ready:${input.sessionId}` },
    );
    // Resend v6 does not throw on API errors — it returns { error }.
    if (result.error) return { ok: false, error: result.error.message };
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
