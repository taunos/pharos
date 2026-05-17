// F3 §3.8 + F3.3 v3 + visual iteration round 1 (2026-05-16) — render digest Markdown → PDF via pdf-lib.
// LIGHT theme (operator print-friendliness ask absorbed at visual iteration round 1; F3.3 v3 D2.a
// PDF-dark assumption overridden — paper-tone backgrounds with dark text, accent reserved for CTA-equivalent
// callouts per globals.css:9-10 reservation; here no CTA on PDF so accent is absent from this surface).
//
// Header restructure (operator ask): logo + "Astrant" wordmark in a top lockup, "Citation Digest" title
// below, "brand · period" subtitle below that.
//
// Section rendering: real per-section content driven by ParsedDigest. Sections 3 + 8.b drawn as actual
// tables (pdf-lib lines); narrative sections (1/4/5/6/7/9) wrapped text. Page breaks auto-handled.

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import { parseDigest, type ParsedDigest } from "./digest-parser";
import { lightPalette } from "./brand-tokens";
import { decodeLogoBundle } from "./logo-bundle";

// pdf-lib StandardFonts use WinAnsi encoding (8-bit subset of Latin-1).
// Replace common Unicode chars that appear in digest markdown but break encoding.
// First customer-path digest fired 2026-05-16 via /api/internal/preview-digest crashed on ≥ (0x2265).
// WinAnsi (CP1252) covers em-dash/en-dash/smart-quotes/ellipsis/bullet/multiply natively, so we only
// substitute characters genuinely outside the encoding (≥ ≤ → ←). First customer-path digest fired
// 2026-05-16 crashed on ≥ (U+2265) which is outside CP1252.
function toWinAnsiSafe(s: string): string {
  return s
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/→/g, "->")
    .replace(/←/g, "<-");
}

// Strip basic markdown markers so narrative text reads cleanly in PDF without rendering bold/italic markup.
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^\*(.+?)\*$/gm, "$1")
    .replace(/\*(.+?)\*/g, "$1");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
  };
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const BOTTOM_RESERVE = 48; // footer + breathing room before page break

