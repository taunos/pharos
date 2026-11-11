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
import { boundSiteNames, containsNameWords, parseStreetAddresses, siteStreetAddresses, type SiteName, type StreetAddress } from "./site-identity";

// dim6:v6: title 60 -> 120 (tartine's title is a sentence; cut at 60 and run
// on into the h1 it read "Tartine is a thoughtful expression of Home", RD-0103).
export const REFERENCE_FIELD_BUDGETS = {
  llmsH1: 80,
  llmsBlockquote: 500,
  // 2026-11-11 (gold labels): the body of llms.txt is where most sites state
  // their services, location and contact details (the gold evidence quotes it
  // for every dev site); the judge needs it to tell a supported claim from an
  // unsupported one.
  llmsBody: 3000,
  title: 120,
  metaDescription: 120,
  // 2026-11-11 (held-out patterns, thin homepages): og:description, the
  // structured-data addresses, the homepage's visible text (navigation
  // included: it lists what the site offers) and one about-type and one
  // contact-type page the homepage links to. Each bounded; a page that
  // cannot be read is left out (less evidence can only lower credit).
  ogDescription: 160,
  h1: 60,
  pageText: 1500,
  navText: 800,
  jsonLdAddresses: 240,
  aboutText: 2000,
  contactText: 1500,
} as const;
/** Per JSON-LD identity entity. */
export const REFERENCE_ENTITY_BUDGETS = { name: 50, description: 120 } as const;
export const REFERENCE_MAX_ENTITIES = 8;
/**
 * Most content the reference can hold: 10080 for the fixed fields (since
 * 2026-11-11: llms.txt body, longer summary, page text, navigation, about and
 * contact pages) plus 170 per entity x 8 = 11440 chars (labels and line breaks come on top). With a 6000-
 * char answer and the instructions the judge prompt stays around 19,000 chars
 * (~6,000 tokens), well inside the 70B model's 24k-token context.
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
/** About / contact page byte cap; a longer page is left out (not read in part). */
export const SECONDARY_PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const REFERENCE_LLMS_MAX_BYTES = 512 * 1024;
export const REFERENCE_JSONLD_MAX_DEPTH = 20;

export type ReferenceFailure = "source_unreadable" | "source_too_large";

export type SiteReference =
  | {
      verifiable: true;
      text: string;
      // dim6:v6 (site-identity.ts): the site's own names bound to its domain,
      // and the street addresses its structured data states for itself.
      names: SiteName[];
      addresses: SiteAddresses;
    }
  | {
      verifiable: false;
      reason: "missing" | "too_short" | "injection" | "too_many_entities" | "structured_data_too_deep" | "structured_data_unreadable" | ReferenceFailure;
    };

