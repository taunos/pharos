// dim6:v6 — deterministic facts about the audited site, taken from the
// site's own sources (reference.ts), used around the accuracy judge:
//
//   - names: what the site calls itself, so an answer that names the
//     business ("Resend", "Tartine", "Electronic Frontier Foundation") counts
//     as naming the site, not only one that repeats the domain. The release
//     check of 2026-11-10 counted those answers as "not named" (RD-0107..0110).
//   - street addresses the site states, so an answer that gives a street
//     address the site does not state is not counted as matching it
//     (drveit Gemini q6 invented one and was counted, RD-0116).
//
// Both inputs are written by the site owner, who is also the party the score
// is about, so they are hostile:
//   - a name counts only when it spells the site's own domain (its first
//     label, e.g. "Dr. Veit" for drveit.com.br), or the label is its initials
//     ("Electronic Frontier Foundation" for eff.org), or it is a leading part
//     of such a name that the label starts with ("Tartine" for
//     tartinebakery.com). A site cannot make common words count unless its
//     domain is that word, and names only ever add points to answers the
//     accuracy judge already found correct (ladder.ts).
//   - addresses can only lower a score (an answer whose address is not among
//     them is not counted as a match), never raise one.
// Model answers are hostile too: they are only matched against, never
// interpreted. Everything here is linear-time on bounded inputs.

import { collapseWhitespace, stripUnsafeChars } from "../llm-safety";

