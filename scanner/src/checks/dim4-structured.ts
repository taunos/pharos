import type { DimensionResult, Env, SubCheck, SubCheckEvidence } from "../types";
import { dimensionScoreOrThrow, gradeFor } from "../scoring";
import { cleanSiteText } from "./llm-safety";
import { MAX_HTML_BYTES, safeFetch, type SafeResponse } from "../safe-fetch";
import { isSameSite, productPathKind, siteBase } from "./site-signals";
import { PRICE_BARE_RE, stripTags } from "./dim5-parsable";

const FETCH_TIMEOUT_MS = 8000;

/** review_schema N/A note (1.3.2): shown in the Score and Audit reports. */
export const REVIEW_SCHEMA_NA_NOTE =
  "No Review or AggregateRating markup found. Ratings markup is optional: add it only for real, verifiable ratings, never invented ones. This check is not counted in your score.";

/** faq_schema N/A note (1.3.3): no FAQPage markup on the homepage. */
export const FAQ_SCHEMA_NA_NOTE =
  "No FAQPage markup found. FAQ markup is optional: add it only for questions the site really answers. This check is not counted in your score.";

/**
 * 1.4.0: Dim 4 sub-check note when the JSON-LD is deeper or larger than the
 * scanner reads, so absence of a type cannot be claimed.
 */
export const notFullyInspectedNote = (what: string) =>
  `Not fully inspected: this page's JSON-LD is nested deeper or is larger than the scanner reads, so it could not confirm whether ${what} markup is present. This check is not counted in your score.`;

/** faq_schema note (1.4.0): FAQPage markup whose questions carry no answer text. */
/** faq_schema note (1.5.1): structural rules only, no claim that answers are relevant. */
export const faqRulesNote = (total: number, clear: number, malformed: number) =>
  `${total} Q&A pair(s); ${clear} ${clear === 1 ? "is" : "are"} phrased as ${clear === 1 ? "a question" : "questions"} and ${clear === 1 ? "has" : "have"} an answer of reasonable length.` +
  (malformed > 0 ? ` ${malformed} ${malformed === 1 ? "entry is" : "entries are"} missing a question or an answer.` : "");

export const FAQ_NO_ANSWERS_NOTE =
  "FAQPage markup found, but none of its entries is a Question with an answer text (acceptedAnswer.text), so there are no Q&A pairs to rate.";

/**
 * service_offer_schema N/A note (1.4.1; 1.4.2 wording): says what was
 * checked (product page links, homepage prices, a pricing page), not that
 * the site does not sell.
 */
export const SERVICE_OFFER_NOT_SELLING_NA_NOTE =
  "We found no product pages, no prices on the homepage and no pricing page, so this check is not counted in your score.";

// Security pass 2026-11-04: validated hops, max 3 redirects, one deadline
// covering headers AND body, capped body (see ../safe-fetch).
function timedFetch(url: string, init?: RequestInit, sameSite?: string): Promise<SafeResponse | null> {
  return safeFetch(url, init, { timeoutMs: FETCH_TIMEOUT_MS, sameSite });
}

// Outreach security round 2: HTML-attribute-tolerant <script> scanning. The old
// regex required `type="..."` with no whitespace and quotes, so valid markup
// such as `<script type = "application/ld+json">` or `type=application/ld+json`
// was missed, and the page was then reported as having no JSON-LD.
type ScriptTag = { attrs: Record<string, string>; body: string };

/** Parses `<script ...>body</script>` elements: any case, any attribute order, quoted (' or ") or bare values, `>` inside quotes. */
export function scanScriptTags(html: string): ScriptTag[] {
  const out: ScriptTag[] = [];
  const lower = html.toLowerCase();
  let i = 0;
  for (;;) {
    const start = lower.indexOf("<script", i);
    if (start < 0) break;
    const after = lower.charAt(start + 7);
    if (after && !/[\s>/]/.test(after)) {
      i = start + 7; // e.g. <scripts>
      continue;
    }
    // Walk the start tag, honouring quotes.
    let j = start + 7;
    let quote = "";
    while (j < html.length) {
      const c = html.charAt(j);
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j++;
    }
    if (j >= html.length) break;
    const attrSrc = html.slice(start + 7, j);
    const attrs: Record<string, string> = {};
    const ar = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = ar.exec(attrSrc)) !== null) {
      const name = m[1].toLowerCase();
      if (!(name in attrs)) attrs[name] = m[2] ?? m[3] ?? m[4] ?? "";
    }
    const closeRe = /<\/script\s*>/gi;
    closeRe.lastIndex = j + 1;
    const close = closeRe.exec(html);
    const end = close ? close.index : html.length;
    out.push({ attrs, body: html.slice(j + 1, end) });
    i = close ? close.index + close[0].length : html.length;
  }
  return out;
}

