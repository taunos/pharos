// LLM input/output hygiene for the paid Audit.
//
// Threat model: the audited site is attacker-controllable. Anything the
// scanner copies from it (MCP card name, auth type, OpenAPI version strings,
// securityScheme names, content-type headers, discovered URLs, JSON parse
// error snippets) and anything an AI provider quotes from it (Perplexity
// searches the web) is hostile text. Rules applied here:
//
//   1. The remediation model never sees raw site text. Scanner notes are
//      reduced to an allowlisted vocabulary (the scanner's own template
//      words + numbers); every other token becomes a fixed placeholder.
//   2. Model output is stripped of control, zero-width, bidi, tag and
//      variation-selector characters, collapsed to one paragraph and
//      length-capped.
//   3. Model output may only mention link targets on an allowlist (the
//      audited host + a few spec sites). Anything else rejects the output.
//   4. Site-derived text shown in the report (notes) gets the same
//      invisible-character strip so it can't reorder or hide report text.
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

/** Max length of one remediation paragraph after sanitizing. */
export const REMEDIATION_MAX_CHARS = 900;

export function sanitizeModelOutput(
  raw: string,
  max = REMEDIATION_MAX_CHARS
): string {
  return capLength(collapseWhitespace(stripUnsafeChars(raw)), max);
}

// ---------------------------------------------------------------------------
// Scanner notes → structured facts for the model
// ---------------------------------------------------------------------------

/** Placeholder the model sees in place of any site-provided value. */
export const SITE_VALUE_PLACEHOLDER = "[site value]";

// The scanner's own note-template vocabulary (extracted from
// scanner/src/checks/dim*.ts and lib/dim6 note templates), plus values the
// templates interpolate from ternaries. Imperative verbs were left out on
// purpose. A word not on this list is treated as site-provided.
const NOTE_VOCAB = new Set(
  (
    "a about accept acceptable q&a llms index across actually agent agents aggregaterating ai all an anchors and api " +
    "api-catalog apikey appear appears application archive are as at audit available avg avoided " +
    "b be bearer below best block blockquote body broken browser but by bytes cached call came cap card " +
    "case-studies case-study catalog cells check checked citation clean common competitor " +
    "competitor-first components composite contain content content-only content-type count customers " +
    "daily day declared declares default description detected did didn't diff dim dimension dimensions " +
    "directly discovery discovery-only dns doh document does doesn't domain dropped empty endpoint endpoints " +
    "entirely error evaluate exists explicitly failed failures fall falling false fetch field fields file " +
    "first footer-style for found free free-tier from full gets h half has have homepage host hosted html " +
    "http https in included info inputschema inside invalid is isn't it it's json json-ld l lcp least link linked " +
    "links list llm llms.txt m markdown markdown-ish markup match may mb mcp md measurable measured mention " +
    "metadata minimal missing modal modal-suggesting models ms n n/a name named negotiation network no " +
    "non-json none not oauth oauth-authorization-server object of offer older on one only open openapi " +
    "operation operations or organization other out overlap page pages paid paid-tier pair pair(s) parse " +
    "parsed parses partial-credit path paths patterns per period positioned present price prices pricing " +
    "pricing-link product provider q query question questions rated re-run reachability reached record " +
    "recognizable redirected redistributed relevant render rendered rendering required response returned " +
    "returns review root run s saas sameas sample sampled schema scheme scored search-result security " +
    "securityschemes server-card service signal site size skipped slice so spec specs static " +
    "static-vs-rendered status still structure sub-checks success-stories suffix summary swagger target " +
    "text text-based the this tier timed title to token tokens tools top-level transport transports true " +
    "txt type unmeasurable url urls valid validation variant version via visibility vs weight well-formed " +
    "well-known when wired with without yaml yaml-heuristic yes yet your zero " +
    // later additions: common template words + the interpolated values
    // that come from our own code (auth types we score, provider ids).
    "return strings auth oauth2 apikey doc b2b imply chars characters per-model averages average " +
    "openai anthropic google perplexity gemini claude gpt-4o sonar diy"
  ).split(" ")
);

// A token made only of digits and number punctuation: 7, 34/100, 1.20MB, 63%, <20.
const NUMERIC_TOKEN = /^[<>~]?[0-9][0-9.,]*(?:%|\/[0-9]+|mb|kb|ms|s|x)?$/i;
const SYMBOL_TOKENS = new Set(["✓", "✗", "→", "—", "–", "-", "+", "&", "/", "|"]);

function isAllowedWord(word: string): boolean {
  // "pair(s)" / "block(s)" — the peel step may leave "pair(s".
  const w = word.replace(/\(s\)?$/, "");
  if (w === "") return true;
  if (NUMERIC_TOKEN.test(w)) return true;
  if (SYMBOL_TOKENS.has(w)) return true;
  return NOTE_VOCAB.has(w.toLowerCase());
}

/**
 * Reduce a scanner note to a string built only from the scanner's template
 * vocabulary, numbers and `[site value]` placeholders. Quoted strings and
 * URLs are replaced whole. The result is safe to place in a model prompt.
 */
// NUL never survives stripUnsafeChars, so it is a safe in-band marker.
const SENTINEL = String.fromCharCode(0);

