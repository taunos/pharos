// Shared customer-email layout (Test C-B). Extracted from the citation-tracking
// digest shell (citation-tracking/src/digest-email.ts — document head, header
// card, section cards, amber CTA footer card). Pure and deterministic: same
// input, same bytes. The wordmark is a hosted absolute URL (Gmail blocks data:
// URIs). Card HTML is passed in pre-rendered — escape any dynamic text with
// escapeHtml before building it.

// Copied from citation-tracking/src/brand-tokens.ts `lightPalette`.
// SYNC WITH that file on brand changes.
export const EMAIL_PALETTE = {
  bg: "#fafaf7",
  card: "#ffffff",
  fg: "#18181b",
  muted: "#71717a",
  border: "#e4e4e7",
  accent: "#f59e0b",
} as const;

export const EMAIL_WORDMARK_URL = "https://astrant.io/brand/astrant-wordmark.png";

export interface EmailLayoutInput {
  preheader: string;
  heading: string;
  subheading?: string;
  cards: string[];
  cta?: { label: string; href: string; caption?: string };
  footerLines: string[];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const p = EMAIL_PALETTE;
  const subheading = input.subheading
    ? `\n        <p style="font-size: 13px; color: ${p.muted}; margin: 0;">${escapeHtml(input.subheading)}</p>`
    : "";
  const cards = input.cards
    .map(
      (body) => `
    <tr>
      <td style="padding-top: 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${p.card}; border: 1px solid ${p.border}; border-radius: 6px;">
          <tr>
            <td style="padding: 20px 24px; font-size: 14px; line-height: 1.6; color: ${p.fg};">
              ${body}
            </td>
          </tr>
        </table>
      </td>
    </tr>`,
    )
    .join("");
  const cta = input.cta
    ? `
    <tr>
      <td style="padding: 24px 0 0 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${p.card}; border: 1px solid ${p.border}; border-radius: 6px;">
          <tr>
            <td style="padding: 20px; text-align: center;">
              <div${input.cta.caption ? ` style="margin-bottom: 12px;"` : ""}>
                <a href="${escapeHtml(input.cta.href)}" style="display: inline-block; padding: 12px 24px; background: ${p.accent}; color: #000000; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">${escapeHtml(input.cta.label)}</a>
              </div>${
                input.cta.caption
                  ? `\n              <div style="font-size: 12px; color: ${p.muted};">${escapeHtml(input.cta.caption)}</div>`
                  : ""
              }
            </td>
          </tr>
        </table>
      </td>
    </tr>`
    : "";
  const footer = input.footerLines
    .map(
      (line) =>
        `<div style="font-size: 12px; color: ${p.muted}; line-height: 1.5;">${escapeHtml(line)}</div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${p.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: ${p.fg};">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: ${p.bg}; opacity: 0;">${escapeHtml(input.preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${p.bg};">
    <tr>
      <td style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 640px; margin: 0 auto;">
    <tr>
      <td style="padding: 28px; background: ${p.card}; border: 1px solid ${p.border}; border-radius: 6px;">
        <img src="${EMAIL_WORDMARK_URL}" alt="Astrant" width="150" height="44" border="0" style="display: block;" />
        <h1 style="font-size: 18px; color: ${p.fg}; margin: 12px 0 4px 0; letter-spacing: -0.01em; font-weight: 600;">${escapeHtml(input.heading)}</h1>${subheading}
      </td>
    </tr>${cards}${cta}
    <tr>
      <td style="padding: 24px 8px 0 8px; text-align: center;">
        ${footer}
      </td>
    </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