export function isJsonLdType(type: string | undefined): boolean {
  if (type === undefined) return false;
  return type.split(";")[0].trim().toLowerCase() === "application/ld+json";
}

export function extractJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  for (const tag of scanScriptTags(html)) {
    if (!isJsonLdType(tag.attrs.type)) continue;
    const raw = tag.body.trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      out.push({ __invalid: true, __raw: raw.slice(0, 200) });
    }
  }
  return out;
}

/** Decodes numeric (&#47; &#x2B;) and the &plus; &sol; &amp; entities, which is all an "ld+json" spelling can need. */
function decodeAttrEntities(s: string): string {
  return s
    // HTML allows any number of leading zeros in character references.
    .replace(/&#x0*([0-9a-f]{1,6});?/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#0*([0-9]{1,7});?/g, (_, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&plus;/gi, "+")
    .replace(/&sol;/gi, "/")
    .replace(/&amp;/gi, "&");
}
function safeCodePoint(n: number): string {
  return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}
const UTF8_COMPATIBLE = /^(utf-?8|us-ascii|ascii|iso-8859-1|latin1|windows-1252)$/i;

/** See SubCheckEvidence.ld_json_absent_proven. Conservative: any doubt => false. */
// Script types we can confidently classify as NOT JSON-LD (lowercased, exact).
const KNOWN_NON_JSONLD_TYPES = new Set([
  "", "text/javascript", "application/javascript", "application/x-javascript", "text/ecmascript",
  "application/ecmascript", "module", "application/json", "text/json", "importmap", "speculationrules",
  "text/template", "text/html", "text/plain", "text/x-template",
]);

/**
 * Conservative safety net (outreach Codex round 4): absence is unproven when any
 * <script> type value contains "&", a backslash or a non-ASCII character, or is
 * not a type we can confidently classify. Decoding tricks then can't matter.
 */
function scriptTypesConfidentlyNonJsonLd(html: string): boolean {
  for (const tag of scanScriptTags(html)) {
    const t = tag.attrs.type;
    if (t === undefined) continue; // no type attribute: classic script
    if (/[&\\]|[^\x20-\x7e]/.test(t)) return false;
    if (!KNOWN_NON_JSONLD_TYPES.has(t.trim().toLowerCase())) return false;
  }
  return true;
}

export function ldJsonAbsentProven(html: string, contentType: string, bodyComplete: boolean): boolean {
  if (!bodyComplete) return false;
  if (!scriptTypesConfidentlyNonJsonLd(html)) return false;
  const cs = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1];
  if (cs && !UTF8_COMPATIBLE.test(cs)) return false;
  if (html.includes(String.fromCodePoint(0xfffd))) return false; // decoding errors
  // Decode twice (handles &amp;#43; style double encoding), then search.
  const text = decodeAttrEntities(decodeAttrEntities(html));
  return !/ld\s*\+\s*json/i.test(text);
}

// 1.3.3: schema.org subtypes count. A Dentist, Bakery or Corporation is an
// Organization; exact-type matching scored such sites "no Organization schema".
export const ORGANIZATION_TYPES: ReadonlySet<string> = new Set([
  "Organization", "Corporation", "NGO", "GovernmentOrganization",
  "EducationalOrganization", "CollegeOrUniversity", "School", "ElementarySchool", "HighSchool",
  "MiddleSchool", "Preschool", "MedicalOrganization", "Hospital", "Pharmacy", "Physician",
  "Dentist", "MedicalClinic", "DiagnosticLab", "VeterinaryCare", "NewsMediaOrganization",
  "SportsOrganization", "SportsTeam", "PerformingGroup", "ResearchOrganization", "Consortium",
  "Cooperative", "WorkersUnion", "LibrarySystem", "Airline", "OnlineBusiness", "OnlineStore",
  "LocalBusiness", "ProfessionalService", "LegalService", "Attorney", "Notary", "AccountingService",
  "FinancialService", "BankOrCreditUnion", "InsuranceAgency", "RealEstateAgent", "TravelAgency",
  "EmploymentAgency", "MedicalBusiness", "Optician", "HealthAndBeautyBusiness", "BeautySalon",
  "DaySpa", "HairSalon", "NailSalon", "TattooParlor", "HealthClub", "SportsActivityLocation",
  "ExerciseGym", "FoodEstablishment", "Restaurant", "Bakery", "CafeOrCoffeeShop", "BarOrPub",
  "Brewery", "FastFoodRestaurant", "IceCreamShop", "Winery", "Store", "AutoPartsStore",
  "BikeStore", "BookStore", "ClothingStore", "ComputerStore", "ConvenienceStore",
  "DepartmentStore", "ElectronicsStore", "Florist", "FurnitureStore", "GardenStore",
  "GroceryStore", "HardwareStore", "HobbyShop", "HomeGoodsStore", "JewelryStore",
  "LiquorStore", "MensClothingStore", "MobilePhoneStore", "MusicStore", "OfficeEquipmentStore",
  "OutletStore", "PawnShop", "PetStore", "ShoeStore", "SportingGoodsStore", "TireShop",
  "ToyStore", "WholesaleStore", "HomeAndConstructionBusiness", "Electrician", "GeneralContractor",
  "HVACBusiness", "HousePainter", "Locksmith", "MovingCompany", "Plumber", "RoofingContractor",
  "AutomotiveBusiness", "AutoDealer", "AutoRepair", "AutoRental", "AutoWash", "LodgingBusiness",
  "Hotel", "Motel", "BedAndBreakfast", "Hostel", "Resort", "ChildCare", "DryCleaningOrLaundry",
  "EntertainmentBusiness", "SelfStorage", "ShoppingCenter", "AnimalShelter", "Library",
  "RadioStation", "TelevisionStation", "TouristInformationCenter", "InternetCafe",
]);

