// dim6:v5 — reference description of the audited site, for the accuracy judge.
//
// Why: an answer can "know" a domain and still describe the wrong owner. The
// first real run (a clinical psychologist) had 8 of 15 affirmative answers
// describing a famous author, a graphic designer or a dress shop, and all 8
// counted as "named your domain". The accuracy judge (accuracy-judge.ts)
// compares each affirmative answer with what the site says about itself. It
// checks consistency with the site's own claims about who it is and what
// kind of business it is, nothing more (prices, dates and other details are
// not checked).
//
// Every extracted identity field gets its own fixed share of the
// REFERENCE_MAX_CHARS budget (REFERENCE_FIELD_BUDGETS), trimmed at a word
// boundary and never omitted, so no field can push another out and the
// judge always sees conflicting evidence (Codex r1 HIGH, r3 HIGH):
//   llms.txt: H1, blockquote
//   JSON-LD Organization / Person / LocalBusiness (and subtypes): each
//     entity gets its own name and description share (Codex r5 HIGH), up to
//     REFERENCE_MAX_ENTITIES distinct entities; more → not verifiable
//     ("too_many_entities", fail closed: we can't tell which one the site is)
//   homepage: <title>, meta description, first <h1>
// Each source is labelled ("From llms.txt:", ...) so the judge can tell
// when sources disagree (it answers UNCLEAR then).
// The scan result carries none of these texts, so two same-site fetches are
// made (llms.txt and the homepage), each through safeFetch (every hop
// validated, byte cap, shared deadline), retried once on a timeout or
// network failure. A response whose final URL is on another site is ignored.
//
// The reference is written by the site owner, who is also the party the
// score is about, so it is untrusted: each part is normalized with line
// breaks kept (so line-anchored patterns still match), the text the judge
// will see is screened for prompt injection in line-preserving and one-line
// form, capped, and fenced in the judge prompt. Tags are found by linear
// indexOf scanning, never by regex over the page (Codex r7).
//   - injected → "injection": AFFIRM answers score 0 (accuracy_blocked=true).
//   - missing, unreadable or too short (< REFERENCE_MIN_WORDS words) →
//     AFFIRM answers score 0 (accuracy_not_checked=true). Fail closed:
//     withholding the description must not restore unchecked credit.

import { capLength, collapseWhitespace, screenUntrustedText, stripUnsafeChars, stripUnsafeCharsKeepLines } from "../llm-safety";
import { safeFetch, type FetchLike, type SafeFetchFailure } from "../safe-fetch";
import { detectAccuracyInjection } from "./accuracy-judge";
import { canonicalDomain } from "./question-set";

// 2026-11-10 (RD-0103): title 60 -> 120. Tartine's title is a sentence; cut at
// 60 and run on into the h1 it read "Tartine is a thoughtful expression of Home".
export const REFERENCE_FIELD_BUDGETS = {
  llmsH1: 80,
  llmsBlockquote: 220,
  title: 120,
  metaDescription: 120,
  h1: 60,
} as const;
/** Per JSON-LD identity entity. */
export const REFERENCE_ENTITY_BUDGETS = { name: 50, description: 120 } as const;
export const REFERENCE_MAX_ENTITIES = 8;
/**
 * Most content the reference can hold: 540 for the fixed fields plus 170 per
 * entity x 8 = 1900 chars (labels and line breaks come on top). With a 6000-
 * char answer and the instructions the judge prompt stays around 10,000 chars
 * (~3,300 tokens), well inside the 70B model's context.
 */
export const REFERENCE_MAX_CHARS =
  Object.values(REFERENCE_FIELD_BUDGETS).reduce((a, b) => a + b, 0) +
  REFERENCE_MAX_ENTITIES * (REFERENCE_ENTITY_BUDGETS.name + REFERENCE_ENTITY_BUDGETS.description);
export const REFERENCE_MIN_WORDS = 5;
const FETCH_TIMEOUT_MS = 8000;
// Collection limits (Codex r6: every limit either cannot hide evidence or
// fails closed with its own reason):
//   - homepage body: REFERENCE_HTML_MAX_BYTES; a longer page → "source_too_large"
//     (panel max 1.26 MB, Linear);
//   - llms.txt body: REFERENCE_LLMS_MAX_BYTES; longer → "source_too_large";
//   - homepage unreadable (timeout/network after one retry, non-2xx, off-site
//     final URL, body read error) → "source_unreadable"; llms.txt the same,
//     except a clean non-2xx / off-site / empty llms.txt just means "no llms.txt";
//   - JSON-LD nesting deeper than REFERENCE_JSONLD_MAX_DEPTH → "structured_data_too_deep";
//   - JSON-LD entities: no raw cap; all are collected, then deduplicated
//     (identical name+description),
//     more than REFERENCE_MAX_ENTITIES distinct → "too_many_entities";
//   - script blocks: no limit (all are read); an ld+json block that is not valid
//     JSON → "structured_data_unreadable" (Codex r9);
//   - end tags need a real name boundary (</scripture> is not </script>); a
//     script, title, h1 or meta tag that never closes → "source_unreadable".
export const REFERENCE_HTML_MAX_BYTES = 4 * 1024 * 1024;
export const REFERENCE_LLMS_MAX_BYTES = 512 * 1024;
export const REFERENCE_JSONLD_MAX_DEPTH = 20;