export interface ReferenceSources {
  llmsTxt?: string | null;
  homepageHtml?: string | null;
  // dim6:v6: the audited domain, for the bound names and addresses
  // (site-identity.ts). Absent → no names, no addresses.
  domain?: string | null;
  // Set by fetchReferenceSources when a source could not be read in full.
  failure?: ReferenceFailure;
  // 2026-11-11: one about-type and one contact-type page the homepage links
  // to on the same site (HTML), when they could be read; otherwise absent.
  aboutHtml?: string | null;
  contactHtml?: string | null;
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

/**
 * llms.txt: the text after the H1 and its blockquote (raw lines kept), or ""
 * when the file has no H1 on its first non-empty line (not an llms.txt).
 */
export function extractLlmsTxtBody(txt: string): string {
  const lines = txt.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (!/^#\s+(.+)$/.test(lines[i]?.trim() ?? "")) return "";
  i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  while (i < lines.length && /^\s*>/.test(lines[i])) i++;
  return raw(lines.slice(i).join("\n"));
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
  // dim6:v6: every identity entity's name, url / @id and streetAddress values
  // (before deduplication), for the bound names and addresses.
  jsonLdFacts: Array<{ name: string; urls: string[]; streets: string[] }>;
  ogSiteName: string;
  /** 2026-11-11: og:description, the page's visible text, and same-site about / contact links. */
  ogDescription: string;
  visibleText: string;
  navText: string;
  aboutHref: string | null;
  contactHref: string | null;
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
  const jsonLdFacts: Array<{ name: string; urls: string[]; streets: string[] }> = [];
  const seenEntities = new Set<string>();
  const entities: Array<Record<string, unknown>> = [];
  let jsonLdTooDeep = false;
  let unreadable: "structured_data_unreadable" | "source_unreadable" | null = null;
  const empty = { jsonLdEntities, jsonLdFacts, ogSiteName: "", ogDescription: "", visibleText: "", navText: "", aboutHref: null, contactHref: null, jsonLdTooDeep, title: "", metaDescription: "", h1: "" };
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
    jsonLdFacts.push({ name, urls: [valueText(e.url), valueText(e["@id"])].filter(Boolean), streets: streetValues(e.address) });
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
  let metaDescription: string | null = null;
  let ogSiteName: string | null = null;
  let ogDescription: string | null = null;
  let metaUnclosed = false;
  for (let from = 0; metaDescription === null || ogSiteName === null || ogDescription === null; ) {
    const tag = nextTag(markup, lower, "meta", from);
    if (tag === null) break;
    if (tag === "unclosed") {
      metaUnclosed = true;
      break;
    }
    if (metaDescription === null && decodeEntities(tag.attrs.name ?? "").trim().toLowerCase() === "description") {
      metaDescription = raw(tag.attrs.content ?? "");
    }
    if (ogSiteName === null && decodeEntities(tag.attrs.property ?? "").trim().toLowerCase() === "og:site_name") {
      ogSiteName = raw(decodeEntities(tag.attrs.content ?? ""));
    }
    if (ogDescription === null && decodeEntities(tag.attrs.property ?? "").trim().toLowerCase() === "og:description") {
      ogDescription = raw(tag.attrs.content ?? "");
    }
    from = tag.end + 1;
  }
  // An unclosed meta before the description was found hides it: fail closed
  // (as in v5). After it, only og:site_name (names, never shown) is lost.
  if (titleText === null || h1Text === null || (metaUnclosed && metaDescription === null)) unreadable = "source_unreadable";
  const title = raw(titleText ?? "");
  const h1 = raw(stripTagsLinear(h1Text ?? ""));
  const links = pageLinks(markup, lower);
  const texts = pageTextsOf(markup, lower);
  return {
    jsonLdEntities,
    jsonLdFacts,
    ogSiteName: ogSiteName ?? "",
    ogDescription: ogDescription ?? "",
    visibleText: texts.main,
    navText: texts.nav,
    aboutHref: links.about,
    contactHref: links.contact,
    jsonLdTooDeep,
    unreadable,
    title,
    metaDescription: metaDescription ?? "",
    h1,
  };
}

/** Raw characters of visible text read from a page (before normalization and the field budget). */
export const VISIBLE_TEXT_SCAN_CHARS = 400_000;

/**
 * The contents of the first <name> element of `markup` ("" when none), and
 * `markup` with every <name> element's contents blanked (same length).
 * Linear (indexOf scanning, see nextTag / findEndTag).
 */
function splitElements(markup: string, lower: string, name: string): { first: string; rest: string; restLower: string } {
  let first = "";
  let out = "";
  let copied = 0;
  for (let from = 0, n = 0; n < 200; n++) {
    const tag = nextTag(markup, lower, name, from);
    if (tag === null || tag === "unclosed") break;
    const close = findEndTag(lower, name, tag.end + 1);
    if (close === -1) break;
    if (!first) first = markup.slice(tag.end + 1, close);
    out += markup.slice(copied, tag.end + 1) + " ".repeat(close - tag.end - 1);
    copied = close;
    from = close + name.length + 2;
  }
  const rest = out + markup.slice(copied);
  return { first, rest, restLower: asciiLower(rest) };
}

/**
 * The page's main visible text and its navigation text (raw, line breaks at
 * block tags kept), from `markup` (script, style, textarea and title contents
 * already blanked, see blankComments): the <main> element when there is one,
 * else the body without <nav>, <header> and <footer> (site menus repeated on
 * every page would use up the budget, 2026-11-11 dev check). Linear; at most
 * VISIBLE_TEXT_SCAN_CHARS characters of markup are read.
 */
function pageTextsOf(markup: string, lower: string): { main: string; nav: string } {
  const b = lower.indexOf("<body");
  const from = b === -1 ? 0 : b;
  const body0 = markup.slice(from, from + VISIBLE_TEXT_SCAN_CHARS);
  const nav = linkTexts(body0, asciiLower(body0)).join(" · ");
  // The main content starts at the page's <main> element when it has one,
  // wherever it is (a store page had 760 KB of markup before it, 2026-11-11).
  const mainTag = nextTag(markup, lower, "main", 0);
  const m = mainTag && mainTag !== "unclosed" ? mainTag.end + 1 : -1;
  const body = m === -1 ? body0 : markup.slice(m, m + VISIBLE_TEXT_SCAN_CHARS);
  const bodyLower = asciiLower(body);
  const navs = splitElements(body, bodyLower, "nav");
  const headers = splitElements(navs.rest, navs.restLower, "header");
  const footers0 = splitElements(headers.rest, headers.restLower, "footer");
  // Widgets are not page text: country / language selectors, forms, icons,
  // dialogs and buttons (a store's country list filled the budget, 2026-11-11).
  let footers = footers0;
  for (const el of ["select", "form", "svg", "dialog", "button"]) {
    const next = splitElements(footers.rest, footers.restLower, el);
    footers = { ...footers, rest: next.rest, restLower: next.restLower };
  }
  // From a <main> start the window runs to its end (or the scan cap); without
  // one, the body minus menus and widgets.
  const mainEnd = m === -1 ? -1 : findEndTag(footers.restLower, "main", 0);
  const mainEl = m === -1 ? footers.rest : mainEnd === -1 ? footers.rest : footers.rest.slice(0, mainEnd);
  const text = (h: string) => raw(decodeEntities(stripTagsLinear(withBreaks(h))));
  // Link text is menus (section and sidebar menus sit inside the content
  // area too, 2026-11-11 dev check): the main text leaves it out, and the
  // navigation field is the page's distinct link texts.
  const noLinks = splitElements(mainEl, asciiLower(mainEl), "a").rest;
  return { main: text(noLinks), nav };
}

/** The distinct texts of the page's links, in order (at most 300 links). Linear. */
function linkTexts(markup: string, lower: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let from = 0, n = 0; n < 300; n++) {
    const tag = nextTag(markup, lower, "a", from);
    if (tag === null || tag === "unclosed") break;
    const close = findEndTag(lower, "a", tag.end + 1);
    if (close === -1) break;
    const t = collapseWhitespace(decodeEntities(stripTagsLinear(markup.slice(tag.end + 1, close))));
    if (t && t.length <= 60 && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
    from = close + 3;
  }
  return out;
}

function withBreaks(chunk: string): string {
  return chunk.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/header|\/footer|\/nav)\b[^>]{0,200}>/gi, (m) => `${m}\n`);
}

