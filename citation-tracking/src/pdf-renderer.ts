// F3 §3.8: render digest Markdown → PDF via pdf-lib. Hand-laid layout
// (no auto-flow); digest has predictable 9-section shape from B1.1.
// See spec v3.2 §1 + §6.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// pdf-lib StandardFonts use WinAnsi encoding (8-bit subset of Latin-1).
// Replace common Unicode chars that appear in digest markdown but break encoding.
// First customer-path digest fired 2026-05-16 via /api/internal/preview-digest crashed on ≥ (0x2265).
function toWinAnsiSafe(s: string): string {
  return s
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/—/g, "--")
    .replace(/–/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/×/g, "x")
    .replace(/•/g, "*");
}

export async function renderDigestPdf(markdown: string, brand: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([612, 792]); // US Letter, points
  const margin = 50;
  let y = page.getHeight() - margin;

  // Header.
  page.drawText("Astrant Citation Digest", { x: margin, y, size: 18, font: fontBold });
  y -= 28;
  page.drawText(brand, { x: margin, y, size: 14, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 28;

  // Body: render markdown line-by-line. v1.0 truncates long lines; v1.1+ wraps.
  for (const rawLine of markdown.split("\n")) {
    const line = toWinAnsiSafe(rawLine);
    if (y < margin + 20) {
      page = pdfDoc.addPage([612, 792]);
      y = page.getHeight() - margin;
    }
    if (line.startsWith("## ")) {
      page.drawText(line.replace(/^## /, ""), { x: margin, y, size: 12, font: fontBold });
      y -= 16;
    } else if (line.startsWith("### ")) {
      page.drawText(line.replace(/^### /, ""), { x: margin, y, size: 11, font: fontBold });
      y -= 14;
    } else if (line.length === 0) {
      y -= 8;
    } else {
      const truncated = line.length > 90 ? line.substring(0, 87) + "..." : line;
      page.drawText(truncated, { x: margin, y, size: 10, font });
      y -= 12;
    }
  }

  return await pdfDoc.save();
}