// Service / Product / Offer and their common subtypes (software included).
export const SERVICE_OFFER_TYPES: ReadonlySet<string> = new Set([
  "Service", "BroadcastService", "CableOrSatelliteService", "FinancialProduct", "FoodService",
  "GovernmentService", "TaxiService", "WebAPI", "Product", "IndividualProduct", "ProductGroup",
  "ProductModel", "SomeProducts", "Vehicle", "SoftwareApplication", "WebApplication",
  "MobileApplication", "VideoGame", "Offer", "AggregateOffer", "OfferForLease", "OfferForPurchase",
]);

const REVIEW_TYPES: ReadonlySet<string> = new Set([
  "Review", "AggregateRating", "CriticReview", "EmployerReview", "UserReview", "Recommendation",
]);

/** "https://schema.org/Dentist" and "schema:Dentist" match as "Dentist". */
function typeNames(t: unknown): string[] {
  const arr = Array.isArray(t) ? t : [t];
  return arr
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().replace(/^(?:https?:\/\/(?:www\.)?schema\.org\/|schema:)/i, ""));
}

const MAX_JSONLD_DEPTH = 32;
/** Objects / arrays visited per search; past it the search reports itself incomplete. */
const MAX_JSONLD_NODES = 20000;

type Found = { matches: Array<{ obj: Record<string, unknown>; depth: number }>; incomplete: boolean };

/**
 * Blocks whose @type (string or array) is in `types`, at any depth. 1.4.0:
 * always deep (WebSite.publisher -> Organization, Offer.itemOffered ->
 * Product, WebPage.mainEntity -> FAQPage were invisible), bounded by depth
 * and node count. `incomplete` is true when a bound stopped the search, so a
 * caller never turns "not inspected" into "absent".
 */