/** Lowercase letters and digits only, accents removed. */
export function normKey(s: string): string {
  return stripUnsafeChars(s)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Words (letters/digits runs) of a name, accents removed, original case. */
function words(s: string): string[] {
  return (
    stripUnsafeChars(s)
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export interface SiteName {
  /** The name as the site writes it (cleaned), for tests and logs. */
  text: string;
  /** Exact uppercase word only (an acronym such as EFF). */
  acronym: boolean;
}

const NAME_MAX_CHARS = 80;
const NAME_MAX_WORDS = 8;
const MIN_PREFIX_CHARS = 5;
const MAX_NAMES = 12;

/** The domain's first label as a key ("drveit" for drveit.com.br). */
export function domainLabelKey(domain: string): string {
  return normKey(domain.replace(/^www\./i, "").split(".")[0] ?? "");
}

/**
 * Split a declared name into candidate pieces: the whole text, the parts
 * between separators (" | ", " – ", " — ", " - ", " · ", ": "), and any
 * parenthesized part on its own ("Electronic Frontier Foundation (EFF)").
 */
function candidatePieces(raw: string): string[] {
  const s = collapseWhitespace(stripUnsafeChars(raw)).slice(0, 400);
  if (!s) return [];
  const out: string[] = [];
  const add = (p: string) => {
    const t = p.replace(/^[\s\-–—|·:,.]+|[\s\-–—|·:,]+$/g, "").trim();
    if (t && t.length <= NAME_MAX_CHARS && words(t).length <= NAME_MAX_WORDS) out.push(t);
  };
  const parts = s.split(/\s+[|\-–—·:]\s+|\s*[|·–—]\s*|:\s+/);
  for (const part of [s, ...parts]) {
    add(part);
    const paren = /^(.*?)\s*\(([^()]{1,40})\)\s*$/.exec(part);
    if (paren) {
      add(paren[1]);
      add(paren[2]);
    }
  }
  return out;
}

/**
 * The site's own names that are bound to its domain (see the module comment),
 * from raw declared-name candidates (llms.txt H1, JSON-LD entity names,
 * og:site_name, <title>). Deduplicated by key, at most MAX_NAMES.
 */
export function boundSiteNames(declared: string[], domain: string): SiteName[] {
  const label = domainLabelKey(domain);
  if (!label) return [];
  const byKey = new Map<string, SiteName>();
  const keep = (text: string, acronym: boolean) => {
    const key = acronym ? `A:${text}` : normKey(text);
    if (key && !byKey.has(key) && byKey.size < MAX_NAMES) byKey.set(key, { text, acronym });
  };
  for (const raw of declared) {
    for (const piece of candidatePieces(raw)) {
      const key = normKey(piece);
      const ws = words(piece);
      if (!key) continue;
      if (key === label) {
        // A short name that spells the label (e.g. "EFF" for eff.org) is an acronym.
        if (key.length < 4) keep(piece.toUpperCase(), true);
        else keep(piece, false);
        // Leading parts of a multi-word bound name the label starts with
        // ("Tartine" of "Tartine Bakery").
        for (let n = 1; n < ws.length; n++) {
          const pre = ws.slice(0, n).join(" ");
          const pk = normKey(pre);
          if (pk.length >= MIN_PREFIX_CHARS && pk.length * 2 >= label.length && label.startsWith(pk)) keep(pre, false);
        }
        continue;
      }
      if (ws.length >= 2 && label.length >= 2 && ws.map((w) => w[0]).join("").toLowerCase() === label) {
        keep(ws.join(" "), false);
        keep(label.toUpperCase(), true);
        continue;
      }
      if (key.length >= MIN_PREFIX_CHARS && key.length * 2 >= label.length && label.startsWith(key)) keep(piece, false);
    }
  }
  return [...byKey.values()];
}

// Letters/digits on either side end a name match (Unicode-aware; \b is ASCII-only).
const NB = "(?<![\\p{L}\\p{N}])";
const NA = "(?![\\p{L}\\p{N}])";

// One-word names that are ordinary English words never count: "Best results"
// is not a mention of best.com. Lowercase keys.
const COMMON_WORDS = new Set(
  `a about above after again against all also always am an and any are around as at away back bad be because
  been before being below best better between big black blue book both box brand bring build business but buy by
  call came can care case cash center change check city clean clear close cloud code come common company contact
  could cool core country create cross daily data day deal deep design did direct do does doing done down drive
  each early easy eat edge else end energy even ever every expert express fact fair family far fast feel few
  field find fine first fit five flex flow fly for form forward found four free fresh from front full fun get
  give global go going gold good great green group grow had happy hard has have he health hello help her here
  high him his home hope hot house how i idea if in info inside into is it its just keep key kind know lab land
  last late learn left less life light like line link list little live local long look love made main make
  making man many market me media meet might mind mobile money more most move much must my name native near
  need net never new news next nice night no north not note now of off offer office often oil ok old on once one
  only open or order other our out over own page park part pay people per pick place plan play plus point power
  pro product pure put quick ready real red rest right rock room run safe said same save say school sea see
  sell send service set shape share she shop should show side sign simple site smart so social some something
  sound south space spot square star start state stay still stop store street study style such sun super sure
  take talk team tech tell ten than that the their them then there these they thing think this those three
  through time to today together too top total touch town track trade travel true trust try turn two type under
  up us use used value very view vision wall want was water way we web well went were west what when where which
  while white who why will win with without word work world would write year yes yet you your zero apple target
  amazon window windows`.split(/\s+/)
);

// A one-word name counts only where it is used as a name: followed by "'s" or
// by a verb that makes it the subject ("Resend offers", "Ugmonk is"), or
// right after a word that introduces a name ("website of Resend", "founded
// by", "called"). "Please Resend the message" is not a mention.
const SUBJECT_NEXT = new Set(
  "is was are were has have had offers offered provides provided sells sold makes made operates operated builds built designs designed helps lets says focuses specializes specialises runs creates created describes lists also does did can could will would may might should develops developed supports serves works started began became remains appears seems belongs".split(" ")
);
const NAME_BEFORE = new Set("of by from about called named for with at brand company".split(" "));

interface NameMatcher {
  re: RegExp;
  /** Declared words: a capital in the site's spelling needs a capital in the answer. */
  caps: boolean[];
  /** Needs the used-as-a-name check (one word, or every word a common word). */
  checkUse: boolean;
}

function nameMatcher(n: SiteName): NameMatcher | null {
  if (n.acronym) return /^[A-Z0-9]{2,}$/.test(n.text) ? { re: new RegExp(`${NB}${n.text}${NA}`, "gu"), caps: [true], checkUse: false } : null;
  const ws = words(n.text);
  if (ws.length === 0) return null;
  // A name made only of ordinary words never counts ("Best", "Best Buy",
  // "Just Eat"): no grammar check can tell the brand from the phrase.
  if (ws.every((w) => COMMON_WORDS.has(w.toLowerCase()))) return null;
  // One word: always written with a capital ("Resend", not the verb "resend").
  const caps = ws.length === 1 ? [true] : ws.map((w) => w[0] !== w[0].toLowerCase());
  // Tokens are [\p{L}\p{N}]+ only: nothing to escape.
  return { re: new RegExp(`${NB}${ws.join("[\\s\\-.'’]*")}${NA}`, "giu"), caps, checkUse: ws.length === 1 };
}

function capsMatch(hit: string, caps: boolean[]): boolean {
  const hw = hit.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (hw.length !== caps.length) return false;
  return caps.every((needCap, i) => !needCap || hw[i][0] !== hw[i][0].toLowerCase());
}

function flatText(text: string): string {
  return stripUnsafeChars(text)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[*_`#]+/g, "");
}

function usedAsName(flat: string, index: number, length: number): boolean {
  const after = flat.slice(index + length, index + length + 40);
  if (/^['’]s(?![\p{L}])/u.test(after)) return true;
  const next = /^[\s,]*([\p{L}]+)/u.exec(after)?.[1]?.toLowerCase();
  if (next !== undefined && SUBJECT_NEXT.has(next)) return true;
  const prev = /([\p{L}]+)[\s,]*$/u.exec(flat.slice(Math.max(0, index - 40), index))?.[1]?.toLowerCase();
  return prev !== undefined && NAME_BEFORE.has(prev);
}

/** Index of the first bound-name mention in `text` (see usedAsName), or -1. */
export function firstNameIndex(text: string, names: SiteName[]): number {
  if (names.length === 0 || !text) return -1;
  const flat = flatText(text);
  let best = -1;
  for (const n of names) {
    const m = nameMatcher(n);
    if (!m) continue;
    for (const hit of flat.matchAll(m.re)) {
      const i = hit.index ?? 0;
      if (best !== -1 && i >= best) break;
      if (capsMatch(hit[0], m.caps) && (!m.checkUse || usedAsName(flat, i, hit[0].length))) {
        best = i;
        break;
      }
    }
  }
  return best;
}

/**
 * true when `text` names the site by one of its bound names. Text is matched
 * with accents and markdown emphasis removed; only the names' own tokens are
 * in the patterns, so hostile text cannot change what is matched.
 */
export function namesSite(text: string, names: SiteName[]): boolean {
  return firstNameIndex(text, names) !== -1;
}

// ── Street addresses ────────────────────────────────────────────────────

export interface StreetAddress {
  /** Street name key: accents, case, punctuation and street-type words removed. */
  street: string;
  /** House number (digits). */
  number: string;
}

const STREET_TYPE_WORDS = new Set(
  "rua r av avenida alameda al travessa tv estrada rodovia praca largo calle carrera paseo street st avenue ave road rd boulevard blvd lane ln drive way place pl court ct strasse str weg platz allee gasse rue chemin bd".split(
    " "
  )
);

function streetKey(name: string): string {
  return words(name)
    .map((w) => w.toLowerCase().replace(/ß/g, "ss"))
    .filter((w) => !STREET_TYPE_WORDS.has(w))
    .join("");
}

// Bounded patterns (every repeat has a small upper limit), run on text that
// is capped (ADDRESS_TEXT_MAX) with markdown emphasis removed.
const PT_ES =
  /(?<![\p{L}])(?:Rua|R\.|Avenida|Av\.?|Alameda|Al\.|Travessa|Tv\.|Estrada|Rodovia|Pra[çc]a|Largo|Calle|Carrera|Paseo)\s+([^\n,;()[\]]{2,60}?)\s*,?\s*(?:n[º°o.]\s*)?(\d{1,5})(?!\d)/giu;
const EN =
  /(?<![\p{N}])(\d{1,5})\s+((?:[\p{Lu}][\p{L}'.-]{0,30}\s+){1,4}?)(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Way|Place|Pl\.?|Court|Ct\.?)(?![\p{L}])/gu;
const DE = /(?<![\p{L}])([\p{Lu}][\p{L}-]{1,40}(?:straße|strasse|str\.|weg|platz|allee|gasse))\s+(\d{1,4})(?!\d)/gu;
const FR = /(?<![\p{N}])(\d{1,4}),?\s+(?:rue|avenue|boulevard|place|chemin|bd)\s+([^\n,;()]{2,50}?)(?=[,\n;(]|\s\d|$)/giu;

export const ADDRESS_TEXT_MAX = 20_000;

interface FoundAddress extends StreetAddress {
  index: number;
}

function findAddresses(t: string): FoundAddress[] {
  const out: FoundAddress[] = [];
  const push = (name: string, number: string, index: number) => {
    const street = streetKey(name);
    if (street.length >= 3 && !out.some((a) => a.street === street && a.number === number)) out.push({ street, number, index });
  };
  for (const m of t.matchAll(PT_ES)) push(m[1], m[2], m.index ?? 0);
  for (const m of t.matchAll(EN)) push(m[2], m[1], m.index ?? 0);
  for (const m of t.matchAll(DE)) push(m[1], m[2], m.index ?? 0);
  for (const m of t.matchAll(FR)) push(m[2], m[1], m.index ?? 0);
  return out;
}

/** Street addresses stated in `text` (first `max` chars). */
export function parseStreetAddresses(text: string, max = ADDRESS_TEXT_MAX): StreetAddress[] {
  return findAddresses(stripUnsafeChars(text.slice(0, max)).replace(/[*_`#]+/g, "")).map(({ street, number }) => ({ street, number }));
}

/**
 * true when `text` contains the words of `name` in order (case- and
 * accent-insensitive). For binding a structured-data entity to the site
 * ("Dr. Veit Odontologia - Unidade São Paulo" contains "Dr. Veit"), never for
 * answer text.
 */
export function containsNameWords(text: string, name: SiteName): boolean {
  const ws = words(name.text).map((w) => w.toLowerCase());
  if (ws.length === 0) return false;
  const tw = words(text).map((w) => w.toLowerCase());
  for (let i = 0; i + ws.length <= tw.length; i++) {
    if (ws.every((w, j) => tw[i + j] === w)) return true;
  }
  return false;
}

/**
 * The site's own street addresses from the JSON-LD streetAddress values of
 * entities bound to the site (reference.ts): parsed with the same patterns; a
 * value the patterns do not read is kept as its whole street key and first
 * number, so a declared address is never lost.
 */
export function siteStreetAddresses(streetAddressValues: string[]): StreetAddress[] {
  const out: StreetAddress[] = [];
  for (const v of streetAddressValues.slice(0, 20)) {
    const parsed = parseStreetAddresses(v);
    if (parsed.length > 0) out.push(...parsed);
    else {
      const number = /\d{1,5}/.exec(v)?.[0];
      const street = streetKey(v.replace(/\d+/g, " "));
      if (number && street.length >= 3) out.push({ street, number });
    }
  }
  return out;
}

/**
 * Street addresses in the answer that are not among the site's own (same
 * street key and same number). Empty when the site states none. The caller
 * (ladder.ts) only lowers a CORRECT answer to "could not confirm" on a
 * non-empty result: the report never says the address is wrong or whose it
 * is, so an address the answer gave for someone else costs at most that
 * answer's credit.
 */
export function unlistedAddresses(answer: string, siteAddresses: StreetAddress[]): StreetAddress[] {
  if (siteAddresses.length === 0) return [];
  return parseStreetAddresses(answer).filter((a) => !siteAddresses.some((s) => s.street === a.street && s.number === a.number));
}

// ── URL-only answers to the homepage-URL question ───────────────────────

/** true for http(s)://<domain or www.domain>[/] with no path, query or fragment. */
export function isHomepageUrl(url: string, domain: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return (
    (u.protocol === "https:" || u.protocol === "http:") &&
    host === domain.toLowerCase().replace(/^www\./, "") &&
    (u.pathname === "/" || u.pathname === "") &&
    u.search === "" &&
    u.hash === "" &&
    u.username === "" &&
    u.password === "" &&
    !url.includes("?") &&
    !url.includes("#")
  );
}

const bareUrlKey = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");

function isSubjectOfSite(subject: string, domain: string, names: SiteName[]): boolean {
  const s = subject.trim();
  if (!s) return false;
  if (bareUrlKey(s) === bareUrlKey(domain)) return true;
  const k = normKey(s);
  return k.length > 0 && names.some((n) => normKey(n.text) === k);
}

// The only sentence an answer may consist of besides the bare URL (Codex
// plan review r6-r7: a whitelist, so no qualification, history or quotation
// can ride along). Group 1: the subject after "of" / "for", if any.
const URL_ASSERTION =
  /^(?:(?:the|its|their) )?(?:official )?(?:(?:website|web) )?(?:url|web address|address|homepage|home page|website|site)(?: (?:of|for) (?:the )?(.{1,80}?)(?:['’]s (?:official )?(?:homepage|home page|website|site))?)? (?:is(?: simply)?:?|:)$/i;

/**
 * dim6:v6: the whole answer is the site's homepage URL, or exactly one
 * sentence asserting it ("The URL for drveit.com.br is: https://www.drveit.com.br",
 * "The URL of the Electronic Frontier Foundation's homepage is https://www.eff.org.").
 * Markdown links count only when their label is the URL, the domain or a
 * bound name; emphasis and citation markers are ignored; nothing else is.
 * Any other text, any other URL, a path, query or fragment → false.
 */
export function isHomepageUrlOnlyAnswer(answer: string, domain: string, names: SiteName[]): boolean {
  if (!answer || answer.length > 600) return false;
  let ok = true;
  let t = stripUnsafeChars(answer).replace(/\[([^\]\n]{0,200})\]\(([^()\s]{1,300})\)/g, (_m, label: string, url: string) => {
    const l = label.replace(/[*_`]+/g, "").trim();
    if (!(bareUrlKey(l) === bareUrlKey(url) || isSubjectOfSite(l, domain, names))) ok = false;
    return url;
  });
  if (!ok) return false;
  t = t
    .replace(/<(https?:\/\/[^>\s]{1,300})>/g, "$1")
    .replace(/\[\d{1,3}\]/g, " ")
    .replace(/[*_`]+/g, "");
  t = collapseWhitespace(t).replace(/[\s.!]+$/, "");
  const urls = t.match(/https?:\/\/[^\s)>\]'"]+/gi) ?? [];
  if (urls.length !== 1) return false;
  const url = urls[0].replace(/[.,;:!]+$/, "");
  if (!isHomepageUrl(url, domain)) return false;
  const at = t.indexOf(url);
  if (t.slice(at + url.length).replace(/^[/.,;:!]*/, "") !== "") return false;
  const prefix = t.slice(0, at).trim();
  if (prefix === "") return true;
  const m = URL_ASSERTION.exec(prefix);
  if (!m) return false;
  return m[1] === undefined || isSubjectOfSite(m[1], domain, names);
}
