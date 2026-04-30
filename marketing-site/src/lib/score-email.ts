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

const FROM_ADDRESS = "Astrant Score <reports@astrant.io>";
const COMPANY_FOOTER =
  "Astrant — Agent Discoverability for B2B SaaS. [Subject to legal review pre-launch: company city placeholder]";

export type SendEnv = {
  RESEND_API_KEY: string;
  UNSUBSCRIBE_SECRET: string;
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

function topGapsHtml(scan: ScanResult, max = 3): string {
  const gaps: { name: string; score: number; notes: string }[] = [];
  for (const dim of scan.dimensions) {
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
        `<li><strong>${escapeHtml(g.name)}</strong> — ${g.score}/100. ${escapeHtml(g.notes)}</li>`
    )
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

export async function sendGapReportReadyEmail(
  env: SendEnv,
  input: BaseSendInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const resend = new Resend(env.RESEND_API_KEY);
  const pdfUrl = `${input.origin}/api/score/${input.scan.id}/pdf?t=${input.scanToken}`;
  const resultsUrl = `${input.origin}/score/${input.scan.id}?t=${input.scanToken}`;
  const unsubUrl = `${input.origin}/api/score/unsubscribe?t=${input.unsubscribeToken}`;
  const requestedDate = new Date().toISOString().slice(0, 10);

  const subject = "Your Astrant Score gap report is ready";
  const text = [
    `Hi —`,
    ``,
    `Your Astrant Score gap report for ${input.scan.url} is ready.`,
    ``,
    `Composite score: ${input.scan.composite.score} (${input.scan.composite.grade})`,
    `Dimensions scored: ${input.scan.dimensions_scored} of ${input.scan.dimensions_total}`,
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

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; line-height: 1.5; max-width: 640px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-top: 0;">Your Astrant Score gap report is ready</h2>
  <p>We just scanned <code>${escapeHtml(input.scan.url)}</code>.</p>
  <p style="font-size: 32px; font-weight: 700; margin: 24px 0 8px 0;">${input.scan.composite.score} <span style="font-size: 22px; font-weight: 600; color: #64748b;">${escapeHtml(input.scan.composite.grade)}</span></p>
  <p style="margin: 0; color: #64748b; font-size: 14px;">Scored on ${input.scan.dimensions_scored} of ${input.scan.dimensions_total} dimensions.</p>
  <h3 style="margin-top: 24px;">Top gaps</h3>
  <ul>${topGapsHtml(input.scan)}</ul>
  <p style="margin-top: 28px;">
    <a href="${pdfUrl}" style="display: inline-block; padding: 10px 18px; background: #0f172a; color: white; text-decoration: none; border-radius: 4px; font-weight: 600;">View full PDF</a>
    &nbsp;
    <a href="${resultsUrl}" style="color: #0f172a;">View results page</a>
  </p>
  <p style="margin-top: 24px;">Made changes? <a href="${input.origin}/score" style="color: #0f172a;">Re-run the scan</a> to see your updated score.</p>
  <hr style="margin: 32px 0; border: none; border-top: 1px solid #e2e8f0;">
  <p style="color: #64748b; font-size: 13px;">You requested this report on ${requestedDate}.</p>
  <p style="color: #64748b; font-size: 13px;">
    <a href="${unsubUrl}" style="color: #64748b;">Unsubscribe from rescan emails</a>
    &nbsp;·&nbsp;
    <a href="${input.origin}/score/delete-me" style="color: #64748b;">Delete all my data</a>
  </p>
  <p style="color: #94a3b8; font-size: 12px; margin-top: 16px;">${escapeHtml(COMPANY_FOOTER)}</p>
</body></html>`;

  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: input.toEmail,
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
    `Dimensions scored: ${input.scan.dimensions_scored} of ${input.scan.dimensions_total}`,
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

  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: input.toEmail,
      subject,
      text,
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

  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: input.toEmail,
      subject,
      text,
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