function findByType(blocks: unknown[], types: string | ReadonlySet<string>): Found {
  const wanted = typeof types === "string" ? new Set([types]) : types;
  const found: Found = { matches: [], incomplete: false };
  let nodes = 0;
  const visit = (v: unknown, depth: number): void => {
    if (!v || typeof v !== "object" || found.incomplete) return;
    if (depth > MAX_JSONLD_DEPTH || ++nodes > MAX_JSONLD_NODES) {
      found.incomplete = true;
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    const obj = v as Record<string, unknown>;
    if (typeNames(obj["@type"]).some((n) => wanted.has(n))) found.matches.push({ obj, depth });
    for (const [k, x] of Object.entries(obj)) if (k !== "@type") visit(x, depth + 1);
  };
  for (const b of blocks) visit(b, 0);
  return found;
}

/**
 * Note-only: how the Organization note names a JSON-LD entry: its @type (the
 * first one in `types`, so always a known schema.org name) plus its @id when
 * the @id is short and plain ("https://site/#clinica" shows as "#clinica").
 * Site text with spaces, commas or semicolons is left out so the note stays
 * parseable.
 */
export function ldEntryLabel(o: Record<string, unknown>, types: ReadonlySet<string>): string {
  const type = typeNames(o["@type"]).find((n) => types.has(n)) ?? "Organization";
  const raw = typeof o["@id"] === "string" ? o["@id"].trim() : "";
  if (!/^[\p{L}\p{N}#:/._~%-]{1,200}$/u.test(raw)) return type;
  const hash = raw.indexOf("#");
  const id = hash >= 0 && hash < raw.length - 1 ? raw.slice(hash) : raw;
  return id.length <= 80 ? `${type} ${id}` : type;
}

/** Note-only: the top-level entries of the blocks (each block, its array items and its @graph members). */
function topLevelEntries(blocks: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  for (const b of blocks) {
    for (const x of Array.isArray(b) ? b : [b]) {
      if (!isObj(x)) continue;
      if (x["@type"] !== undefined) out.push(x);
      const g = x["@graph"];
      for (const y of Array.isArray(g) ? g : [g]) if (isObj(y)) out.push(y);
    }
  }
  return out;
}

const PERSON_TYPES: ReadonlySet<string> = new Set(["Person"]);

/** A number, or a string holding only a number ("4.8", "4,8", "12", "-1"); null otherwise. */
function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !/^\s*-?\d{1,9}(?:[.,]\d{1,6})?\s*$/.test(v)) return null;
  return Number(v.trim().replace(",", "."));
}

/**
 * 1.4.1: a ratingValue inside its scale: worstRating (default 1) to
 * bestRating (default 5), as in schema.org. 1.4.2: a value above 5 counts
 * only when bestRating declares the larger scale (no 0-100 scale is
 * assumed).
 */
function ratingInRange(r: Record<string, unknown>): boolean {
  const value = numberOf(r.ratingValue);
  if (value === null) return false;
  const best = r.bestRating === undefined ? null : numberOf(r.bestRating);
  const worst = r.worstRating === undefined ? null : numberOf(r.worstRating);
  if ((r.bestRating !== undefined && best === null) || (r.worstRating !== undefined && worst === null)) return false;
  const lo = worst ?? 1;
  const hi = best ?? 5;
  return lo < hi && value >= lo && value <= hi;
}

/** 1.4.1: a rating count is a positive integer. */
function isPositiveCount(v: unknown): boolean {
  const n = numberOf(v);
  return n !== null && Number.isInteger(n) && n > 0;
}

/**
 * An AggregateRating is well-formed with a ratingValue inside its scale and a
 * ratingCount or reviewCount (1.4.1: every count given is a positive
 * integer); a Review with an author and a reviewRating whose ratingValue is
 * inside its scale.
 */
function ratingWellFormed(r: Record<string, unknown>): boolean {
  return ratingProblem(r) === null;
}

/**
 * 1.4.2: why a rating block is not well-formed, for the note: "missing" when
 * a required field is absent (an AggregateRating's ratingValue or both
 * counts; a Review's author, reviewRating or its ratingValue), "invalid" when
 * every field is there but a value fails (outside its scale, not a number, a
 * count that is not a positive integer); null when well-formed.
 */
function ratingProblem(r: Record<string, unknown>): "missing" | "invalid" | null {
  if (typeNames(r["@type"]).includes("AggregateRating")) {
    const counts = [r.ratingCount, r.reviewCount].filter((c) => c !== undefined);
    if (r.ratingValue === undefined || counts.length === 0) return "missing";
    return ratingInRange(r) && counts.every(isPositiveCount) ? null : "invalid";
  }
  const rating = r.reviewRating;
  const ratingObj = rating && typeof rating === "object" && !Array.isArray(rating) ? (rating as Record<string, unknown>) : null;
  if (!r.author || !ratingObj || ratingObj.ratingValue === undefined) return "missing";
  return ratingInRange(ratingObj) ? null : "invalid";
}

/** review_schema note suffixes (1.4.2): the validation failure, for the remediation text. */
export const REVIEW_MISSING_FIELD_NOTE = "each block is missing a required field";
export const REVIEW_INVALID_VALUE_NOTE = "each block has a rating value or count that is not valid";
export const REVIEW_MIXED_NOTE = "some blocks are missing a required field and others have a value that is not valid";

/**
 * Non-empty answer text in a Question's acceptedAnswer (object or array).
 * 1.4.1: an answer that declares a @type must be an Answer. 1.4.2 (decided):
 * an answer with no @type still counts. schema.org gives acceptedAnswer the
 * range Answer, so an untyped object there is read as one; a typed object of
 * any other type (Comment, Thing, ...) does not count.
 */
/** The first non-empty acceptedAnswer text of a Question, or null. */
function answerText(q: Record<string, unknown>): string | null {
  const a = q.acceptedAnswer;
  for (const x of Array.isArray(a) ? a : [a]) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    if (o["@type"] !== undefined && !typeNames(o["@type"]).includes("Answer")) continue;
    if (typeof o.text === "string" && o.text.trim().length > 0) return o.text;
  }
  return null;
}

/**
 * A same-site product page linked from the homepage HTML. 1.5.2 (RD-0120):
 * any language (productPathKind); a product page (/produtos/x) is preferred
 * over a product index or shop page (/produtos), which is taken when the
 * homepage links no product page.
 */
const MAX_HREFS_SCANNED = 5000;

