// §7.3 validator: pure function, runs on every draft (model or template).
import { APPROVED_NON_TABLE_COPY, OPENER_VARIANTS, SUBJECT_VARIANTS, fill } from "./copy";
import { ALL_ANCHORS, type FactSheet } from "./facts";

export type DraftFields = { subject: string; opener: string; finding_1: string; finding_2: string };
export type ValidationResult = { ok: true; fields: DraftFields } | { ok: false; failures: string[] };

const KEYS = ["subject", "opener", "finding_1", "finding_2"] as const;
const LIMITS: Record<(typeof KEYS)[number], number> = { subject: 60, opener: 200, finding_1: 240, finding_2: 240 };
export const MAX_BODY_WORDS = 120;

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Case-insensitive word-boundary phrase regex (boundaries that also work for "#1"-style tokens). */
function phraseRe(p: string, flags = "i"): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${esc(p).replace(/\s+/g, "\\s+")}(?![A-Za-z0-9])`, flags);
}

const MARKDOWN_CHARS = ["*", "#", "`", "_", "|", "[", "]", "<", ">", "~"];
const PREAMBLE_START = ["sure", "here is", "here's", "certainly", "as an ai", "subject:", "dear", "i hope this", "as requested", "okay"];
const META_ANYWHERE = ["as an ai", "language model", "i cannot"];
const PLACEHOLDER_CHARS = ["{", "}", "[", "]", "<", ">"];
const PLACEHOLDER_WORDS = ["lorem", "xxx", "tbd", "your name", "company name", "insert", "n/a"];
export const ENTITY_DENYLIST = [
  "ChatGPT", "GPT", "Perplexity", "Gemini", "Claude", "Google", "Copilot", "Bing", "OpenAI",
  "Anthropic", "Microsoft", "Meta", "Llama", "Mistral", "Grok", "xAI", "DeepSeek", "Bard",
  "SearchGPT", "Semrush", "Ahrefs", "Moz", "HubSpot", "Profound", "Otterly", "Athena", "Scrunch",
];
const BANNED_CLAIMS = [
  "invisible", "can't find", "cannot find", "can not find", "losing", "lose customers", "guarantee",
  "rank", "ranking", "cited", "citation", "traffic", "revenue", "competitor", "best", "#1", "only",
  "urgent", "act now", "free trial", "discount",
];
export const D17_HONESTY = [
  "scan", "scans", "scanning", "scanner", "scanned", "automated", "automatically", "tool ran", "I spent", "spent some time",
  "I personally", "personally reviewed", "I reviewed", "I looked", "I took a look", "I noticed",
  "I came across", "I was browsing", "been following", "fan of", "love your", "impressed", "congrats",
  "saw your", "read your",
  // Codex review #1: every form of "notice", and browsing/looking-at claims.
  "notice", "noticed", "noticing", "notices", "browse", "browsed", "browsing", "while looking", "looking at", "looked at",
  "came across", "stumbled",
];
// Filenames that look domain-like but are anchors, not domains.
const DOMAINLIKE_ALLOW = new Set(["llms.txt"]);

const NUM_RE = /\d+(?:[.,]\d+)*/g;
export function numbersIn(text: string): string[] {
  return (text.match(NUM_RE) ?? []).map((n) => n.replace(/,/g, ""));
}

/**
 * Derived from approved code-owned copy at module load, never typed by hand.
 * Copy-table sentences are excluded on purpose: their numbers (404, the 1 in
 * "H1") reach the allow-list only through the assigned gap's `numbers`, so a
 * model can't borrow a number from a gap this lead doesn't have.
 */
export const APPROVED_NUMBER_WHITELIST: ReadonlySet<string> = new Set(
  APPROVED_NON_TABLE_COPY.flatMap((s) => numbersIn(s.replace(/\{[a-z_]+\}/g, " ")))
);

const DOMAIN_LIKE_RE = /(?<![A-Za-z0-9-])(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![A-Za-z0-9-])/g;

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Parses the model's raw output and validates it. `bodyWords` = rendered body (excl. footer) word count fn. */
export function validateRaw(raw: unknown, sheet: FactSheet, bodyWordsOf: (f: DraftFields) => number): ValidationResult {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ok: false, failures: ["shape:not_json"] };
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, failures: ["shape:not_object"] };
  const keys = Object.keys(obj).sort();
  if (keys.join(",") !== [...KEYS].sort().join(",")) return { ok: false, failures: ["shape:keys"] };
  for (const k of KEYS) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v !== "string" || v.trim() === "") return { ok: false, failures: [`shape:${k}_empty`] };
  }
  return validateFields(obj as DraftFields, sheet, bodyWordsOf);
}

