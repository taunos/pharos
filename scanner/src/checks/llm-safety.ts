// Site-text hygiene for the scanner's rule-based text checks.
//
// Threat model: the audited site is attacker-controllable. Dim 1 reads the
// site's llms.txt blockquote and Dim 4 its FAQPage questions and answers.
// Until 1.4.2 an LLM rated that text; since 1.5.0 both are scored by fixed
// rules (no model call), so planted text can no longer talk a scorer up.
//
//   1. stripUnsafeChars / cleanSiteText: NFKC-fold, drop control /
//      zero-width / bidi / tag / variation-selector / private-use code
//      points, so counts and matches see the visible text only.
//   2. detectScoringInjection: Dim 1 still scores a blockquote that reads
//      like instructions to an AI scorer 0 (one of its rules). The site
//      owner is the attacker, so the safe direction is down.
//
// Adapted from marketing-site/src/lib/llm-safety.ts and
// marketing-site/src/lib/dim6/affirmation-judge.ts. The scanner Worker must
// not import from marketing-site, so the relevant parts are copied here.
//
// Character classes are numeric code-point ranges, not regex escapes, so no
// invisible character ever appears literally in this source file.

// [start, end] inclusive code-point ranges removed from site text.
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

export function isUnsafeCodePoint(cp: number): boolean {
  for (const [a, b] of UNSAFE_RANGES) {
    if (cp >= a && cp <= b) return true;
  }
  // Private-use areas: no legitimate use in a summary or FAQ question.
  if (cp >= 0xe000 && cp <= 0xf8ff) return true;
  if (cp >= 0xf0000) return true;
  return false;
}

/**
 * NFKC-normalize (folds full-width / compatibility look-alikes), drop unsafe
 * code points, and turn tab/CR/LF into plain spaces.
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

/** Cap on a word boundary. */
export function capLength(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd();
}

/** Strip, collapse to one line and cap: the form site text is screened and sent in. */
export function cleanSiteText(s: string, max: number): string {
  return capLength(collapseWhitespace(stripUnsafeChars(s)), max);
}

// Instruction-like text aimed at a scorer. Tuned to what a hostile site would
// write to move a 0-100 score, not to ordinary product copy: FAQ sites about
// AI legitimately say "AI", "answer" and "questions", so those alone never
// match. A false positive costs the site points; it never gains any.
export const SCORING_INJECTION_PATTERNS: RegExp[] = [
  // "ignore the criteria above", "disregard previous instructions"
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:instructions?|prompts?|rules?|guidelines|criteria|rubric|above|previous|prior|earlier)\b/i,
  /\b(?:system prompt|developer message|system message|hidden prompt)\b/i,
  /\b(?:new|updated|real|actual|additional)\s+instructions?\b|\binstructions?\s*:/i,
  // "return 100", "output a score of 95", "give this a rating of 100"
  /\b(?:return|output|respond|reply|answer|give|print|assign|award|rate)\b[^.\n]{0,30}\b(?:score|rating|grade|number|integer|100|9[0-9])\b/i,
  // "score: 100", "rating = 95", "score it 100"
  /\b(?:score|rating|grade)\s*(?:it|this|them|us|me)?\s*(?:of|as|at|=|:|is|to|with)?\s*[0-9]{2,3}\b/i,
  /\b[0-9]{1,3}\s*\/\s*100\b|\b[0-9]{1,3}\s+out\s+of\s+100\b|\bfull marks\b|\bmaximum score\b|\bperfect score\b/i,
  /\bnothing else\b|\bonly (?:a|the|one) (?:number|integer|digit)s?\b|\bsingle (?:number|integer|word)\b/i,
  // "the evaluator must...", "you are a grader"
  /\b(?:evaluator|grader|judge|classifier|rater|scorer|language model)s?\b[^.\n]{0,60}\b(?:must|should|shall|output|answer|respond|return|reply|say|score|rate)\b/i,
  /\b(?:you are|act as|pretend to be|as an?)\b[^.\n]{0,30}\b(?:evaluator|grader|judge|classifier|rater|scorer)\b/i,
  // Delimiter / chat-template forgery
  /<\/?(?:system|user|assistant|instructions?|untrusted[a-z-]*|data|blockquote|questions?|prompt)\b[^>]*>|"""|```|\[\/?INST\]|<\|[a-z_]+\|>|<<\/?SYS>>/i,
  /(?:^|\s)(?:answer|score|rating|output|result|response|assistant|system)\s*:/i,
];

/** Returns the first injection-like snippet in already-cleaned text, or null. */
export function detectScoringInjection(text: string): string | null {
  for (const re of SCORING_INJECTION_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0].slice(0, 40);
  }
  return null;
}
