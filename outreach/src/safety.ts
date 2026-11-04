// Hostile-input controls (Bruno, 2026-11-04: "treat every outside input as hostile").
// Pure functions shared by research (SSRF), fact building, rendering, and the
// final gate every mailbox draft passes through (checkOutboundDraft).

// ── hosts and URLs (SSRF, allowlists) ─────────────────────────────────────

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** Strict ASCII hostname: ≥2 labels, alphabetic TLD. No IDN/punycode (homoglyph risk), no IP literals. */
export const HOSTNAME_RE = new RegExp(`^(?:${LABEL}\\.)+[a-z]{2,63}$`);

const BLOCKED_SUFFIXES = [
  "localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "private",
  "test", "example", "invalid", "onion", "arpa", "home.arpa", "in-addr.arpa", "ip6.arpa",
];

export function isPublicHostname(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 253) return false;
  const h = raw.toLowerCase();
  if (h !== raw) return false; // stored domains are already lowercase; anything else is suspicious
  if (!HOSTNAME_RE.test(h)) return false;
  if (h.split(".").some((l) => l.startsWith("xn--"))) return false;
  for (const s of BLOCKED_SUFFIXES) if (h === s || h.endsWith("." + s)) return false;
  return true;
}

/** Public https URL on port 443 with no credentials, or null. */
export function safeHttpsUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port !== "" && u.port !== "443") return null;
  if (!isPublicHostname(u.hostname)) return null;
  return u;
}

export function sameSite(host: string, domain: string): boolean {
  return host === domain || host === "www." + domain;
}

// Hosts a draft may link to (with a scheme). The lead's own domain may appear
// only bare (e.g. "example.com/llms.txt"), never as a link.
export const LINK_HOSTS = new Set(["astrant.io", "www.astrant.io", "go.getastrant.com"]);
export const ASTRANT_HOSTS = new Set(["astrant.io", "www.astrant.io"]);

/** True for an https URL on astrant.io (Score, privacy, benchmark links). */
export function isAstrantUrl(raw: unknown): boolean {
  const u = safeHttpsUrl(raw);
  return !!u && ASTRANT_HOSTS.has(u.hostname);
}

// ── characters ────────────────────────────────────────────────────────────

// C0/C1 controls except LF; DEL; soft hyphen; Arabic letter mark; Hangul fillers;
// Mongolian vowel separator; zero-width and bidi controls; line/paragraph
// separators; word joiners and invisible operators; variation selectors; BOM;
// interlinear annotation and object-replacement characters; tag characters.
// Built at runtime from code points: no literal invisible characters and no
// escape sequences in source (they get silently materialized by tooling).
const UNSAFE_RANGES: [number, number][] = [
  [0x0000, 0x0009], [0x000b, 0x001f], [0x007f, 0x009f], [0x00ad, 0x00ad], [0x034f, 0x034f],
  [0x061c, 0x061c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180e, 0x180e], [0x200b, 0x200f],
  [0x202a, 0x202e], [0x2028, 0x2029], [0x2060, 0x206f], [0x3164, 0x3164], [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xfffc], [0xe0000, 0xe007f],
];
export const UNSAFE_CODEPOINTS = UNSAFE_RANGES;
const UNSAFE_CHARS_RE = new RegExp(
  "[" + UNSAFE_RANGES.map(([lo, hi]) => String.fromCodePoint(lo) + "-" + String.fromCodePoint(hi)).join("") + "]",
  "u"
);

export function hasUnsafeChars(s: string): boolean {
  return UNSAFE_CHARS_RE.test(s);
}

const CONFUSABLE_SCRIPTS_RE = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Cherokee}\p{Script=Coptic}]/u;
const LATIN_RE = /\p{Script=Latin}/u;

/** A word mixing Latin with a look-alike script (e.g. Cyrillic "а" in "pаypal"). */
export function hasMixedScriptWord(s: string): boolean {
  return s.split(/\s+/).some((w) => LATIN_RE.test(w) && CONFUSABLE_SCRIPTS_RE.test(w));
}