/** Words of a common prefix / suffix shorter than this are kept (not a shared header). */
const SHARED_EDGE_MIN_WORDS = 5;

/**
 * `text` without the words it shares with `home` at its start and at its
 * end (at least SHARED_EDGE_MIN_WORDS words each): a site-wide header and
 * footer. Linear in the word counts.
 */
export function withoutSharedEdges(text: string, home: string): string {
  // Words compared, the text's own whitespace kept: line breaks matter to the
  // line-anchored injection screen (Codex review 2026-11-11 MED).
  const parts = text.split(/(\s+)/);
  const t: number[] = [];
  for (let i = 0; i < parts.length; i++) if (parts[i] && !/^\s+$/.test(parts[i])) t.push(i);
  const h = home.split(/\s+/).filter(Boolean);
  let pre = 0;
  while (pre < t.length && pre < h.length && parts[t[pre]] === h[pre]) pre++;
  if (pre < SHARED_EDGE_MIN_WORDS) pre = 0;
  let suf = 0;
  while (suf < t.length - pre && suf < h.length && parts[t[t.length - 1 - suf]] === h[h.length - 1 - suf]) suf++;
  if (suf < SHARED_EDGE_MIN_WORDS) suf = 0;
  if (pre + suf >= t.length) return "";
  return parts.slice(t[pre], t[t.length - 1 - suf] + 1).join("");
}

/** The page's visible text (main content first, see pageTextsOf). */
function visibleTextOf(markup: string, lower: string): string {
  return pageTextsOf(markup, lower).main;
}


// Paths of an about-type and a contact-type page, in the languages of the
// panel and the usual small-business wordings.
const ABOUT_PATH = /(?:^|\/)(?:about(?:-us)?|our-story|story|company|who-we-are|sobre(?:-nos|-mi)?|quem-somos|nosotros|acerca(?:-de)?|ueber-uns|uber-uns|a-propos|qui-sommes-nous|chi-siamo)(?:\/|$|\.html?$)/i;
const CONTACT_PATH = /(?:^|\/)(?:contact(?:-us)?|contato|contacto|kontakt|fale-conosco|contatti|nous-contacter)(?:\/|$|\.html?$)/i;

