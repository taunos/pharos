// citation-tracking/src/digest-parser.ts
// D11 LOCKED at F3.3 v3 — shared markdown parser for HTML email + PDF render paths.
// Both renderers consume this ParsedDigest struct; avoids drift between email + PDF rendering layers.
//
// Calibration source: digest-template.ts (canonical markdown generator), NOT PDF-extracted samples.
// PDF text extraction silently converts em-dash (U+2014) → double-hyphen, drops italic markers,
// flattens pipe-table cells. Parser regex MUST be calibrated against the markdown source.
//
// Reference shape from digest-template.ts (line numbers approximate):
//
//   # Citation-Tracking Digest — April 2026 (full month, 30 days)        // line 121 — em-dash separator
//
//   *Internal instrumentation report. Baseline measurement phase — ...
//
//   ## 1. Top-of-document warnings                                        // line 133
//   *No warnings this period.*
//
//   ## 2. Headline KPI                                                    // line 154
//   *Astrant cite-share this month: 0%. Baseline phase — ...*             // line 14 (zero baseline)
//   ${brand} cite-share this month: 0.5%                                  // line 29 (non-zero)
//
//   ## 3. Per-provider cite share                                         // line 174
//   | Provider | Observations | Cited | Cite share | Errors | Rate-limit | Timeout |
//   |---|---:|---:|---:|---:|---:|---:|
//   | openai | N | M | P% | ... |
//
//   ## 8. Operational health                                              // line 243
//   - Total probe rows ingested this period: **N**                        // line 245
//   - Validated rows (status=success): **N**                              // line 246
//   - Partial-coverage rows: **N** (P%)                                   // line 247
//
//   ## 9. Methodology footer                                              // line 258
//   - Engine version: `citation-tracking:vX.Y`
//   - Period: YYYY-MM-DD through YYYY-MM-DD (UTC, half-open interval)    // line 262 — primary period source

export type ParsedDigest = {
  headerMeta: { brandName: string; period: string; isPartial: boolean };
  // Summary surfaces what digest-template.ts actually emits (section-8 prose):
  //   totalProbes ← "Total probe rows ingested this period: **N**"
  //   validatedRows ← "Validated rows (status=success): **N**"
  // "Cites" doesn't appear as a section-level aggregate metric; only per-provider in section 3 table.
  summary: { citeSharePct: number | null; totalProbes: number; validatedRows: number };
  // F3.2 caller-side appends footer: "Manage your subscription anytime: <url>" before passing markdown
  // to render layer (citation-tracking/src/index.ts:97-100). Parser extracts here; renderers interpolate.
  // Null for Astrant's own digest (no subscription row) — renderer skips CTA footer for null.
  accountUrl: string | null;
  perProvider: Array<{
    provider: string;
    observations: number;
    cited: number;
    share: string;
    errors: number;
    rateLimit: number;
    timeout: number;
  }>;
  perPromptCites: string[];
  vocabAssociation: string;
  competitive: string;
  trend: string;
  operationalHealth: string;
  perProviderErrors: Array<{ provider: string; error: number; rateLimit: number; timeout: number }>;
  methodology: string[];
};

export function parseDigest(markdown: string): ParsedDigest {
  return {
    headerMeta: {
      brandName: extractBrandName(markdown),
      period: extractPeriod(markdown),
      isPartial: detectPartial(markdown),
    },
    summary: extractSummary(markdown),
    accountUrl: extractAccountUrl(markdown),
    perProvider: extractPerProvider(markdown),
    perPromptCites: extractPerPromptCites(markdown),
    vocabAssociation: extractSection(markdown, "5"),
    competitive: extractSection(markdown, "6"),
    trend: extractSection(markdown, "7"),
    operationalHealth: extractSection(markdown, "8"),
    perProviderErrors: extractPerProviderErrors(markdown),
    methodology: extractMethodology(markdown),
  };
}