export function validateFields(f: DraftFields, sheet: FactSheet, bodyWordsOf: (f: DraftFields) => number): ValidationResult {
  const failures: string[] = [];
  const fail = (r: string) => failures.push(r);
  const domain = sheet.domain.toLowerCase();

  for (const k of KEYS) {
    const v = f[k];
    if (typeof v !== "string" || v.trim() === "") {
      fail(`shape:${k}_empty`);
      continue;
    }
    if (/[\r\n]/.test(v)) fail(`shape:${k}_newline`);
    if (v.length > LIMITS[k]) fail(`length:${k}`);

    // Markdown artifacts
    if (MARKDOWN_CHARS.some((c) => v.includes(c)) || v.includes("**") || v.includes("](")) fail(`markdown:${k}`);
    if (/^\s*[-•>]/.test(v)) fail(`markdown:${k}_line_start`);

    // Preamble / meta
    const start = v.trimStart().toLowerCase();
    for (const p of PREAMBLE_START) {
      if (start.startsWith(p) && !/[a-z0-9]/i.test(start.charAt(p.length) || " ")) fail(`preamble:${k}:${p}`);
    }
    for (const p of META_ANYWHERE) if (phraseRe(p).test(v)) fail(`meta:${k}:${p}`);

    // Placeholders
    if (PLACEHOLDER_CHARS.some((c) => v.includes(c))) fail(`placeholder:${k}`);
    for (const p of PLACEHOLDER_WORDS) if (phraseRe(p).test(v)) fail(`placeholder:${k}:${p}`);

    // Text with the lead's own domain removed (its digits/labels are not claims).
    const stripped = v.replace(new RegExp(esc(domain), "gi"), " ");

    // Grounding: numbers
    const allowedNums = new Set<string>([
      String(sheet.score),
      ...sheet.gaps.flatMap((g) => g.numbers.map(String)),
      ...APPROVED_NUMBER_WHITELIST,
    ]);
    for (const n of numbersIn(stripped)) if (!allowedNums.has(n)) fail(`grounding:number:${k}:${n}`);

    // Grounding: entities
    if (/https?:\/\/|www\.|:\/\//i.test(v)) fail(`grounding:url:${k}`);
    for (const m of v.matchAll(DOMAIN_LIKE_RE)) {
      const tok = m[0].toLowerCase();
      if (tok === domain || tok.endsWith("." + domain) || DOMAINLIKE_ALLOW.has(tok)) continue;
      fail(`grounding:domain:${k}:${tok}`);
    }
    for (const e of ENTITY_DENYLIST) if (phraseRe(e).test(stripped)) fail(`grounding:entity:${k}:${e}`);

    // Banned claims
    for (const b of BANNED_CLAIMS) if (phraseRe(b).test(stripped)) fail(`banned:${k}:${b}`);
    if (v.includes("%")) fail(`banned:${k}:%`);

    // D17 personal-voice honesty
    for (const p of D17_HONESTY) if (phraseRe(p).test(stripped)) fail(`d17:${k}:${p}`);

    // Anchors of gaps that are not in this fact sheet
    const sheetAnchors = new Set(sheet.gaps.map((g) => g.anchor.toLowerCase()));
    for (const a of ALL_ANCHORS) {
      if (!sheetAnchors.has(a.toLowerCase()) && phraseRe(a).test(stripped)) fail(`grounding:foreign_anchor:${k}:${a}`);
    }
  }

  // Fact grounding (Codex review #1). Phrase rules can't prove truth, so the
  // claims are pinned to approved text: each finding must be its gap's approved
  // sentence verbatim (filled from scan data only), and the subject and opener
  // must be approved variants filled with the lead's domain. Nothing free-written
  // can reach a draft.
  if (sheet.gaps[0] && f.finding_1 !== sheet.gaps[0].canonical) fail("grounding:finding_1_not_verbatim");
  if (sheet.gaps[1] && f.finding_2 !== sheet.gaps[1].canonical) fail("grounding:finding_2_not_verbatim");
  const subjects = SUBJECT_VARIANTS.map((t) => fill(t, { domain: sheet.domain }));
  const openers = OPENER_VARIANTS.map((t) => fill(t, { domain: sheet.domain }));
  if (!subjects.includes(f.subject)) fail("grounding:subject_not_approved");
  if (!openers.includes(f.opener)) fail("grounding:opener_not_approved");

  // Grounding: findings carry their assigned gap's anchor
  const g1 = sheet.gaps[0];
  const g2 = sheet.gaps[1];
  if (!g1 || !g2) fail("grounding:lt_2_gaps");
  else {
    if (typeof f.finding_1 === "string" && !phraseRe(g1.anchor).test(f.finding_1)) fail("grounding:finding_1_anchor");
    if (typeof f.finding_2 === "string" && !phraseRe(g2.anchor).test(f.finding_2)) fail("grounding:finding_2_anchor");
  }

  // Subject rules
  const s = f.subject ?? "";
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && letters === letters.toUpperCase()) fail("subject:all_caps");
  if (s.includes("!")) fail("subject:exclamation");
  if (/^\s*(re|fwd?)\s*:/i.test(s)) fail("subject:re_fwd");
  if (/\p{Extended_Pictographic}/u.test(s)) fail("subject:emoji");

  // Emoji anywhere in model fields is also out (plain-text business email).
  for (const k of KEYS) if (/\p{Extended_Pictographic}/u.test(f[k] ?? "")) fail(`emoji:${k}`);

  if (failures.length === 0 && bodyWordsOf(f) > MAX_BODY_WORDS) fail("length:body_words");

  return failures.length ? { ok: false, failures: [...new Set(failures)] } : { ok: true, fields: f };
}