export type ReferenceFailure = "source_unreadable" | "source_too_large";

export type SiteReference =
  | { verifiable: true; text: string }
  | {
      verifiable: false;
      reason: "missing" | "too_short" | "injection" | "too_many_entities" | "structured_data_too_deep" | "structured_data_unreadable" | ReferenceFailure;
    };

export interface ReferenceSources {
  llmsTxt?: string | null;
  homepageHtml?: string | null;
  // Set by fetchReferenceSources when a source could not be read in full.
  failure?: ReferenceFailure;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", plus: "+", sol: "/" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Extractors return RAW text (line structure kept) so the injection screen
// can see it before cleaning; buildSiteReference cleans.
function raw(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

export function cleanReferencePart(s: string): string {
  return collapseWhitespace(stripUnsafeChars(s));
}

// Text past a part's budget that is still screened, for patterns that start
// inside the shown text and end just after the cut.
const SCREEN_SLACK_CHARS = 200;

/**
 * Linear-time normalization that keeps line breaks: unsafe / zero-width
 * characters dropped (NFKC), every run of non-newline whitespace -> one
 * space, every line break with the whitespace around it -> one "\n", trimmed.
 * collapseWhitespace() of the result has the same length (each "\n" becomes
 * one space), so a prefix of it maps one-to-one onto the shown text.
 */
export function normalizeReferencePart(s: string): string {
  return stripUnsafeCharsKeepLines(s)
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n\s*/g, "\n")
    .trim();
}

/** llms.txt: the first-line H1 and the blockquote right after it (raw). */
export function extractLlmsTxtIdentity(txt: string): string[] {
  const lines = txt.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const h1 = /^#\s+(.+)$/.exec(lines[i]?.trim() ?? "");
  // No H1 on the first non-empty line: not an llms.txt (e.g. an HTML page
  // served for every path).
  if (!h1) return [];
  const out = [raw(h1[1])];
  i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  const quote: string[] = [];
  while (i < lines.length && /^\s*>/.test(lines[i])) {
    quote.push(lines[i].replace(/^\s*>\s?/, ""));
    i++;
  }
  if (quote.length > 0) out.push(raw(quote.join("\n")));
  return out.filter(Boolean);
}

// schema.org Organization / LocalBusiness / Person and their subtypes (Codex
// r10: e.g. "Dentist" was missed). Static list from the schema.org type
// hierarchy, plus any type name ending in Organization or Business.
const IDENTITY_TYPES = new Set(
  `Person Patient
  Organization Airline Consortium Corporation FundingScheme GovernmentOrganization LibrarySystem NGO
  NewsMediaOrganization OnlineBusiness OnlineStore PoliticalParty Project FundingAgency ResearchProject
  ResearchOrganization SearchRescueOrganization WorkersUnion SportsOrganization SportsTeam
  PerformingGroup DanceGroup MusicGroup TheaterGroup
  EducationalOrganization CollegeOrUniversity ElementarySchool HighSchool MiddleSchool Preschool School
  MedicalOrganization DiagnosticLab Hospital MedicalClinic Pharmacy Physician VeterinaryCare Dentist
  LocalBusiness AnimalShelter ArchiveOrganization ChildCare DryCleaningOrLaundry EmploymentAgency InternetCafe
  Library ProfessionalService RadioStation RealEstateAgent RecyclingCenter SelfStorage ShoppingCenter
  TelevisionStation TouristInformationCenter TravelAgency
  AutomotiveBusiness AutoBodyShop AutoDealer AutoPartsStore AutoRental AutoRepair AutoWash GasStation
  MotorcycleDealer MotorcycleRepair
  EmergencyService FireStation PoliceStation
  EntertainmentBusiness AdultEntertainment AmusementPark ArtGallery Casino ComedyClub MovieTheater NightClub
  FinancialService AccountingService AutomatedTeller BankOrCreditUnion InsuranceAgency
  FoodEstablishment Bakery BarOrPub Brewery CafeOrCoffeeShop Distillery FastFoodRestaurant IceCreamShop
  Restaurant Winery
  GovernmentOffice PostOffice
  HealthAndBeautyBusiness BeautySalon DaySpa HairSalon HealthClub NailSalon TattooParlor
  HomeAndConstructionBusiness Electrician GeneralContractor HVACBusiness HousePainter Locksmith MovingCompany
  Plumber RoofingContractor
  LegalService Attorney Notary
  LodgingBusiness BedAndBreakfast Campground Hostel Hotel Motel Resort VacationRental
  MedicalBusiness CommunityHealth Dermatology DietNutrition Emergency Geriatric Gynecologic Midwifery Nursing
  Obstetric Oncologic Optician Optometric Otolaryngologic Pediatric Physiotherapy PlasticSurgery Podiatric
  PrimaryCare Psychiatric PublicHealth
  SportsActivityLocation BowlingAlley ExerciseGym GolfCourse PublicSwimmingPool SkiResort SportsClub
  StadiumOrArena TennisComplex
  Store BikeStore BookStore ClothingStore ComputerStore ConvenienceStore DepartmentStore ElectronicsStore
  Florist FurnitureStore GardenStore GroceryStore HardwareStore HobbyShop HomeGoodsStore JewelryStore
  LiquorStore MensClothingStore MobilePhoneStore MovieRentalStore MusicStore OfficeEquipmentStore OutletStore
  PawnShop PetStore ShoeStore SportingGoodsStore TireShop ToyStore WholesaleStore`.split(/\s+/)
);
const isIdentityType = (t: string) => IDENTITY_TYPES.has(t) || /^[A-Za-z]+(?:Organization|Business)$/.test(t);

// A type as a term ("Dentist"), a schema.org IRI ("https://schema.org/Dentist",
// "http://schema.org/Dentist") or a compact IRI ("schema:Dentist"): the local name.
function typesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.trim().replace(/^.*[/#:]/, ""));
}

/**
 * A JSON-LD name / description value as text: a string, an {"@value": ...}
 * object, or an array of those (joined with "; "). Other shapes give "".
 */
function valueText(v: unknown, depth = 0): string {
  if (typeof v === "string") return v.trim();
  if (depth > 2 || v === null || typeof v !== "object") return "";
  if (Array.isArray(v)) return v.map((x) => valueText(x, depth + 1)).filter(Boolean).join("; ");
  const val = (v as Record<string, unknown>)["@value"];
  return typeof val === "string" ? val.trim() : "";
}

class JsonLdTooDeep extends Error {}

// Walks top-level arrays and @graph (where a page states its own identity;
// entities nested in properties such as publisher or alumniOf are related
// entities, not the site's claim about itself). No count cap: the walk is
// bounded by the body byte cap. Nesting past REFERENCE_JSONLD_MAX_DEPTH
// throws, so the caller fails closed instead of skipping evidence.
function collectEntities(node: unknown, out: Array<Record<string, unknown>>, depth = 0): void {
  if (node === null || typeof node !== "object") return;
  if (depth > REFERENCE_JSONLD_MAX_DEPTH) throw new JsonLdTooDeep();
  if (Array.isArray(node)) {
    for (const n of node) collectEntities(n, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typesOf(obj).some(isIdentityType)) out.push(obj);
  if (obj["@graph"]) collectEntities(obj["@graph"], out, depth + 1);
  if (obj["@included"]) collectEntities(obj["@included"], out, depth + 1);
}

/**
 * Homepage HTML (raw): JSON-LD identity entities (name/description, distinct,
 * in document order), <title>, meta description, first <h1>.
 */
export function extractHtmlIdentity(page: string): {
  jsonLdEntities: Array<{ name: string; description: string }>;
  jsonLdTooDeep: boolean;
  // Evidence we found but could not read (Codex r9: fail closed, never skip):
  // an ld+json block that is not valid JSON, or a script / title / h1 / meta
  // tag that never closes (its start tag or its end tag).
  unreadable: "structured_data_unreadable" | "source_unreadable" | null;
  title: string;
  metaDescription: string;
  h1: string;
} {
  const jsonLdEntities: Array<{ name: string; description: string }> = [];
  const seenEntities = new Set<string>();
  const entities: Array<Record<string, unknown>> = [];
  let jsonLdTooDeep = false;
  let unreadable: "structured_data_unreadable" | "source_unreadable" | null = null;
  const empty = { jsonLdEntities, jsonLdTooDeep, title: "", metaDescription: "", h1: "" };
  // HTML comments are inert: blank them out (same length) so decoy markup in
  // a comment is never read (Codex r10). An unclosed comment hides the rest
  // of the page: fail closed.
  const pass = blankComments(page);
  if (pass === null) return { ...empty, unreadable: "source_unreadable" };
  // Tags are found in `markup` (raw-text element contents blanked); element
  // contents are read from `html`. Same length, same offsets.
  const { html, markup } = pass;
  // ASCII-only lowercase: same length as html, so offsets found in it apply
  // to html (Codex r8 HIGH: toLowerCase() turns U+0130 into two code units).
  const lower = asciiLower(markup);
  const blocks: string[] = [];
  for (let from = 0; ; ) {
    const tag = nextTag(markup, lower, "script", from);
    if (tag === null) break;
    // An unclosed script hides everything after it: fail closed.
    if (tag === "unclosed") return { ...empty, unreadable: "source_unreadable" };
    const close = findEndTag(lower, "script", tag.end + 1);
    if (close === -1) return { ...empty, unreadable: "source_unreadable" };
    if (isJsonLdType(tag.attrs.type)) blocks.push(html.slice(tag.end + 1, close));
    from = close + 8;
  }
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      // A JSON-LD block we cannot parse may hold an identity claim: fail
      // closed instead of skipping it (Codex r9).
      unreadable ??= "structured_data_unreadable";
      continue;
    }
    try {
      collectEntities(parsed, entities);
    } catch (e) {
      if (e instanceof JsonLdTooDeep) jsonLdTooDeep = true;
      else throw e;
    }
  }
  for (const e of entities) {
    const name = valueText(e.name);
    const description = valueText(e.description);
    if (!name && !description) continue;
    // The same entity listed twice (identical name and description) is one
    // entity: keeping one copy loses no evidence.
    const k = JSON.stringify([name, description]);
    if (seenEntities.has(k)) continue;
    seenEntities.add(k);
    jsonLdEntities.push({ name, description });
  }
  const titleText = firstElementText(markup, html, lower, "title");
  const h1Text = firstElementText(markup, html, lower, "h1");
  let metaDescription = "";
  let metaUnclosed = false;
  for (let from = 0; ; ) {
    const tag = nextTag(markup, lower, "meta", from);
    if (tag === null) break;
    if (tag === "unclosed") {
      metaUnclosed = true;
      break;
    }
    if (decodeEntities(tag.attrs.name ?? "").trim().toLowerCase() === "description") {
      metaDescription = raw(tag.attrs.content ?? "");
      break;
    }
    from = tag.end + 1;
  }
  if (titleText === null || h1Text === null || metaUnclosed) unreadable = "source_unreadable";
  const title = raw(titleText ?? "");
  const h1 = raw(stripTagsLinear(h1Text ?? ""));
  return { jsonLdEntities, jsonLdTooDeep, unreadable, title, metaDescription, h1 };
}

/** Same rule as the scanner's Dim 4: the media type before any ";" parameter. */
function isJsonLdType(type: string | undefined): boolean {
  // Attribute values are decoded first (Codex r10: type="application/ld&#43;json").
  return decodeEntities(type ?? "").split(";")[0].trim().toLowerCase() === "application/ld+json";
}

/**
 * One forward pass over the page (Codex r10), two same-length outputs:
 *   - html: HTML comments (<!-- ... -->, including the short <!--> form)
 *     replaced by spaces, so decoy markup in a comment is never read;
 *   - markup: the same, with the contents of script, style, textarea and
 *     title elements also replaced by spaces, so text inside them (e.g. a
 *     "<script>" in a title or a JSON string) is never taken for a tag.
 * Tags are found in `markup`; element contents are read from `html`.
 * Comment syntax inside those elements is text, not a comment.
 * null when a comment never closes.
 */
export function blankComments(page: string): { html: string; markup: string } | null {
  const lower = asciiLower(page);
  const html: string[] = [];
  const markup: string[] = [];
  let copied = 0;
  const blank = (from: number, to: number, both: boolean) => {
    html.push(page.slice(copied, from), both ? " ".repeat(to - from) : page.slice(from, to));
    markup.push(page.slice(copied, from), " ".repeat(to - from));
    copied = to;
  };
  for (let i = 0; ; ) {
    const lt = lower.indexOf("<", i);
    if (lt === -1) break;
    if (lower.startsWith("<!--", lt)) {
      const end = lower.indexOf("-->", lt + 2);
      if (end === -1) return null;
      blank(lt, end + 3, true);
      i = end + 3;
      continue;
    }
    const rawEl = RAW_TEXT_ELEMENTS.find((n) => lower.startsWith(`<${n}`, lt) && isNameEnd(lower[lt + n.length + 1]));
    if (rawEl) {
      const tag = readTagAttrs(page, lt + rawEl.length + 1);
      if (!tag) break; // unclosed start tag: the extractor fails closed on it
      const close = findEndTag(lower, rawEl, tag.end + 1);
      if (close === -1) break; // unclosed element: likewise
      blank(tag.end + 1, close, false);
      i = close + rawEl.length + 2;
      continue;
    }
    i = lt + 1;
  }
  html.push(page.slice(copied));
  markup.push(page.slice(copied));
  return { html: html.join(""), markup: markup.join("") };
}
const RAW_TEXT_ELEMENTS = ["script", "style", "textarea", "title"];

// ── Linear HTML scanning (Codex r7 MED) ─────────────────────────────────
// Regexes such as /<meta\b[^>]*>/gi go quadratic on many unclosed "<meta "
// prefixes, and the homepage cap is 4 MB, so tags are found with indexOf and
// read with a single forward pass (same approach as the scanner's
// scanTags / stripTags). Every search starts after the previous match, and a
// tag that never closes ends the scan, so each character is visited a
// bounded number of times.

/**
 * A-Z -> a-z, every other UTF-16 code unit unchanged, so the result has the
 * same length and offsets as the input (String.prototype.toLowerCase does
 * not: U+0130 becomes two code units). Linear; built in chunks.
 */
export function asciiLower(s: string): string {
  const CHUNK = 8192;
  const buf = new Uint16Array(Math.min(CHUNK, s.length));
  let out = "";
  for (let start = 0; start < s.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, s.length);
    for (let i = start; i < end; i++) {
      const c = s.charCodeAt(i);
      buf[i - start] = c >= 65 && c <= 90 ? c + 32 : c;
    }
    out += String.fromCharCode.apply(null, buf.subarray(0, end - start) as unknown as number[]);
  }
  return out;
}

const isTagSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

/** Attributes of a tag whose name ends at `i`, up to its closing ">"; null when it never closes. */
function readTagAttrs(html: string, i: number): { attrs: Record<string, string>; end: number } | null {
  const attrs: Record<string, string> = {};
  const n = html.length;
  for (;;) {
    while (i < n && (isTagSpace(html[i]) || html[i] === "/")) i++;
    if (i >= n) return null;
    if (html[i] === ">") return { attrs, end: i };
    const nameStart = i;
    while (i < n && !isTagSpace(html[i]) && html[i] !== "/" && html[i] !== ">" && html[i] !== "=") i++;
    const key = html.slice(nameStart, i).toLowerCase();
    while (i < n && isTagSpace(html[i])) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < n && isTagSpace(html[i])) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        if (close === -1) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const vStart = i;
        while (i < n && !isTagSpace(html[i]) && html[i] !== ">") i++;
        value = html.slice(vStart, i);
      }
    }
    if (key && !(key in attrs)) attrs[key] = value;
  }
}

// A tag name ends at whitespace, "/" or ">" (so <scripture>, <h10>,
// </titles> and </h1x> are other tags, as in a browser).
const isNameEnd = (c: string | undefined) => c !== undefined && (isTagSpace(c) || c === "/" || c === ">");