export async function renderDigestPdf(markdown: string, brand: string): Promise<Uint8Array> {
  const digest = parseDigest(markdown);
  const p = lightPalette;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const logoBytes = decodeLogoBundle();
  const logo = await pdfDoc.embedPng(logoBytes);

  const pages: PDFPage[] = [];
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  pages.push(page);

  const fillBg = (pg: PDFPage) => {
    const c = hexToRgb(p.bg);
    pg.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(c.r, c.g, c.b) });
  };
  fillBg(page);

  const fill = (pg: PDFPage, x: number, y: number, w: number, h: number, color: string) => {
    const c = hexToRgb(color);
    pg.drawRectangle({ x, y, width: w, height: h, color: rgb(c.r, c.g, c.b) });
  };
  const stroke = (pg: PDFPage, x1: number, y1: number, x2: number, y2: number, color: string, thickness = 0.5) => {
    const c = hexToRgb(color);
    pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color: rgb(c.r, c.g, c.b), thickness });
  };
  const drawText = (
    pg: PDFPage,
    s: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; italic?: boolean; color?: string } = {},
  ) => {
    const c = hexToRgb(opts.color ?? p.fg);
    const f = opts.bold ? fontBold : opts.italic ? fontItalic : font;
    pg.drawText(toWinAnsiSafe(s), {
      x,
      y,
      size: opts.size ?? 10,
      font: f,
      color: rgb(c.r, c.g, c.b),
    });
  };

  // ===== HEADER ON FIRST PAGE =====
  // Top lockup: logo + "Astrant" wordmark as TITLE (largest), Citation Digest subtitle, brand · period text.
  // Visual iteration round 2: established hierarchy title > subtitle > text.
  const logoTop = PAGE_H - 56;
  const logoSize = 36;
  const logoScale = logo.scale(logoSize / logo.width);
  page.drawImage(logo, { x: MARGIN_X, y: logoTop - logoScale.height + 4, width: logoScale.width, height: logoScale.height });
  drawText(page, "Astrant", MARGIN_X + logoScale.width + 4, logoTop - 24, { size: 28, bold: true });
  // Subtitle: Citation Digest
  drawText(page, "Citation Digest", MARGIN_X, logoTop - 58, { size: 16, bold: true });
  // Text: brand · period
  const subtitle = `${digest.headerMeta.brandName} · ${digest.headerMeta.period || ""}`;
  drawText(page, subtitle, MARGIN_X, logoTop - 76, { size: 11, color: p.muted });
  // Divider under header
  stroke(page, MARGIN_X, logoTop - 90, PAGE_W - MARGIN_X, logoTop - 90, p.border, 0.5);

  // ===== SUMMARY CARD =====
  const summaryTop = logoTop - 106;
  const summaryH = 84;
  fill(page, MARGIN_X, summaryTop - summaryH, CONTENT_W, summaryH, p.card);
  // Border (4 thin lines)
  stroke(page, MARGIN_X, summaryTop, MARGIN_X + CONTENT_W, summaryTop, p.border);
  stroke(page, MARGIN_X, summaryTop - summaryH, MARGIN_X + CONTENT_W, summaryTop - summaryH, p.border);
  stroke(page, MARGIN_X, summaryTop, MARGIN_X, summaryTop - summaryH, p.border);
  stroke(page, MARGIN_X + CONTENT_W, summaryTop, MARGIN_X + CONTENT_W, summaryTop - summaryH, p.border);

  const cellW = CONTENT_W / 4;
  const metricCells: Array<[string, string]> = [
    ["PERIOD", digest.headerMeta.period || "—"],
    ["CITE-SHARE", digest.summary.citeSharePct !== null ? `${digest.summary.citeSharePct}%` : "N/A"],
    ["TOTAL PROBES", String(digest.summary.totalProbes)],
    ["VALIDATED", String(digest.summary.validatedRows)],
  ];
  metricCells.forEach(([label, value], i) => {
    const cx = MARGIN_X + cellW * i + 16;
    drawText(page, label, cx, summaryTop - 22, { size: 8, color: p.muted, bold: true });
    const isPeriod = i === 0;
    drawText(page, value, cx, summaryTop - (isPeriod ? 44 : 50), { size: isPeriod ? 11 : 18, bold: true });
  });

  // ===== BODY (sections) =====
  // Cursor state — current page + y position.
  const cursor = { page, y: summaryTop - summaryH - 28 };

  const ensureSpace = (needed: number) => {
    if (cursor.y - needed < BOTTOM_RESERVE) {
      const np = pdfDoc.addPage([PAGE_W, PAGE_H]);
      pages.push(np);
      fillBg(np);
      cursor.page = np;
      cursor.y = PAGE_H - MARGIN_X;
    }
  };

  // Naive word-wrap: returns lines fitting in maxWidth at given font/size.
  const wrap = (text: string, maxWidth: number, size: number, f: PDFFont): string[] => {
    const safe = toWinAnsiSafe(text);
    const words = safe.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(trial, size) <= maxWidth) {
        cur = trial;
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  const writeParagraph = (
    text: string,
    opts: { size?: number; bold?: boolean; italic?: boolean; color?: string; indent?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    const lineHeight = size * 1.4;
    const indent = opts.indent ?? 0;
    const f = opts.bold ? fontBold : opts.italic ? fontItalic : font;
    const lines = wrap(text, CONTENT_W - indent, size, f);
    for (const line of lines) {
      ensureSpace(lineHeight);
      drawText(cursor.page, line, MARGIN_X + indent, cursor.y - size, {
        size,
        bold: opts.bold,
        italic: opts.italic,
        color: opts.color,
      });
      cursor.y -= lineHeight;
    }
  };

  const writeSectionHeading = (label: string) => {
    ensureSpace(34);
    cursor.y -= 8;
    drawText(cursor.page, label, MARGIN_X, cursor.y - 12, { size: 13, bold: true });
    cursor.y -= 18;
    stroke(cursor.page, MARGIN_X, cursor.y, MARGIN_X + CONTENT_W, cursor.y, p.border, 0.5);
    cursor.y -= 10;
  };

  const writeBlankLine = (h = 6) => {
    cursor.y -= h;
  };

  // Render a table with given column widths (sum should equal CONTENT_W). Right-align numeric cols by passing
  // alignment per column.
  const drawTable = (
    headers: string[],
    rows: string[][],
    colWidths: number[],
    aligns: Array<"left" | "right">,
  ) => {
    const headerH = 22;
    const rowH = 18;
    ensureSpace(headerH + rowH * rows.length + 10);

    // Header row
    const headerTop = cursor.y;
    fill(cursor.page, MARGIN_X, headerTop - headerH, CONTENT_W, headerH, p.card);
    stroke(cursor.page, MARGIN_X, headerTop, MARGIN_X + CONTENT_W, headerTop, p.border);
    stroke(cursor.page, MARGIN_X, headerTop - headerH, MARGIN_X + CONTENT_W, headerTop - headerH, p.border);
    let x = MARGIN_X;
    headers.forEach((h, i) => {
      const w = colWidths[i];
      const safe = toWinAnsiSafe(h);
      const tw = fontBold.widthOfTextAtSize(safe, 9);
      const tx = aligns[i] === "right" ? x + w - tw - 8 : x + 8;
      drawText(cursor.page, h, tx, headerTop - 14, { size: 9, bold: true, color: p.muted });
      x += w;
    });
    cursor.y = headerTop - headerH;

    // Data rows
    for (const row of rows) {
      ensureSpace(rowH);
      const rowTop = cursor.y;
      // Light row separator
      stroke(cursor.page, MARGIN_X, rowTop - rowH, MARGIN_X + CONTENT_W, rowTop - rowH, p.border, 0.25);
      let cx = MARGIN_X;
      row.forEach((cell, i) => {
        const w = colWidths[i];
        const safe = toWinAnsiSafe(cell);
        const tw = font.widthOfTextAtSize(safe, 9);
        const tx = aligns[i] === "right" ? cx + w - tw - 8 : cx + 8;
        drawText(cursor.page, cell, tx, rowTop - 12, { size: 9 });
        cx += w;
      });
      cursor.y -= rowH;
    }
    cursor.y -= 8;
  };

  // --- Section 1: warnings ---
  writeSectionHeading("1. Top-of-document warnings");
  const warningsText = extractSectionText(markdown, "1");
  renderNarrative(warningsText, writeParagraph);

  // --- Section 2: headline KPI (already in summary card; render axis breakdown if present) ---
  writeSectionHeading("2. Headline KPI");
  const headlineText = extractHeadlineNarrative(markdown);
  renderNarrative(headlineText, writeParagraph);

  // --- Section 3: per-provider table ---
  writeSectionHeading("3. Per-provider cite share");
  if (digest.perProvider.length > 0) {
    // Column widths: provider gets more, numeric cols compact. CONTENT_W = 516
    const widths = [120, 70, 50, 70, 56, 80, 70]; // sum=516
    const headers = ["Provider", "Observations", "Cited", "Cite share", "Errors", "Rate-limit", "Timeout"];
    const aligns: Array<"left" | "right"> = ["left", "right", "right", "right", "right", "right", "right"];
    const rows = digest.perProvider.map((r) => [
      r.provider,
      String(r.observations),
      String(r.cited),
      r.share,
      String(r.errors),
      String(r.rateLimit),
      String(r.timeout),
    ]);
    drawTable(headers, rows, widths, aligns);
  } else {
    writeParagraph("No provider rows extracted.", { italic: true, color: p.muted });
  }

  // --- Section 4: per-prompt (narrative passthrough; section 4 is table in source but parser returns bulleted list shape) ---
  writeSectionHeading("4. Per-prompt — prompts that produced cites");
  const perPromptText = extractSectionText(markdown, "4");
  renderNarrative(perPromptText, writeParagraph);

  // --- Section 5: vocab association ---
  writeSectionHeading("5. Vocabulary association (D2)");
  renderNarrative(digest.vocabAssociation, writeParagraph);

  // --- Section 6: competitive context ---
  writeSectionHeading("6. Competitive context (D3)");
  renderNarrative(digest.competitive, writeParagraph);

  // --- Section 7: trend ---
  writeSectionHeading("7. Trend (month-over-month)");
  renderNarrative(digest.trend, writeParagraph);

  // --- Section 8: operational health (bullets + sub-table) ---
  writeSectionHeading("8. Operational health");
  const opHealthText = extractSection8Bullets(markdown);
  renderNarrative(opHealthText, writeParagraph);
  writeBlankLine(8);
  drawText(cursor.page, "Per-provider error breakdown", MARGIN_X, cursor.y - 11, { size: 10, bold: true });
  cursor.y -= 18;
  if (digest.perProviderErrors.length > 0) {
    const widths = [200, 110, 110, 96]; // sum=516
    const headers = ["Provider", "Error", "Rate-limit", "Timeout"];
    const aligns: Array<"left" | "right"> = ["left", "right", "right", "right"];
    const rows = digest.perProviderErrors.map((r) => [
      r.provider,
      String(r.error),
      String(r.rateLimit),
      String(r.timeout),
    ]);
    drawTable(headers, rows, widths, aligns);
  } else {
    writeParagraph("No provider error breakdown rows extracted.", { italic: true, color: p.muted });
  }

  // --- Section 9: methodology footer ---
  writeSectionHeading("9. Methodology footer");
  for (const line of digest.methodology) {
    if (!line.trim()) continue;
    writeParagraph(line.replace(/^-\s*/, "• "), { size: 9, color: p.muted, indent: 8 });
  }

  // ===== FOOTER ON EVERY PAGE =====
  pages.forEach((pg, i) => {
    const pageNum = i + 1;
    drawText(pg, "Astrant Citation Digest", MARGIN_X, 24, { size: 9, color: p.muted });
    const pageLabel = `Page ${pageNum} of ${pages.length}`;
    const pageLabelW = font.widthOfTextAtSize(pageLabel, 9);
    drawText(pg, pageLabel, PAGE_W - MARGIN_X - pageLabelW, 24, { size: 9, color: p.muted });
  });

  return await pdfDoc.save();
}

// Section 1: returns raw narrative content (skips the heading line).
function extractSectionText(md: string, sectionNum: string): string {
  const re = new RegExp(`##\\s*${sectionNum}\\.[\\s\\S]*?(?=##\\s*\\d+\\.|$)`);
  const m = md.match(re);
  if (!m) return "";
  return m[0].replace(/^##[^\n]+\n/, "").trim();
}

// Section 2: headline line is interpolated above the "### By axis" subheading. We capture everything between
// "## 2." and (### By axis OR next ##) so the brand cite-share callout still shows in body even though it's
// also in the summary card chip.
function extractHeadlineNarrative(md: string): string {
  const m = md.match(/##\s*2\.[^\n]*\n([\s\S]*?)(?=###|##\s*\d+\.|$)/);
  return m ? m[1].trim() : "";
}

// Section 8 bullets: extract just the leading bullet narrative (before "### Per-provider error breakdown").
function extractSection8Bullets(md: string): string {
  const sec = md.match(/##\s*8\.[\s\S]*?(?=##\s*\d+\.|$)/);
  if (!sec) return "";
  const body = sec[0].replace(/^##[^\n]+\n/, "");
  const cut = body.split(/###\s/)[0];
  return cut.trim();
}

// Convert narrative markdown to bullet/paragraph calls. Italic-only paragraphs render italic.
function renderNarrative(
  text: string,
  writePara: (s: string, opts?: { size?: number; bold?: boolean; italic?: boolean; color?: string; indent?: number }) => void,
): void {
  if (!text || !text.trim()) return;
  const blocks = text.split(/\n\s*\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // Bullet list block?
    if (/^[-*]\s/.test(trimmed)) {
      const items = trimmed.split(/\n/).filter((l) => /^[-*]\s/.test(l.trim()));
      for (const item of items) {
        const body = stripMarkdown(item.trim().replace(/^[-*]\s*/, ""));
        writePara(`• ${body}`, { size: 10, indent: 8 });
      }
      continue;
    }
    // Italic-only block (entire block wrapped in *...*)?
    if (/^\*[^*].*[^*]\*$/.test(trimmed.replace(/\n/g, " "))) {
      writePara(stripMarkdown(trimmed.replace(/\n/g, " ")), { italic: true });
      continue;
    }
    // Default paragraph
    writePara(stripMarkdown(trimmed.replace(/\n/g, " ")));
  }
}