export function findProductLink(html: string, pageUrl: string): string | null {
  const base = siteBase(pageUrl);
  const re = /\bhref\s*=\s*["']([^"'<>\s]{1,2048})["']/gi;
  let m: RegExpExecArray | null;
  let listing: string | null = null;
  for (let n = 0; (m = re.exec(html)) !== null && n < MAX_HREFS_SCANNED; n++) {
    let u: URL;
    try {
      u = new URL(m[1], pageUrl);
    } catch {
      continue;
    }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !isSameSite(u.hostname, base)) continue;
    const kind = productPathKind(u.pathname);
    if (!kind) continue;
    u.search = "";
    u.hash = "";
    if (kind === "detail") return u.toString();
    listing ??= u.toString();
  }
  return listing;
}

// 1.5.0: faq_schema is scored by fixed rules, not an AI rating (the model
// gave different scores to the same questions on different runs). A Q&A
// pair meets the rules when its question is phrased as a question and is
// 2-40 words long (10-300 characters when it is one word, for scripts
// written without spaces), and its answer is 1-300 words and at least 2
// characters long. 1.5.1 (Codex r6): the minimums were 3 and 5 words, which
// failed short correct answers ("Quanto custa?" / "30 euros."). The rules
// are structural: they do not check that the answer is relevant.
const QUESTION_MAX_CHARS = 300;
const ANSWER_MAX_CHARS = 5000;
export const FAQ_QUESTION_MIN_WORDS = 2;
export const FAQ_QUESTION_MAX_WORDS = 40;
export const FAQ_ANSWER_MIN_WORDS = 1;
export const FAQ_ANSWER_MIN_CHARS = 2;
export const FAQ_ANSWER_MAX_WORDS = 300;

// First words that open a question in English, Portuguese, Spanish, French
// and German, written lowercase without accents (the question's first word
// is compared the same way). Words that often open a statement too ("por",
// "es", "e") are left out; such questions usually end with "?" anyway.
const INTERROGATIVES = new Set([
  // en
  "what", "how", "why", "when", "where", "who", "whom", "whose", "which", "can", "could", "do", "does", "did",
  "is", "are", "was", "were", "will", "would", "should", "shall", "may", "might", "have", "has",
  // pt
  "que", "como", "quando", "onde", "quem", "qual", "quais", "quanto", "quanta", "quantos", "quantas",
  "posso", "pode", "podem", "devo", "existe",
  // es
  "cuando", "donde", "quien", "quienes", "cual", "cuales", "cuanto", "cuanta", "cuantos", "cuantas",
  "puedo", "puede", "pueden", "hay", "debo",
  // fr
  "quoi", "comment", "pourquoi", "ou", "qui", "quel", "quelle", "quels", "quelles", "combien", "dois",
  // de
  "wie", "warum", "wann", "wo", "wer", "welche", "welcher", "welches", "wieso", "weshalb", "woher",
  "wohin", "kann", "konnen", "ist", "sind", "gibt", "muss", "darf",
]);

const wordCount = (s: string) => s.split(" ").filter(Boolean).length;

/** true when a cleaned question reads as a question (rule text in the comment above). */
export function isQuestionPhrased(q: string): boolean {
  if (/[?]\s*$/.test(q)) return true;
  const first = q
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .match(/^[^\p{L}]*([\p{L}]+)/u)?.[1];
  return first !== undefined && INTERROGATIVES.has(first);
}

/** true when one Q&A pair meets every faq_schema rule. */
export function faqPairMeetsRules(question: string, answer: string): boolean {
  const q = cleanSiteText(question, QUESTION_MAX_CHARS + 1);
  const a = cleanSiteText(stripTags(answer), ANSWER_MAX_CHARS);
  const qWords = wordCount(q);
  const qLengthOk =
    qWords >= FAQ_QUESTION_MIN_WORDS
      ? qWords <= FAQ_QUESTION_MAX_WORDS
      : q.length >= 10 && q.length <= QUESTION_MAX_CHARS;
  const aWords = wordCount(a);
  return (
    qLengthOk &&
    isQuestionPhrased(q) &&
    aWords >= FAQ_ANSWER_MIN_WORDS &&
    a.trim().length >= FAQ_ANSWER_MIN_CHARS &&
    aWords <= FAQ_ANSWER_MAX_WORDS
  );
}