/**
 * The next `<name ...>` start tag at or after `from` (`lower` is html
 * ASCII-lowercased): null when there is none, "unclosed" when one starts but
 * its ">" never comes.
 */
function nextTag(
  html: string,
  lower: string,
  name: string,
  from: number
): { attrs: Record<string, string>; end: number } | "unclosed" | null {
  const open = `<${name}`;
  for (let at = lower.indexOf(open, from); at !== -1; at = lower.indexOf(open, at + open.length)) {
    const after = at + open.length;
    if (after >= html.length) return "unclosed";
    if (!isNameEnd(html[after])) continue; // e.g. <metadata>, <h10>, <scripture>
    return readTagAttrs(html, after) ?? "unclosed";
  }
  return null;
}

/** Offset of the next `</name` end tag with a real name boundary at or after `from`; -1 when none. */
function findEndTag(lower: string, name: string, from: number): number {
  const open = `</${name}`;
  for (let at = lower.indexOf(open, from); at !== -1; at = lower.indexOf(open, at + open.length)) {
    if (isNameEnd(lower[at + open.length])) return at;
  }
  return -1;
}

/** Raw inner HTML (read from `html`) of the first <name> element found in `markup`: "" when absent, null when its start or end tag never closes. */
function firstElementText(markup: string, html: string, lower: string, name: string): string | null {
  const tag = nextTag(markup, lower, name, 0);
  if (tag === null) return "";
  if (tag === "unclosed") return null;
  const close = findEndTag(lower, name, tag.end + 1);
  return close === -1 ? null : html.slice(tag.end + 1, close);
}

