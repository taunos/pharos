// Text hygiene for the paid Audit report.
//
// Threat model: the audited site is attacker-controllable. Anything the
// scanner copies from it (MCP card name, auth type, OpenAPI version strings,
// securityScheme names, content-type headers, discovered URLs, JSON parse
// error snippets) and anything an AI provider quotes from it (Perplexity
// searches the web) is hostile text. Site-derived text shown in the report
// (notes) is stripped of control, zero-width, bidi, tag and
// variation-selector characters so it can't reorder or hide report text.
// (Remediation engine v6 has no model: its text is fixed templates, see
// lib/remediation-templates.ts.)
//
// Character classes are numeric code-point ranges, not regex escapes, so no
// invisible character ever appears literally in this source file.

// [start, end] inclusive code-point ranges removed from any text we show or
// feed to a model.
const UNSAFE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008], // C0 controls (tab 0x09 / LF 0x0a / CR 0x0d handled as whitespace)
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f], // DEL + C1 controls
  [0x00ad, 0x00ad], // soft hyphen (invisible)
  [0x034f, 0x034f], // combining grapheme joiner
  [0x061c, 0x061c], // Arabic letter mark (bidi)
  [0x115f, 0x1160], // Hangul fillers (render blank)
  [0x17b4, 0x17b5],
  [0x180b, 0x180f], // Mongolian variation selectors / vowel separator
  [0x200b, 0x200f], // zero-width space/joiners, LRM, RLM
  [0x2028, 0x2029], // line / paragraph separator
  [0x202a, 0x202e], // bidi embeddings + overrides
  [0x2060, 0x206f], // word joiner, invisible operators, bidi isolates
  [0x3164, 0x3164], // Hangul filler
  [0xfe00, 0xfe0f], // variation selectors
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
  [0xffa0, 0xffa0],
  [0xfff0, 0xfffb], // specials incl. interlinear annotation
  [0x1d173, 0x1d17a], // musical invisible formatting
  [0xe0000, 0xe007f], // tag characters ("ASCII smuggling")
  [0xe0100, 0xe01ef], // variation selectors supplement
];

function isUnsafeCodePoint(cp: number): boolean {
  for (const [a, b] of UNSAFE_RANGES) {
    if (cp >= a && cp <= b) return true;
  }
  // Private-use planes: no legitimate use in a report.
  if (cp >= 0xe000 && cp <= 0xf8ff) return true;
  if (cp >= 0xf0000) return true;
  return false;
}

/**
 * NFKC-normalize (folds full-width / compatibility look-alikes), drop unsafe
 * code points, and turn tab/CR/LF into plain spaces. Does not collapse runs
 * of spaces; callers that want one paragraph use `collapseWhitespace`.
 */
export function stripUnsafeChars(input: string): string {
  const s = String(input ?? "").normalize("NFKC");
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) {
      out += " ";
      continue;
    }
    if (isUnsafeCodePoint(cp)) continue;
    out += ch;
  }
  return out;
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Cap on a word boundary. No ellipsis is appended (keeps wording stable). */
export function capLength(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd();
}

/** Display hygiene for site-derived text shown in the report. */
export const DISPLAY_TEXT_MAX = 1000;
export function cleanDisplayText(s: string, max = DISPLAY_TEXT_MAX): string {
  return capLength(collapseWhitespace(stripUnsafeChars(s)), max);
}

/** Max length of one remediation paragraph shown in the report. */
export const REMEDIATION_MAX_CHARS = 900;

/** Origin only (scheme + host + port). The path/query of the scan URL is customer-typed. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Re-escape unsafe code points inside an already-serialized JSON string as
 * \uXXXX sequences, so the raw JSON export in the report can't carry bidi /
 * zero-width characters either. Tab/LF/CR are left alone (JSON.stringify has
 * already escaped them inside strings; outside strings they are layout).
 */
const BACKSLASH = String.fromCharCode(92);

export function escapeUnsafeInJson(json: string): string {
  let out = "";
  for (const ch of json) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp !== 0x09 && cp !== 0x0a && cp !== 0x0d && isUnsafeCodePoint(cp)) {
      for (let i = 0; i < ch.length; i++) {
        out += BACKSLASH + "u" + ch.charCodeAt(i).toString(16).padStart(4, "0");
      }
    } else {
      out += ch;
    }
  }
  return out;
}