/** The first about-type and contact-type link of the page (raw href values). Linear over the a tags. */
function pageLinks(markup: string, lower: string): { about: string | null; contact: string | null } {
  let about: string | null = null;
  let contact: string | null = null;
  for (let from = 0, n = 0; (about === null || contact === null) && n < 2000; n++) {
    const tag = nextTag(markup, lower, "a", from);
    if (tag === null || tag === "unclosed") break;
    from = tag.end + 1;
    const href = decodeEntities(tag.attrs.href ?? "").trim();
    if (!href || href.startsWith("#") || /^(?:mailto|tel|javascript):/i.test(href)) continue;
    const path = href.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "").split(/[?#]/)[0];
    if (about === null && ABOUT_PATH.test(path)) about = href;
    else if (contact === null && CONTACT_PATH.test(path)) contact = href;
  }
  return { about, contact };
}

/** streetAddress values of a JSON-LD address: a string, a PostalAddress, or an array of those. */
function streetValues(v: unknown, depth = 0): string[] {
  if (depth > 2 || v === null || v === undefined) return [];
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (Array.isArray(v)) return v.flatMap((x) => streetValues(x, depth + 1));
  if (typeof v === "object") {
    const s = valueText((v as Record<string, unknown>).streetAddress);
    return s ? [s] : [];
  }
  return [];
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
export function blankComments(page: string): { html: string; markup: string; complete: boolean } | null {
  const lower = asciiLower(page);
  const html: string[] = [];
  const markup: string[] = [];
  let copied = 0;
  // false when a raw-text element (script, style, textarea, title) never
  // closes: a browser shows nothing after it.
  let complete = true;
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
      if (!tag) {
        complete = false;
        break; // unclosed start tag: the extractor fails closed on it
      }
      const close = findEndTag(lower, rawEl, tag.end + 1);
      if (close === -1) {
        complete = false;
        break; // unclosed element: likewise
      }
      blank(tag.end + 1, close, false);
      i = close + rawEl.length + 2;
      continue;
    }
    i = lt + 1;
  }
  html.push(page.slice(copied));
  markup.push(page.slice(copied));
  return { html: html.join(""), markup: markup.join(""), complete };
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
  about: "From the about page:",
  contact: "From the contact page:",
} as const;
// One reference line: raw parts, each normalized, screened and capped at its
// own budget, joined with `sep`. `html` parts (title, meta, h1) have their
// character references decoded during normalization.
type RefPart = { raw: string; budget: number; html?: boolean };
// dim6:v6: each field on its own line with its own label ("Title: …"), and a
// cut field ends with "...", so the judge never reads two fields as one
// sentence (tartine, RD-0103).
type RefField = { parts: RefPart[]; sep: string; label?: string };
const single = (raw: string, budget: number, html = false, label?: string): RefField => ({ parts: [{ raw, budget, html }], sep: "", label });
export const REFERENCE_FIELD_LABELS = {
  llmsH1: "Name:",
  llmsBlockquote: "Summary:",
  llmsBody: "Details:",
  ogDescription: "Social description:",
  pageText: "Page text:",
  navText: "Navigation:",
  jsonLdAddresses: "Address:",
  title: "Title:",
  metaDescription: "Description:",
  h1: "Main heading:",
} as const;
// ASCII: the judge input is NFKC-normalized, which turns "…" into "...".
const CUT_MARK = "...";
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
/** Visible homepage text read for the addresses an answer may give (site-identity.ts). */
export const REFERENCE_VISIBLE_TEXT_MAX = 200_000;

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
  // dim6:v6: raw declared names and addresses (site-identity.ts).
  const declaredNames: string[] = [];
  let html: ReturnType<typeof extractHtmlIdentity> | null = null;
  if (sources.llmsTxt) {
    const [h1 = "", quote = ""] = extractLlmsTxtIdentity(sources.llmsTxt);
    declaredNames.push(h1);
    groups.push({
      label: REFERENCE_LABELS.llmsTxt,
      fields: [
        single(h1, REFERENCE_FIELD_BUDGETS.llmsH1, false, REFERENCE_FIELD_LABELS.llmsH1),
        single(quote, REFERENCE_FIELD_BUDGETS.llmsBlockquote, false, REFERENCE_FIELD_LABELS.llmsBlockquote),
        single(extractLlmsTxtBody(sources.llmsTxt), REFERENCE_FIELD_BUDGETS.llmsBody, false, REFERENCE_FIELD_LABELS.llmsBody),
      ],
    });
  }
  if (sources.homepageHtml) {
    const h = extractHtmlIdentity(sources.homepageHtml);
    html = h;
    declaredNames.push(...h.jsonLdFacts.map((e) => e.name), h.ogSiteName, decodeEntities(h.title));
    tooManyEntities = h.jsonLdEntities.length > REFERENCE_MAX_ENTITIES;
    jsonLdTooDeep = h.jsonLdTooDeep;
    htmlUnreadable = h.unreadable;
    // Only the addresses of entities bound to this site (same rule as
    // siteAddresses: a URL on the domain or a bound site name). A graph can
    // list other businesses; their address unlabelled would back a wrong
    // answer (Codex review 2026-11-11 HIGH).
    const dom = sources.domain ?? "";
    const boundNow = dom ? boundSiteNames(declaredNames, dom) : [];
    const streets = dom
      ? [...new Set(h.jsonLdFacts.filter((e) => e.urls.some((u) => canonicalDomain(u) === dom) || boundNow.some((n) => containsNameWords(e.name, n))).flatMap((e) => e.streets))]
      : [];
    groups.push({
      label: REFERENCE_LABELS.jsonLd,
      fields: [
        ...h.jsonLdEntities.map((e) => ({
          parts: [
            { raw: e.name, budget: REFERENCE_ENTITY_BUDGETS.name },
            { raw: e.description, budget: REFERENCE_ENTITY_BUDGETS.description },
          ],
          sep: ": ",
        })),
        ...(streets.length > 0 ? [single(streets.join("; "), REFERENCE_FIELD_BUDGETS.jsonLdAddresses, false, REFERENCE_FIELD_LABELS.jsonLdAddresses)] : []),
      ],
    });
    groups.push({
      label: REFERENCE_LABELS.homepage,
      fields: [
        single(h.title, REFERENCE_FIELD_BUDGETS.title, true, REFERENCE_FIELD_LABELS.title),
        single(h.metaDescription, REFERENCE_FIELD_BUDGETS.metaDescription, true, REFERENCE_FIELD_LABELS.metaDescription),
        ...(h.ogDescription && h.ogDescription !== h.metaDescription
          ? [single(h.ogDescription, REFERENCE_FIELD_BUDGETS.ogDescription, true, REFERENCE_FIELD_LABELS.ogDescription)]
          : []),
        single(h.h1, REFERENCE_FIELD_BUDGETS.h1, true, REFERENCE_FIELD_LABELS.h1),
        single(h.visibleText, REFERENCE_FIELD_BUDGETS.pageText, false, REFERENCE_FIELD_LABELS.pageText),
        single(h.navText, REFERENCE_FIELD_BUDGETS.navText, false, REFERENCE_FIELD_LABELS.navText),
      ],
    });
  }
  // Secondary pages: their visible text only (their own structured data and
  // titles are not identity claims about the site as a whole).
  for (const [html2, label, budget] of [
    [sources.aboutHtml, REFERENCE_LABELS.about, REFERENCE_FIELD_BUDGETS.aboutText],
    [sources.contactHtml, REFERENCE_LABELS.contact, REFERENCE_FIELD_BUDGETS.contactText],
  ] as const) {
    if (!html2) continue;
    const pass2 = blankComments(html2);
    // An unclosed comment, script, style, textarea or title hides the rest of
    // the page from a browser: the page is dropped (Codex review 2026-11-11
    // MED, rounds 1-2).
    if (!pass2 || !pass2.complete) continue;
    // Drop what the page shares with the homepage at its start and end: the
    // site-wide header and footer (menus not marked up as <nav>/<header>/
    // <footer> would otherwise fill the budget, 2026-11-11 dev check).
    const text2 = withoutSharedEdges(visibleTextOf(pass2.markup, asciiLower(pass2.markup)), html?.visibleText ?? "");
    // Text that did not decode drops only this page (the homepage stays the core evidence).
    if (text2 && !text2.includes(REPLACEMENT_CHAR)) groups.push({ label, fields: [single(text2, budget, false, REFERENCE_FIELD_LABELS.pageText)] });
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
  // dim6:v6 (Codex plan review LOW): text that did not decode (a page in a
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
      // non-empty part is kept, trimmed at a word boundary, marked when cut.
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
  const domain = sources.domain ?? "";
  const names = domain ? boundSiteNames(declaredNames, domain) : [];
  return { verifiable: true, text, names, addresses: domain && html ? siteAddresses(html, domain, names, sources.homepageHtml ?? "") : { declared: [], accepted: [] } };
}

