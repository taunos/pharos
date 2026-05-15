// F3 D6.2: monthly digest email — HTML body + PDF attachment. Sent from the
// scheduled handler per-customer loop. Relocated from marketing-site per
// deploy-prompt v2 (cross-Worker imports impossible). See spec v3.2 §6.2.

import { Resend } from "resend";

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
  const htmlBody = markdownToBasicHtml(digestMarkdown);
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

// Basic Markdown → HTML: handles ##, ###, paragraphs, bold (**), italic (*), lists (-).
// Digest has predictable 9-section shape; hand-rolled is enough. Tables render as plain
// paragraph lines in v1.0 (PDF attachment carries the structured view).
function markdownToBasicHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inParagraph = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.length === 0) {
      if (inParagraph) { out.push("</p>"); inParagraph = false; }
      continue;
    }
    if (line.startsWith("## ")) {
      if (inParagraph) { out.push("</p>"); inParagraph = false; }
      out.push(`<h2>${escapeHtml(line.substring(3))}</h2>`);
      continue;
    }
    if (line.startsWith("### ")) {
      if (inParagraph) { out.push("</p>"); inParagraph = false; }
      out.push(`<h3>${escapeHtml(line.substring(4))}</h3>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (inParagraph) { out.push("</p>"); inParagraph = false; }
      out.push(`<li>${renderInline(line.substring(2))}</li>`);
      continue;
    }
    if (!inParagraph) { out.push("<p>"); inParagraph = true; }
    out.push(renderInline(line));
  }
  if (inParagraph) out.push("</p>");
  return `<!DOCTYPE html><html><body style="font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 0 auto;">${out.join("\n")}</body></html>`;
}

function renderInline(s: string): string {
  // Escape first, then apply emphasis. Conservative — avoids HTML injection from interpolated brand_name.
  let h = escapeHtml(s);
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return h;
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