/**
 * Text content of an element's inner HTML, in one pass: a "<" followed by a
 * letter, "/" or "!" starts markup, replaced by a space up to its ">"; any
 * other "<" is text (as in a browser: "< invalid Dental clinic" stays).
 * Markup that never closes ends the text.
 */
function stripTagsLinear(s: string): string {
  let out = "";
  for (let i = 0; ; ) {
    let lt = s.indexOf("<", i);
    while (lt !== -1 && !/[A-Za-z/!]/.test(s[lt + 1] ?? "")) lt = s.indexOf("<", lt + 1);
    if (lt === -1) return out + s.slice(i);
    out += `${s.slice(i, lt)} `;
    const gt = s.indexOf(">", lt + 1);
    if (gt === -1) return out;
    i = gt + 1;
  }
}

export const REFERENCE_LABELS = {
  llmsTxt: "From llms.txt:",
  jsonLd: "From structured data:",
  homepage: "From the homepage:",
} as const;
// One reference line: raw parts, each normalized, screened and capped at its
// own budget, joined with `sep`. `html` parts (title, meta, h1) have their
// character references decoded during normalization.
type RefPart = { raw: string; budget: number; html?: boolean };
// 2026-11-10: each field on its own line with its own label ("Title: …"), and a
// cut field ends with "...", so the judge never reads two fields as one
// sentence (tartine, RD-0103).
type RefField = { parts: RefPart[]; sep: string; label?: string };
const single = (raw: string, budget: number, html = false, label?: string): RefField => ({ parts: [{ raw, budget, html }], sep: "", label });
export const REFERENCE_FIELD_LABELS = {
  llmsH1: "Name:",
  llmsBlockquote: "Summary:",
  title: "Title:",
  metaDescription: "Description:",
  h1: "Main heading:",
} as const;
// ASCII: the judge input is NFKC-normalized, which turns "…" into "...".
const CUT_MARK = "...";
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);