/**
 * dim6:v6: the site's street addresses (site-identity.ts). `declared`: from
 * JSON-LD identity entities bound to the site (url / @id on this domain, or
 * the site's own name in the entity name); the address check runs only when
 * there is one. `accepted`: those plus every address in the homepage's
 * visible text (drveit lists a third clinic only there), the addresses an
 * answer may give and still count.
 */
function siteAddresses(
  h: ReturnType<typeof extractHtmlIdentity>,
  domain: string,
  names: SiteName[],
  page: string
): SiteAddresses {
  const bound = h.jsonLdFacts.filter(
    (e) => e.urls.some((u) => canonicalDomain(u) === domain) || names.some((n) => containsNameWords(e.name, n))
  );
  const declared = siteStreetAddresses(bound.flatMap((e) => e.streets));
  if (declared.length === 0) return { declared, accepted: [] };
  const pass = blankComments(page);
  const visible = pass ? decodeEntities(stripTagsLinear(pass.markup.slice(0, REFERENCE_HTML_MAX_BYTES))).slice(0, REFERENCE_VISIBLE_TEXT_MAX) : "";
  const accepted = [...declared];
  for (const a of parseStreetAddresses(visible, REFERENCE_VISIBLE_TEXT_MAX)) {
    if (!accepted.some((x) => x.street === a.street && x.number === a.number)) accepted.push(a);
  }
  return { declared, accepted };
}