export function hasHtml(s: string): boolean {
  return /<\s*\/?\s*[a-z!?]/i.test(s) || /&(#\d+|#x[0-9a-f]+|[a-z]{2,8});/i.test(s);
}

export function hasMarkdown(s: string): boolean {
  return /\*\*|__|\]\(|`|^\s*#{1,6}\s|^\s*[-*>]\s/m.test(s);
}

// ── draft gate ────────────────────────────────────────────────────────────

export const MAX_SUBJECT = 120; // after "Re: " for follow-ups
export const MAX_BODY = 4000;
export const MAX_POSTAL = 300;
const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@([a-z0-9.-]{1,253})$/;

// Anything with "scheme://", plus schemes that work without slashes.
const SCHEME_SRC = String.raw`\b(?:[a-z][a-z0-9+.-]{1,20}:\/\/|(?:mailto|javascript|data|vbscript|file|tel|sms|blob):(?=[^\s]))[^\s<>"']*`;
const SCHEME_RE = new RegExp(SCHEME_SRC, "gi");
const SCHEME_TEST_RE = new RegExp(SCHEME_SRC, "i");
const DOMAIN_LIKE_RE = /(?<![A-Za-z0-9-])(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![A-Za-z0-9-])/g;
const BARE_ALLOWED = new Set(["llms.txt"]);

export type DraftCheck = { ok: true } | { ok: false; reason: string };

/**
 * Final gate before ANY outreach draft reaches the mailbox. Every slot is
 * checked, then the assembled text:
 *  - recipient: strict ASCII email on the lead's own domain, no CR/LF;
 *  - subject: single line, no unsafe/zero-width/bidi chars, no HTML, capped;
 *  - body (postal line excluded, checked on its own): no unsafe chars, no HTML,
 *    no markdown, no mixed-script words, every scheme URL is https on an
 *    allowlisted host (go.getastrant.com only as /u/<token>), every bare domain
 *    is the lead's own or astrant.io;
 *  - postal address (operator secret): single line, no unsafe chars, no HTML, no URL.
 */
export function checkOutboundDraft(d: { to: string; subject: string; text: string; domain: string; postal: string; optoutUrl: string }): DraftCheck {
  if (!isPublicHostname(d.domain)) return { ok: false, reason: "domain" };
  const m = EMAIL_RE.exec(d.to);
  if (!m || d.to.length > 254 || m[1] !== d.domain) return { ok: false, reason: "recipient" };
  if (!d.subject || d.subject.length > MAX_SUBJECT || /[\r\n]/.test(d.subject) || hasUnsafeChars(d.subject) || hasHtml(d.subject) || hasMixedScriptWord(d.subject)) {
    return { ok: false, reason: "subject" };
  }
  const postal = d.postal.trim();
  if (!postal || postal.length > MAX_POSTAL || /[\r\n]/.test(postal) || hasUnsafeChars(postal) || hasHtml(postal) || SCHEME_TEST_RE.test(postal)) {
    return { ok: false, reason: "postal" };
  }
  if (d.text.length > MAX_BODY) return { ok: false, reason: "body_length" };
  const lines = d.text.split("\n");
  const postalIdx = lines.findIndex((l) => l === postal);
  if (postalIdx < 0) return { ok: false, reason: "postal_missing" };
  const rest = lines.filter((_, i) => i !== postalIdx).join("\n");
  if (hasUnsafeChars(rest)) return { ok: false, reason: "unsafe_chars" };
  if (hasHtml(rest)) return { ok: false, reason: "html" };
  // URLs are removed first: a base64url opt-out token can legitimately contain "__" or "-".
  // URLs themselves are checked against the allowlist below.
  const prose = rest.replace(SCHEME_RE, " ");
  if (hasMarkdown(prose.split("\n").filter((l) => l !== "--").join("\n"))) return { ok: false, reason: "markdown" };
  if (hasMixedScriptWord(rest)) return { ok: false, reason: "mixed_script" };
  if (!rest.includes(d.optoutUrl)) return { ok: false, reason: "optout_missing" };
  for (const mm of rest.matchAll(SCHEME_RE)) {
    const tok = mm[0].replace(/[.,;:!?)]+$/, "");
    const u = safeHttpsUrl(tok);
    if (!u || !LINK_HOSTS.has(u.hostname)) return { ok: false, reason: `url:${tok.slice(0, 60)}` };
    if (u.hostname === "go.getastrant.com" && !/^\/u\/[A-Za-z0-9_-]{1,200}$/.test(u.pathname)) return { ok: false, reason: "url:optout_path" };
  }
  const withoutUrls = rest.replace(SCHEME_RE, " ");
  for (const mm of withoutUrls.matchAll(DOMAIN_LIKE_RE)) {
    const tok = mm[0].toLowerCase();
    if (tok === d.domain || tok === "www." + d.domain || ASTRANT_HOSTS.has(tok) || BARE_ALLOWED.has(tok)) continue;
    return { ok: false, reason: `domain_token:${tok.slice(0, 60)}` };
  }
  return { ok: true };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