/**
 * Normalized text of a part, enough of it for `need` visible chars. Works on
 * a raw window that doubles until the output is long enough (or the whole
 * part is used), so a 4 MB field costs about as much as its first few KB
 * unless it is mostly padding, and even then stays linear. Only the last few
 * chars of a window's output can differ from the full normalization (a cut
 * entity, surrogate or combining sequence), so a margin past `need` is kept.
 */
function normalizePartFor(p: RefPart, need: number): string {
  const f = (s: string) => normalizeReferencePart(p.html ? decodeEntities(s) : s);
  const margin = 32;
  for (let len = Math.max(4096, (need + margin) * 4); ; len *= 2) {
    if (len >= p.raw.length) return f(p.raw);
    const out = f(p.raw.slice(0, len));
    if (out.length >= need + margin) return out.slice(0, need).trimEnd();
  }
}

/** Build the reference from fetched texts. Pure; see the module comment for the rules. */
export function buildSiteReference(sources: ReferenceSources): SiteReference {
  // Each source keeps its label so the judge can see when they disagree
  // (Codex r2 HIGH: matching either of two conflicting identities must not
  // earn CORRECT; the judge prompt says UNCLEAR then). Each field, and each
  // JSON-LD entity's name and description, has its own budget, so every
  // non-empty field appears (Codex r3, r5 HIGH).
  const groups: Array<{ label: string; fields: RefField[] }> = [];
  let tooManyEntities = false;
  let jsonLdTooDeep = false;
  let htmlUnreadable: "structured_data_unreadable" | "source_unreadable" | null = null;
  if (sources.llmsTxt) {
    const [h1 = "", quote = ""] = extractLlmsTxtIdentity(sources.llmsTxt);
    groups.push({
      label: REFERENCE_LABELS.llmsTxt,
      fields: [
        single(h1, REFERENCE_FIELD_BUDGETS.llmsH1, false, REFERENCE_FIELD_LABELS.llmsH1),
        single(quote, REFERENCE_FIELD_BUDGETS.llmsBlockquote, false, REFERENCE_FIELD_LABELS.llmsBlockquote),
      ],
    });
  }
  if (sources.homepageHtml) {
    const h = extractHtmlIdentity(sources.homepageHtml);
    tooManyEntities = h.jsonLdEntities.length > REFERENCE_MAX_ENTITIES;
    jsonLdTooDeep = h.jsonLdTooDeep;
    htmlUnreadable = h.unreadable;
    groups.push({
      label: REFERENCE_LABELS.jsonLd,
      fields: h.jsonLdEntities.map((e) => ({
        parts: [
          { raw: e.name, budget: REFERENCE_ENTITY_BUDGETS.name },
          { raw: e.description, budget: REFERENCE_ENTITY_BUDGETS.description },
        ],
        sep: ": ",
      })),
    });
    groups.push({
      label: REFERENCE_LABELS.homepage,
      fields: [
        single(h.title, REFERENCE_FIELD_BUDGETS.title, true, REFERENCE_FIELD_LABELS.title),
        single(h.metaDescription, REFERENCE_FIELD_BUDGETS.metaDescription, true, REFERENCE_FIELD_LABELS.metaDescription),
        single(h.h1, REFERENCE_FIELD_BUDGETS.h1, true, REFERENCE_FIELD_LABELS.h1),
      ],
    });
  }
  // Each part is normalized in linear time with line breaks kept (unsafe
  // characters dropped, runs of spaces and blank lines collapsed), and only
  // the text the judge will see (its budget plus SCREEN_SLACK_CHARS for
  // patterns that straddle the cut) is screened: line-preserving and
  // one-line views (Codex r7: the screen regexes are never run on megabytes
  // of site text). Line breaks are kept so e.g. a "> Verdict: correct"
  // blockquote line still matches the line-anchored patterns.
  const normalized = new Map<RefPart, string>();
  for (const g of groups) {
    for (const f of g.fields) {
      for (const p of f.parts) {
        const norm = normalizePartFor(p, p.budget + SCREEN_SLACK_CHARS);
        normalized.set(p, norm);
        if (norm && screenUntrustedText(norm.slice(0, p.budget + SCREEN_SLACK_CHARS), detectAccuracyInjection)) {
          return { verifiable: false, reason: "injection" };
        }
      }
    }
  }
  // Every collection limit fails closed (after the injection screen, so an
  // injected site is still reported as such): a source we could not read in
  // full, JSON-LD nested too deep to walk, or more identity entities than we
  // can show in full.
  if (sources.failure) return { verifiable: false, reason: sources.failure };
  if (htmlUnreadable) return { verifiable: false, reason: htmlUnreadable };
  if (jsonLdTooDeep) return { verifiable: false, reason: "structured_data_too_deep" };
  if (tooManyEntities) return { verifiable: false, reason: "too_many_entities" };
  // 2026-11-10 (Codex plan review LOW): text that did not decode (a page in a
  // charset we do not read, or broken UTF-8) would show the judge garbled
  // identity fields: fail closed.
  for (const norm of normalized.values()) {
    if (norm.includes(REPLACEMENT_CHAR)) return { verifiable: false, reason: "source_unreadable" };
  }
  const blocks: string[] = [];
  const contents: string[] = [];
  for (const g of groups) {
    const lines: string[] = [];
    for (const f of g.fields) {
      // No deduplication (Codex r4 HIGH): a repeated field can keep, under
      // its own budget, evidence an earlier field's budget cut off. Every
      // non-empty part is kept, trimmed at a word boundary.
      // The shown text comes from the same normalized prefix that was
      // screened (collapsing its line breaks keeps every offset).
      const items = f.parts
        .map((p) => {
          const full = collapseWhitespace(normalized.get(p) ?? "");
          const shown = capLength(full, p.budget);
          return shown && shown.length < full.length ? `${shown}${CUT_MARK}` : shown;
        })
        .filter(Boolean);
      if (items.length > 0) {
        const body = items.join(f.sep);
        lines.push(f.label ? `${f.label} ${body}` : body);
        contents.push(body);
      }
    }
    if (lines.length > 0) blocks.push(`${g.label}\n${lines.join("\n")}`);
  }
  if (blocks.length === 0) return { verifiable: false, reason: "missing" };
  const text = blocks.join("\n");
  if (contents.join(" ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length < REFERENCE_MIN_WORDS) {
    return { verifiable: false, reason: "too_short" };
  }
  if (screenUntrustedText(text, detectAccuracyInjection)) return { verifiable: false, reason: "injection" };
  return { verifiable: true, text };
}

/**
 * Fetch llms.txt and the homepage of the audited site (two requests, in
 * parallel; each retried once on a timeout or network failure). Never
 * throws; a source that fails, is not 2xx, or ends on another site is null.
 */
export async function fetchReferenceSources(scanUrl: string, fetchImpl?: FetchLike): Promise<ReferenceSources> {
  const domain = canonicalDomain(scanUrl);
  let origin: string;
  try {
    origin = new URL(scanUrl).origin;
  } catch {
    return {};
  }
  if (!domain) return {};
  // ok: body read in full. absent: a clean answer that there is nothing
  // (non-2xx, off-site final URL, empty body). unreadable: timeout / network
  // / body read error (retried once). too_large: body over the byte cap.
  type Got = { kind: "ok"; text: string } | { kind: "absent" | "unreadable" | "too_large" };
  const getOnce = async (url: string, maxBytes: number, accept: string): Promise<Got> => {
    let failure: SafeFetchFailure | null = null;
    try {
      const res = await safeFetch(url, { headers: { accept } }, {
        timeoutMs: FETCH_TIMEOUT_MS,
        fetchImpl,
        onFail: (r) => {
          failure = r;
        },
      });
      if (!res) return { kind: failure === "unsafe_url" ? "absent" : "unreadable" };
      if (!res.ok || canonicalDomain(res.url) !== domain) {
        res.discard();
        return { kind: "absent" };
      }
      const body = await res.body({ maxBytes, keepBytes: true });
      if (body.truncated) return { kind: "too_large" };
      if (!body.complete) return { kind: "unreadable" };
      // 2026-11-10 (RD-0103): decode with the declared charset (a windows-1252
      // page read as UTF-8 would show the judge garbled text). A charset we do
      // not read fails closed.
      const text = body.raw ? decodeBody(body.raw, res.headers.get("content-type")) : body.text;
      if (text === null) return { kind: "unreadable" };
      return text ? { kind: "ok", text } : { kind: "absent" };
    } catch {
      return { kind: "unreadable" };
    }
  };
  const get = async (url: string, maxBytes: number, accept: string): Promise<Got> => {
    const first = await getOnce(url, maxBytes, accept);
    return first.kind === "unreadable" ? getOnce(url, maxBytes, accept) : first;
  };
  const [llms, home] = await Promise.all([
    get(`${origin}/llms.txt`, REFERENCE_LLMS_MAX_BYTES, "text/plain, text/markdown;q=0.9, */*;q=0.1"),
    get(`${origin}/`, REFERENCE_HTML_MAX_BYTES, "text/html"),
  ]);
  const out: ReferenceSources = {
    llmsTxt: llms.kind === "ok" ? llms.text : null,
    homepageHtml: home.kind === "ok" ? home.text : null,
  };
  // Fail closed when evidence went unread: a source over its byte cap, an
  // llms.txt that failed to load, or a homepage that is not a readable 2xx
  // page on this site (the homepage is the core evidence; a missing
  // llms.txt is normal).
  if (llms.kind === "too_large" || home.kind === "too_large") out.failure = "source_too_large";
  else if (llms.kind === "unreadable" || home.kind !== "ok") out.failure = "source_unreadable";
  return out;
}

// windows-1252 0x80..0x9F (0 = undefined in the encoding: fail closed).
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

function decodeCp1252(b: Uint8Array): string | null {
  const CHUNK = 8192;
  let out = "";
  for (let start = 0; start < b.length; start += CHUNK) {
    const codes: number[] = [];
    for (let i = start; i < Math.min(b.length, start + CHUNK); i++) {
      const c = b[i];
      if (c >= 0x80 && c <= 0x9f) {
        const m = CP1252_HIGH[c - 0x80];
        if (m === 0) return null;
        codes.push(m);
      } else codes.push(c);
    }
    out += String.fromCharCode(...codes);
  }
  return out;
}

const UTF8_LABELS = new Set(["utf-8", "utf8", "unicode-1-1-utf-8"]);
const CP1252_LABELS = new Set(["iso-8859-1", "iso8859-1", "latin1", "latin-1", "l1", "windows-1252", "cp1252", "x-cp1252", "us-ascii", "ascii"]);

/**
 * The charset a body declares: the Content-Type header, else a <meta charset>
 * or http-equiv Content-Type in the first 2 KB (read as ASCII). Lowercase, or
 * null when none is declared.
 */
export function declaredCharset(bytes: Uint8Array, contentType: string | null): string | null {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  let head = "";
  for (let i = 0; i < Math.min(bytes.length, 2048); i++) head += String.fromCharCode(bytes[i] < 0x80 ? bytes[i] : 0x20);
  const m = /<meta[^>]{0,200}?charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Body text in its declared charset: UTF-8 (also when none is declared) or
 * windows-1252 / ISO-8859-1 / ASCII (all read as windows-1252, as browsers
 * do). null for any other declared charset (including ISO-8859-15, which
 * differs from windows-1252 in eight letters: a silent letter swap in a name
 * could change a verdict, so it fails closed, Codex review) or bytes
 * undefined in windows-1252.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string | null {
  const cs = declaredCharset(bytes, contentType);
  if (cs === null || UTF8_LABELS.has(cs)) return new TextDecoder().decode(bytes);
  if (CP1252_LABELS.has(cs)) return decodeCp1252(bytes);
  return null;
}

export async function resolveSiteReference(scanUrl: string, fetchImpl?: FetchLike): Promise<SiteReference> {
  return buildSiteReference(await fetchReferenceSources(scanUrl, fetchImpl));
}