export function sanitizeNotesForModel(notes: string, max = 400): string {
  let s = collapseWhitespace(stripUnsafeChars(notes));
  // Whole-span replacements first: URLs and quoted values.
  const mark = ` ${SENTINEL} `;
  s = s.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, mark);
  // Single quotes only count as quoting when not inside a word, so the
  // scanner's own "isn't" / "didn't" survive.
  s = s.replace(/"[^"]*"|(?<![a-z])'[^']*'(?![a-z])|`[^`]*`|“[^”]*”|‘[^’]*’/gi, mark);
  // Any remaining quote char means an unbalanced quote: drop it (apostrophes
  // inside a word are kept and checked against the vocabulary).
  s = s.replace(/["`“”‘’]|(?<![a-z])'|'(?![a-z])/gi, " ");

  const out: string[] = [];
  for (const tok of s.split(" ")) {
    if (tok === "") continue;
    if (tok === SENTINEL) {
      out.push(SITE_VALUE_PLACEHOLDER);
      continue;
    }
    // Peel surrounding punctuation, keep it.
    const m = tok.match(/^([(\[]*)(.*?)([)\].,;:!?]*)$/) ?? ["", "", tok, ""];
    const [, pre, core, post] = m;
    // key=value / a/b / a:b compounds: every part must be allowed.
    const parts = core.split(/(=|:|,|\/(?![0-9]))/);
    let ok = parts.every((p) => p === "=" || p === ":" || p === "," || p === "/" || isAllowedWord(p));
    // Fixed scanner paths and dotted spec fields: /.well-known/mcp.json,
    // /llms.txt, tools/list, .md, components.securitySchemes.
    if (!ok && /^[a-z0-9._/-]+$/i.test(core) && /[/.]/.test(core)) {
      ok = core
        .split(/[/.]/)
        .every((p) => p === "" || isAllowedWord(p) || FILE_EXTENSIONS.has(p.toLowerCase()));
    }
    if (ok) {
      out.push(`${pre}${core}${post}`);
    } else {
      out.push(`${pre}${SITE_VALUE_PLACEHOLDER}${post}`);
    }
  }
  // Collapse runs of placeholders.
  const joined = out
    .join(" ")
    .replace(/(\[site value\][\s,;:=]*){2,}/g, `${SITE_VALUE_PLACEHOLDER} `)
    .replace(/([=(]) (\[site value\])/g, "$1$2")
    .replace(/(\[site value\]) ([,;:.)])/g, "$1$2")
    .split(SENTINEL)
    .join("");
  return capLength(collapseWhitespace(joined), max);
}

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

/** Safe single-line label (check names come from the scanner; still trim it). */
export function safeLabel(s: string, max = 80): string {
  return capLength(
    collapseWhitespace(stripUnsafeChars(s).replace(/[^A-Za-z0-9 /()+.,&'-]/g, " ")),
    max
  );
}

// ---------------------------------------------------------------------------
// Link allowlist for model output
// ---------------------------------------------------------------------------

/** Spec / reference sites a remediation may legitimately name. */
export const LINK_ALLOWLIST_HOSTS: ReadonlyArray<string> = [
  "schema.org",
  "llmstxt.org",
  "modelcontextprotocol.io",
  "openapis.org",
  "swagger.io",
];

// Dotted tokens that look like domains but are filenames or spec fields.
const FILE_EXTENSIONS = new Set([
  "txt", "json", "yaml", "yml", "md", "html", "htm", "xml", "js", "ts", "jsx", "tsx", "css",
  "csv", "pdf", "png", "jpg", "svg", "webp",
]);
const DOTTED_NON_HOSTS = new Set([
  "info.title", "info.version", "info.description", "components.securityschemes",
  "e.g", "i.e", "etc",
]);

function hostAllowed(host: string, auditedHost: string | null): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  const bare = (x: string) => x.replace(/^www\./, "");
  const allowed = [...LINK_ALLOWLIST_HOSTS];
  if (auditedHost) allowed.push(bare(auditedHost));
  return allowed.some((a) => bare(h) === a || h.endsWith(`.${a}`));
}

/**
 * Returns the first disallowed link-like thing in `text`, or null.
 * Disallowed: any non-http(s) scheme, javascript:/data: URIs, email
 * addresses, and any URL or bare domain whose host is not the audited host
 * or on LINK_ALLOWLIST_HOSTS.
 */
export function findDisallowedLink(
  text: string,
  auditedHost: string | null
): string | null {
  const t = text;
  const scheme = t.match(/\b(javascript|data|vbscript|file|blob)\s*:/i);
  if (scheme) return scheme[0];

  for (const m of t.matchAll(/\b([a-z][a-z0-9+.-]*):\/\/([^\s/?#)\]'"<>]+)/gi)) {
    const proto = m[1].toLowerCase();
    if (proto !== "http" && proto !== "https") return m[0];
    const host = m[2].replace(/^[^@]*@/, "").replace(/:\d+$/, "");
    if (!hostAllowed(host, auditedHost)) return m[0];
  }

  const email = t.match(/[^\s@<>()]+@[a-z0-9-]+(\.[a-z0-9-]+)+/i);
  if (email) return email[0];

  // Bare domains: label(.label)+ ending in an alphabetic TLD. Skip what we
  // already validated as part of a scheme URL, filenames and spec fields.
  const stripped = t.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ");
  for (const m of stripped.matchAll(
    /(?<![\w@./-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9])(?![\w-])/gi
  )) {
    const tok = m[1].toLowerCase();
    if (DOTTED_NON_HOSTS.has(tok)) continue;
    const last = tok.split(".").pop() ?? "";
    if (FILE_EXTENSIONS.has(last)) continue;
    if (/^\d+(\.\d+)+$/.test(tok)) continue; // version numbers like 3.1.0
    if (/^[0-9]+\.[a-z]+$/.test(tok)) continue; // "3.x"
    if (last.length < 2) continue;
    if (hostAllowed(tok, auditedHost)) continue;
    return m[1];
  }
  return null;
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