// Section 2 templates differ by case:
//   line 14: "*${brand} cite-share this month: 0%..." (italicized zero-baseline)
//   line 29: "${brand} cite-share this month: 0.5%" (non-italicized non-zero)
// Optional leading asterisk handles both. Single-word brand only for v1.0; multi-word brands
// (e.g. "Acme Corp", "X & Y Inc") would fall through to fallback — flagged as v1.1+ improvement.
function extractBrandName(md: string): string {
  const m = md.match(/##\s*2\.[\s\S]*?\*?([A-Z][a-zA-Z0-9]+)\s+cite-share/i);
  if (m) return m[1];
  const fallback = md.slice(0, 500).match(/\*?\s*([A-Z][a-zA-Z0-9]+)\s+cite-share/);
  return fallback ? fallback[1] : "Astrant";
}

// Primary source: section 9's machine-parseable date strings (digest-template.ts:262).
// Format: "- Period: YYYY-MM-DD through YYYY-MM-DD (UTC, half-open interval)"
// The end date is period_end-1 (inclusive last day), so day count = (end - start) + 1.
//
// H1 fallback (digest-template.ts:121) uses em-dash separator (U+2014); regex tolerates both
// em-dash and ASCII hyphen for resilience against PDF-extracted reference data.
function extractPeriod(md: string): string {
  const periodLine = md.match(/^- Period:\s+(\d{4}-\d{2}-\d{2})\s+through\s+(\d{4}-\d{2}-\d{2})/m);
  if (periodLine) {
    const [, startISO, endISO] = periodLine;
    const start = new Date(startISO + "T00:00:00Z");
    const end = new Date(endISO + "T00:00:00Z");
    const monthYear = start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    // +1 because end is the inclusive last day (period_end - 1); the period spans start through end inclusive.
    const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    return `${monthYear} (${days} days)`;
  }
  const h1 = md.match(/^#\s+[^\n]*?[—\-]+\s+([^\n]+)/m);
  if (h1) return h1[1].trim();
  const legacy = md.match(/period[:\s]+([^\n]+)/i);
  return legacy ? legacy[1].trim() : "";
}

function detectPartial(md: string): boolean {
  return /partial|first[- ]month\s+digest/i.test(md.slice(0, 600));
}

function extractSummary(md: string): {
  citeSharePct: number | null;
  totalProbes: number;
  validatedRows: number;
} {
  const sharePct = md.match(/cite-share[^:\n]*:\s*(\d+(?:\.\d+)?)\s*%/i);
  const totalProbes = md.match(/Total probe rows ingested this period:\s*\*\*(\d+)\*\*/);
  const validatedRows = md.match(/Validated rows[^:]*:\s*\*\*(\d+)\*\*/);
  return {
    citeSharePct: sharePct ? parseFloat(sharePct[1]) : null,
    totalProbes: totalProbes ? parseInt(totalProbes[1], 10) : 0,
    validatedRows: validatedRows ? parseInt(validatedRows[1], 10) : 0,
  };
}

function extractAccountUrl(md: string): string | null {
  const m = md.match(/Manage your subscription anytime:\s*(\S+)/);
  return m ? m[1] : null;
}

// Section 3 pipe-table per digest-template.ts:179:
//   | provider | observations | cited | cite_share% | errors | rate_limit | timeout |
// Header row + separator row precede data rows. Data row regex matches 7-column table.
function extractPerProvider(md: string): ParsedDigest["perProvider"] {
  const section = extractSectionRaw(md, "3");
  if (!section) return [];
  const rows: ParsedDigest["perProvider"] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    // Skip header, separator, non-data rows
    if (!trimmed.startsWith("|")) continue;
    if (trimmed.includes("---")) continue;
    if (trimmed.toLowerCase().includes("provider |") && trimmed.toLowerCase().includes("observations")) continue;
    const cells = trimmed.split("|").map((c) => c.trim()).filter((c, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length !== 7) continue;
    rows.push({
      provider: cells[0],
      observations: parseInt(cells[1], 10) || 0,
      cited: parseInt(cells[2], 10) || 0,
      share: cells[3],
      errors: parseInt(cells[4], 10) || 0,
      rateLimit: parseInt(cells[5], 10) || 0,
      timeout: parseInt(cells[6], 10) || 0,
    });
  }
  return rows;
}

function extractPerPromptCites(md: string): string[] {
  const sectionMatch = md.match(/##\s*4\.[\s\S]*?(?=##\s*5\.|$)/);
  if (!sectionMatch) return [];
  return sectionMatch[0]
    .split("\n")
    .filter((line) => line.trim().startsWith("- "))
    .map((line) => line.replace(/^-\s*/, "").trim());
}

function extractSection(md: string, sectionNum: string): string {
  const re = new RegExp(`##\\s*${sectionNum}\\.[\\s\\S]*?(?=##\\s*\\d+\\.|$)`);
  const m = md.match(re);
  return m ? m[0].replace(/^##[^\n]+\n/, "").trim() : "";
}

// Section 8 sub-table per digest-template.ts:254:
//   | provider | error | rate_limit | timeout |
function extractPerProviderErrors(md: string): ParsedDigest["perProviderErrors"] {
  const section = extractSectionRaw(md, "8");
  if (!section) return [];
  const rows: ParsedDigest["perProviderErrors"] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (trimmed.includes("---")) continue;
    if (trimmed.toLowerCase().includes("provider |") && trimmed.toLowerCase().includes("error")) continue;
    const cells = trimmed.split("|").map((c) => c.trim()).filter((c, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length !== 4) continue;
    rows.push({
      provider: cells[0],
      error: parseInt(cells[1], 10) || 0,
      rateLimit: parseInt(cells[2], 10) || 0,
      timeout: parseInt(cells[3], 10) || 0,
    });
  }
  return rows;
}

// Raw section extraction (includes header line; for table-scanning consumers).
function extractSectionRaw(md: string, sectionNum: string): string {
  const re = new RegExp(`##\\s*${sectionNum}\\.[\\s\\S]*?(?=##\\s*\\d+\\.|$)`);
  const m = md.match(re);
  return m ? m[0] : "";
}

function extractMethodology(md: string): string[] {
  const section = extractSection(md, "9");
  // Stop at the `---` horizontal-rule which marks the F3.2 appended account-link footer
  // (digest-template.ts ends section 9 with bullet lines; index.ts:219 appends "---\n\nManage..." footer).
  const truncated = section.split(/\n---+\n/)[0];
  return truncated
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.trim());
}
