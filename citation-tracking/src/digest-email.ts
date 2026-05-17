// F3 D6.2 + F3.3 v3 + visual iteration round 1 (2026-05-16) — monthly digest email — HTML body + PDF
// attachment. F3.3 v3 v1 placeholder had a single stub section card; this revision absorbs operator's ask
// for real section content + header restructure (logo + Astrant wordmark lockup atop, "Citation Digest" title
// below). Sections 3 and 8.b rendered as real HTML tables; remaining sections rendered as narrative content.

import { Resend } from "resend";
import { parseDigest, type ParsedDigest } from "./digest-parser";
import { lightPalette } from "./brand-tokens";

export interface DigestEmailEnv {
  RESEND_API_KEY: string;
}

export async function sendDigestEmail(
  env: DigestEmailEnv,
  customerId: string,
  customerEmail: string,
  digestMarkdown: string,
  pdfBytes: Uint8Array,
  periodStart: number,
): Promise<void> {
  const htmlBody = htmlEmailFromMarkdown(digestMarkdown);
  const pdfBase64 = uint8ArrayToBase64(pdfBytes);
  const resend = new Resend(env.RESEND_API_KEY);
  await resend.emails.send({
    from: "Astrant AutoPilot <reports@astrant.io>",
    to: customerEmail,
    subject: `Your Astrant citation digest — ${formatMonth(periodStart)}`,
    html: htmlBody,
    attachments: [
      {
        filename: `astrant-citation-digest-${customerId}-${formatMonthSlug(periodStart)}.pdf`,
        content: pdfBase64,
      },
    ],
  });
}