export async function runDim4(
  targetUrl: string,
  env: Env,
  // E12: receives the homepage this check reads (HTML + final URL; null when
  // it couldn't), so Dim 3's homepage-link discovery reuses it instead of
  // fetching again.
  onHomepage?: (homepage: { html: string; url: string } | null) => void,
  // 1.4.1: true when Dim 5 found a pricing page (1.4.2: or prices on the
  // homepage or a homepage-linked page). Awaited only when neither
  // the homepage nor a sampled product page carries Service / Product /
  // Offer markup; undefined (unknown) keeps the check scored.
  pricingPageFound?: Promise<boolean>
): Promise<DimensionResult> {
  const subs: SubCheck[] = [];

  const res = await timedFetch(targetUrl, { headers: { "User-Agent": "AstrantScanner/0.1", Accept: "text/html" } });
  let html = "";
  let blocks: unknown[] = [];
  let invalidCount = 0;
  // Evidence from THIS response, attached to every Dim 4 sub-check, so a consumer
  // never infers "the homepage had no JSON-LD" from some other request.
  const evidence: SubCheckEvidence = {
    status: res ? res.status : null,
    content_type: res?.headers.get("content-type") ?? "",
    parsed: false,
    requested_url: targetUrl,
    final_url: res?.url ?? "",
    body_complete: false,
    truncated: false,
    ld_json_absent_proven: false,
  };
  if (res && res.status === 200) {
    // Capped read under the fetch deadline. A read error / timeout gives ""
    // and body_complete:false; a truncated body is scored on its prefix but
    // is never complete, so absence is never proven from it.
    const b = await res.body({ maxBytes: MAX_HTML_BYTES });
    const read = b.complete || b.truncated;
    html = b.text;
    evidence.body_complete = b.complete;
    evidence.truncated = b.truncated;
    if (read) {
      try {
        blocks = extractJsonLdBlocks(html);
        invalidCount = blocks.filter((b) => (b as { __invalid?: boolean })?.__invalid).length;
        evidence.parsed = true;
      } catch {
        // ignore
      }
      evidence.ld_json_absent_proven = ldJsonAbsentProven(html, evidence.content_type, b.complete);
    }
    onHomepage?.(read ? { html, url: res.url || targetUrl } : null);
  } else {
    res?.discard();
    onHomepage?.(null);
  }
  const validBlocks = blocks.filter((b) => !(b as { __invalid?: boolean })?.__invalid);

  // 1. json_ld_present
  let presentScore = 0;
  let presentNote = "no JSON-LD found on homepage";
  if (validBlocks.length > 0) {
    presentScore = 100;
    presentNote = `${validBlocks.length} valid JSON-LD block(s) on homepage`;
  } else if (invalidCount > 0) {
    presentScore = 50;
    presentNote = `${invalidCount} JSON-LD block(s) present but failed to parse`;
  }
  subs.push({
    id: "json_ld_present",
    name: "JSON-LD present on homepage",
    weight: 25,
    score: presentScore,
    passed: presentScore >= 70,
    notes: presentNote,
  });

  // 2. organization_schema
  const siteHost = siteBase(targetUrl);
  // 1.4.1: a product page link on the homepage (also a sign of selling).
  const productUrl = html ? findProductLink(html, res?.url || targetUrl) : null;
  const orgFound = findByType(validBlocks, ORGANIZATION_TYPES);
  const fields = (o: Record<string, unknown>) =>
    [typeof o.name === "string" && !!o.name, typeof o.url === "string" && !!o.url, typeof o.description === "string" && !!o.description].filter(Boolean).length;
  const ownSite = (o: Record<string, unknown>) => {
    try {
      return typeof o.url === "string" && isSameSite(new URL(o.url, targetUrl).hostname, siteHost) ? 1 : 0;
    } catch {
      return 0;
    }
  };
  // 1.4.0: nested Organizations count (WebSite.publisher, Service.provider).
  // Prefer the one describing this site (its url on this host), then the most
  // complete, then the shallowest, rather than the first one found.
  const orgs = [...orgFound.matches].sort(
    (a, b) => ownSite(b.obj) - ownSite(a.obj) || fields(b.obj) - fields(a.obj) || a.depth - b.depth
  );
  let orgScore = 0;
  let orgNote = "no Organization schema";
  if (orgs.length > 0) {
    const o = orgs[0].obj;
    // 1.4.0: name + url + description is complete (100). sameAs is
    // informational only, never a gap: a business with no social profiles
    // is never pushed to invent some.
    const hits = fields(o);
    const sameAs = Array.isArray(o.sameAs) ? o.sameAs : typeof o.sameAs === "string" && o.sameAs ? [o.sameAs] : [];
    orgScore = hits === 3 ? 100 : hits * 30;
    // The note's flags use the same non-empty-string test as the score.
    const str = (v: unknown) => typeof v === "string" && !!v;
    const hasDescription = str(o.description);
    orgNote = `Organization found: name=${str(o.name)}, url=${str(o.url)}, description=${hasDescription}, sameAs=${sameAs.length}`;
    // Note-only (scoring unchanged): name the entry that was read, and when it
    // has no description, a top-level Person or other Organization entry that
    // does (with its sameAs links when the read entry has none).
    orgNote += `; entry=${ldEntryLabel(o, ORGANIZATION_TYPES)}`;
    if (!hasDescription) {
      const hasSameAs = (e: Record<string, unknown>) =>
        (Array.isArray(e.sameAs) && e.sameAs.length > 0) || (typeof e.sameAs === "string" && !!e.sameAs);
      const other = topLevelEntries(validBlocks).find(
        (e) =>
          e !== o &&
          typeof e.description === "string" &&
          !!e.description.trim() &&
          typeNames(e["@type"]).some((n) => ORGANIZATION_TYPES.has(n) || PERSON_TYPES.has(n))
      );
      if (other) {
        const kinds = typeNames(other["@type"]).some((n) => ORGANIZATION_TYPES.has(n)) ? ORGANIZATION_TYPES : PERSON_TYPES;
        const fields = sameAs.length === 0 && hasSameAs(other) ? "description and sameAs" : "description";
        orgNote += `; ${fields} present on ${ldEntryLabel(other, kinds)}`;
      }
    }
  }
  subs.push({
    id: "organization_schema",
    name: "Organization schema completeness",
    weight: 20,
    score: orgScore,
    passed: orgScore >= 70,
    notes: orgNote,
    ...(orgs.length === 0 && orgFound.incomplete ? { notes: notFullyInspectedNote("Organization"), na: true } : {}),
  });

  // 3. service_offer_schema
  let svcFound = findByType(validBlocks, SERVICE_OFFER_TYPES);
  let svcFrom = "";
  let svcEvidence: SubCheckEvidence | null = null;
  // 1.4.0 (F17): a store's homepage often carries no Product markup while its
  // product pages do. When the homepage links a product page on this site and
  // has no Service / Product / Offer, sample one (same host, one request,
  // same caps) before reporting absence.
  if (svcFound.matches.length === 0 && !svcFound.incomplete && html) {
    if (productUrl) {
      // 1.4.1: every redirect hop stays on the audited site.
      const pr = await timedFetch(productUrl, { headers: { "User-Agent": "AstrantScanner/0.1", Accept: "text/html" } }, siteHost);
      if (pr && pr.status === 200) {
        const pb = await pr.body({ maxBytes: MAX_HTML_BYTES });
        if (pb.complete || pb.truncated) {
          const productBlocks = extractJsonLdBlocks(pb.text).filter((b) => !(b as { __invalid?: boolean })?.__invalid);
          const onProduct = findByType(productBlocks, SERVICE_OFFER_TYPES);
          svcFound = { matches: onProduct.matches, incomplete: onProduct.incomplete };
          svcFrom = productUrl;
          svcEvidence = {
            status: pr.status,
            content_type: pr.headers.get("content-type") ?? "",
            parsed: true,
            requested_url: productUrl,
            final_url: pr.url ?? "",
            body_complete: pb.complete,
            truncated: pb.truncated,
            ld_json_absent_proven: ldJsonAbsentProven(pb.text, pr.headers.get("content-type") ?? "", pb.complete),
          };
        }
      } else {
        pr?.discard();
      }
    }
  }
  const services = svcFound.matches.map((m) => m.obj);
  // 1.5.2 (Codex review): a product index or shop page is named as such,
  // not as "the sampled product page".
  const sampleLabel = svcFrom && productPathKind(new URL(svcFrom).pathname) === "listing" ? "sampled product listing page" : "sampled product page";
  let svcScore = 0;
  let svcNote = svcFrom
    ? sampleLabel === "sampled product page"
      ? `no Service / Product / Offer schema on the homepage or on the sampled product page (${svcFrom})`
      : `no Service / Product / Offer schema on the homepage or on the sampled product listing page (${svcFrom})`
    : "no Service / Product / Offer schema";
  if (services.length > 0) {
    // 1.3.3: price is not required. Quote-based businesses publish no price,
    // and requiring one pushed them to invent it.
    let bestPartial = 0;
    for (const s of services) {
      const hasName = typeof s.name === "string" && !!s.name;
      const hasDesc = typeof s.description === "string" && !!s.description;
      const hasProvider =
        !!s.provider || !!s.brand || !!s.seller || !!s.offeredBy || !!s.publisher ||
        !!s.author || !!s.creator || !!s.manufacturer;
      const partials = [hasName, hasDesc, hasProvider].filter(Boolean).length;
      if (partials > bestPartial) bestPartial = partials;
    }
    svcScore = bestPartial === 3 ? 100 : bestPartial === 2 ? 50 : 0;
    svcNote = `${services.length} Service/Product/Offer block(s); best match has ${bestPartial}/3 required fields`;
    if (svcFrom) svcNote += ` (on the ${sampleLabel} ${svcFrom}; none on the homepage)`;
  }
  // 1.4.1: applicability. No markup, no product page link, no price on the
  // homepage and no pricing page (Dim 5): nothing shows the site sells
  // online, so the check is N/A rather than a gap.
  let notSelling = false;
  if (services.length === 0 && !svcFound.incomplete && evidence.body_complete && !productUrl && pricingPageFound) {
    const homepagePrices = (stripTags(html).match(PRICE_BARE_RE) ?? []).length;
    notSelling = homepagePrices === 0 && !(await pricingPageFound.catch(() => true));
  }
  subs.push({
    id: "service_offer_schema",
    name: "Service / Product / Offer schema",
    weight: 20,
    score: svcScore,
    passed: svcScore >= 70,
    notes: svcNote,
    ...(services.length === 0 && svcFound.incomplete ? { notes: notFullyInspectedNote("Service / Product / Offer"), na: true } : {}),
    ...(notSelling ? { notes: SERVICE_OFFER_NOT_SELLING_NA_NOTE, na: true } : {}),
  });

  // 4. faq_schema
  const faqFound = findByType(validBlocks, "FAQPage");
  const faqPages = faqFound.matches.map((m) => m.obj);
  const pairs: Array<{ q: string; a: string }> = [];
  // 1.5.1 (Codex r6): a typed Question missing its name or its answer text
  // counts in the denominator as failing (it used to vanish, so 1 good pair
  // plus 5 unanswered Questions scored 100).
  let malformed = 0;
  for (const f of faqPages) {
    const me = f.mainEntity;
    const arr = Array.isArray(me) ? me : me ? [me] : [];
    for (const item of arr) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        // 1.4.0: a Q&A pair is a question with a non-empty answer text.
        // 1.4.1: and the entry is typed Question.
        const o = item as Record<string, unknown>;
        const q = o.name;
        const a = answerText(o);
        if (!typeNames(o["@type"]).includes("Question")) continue;
        if (typeof q === "string" && q.trim() && a !== null) pairs.push({ q: q.trim(), a });
        else malformed++;
      }
    }
  }
  const qCount = pairs.length;
  // 1.3.3: N/A without FAQPage markup (weight redistributed). 1.5.0: the
  // score is the share of Q&A pairs that meet the fixed rules.
  const faqName = "FAQPage schema";
  if (faqPages.length === 0) {
    subs.push({
      id: "faq_schema",
      name: faqName,
      weight: 20,
      score: 0,
      passed: false,
      notes: faqFound.incomplete ? notFullyInspectedNote("FAQPage") : FAQ_SCHEMA_NA_NOTE,
      na: true,
    });
  } else if (qCount === 0) {
    subs.push({ id: "faq_schema", name: faqName, weight: 20, score: 0, passed: false, notes: FAQ_NO_ANSWERS_NOTE });
  } else {
    const clear = pairs.filter((p) => faqPairMeetsRules(p.q, p.a)).length;
    const total = qCount + malformed;
    const faqScore = Math.round((clear / total) * 100);
    subs.push({
      id: "faq_schema",
      name: faqName,
      weight: 20,
      score: faqScore,
      passed: faqScore >= 70,
      notes: faqRulesNote(total, clear, malformed),
    });
  }

  // 5. review_schema. 1.3.2: N/A when no Review/AggregateRating markup is
  // present (weight redistributed, like Dim 5 pricing_text_visibility).
  // Scoring its absence pushed sites without real ratings to invent them.
  // 1.3.3: nested ratings count too (Product.aggregateRating, Product.review).
  const reviewFound = findByType(validBlocks, REVIEW_TYPES);
  const reviews = reviewFound.matches.map((m) => m.obj);
  if (reviews.length > 0) {
    const wellFormed = reviews.some(ratingWellFormed);
    const reviewScore = wellFormed ? 100 : 50;
    let why = "";
    if (!wellFormed) {
      const problems = new Set(reviews.map(ratingProblem));
      why = problems.size > 1 ? REVIEW_MIXED_NOTE : problems.has("missing") ? REVIEW_MISSING_FIELD_NOTE : REVIEW_INVALID_VALUE_NOTE;
      why = `: ${why}`;
    }
    subs.push({
      id: "review_schema",
      name: "Review / AggregateRating schema",
      weight: 15,
      score: reviewScore,
      passed: reviewScore >= 70,
      notes: `${reviews.length} Review/AggregateRating block(s); well-formed=${wellFormed}${why}`,
    });
  } else {
    subs.push({
      id: "review_schema",
      name: "Review / AggregateRating schema",
      weight: 15,
      score: 0,
      passed: false,
      notes: reviewFound.incomplete ? notFullyInspectedNote("Review / AggregateRating") : REVIEW_SCHEMA_NA_NOTE,
      na: true,
    });
  }

  for (const sc of subs) sc.evidence = { ...(sc.id === "service_offer_schema" && svcEvidence ? svcEvidence : evidence) };
  const score = dimensionScoreOrThrow(subs);
  return {
    dimension_id: 4,
    dimension_name: "Structured Capability Data",
    score,
    grade: gradeFor(score),
    sub_checks: subs,
  };
}