export interface SiteAddresses {
  declared: StreetAddress[];
  accepted: StreetAddress[];
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
  type Got = { kind: "ok"; text: string; url: string } | { kind: "absent" | "unreadable" | "too_large" };
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
      // dim6:v6: decode with the declared charset (a windows-1252 page read
      // as UTF-8 would show the judge garbled text). A charset we do not read
      // fails closed.
      const text = body.raw ? decodeBody(body.raw, res.headers.get("content-type")) : body.text;
      if (text === null) return { kind: "unreadable" };
      return text ? { kind: "ok", text, url: res.url || url } : { kind: "absent" };
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
    domain,
  };
  // One about-type and one contact-type page the homepage links to, same site
  // only (the final URL is checked like the homepage's). A page that cannot be
  // read is left out: it can only remove evidence, never add credit.
  if (home.kind === "ok") {
    const pass = blankComments(home.text);
    const links = pass ? pageLinks(pass.markup, asciiLower(pass.markup)) : { about: null, contact: null };
    // A <base href> changes what relative links point to (Codex review round 2).
    let base = home.url;
    // The first <base> that has an href counts, as in a browser (Codex round 3).
    if (pass) {
      const lower = asciiLower(pass.markup);
      for (let from = 0, n = 0; n < 50; n++) {
        const tag = nextTag(pass.markup, lower, "base", from);
        if (tag === null || tag === "unclosed") break;
        from = tag.end + 1;
        if (tag.attrs.href === undefined) continue;
        try {
          base = new URL(decodeEntities(tag.attrs.href).trim(), home.url).href;
        } catch {
          // an unparseable base: keep the page URL
        }
        break;
      }
    }
    const resolve = (href: string | null): string | null => {
      if (!href) return null;
      try {
        // Relative to the page the homepage really is (after redirects), not the
        // origin root (Codex review 2026-11-11 MED).
        const u = new URL(href, base);
        return canonicalDomain(u.href) === domain && (u.protocol === "https:" || u.protocol === "http:") ? u.href.split("#")[0] : null;
      } catch {
        return null;
      }
    };
    const [about, contact] = await Promise.all(
      [resolve(links.about), resolve(links.contact)].map((u) => (u ? getOnce(u, SECONDARY_PAGE_MAX_BYTES, "text/html") : Promise.resolve(null)))
    );
    if (about?.kind === "ok") out.aboutHtml = about.text;
    if (contact?.kind === "ok") out.contactHtml = contact.text;
  }
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
 * do). null for any other declared charset or bytes undefined in it.
 * ISO-8859-15 is not read: it differs from windows-1252 in eight letters,
 * and a silent letter swap in a name could change a verdict (Codex review),
 * so it fails closed like any other charset we do not read.
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