function htmlEmailFromMarkdown(markdown: string): string {
  const digest = parseDigest(markdown);
  const p = lightPalette;

  const summaryCardHtml = renderSummaryCard(digest, p);
  const sectionCardsHtml = renderSectionCards(digest, markdown, p);
  const footerHtml = renderFooter(digest, p);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Astrant Citation Digest</title>
</head>
<body style="margin: 0; padding: 0; background: ${p.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: ${p.fg};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${p.bg};">
    <tr>
      <td style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 640px; margin: 0 auto;">
          ${renderHeaderCard(digest, p)}
          ${summaryCardHtml}
          ${sectionCardsHtml}
          ${footerHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Header card: logo + "Astrant" wordmark as TITLE (largest), "Citation Digest" as subtitle, brand · period as text.
// Operator visual iteration round 2 ask: establish font hierarchy title > subtitle > text.
function renderHeaderCard(digest: ParsedDigest, p: typeof lightPalette): string {
  return `
    <tr>
      <td style="padding: 28px; background: ${p.card}; border: 1px solid ${p.border}; border-radius: 6px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
          <tr>
            <td valign="middle" width="44" height="44" style="line-height: 0; font-size: 0;">
              <img src="https://astrant.io/brand/astrant-mark-light-tight.png" alt="" width="44" height="44" border="0" style="display: block;" />
            </td>
            <td valign="middle" height="44" style="padding-left: 8px; line-height: 44px;">
              <span style="font-size: 32px; font-weight: 700; color: ${p.fg}; letter-spacing: -0.02em; line-height: 44px;">Astrant</span>
            </td>
          </tr>
        </table>
        <h1 style="font-size: 18px; color: ${p.fg}; margin: 4px 0 4px 0; letter-spacing: -0.01em; font-weight: 600;">Citation Digest</h1>
        <p style="font-size: 13px; color: ${p.muted}; margin: 0;">${escapeHtml(digest.headerMeta.brandName)} · ${escapeHtml(digest.headerMeta.period)}</p>
      </td>
    </tr>
  `;
}

function renderSummaryCard(digest: ParsedDigest, p: typeof lightPalette): string {
  const cells: Array<{ label: string; value: string; big?: boolean }> = [
    { label: "Period", value: digest.headerMeta.period || "—" },
    {
      label: "Cite-share",
      value: digest.summary.citeSharePct !== null ? `${digest.summary.citeSharePct}%` : "N/A",
      big: true,
    },
    { label: "Total probes", value: String(digest.summary.totalProbes), big: true },
    { label: "Validated", value: String(digest.summary.validatedRows), big: true },
  ];
  const cellHtml = cells
    .map(
      (c, i) => `
            <td style="padding: 0 ${i === cells.length - 1 ? "0" : "12px"} 0 ${i === 0 ? "0" : "12px"}; vertical-align: top; width: 25%;">
              <div style="font-size: 11px; text-transform: uppercase; color: ${p.muted}; letter-spacing: 0.5px; font-weight: 600;">${c.label}</div>
              <div style="font-size: ${c.big ? "22px" : "16px"}; color: ${p.fg}; margin-top: 6px; font-weight: 700;">${escapeHtml(c.value)}</div>
            </td>`,
    )
    .join("");
  return `
    <tr>
      <td style="padding-top: 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${p.card}; border: 1px solid ${p.border}; border-radius: 6px;">
          <tr>
            <td style="padding: 20px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>${cellHtml}</tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function renderSectionCards(digest: ParsedDigest, markdown: string, p: typeof lightPalette): string {
  const sections: Array<{ num: string; title: string; bodyHtml: string }> = [
    { num: "1", title: "Top-of-document warnings", bodyHtml: narrativeHtml(extractSectionText(markdown, "1"), p) },
    { num: "2", title: "Headline KPI", bodyHtml: narrativeHtml(extractHeadlineNarrative(markdown), p) },
    { num: "3", title: "Per-provider cite share", bodyHtml: perProviderTableHtml(digest, p) },
    { num: "4", title: "Per-prompt — prompts that produced cites", bodyHtml: narrativeHtml(extractSectionText(markdown, "4"), p) },
    { num: "5", title: "Vocabulary association (D2)", bodyHtml: narrativeHtml(digest.vocabAssociation, p) },
    { num: "6", title: "Competitive context (D3)", bodyHtml: narrativeHtml(digest.competitive, p) },
    { num: "7", title: "Trend (month-over-month)", bodyHtml: narrativeHtml(digest.trend, p) },
    {
      num: "8",
      title: "Operational health",
      bodyHtml:
        narrativeHtml(extractSection8Bullets(markdown), p) +
        `<div style="font-size: 13px; font-weight: 600; color: ${p.fg}; margin: 16px 0 8px 0;">Per-provider error breakdown</div>` +
        perProviderErrorsTableHtml(digest, p),
    },
    { num: "9", title: "Methodology footer", bodyHtml: methodologyHtml(digest, p) },
  ];

  return sections
    .map(
      (s) => `
    <tr>
      <td style="padding-top: 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${p.card}; border: 1px solid ${p.border}; border-radius: 6px;">
          <tr>
            <td style="padding: 20px 24px;">
              <div style="font-size: 11px; text-transform: uppercase; color: ${p.muted}; letter-spacing: 0.5px; font-weight: 600; margin-bottom: 8px;">Section ${s.num}</div>
              <h2 style="font-size: 16px; color: ${p.fg}; margin: 0 0 12px 0; font-weight: 700;">${escapeHtml(s.title)}</h2>
              ${s.bodyHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `,
    )
    .join("");
}

function perProviderTableHtml(digest: ParsedDigest, p: typeof lightPalette): string {
  if (digest.perProvider.length === 0) {
    return `<p style="color: ${p.muted}; font-style: italic; margin: 0;">No provider rows extracted.</p>`;
  }
  const headers = ["Provider", "Observations", "Cited", "Cite share", "Errors", "Rate-limit", "Timeout"];
  const headerHtml = headers
    .map(
      (h, i) =>
        `<th style="text-align: ${i === 0 ? "left" : "right"}; padding: 8px 10px; font-size: 11px; color: ${p.muted}; text-transform: uppercase; font-weight: 600; letter-spacing: 0.4px; border-bottom: 1px solid ${p.border};">${escapeHtml(h)}</th>`,
    )
    .join("");
  const rowsHtml = digest.perProvider
    .map(
      (r) => `
            <tr>
              <td style="padding: 8px 10px; font-size: 13px; color: ${p.fg}; border-bottom: 1px solid ${p.border}; font-weight: 500;">${escapeHtml(r.provider)}</td>
              <td style="padding: 8px 10px; font-size: 13px; color: ${p.fg}; border-bottom: 1px solid ${p.border}; text-align: right; font-variant-numeric: tabular-nums;">${r.observations}</td>
              <td style="padding: 8px 10px; font-size: 13px; color: ${p.fg}; border-bottom: 1px solid ${p.border}; text-align: right; font-variant-numeric: tabular-nums;">${r.cited}</td>
              <td style="padding: 8px 10px; font-size: 13px; color: ${p.fg}; border-bottom: 1px solid ${p.border}; text-align: right; font-variant-numeric: tabular-nums;">${escapeHtml(r.share)}</td>
              <td style="padding: 8px 10px; font-size: 13px; color: ${p.fg}; border-bottom: 1px solid ${p.border}; text-align: right; font-variant-numeric: tabular-nums;">${r.errors}</td>
              <td style="padding: 8px 10px; font-size: 13px; color: ${p.fg}; border-bottom: 1px solid ${p.border}; text-align: right; font-variant-numeric: tabular-nums;">${r.rateLimit}</td>
              <td style="padding: 8px 10px; font-size: 13px; color: ${p.fg}; border-bottom: 1px solid ${p.border}; text-align: right; font-variant-numeric: tabular-nums;">${r.timeout}</td>
            </tr>`,
    )
    .join("");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function perProviderErrorsTableHtml(digest: ParsedDigest, p: typeof lightPalette): string {
  if (digest.perProviderErrors.length === 0) {
    return `<p style="color: ${p.muted}; font-style: italic; margin: 0;">No provider error breakdown rows extracted.</p>`;
  }
  const headers = ["Provider", "Error", "Rate-limit", "Timeout"];
  const headerHtml = headers
    .map(
      (h, i) =>
        `<th style="text-align: ${i === 0 ? "left" : "right"}; padding: 8px 10px; font-size: 11px; color: ${p.muted}; text-transform: uppercase; font-weight: 600; letter-spacing: 0.4px; border-bottom: 1px solid ${p.border};">${escapeHtml(h)}</th>`,
    )
    .join("");
  const rowsHtml = digest.perProviderErrors
    .map(
      (r) => `
            <tr>
              <td style="padding: 8px 10px; font-size: 13px; color: ${p.fg}; border-bottom: 1px solid ${p.border}; font-weight: 500;">${escapeHtml(r.provider)}</td>
              <td style="padding: 8px 10px; font-size: 13px; color: ${p.fg}; border-bottom: 1px solid ${p.border}; text-align: right; font-variant-numeric: tabular-nums;">${r.error}</td>
              <td style="padding: 8px 10px; font-size: 13px; color: ${p.fg}; border-bottom: 1px solid ${p.border}; text-align: right; font-variant-numeric: tabular-nums;">${r.rateLimit}</td>
              <td style="padding: 8px 10px; font-size: 13px; color: ${p.fg}; border-bottom: 1px solid ${p.border}; text-align: right; font-variant-numeric: tabular-nums;">${r.timeout}</td>
            </tr>`,
    )
    .join("");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function methodologyHtml(digest: ParsedDigest, p: typeof lightPalette): string {
  if (digest.methodology.length === 0) return "";
  const items = digest.methodology
    .filter((l) => l.trim())
    .map((l) => `<li style="margin: 4px 0; color: ${p.muted}; font-size: 12px;">${escapeHtml(stripMarkdown(l.replace(/^-\s*/, "")))}</li>`)
    .join("");
  return `<ul style="padding-left: 18px; margin: 0;">${items}</ul>`;
}

// Convert a narrative markdown block into safe HTML — handles bullet lists, italic paragraphs, and plain
// paragraphs with inline ** / * / ` markup.
function narrativeHtml(text: string, p: typeof lightPalette): string {
  if (!text || !text.trim()) return "";
  const blocks = text.split(/\n\s*\n/);
  const parts: string[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^[-*]\s/m.test(trimmed) && trimmed.split("\n").every((l) => /^[-*]\s/.test(l.trim()) || !l.trim())) {
      const items = trimmed
        .split("\n")
        .filter((l) => /^[-*]\s/.test(l.trim()))
        .map((l) => `<li style="margin: 4px 0; color: ${p.fg}; font-size: 13px; line-height: 1.5;">${inlineMd(l.trim().replace(/^[-*]\s*/, ""))}</li>`)
        .join("");
      parts.push(`<ul style="padding-left: 18px; margin: 8px 0;">${items}</ul>`);
      continue;
    }
    const oneLine = trimmed.replace(/\n/g, " ");
    // Italic-only paragraph?
    if (/^\*[^*].*[^*]\*$/.test(oneLine)) {
      parts.push(
        `<p style="margin: 8px 0; color: ${p.muted}; font-size: 13px; line-height: 1.5; font-style: italic;">${inlineMd(oneLine.replace(/^\*|\*$/g, ""))}</p>`,
      );
      continue;
    }
    parts.push(`<p style="margin: 8px 0; color: ${p.fg}; font-size: 13px; line-height: 1.5;">${inlineMd(oneLine)}</p>`);
  }
  return parts.join("");
}

// Inline markdown: bold/italic/code → HTML. Escape first, then transform markers.
function inlineMd(s: string): string {
  const esc = escapeHtml(s);
  return esc
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, '<code style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;">$1</code>')
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\*(.+?)\*/g, "$1");
}

function extractSectionText(md: string, sectionNum: string): string {
  const re = new RegExp(`##\\s*${sectionNum}\\.[\\s\\S]*?(?=##\\s*\\d+\\.|$)`);
  const m = md.match(re);
  if (!m) return "";
  return m[0].replace(/^##[^\n]+\n/, "").trim();
}

function extractHeadlineNarrative(md: string): string {
  const m = md.match(/##\s*2\.[^\n]*\n([\s\S]*?)(?=###|##\s*\d+\.|$)/);
  return m ? m[1].trim() : "";
}

function extractSection8Bullets(md: string): string {
  const sec = md.match(/##\s*8\.[\s\S]*?(?=##\s*\d+\.|$)/);
  if (!sec) return "";
  const body = sec[0].replace(/^##[^\n]+\n/, "");
  return body.split(/###\s/)[0].trim();
}

// Footer with CTA per D9 — THE single accent application on the email surface (D2.b reservation).
// Black text on amber accent (9.7:1 AAA contrast).
// Null accountUrl → Astrant's own digest (no subscription); renders minimal caption footer instead.
function renderFooter(digest: ParsedDigest, p: typeof lightPalette): string {
  return digest.accountUrl
    ? `
    <tr>
      <td style="padding: 24px 0 0 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${p.card}; border: 1px solid ${p.border}; border-radius: 6px;">
          <tr>
            <td style="padding: 20px; text-align: center;">
              <div style="margin-bottom: 12px;">
                <a href="${escapeHtml(digest.accountUrl)}" style="display: inline-block; padding: 12px 24px; background: ${p.accent}; color: #000000; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">Manage subscription</a>
              </div>
              <div style="font-size: 12px; color: ${p.muted};">Cancel, reactivate, or view your subscription status anytime.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `
    : `
    <tr>
      <td style="padding: 24px 0 0 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${p.card}; border: 1px solid ${p.border}; border-radius: 6px;">
          <tr>
            <td style="padding: 16px; text-align: center;">
              <div style="font-size: 12px; color: ${p.muted};">Astrant Citation Digest · internal instrumentation report</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Workers / V8: btoa accepts binary string only.
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function formatMonth(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatMonthSlug(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
