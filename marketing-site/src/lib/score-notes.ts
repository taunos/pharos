// Plain-language versions of the scanner's terse sub-check notes, for display:
// the free Score surfaces (results page, Score PDF, Score email) and the paid
// Audit report (audit-report-model.ts: the check tables and the "Finding:"
// lines). "status=404" or "name=true, url=true, description=false" would
// otherwise reach a reader as raw debug output. The scanner notes themselves
// are unchanged: remediation-templates.ts, the executive summary, the corpus
// write and the JSON export all read the raw form, so translate only at the
// point of display.
//
// Only exact, known note shapes are rewritten; anything else is returned as is.
// Pure: safe in server and client components.

import type { SubCheck } from "./audit-types";

const yes = (s: string) => s === "yes" || s === "true";

function joinOr(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const count = (n: string, one: string, many: string) => `${n} ${n === "1" ? one : many}`;

// "MedicalBusiness", "#clinica" -> "MedicalBusiness entry (#clinica)".
const entry = (type: string, id: string | undefined) => `${type} entry${id ? ` (${id})` : ""}`;

// The scanner's Organization note with the entry clause (note-only change,
// 2026-11-10): which entry was read, and a top-level identity entry that has
// the description it lacks.
const ORG_NOTE =
  /^Organization found: name=(true|false), url=(true|false), description=(true|false), sameAs=\d+; entry=([A-Za-z]+)(?: ([^\s;]+))?(?:; (description(?: and sameAs)?) present on ([A-Za-z]+)(?: ([^\s;]+))?)?$/;

function plainOrganizationNote(m: RegExpMatchArray): string {
  const [, name, url, description, type, id, otherFields, otherType, otherId] = m;
  const fields: Array<[string, string, string]> = [["a name", "name", name], ["a URL", "URL", url], ["a description", "description", description]];
  const has = fields.filter(([, , v]) => yes(v)).map(([k]) => k);
  const lacks = fields.filter(([, , v]) => !yes(v)).map(([, k]) => k);
  const head = `Your ${entry(type, id)}`;
  let s =
    lacks.length === 0
      ? `${head} has a name, URL and description.`
      : has.length === 0
        ? `${head} has no name, URL or description.`
        : `${head} has ${joinAnd(has)} but no ${joinOr(lacks)}.`;
  if (otherFields && otherType) {
    const what = otherFields === "description" ? "a description" : "a description and sameAs links";
    s += ` Your ${entry(otherType, otherId)} has ${what}, but this check reads the ${type} entry.`;
  }
  return s;
}

const CURATION_PROBLEMS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^(\d+) links \(>100\)$/, (m) => `${m[1]} links (more than 100)`],
  [/^tag pages linked$/, () => "links to tag pages"],
  [/^archive pages linked$/, () => "links to archive pages"],
  [/^search-result URLs linked$/, () => "links to search-result pages"],
  [/^links contain query strings$/, () => "links with query strings (a ? in the address)"],
];

function plainCurationProblems(notes: string): string | null {
  const parts: string[] = [];
  for (const p of notes.split("; ")) {
    const hit = CURATION_PROBLEMS.map(([re, f]) => {
      const m = p.match(re);
      return m ? f(m) : null;
    }).find((x) => x !== null);
    if (!hit) return null;
    parts.push(hit);
  }
  return `The llms.txt link list has ${joinAnd(parts)}.`;
}

// Dim 5 pricing: "N text-based price token(s)" / "N price token(s)" -> "N price(s) in the page text".
function plainPriceTokens(notes: string): string {
  return notes
    .replace(/\b(\d+) text-based price token\(s\)/g, (_, n: string) => `${count(n, "price", "prices")} in the page text`)
    .replace(/\b(\d+) price token\(s\) but none/g, (_, n: string) => `${count(n, "price", "prices")} in the page text, but none`);
}

export function plainScoreNote(sub: Pick<SubCheck, "id" | "notes">): string {
  const notes = sub.notes ?? "";
  let m: RegExpMatchArray | null;
  switch (sub.id) {
    case "presence":
      if ((m = notes.match(/^status=(404|410)$/))) return `There is no llms.txt file at /llms.txt (the server answered ${m[1]}).`;
      if ((m = notes.match(/^status=(\d{3})$/)) && m[1] !== "200") return `/llms.txt did not load (the server answered HTTP ${m[1]}).`;
      if (/^status=200, content-type="[^"]*"$/.test(notes)) return "Found an llms.txt file at /llms.txt.";
      if (notes === "fetch failed") return "We could not load /llms.txt on this run.";
      return notes;
    case "spec_compliance":
      if ((m = notes.match(/^h1=(yes|no), blockquote=(yes|no)$/))) {
        const h1 = yes(m[1]);
        const bq = yes(m[2]);
        if (h1 && bq) return "The file starts with an H1 title and has a blockquote summary.";
        if (h1) return "The file has an H1 title but no blockquote summary (a line starting with >).";
        if (bq) return "The file has a blockquote summary but no H1 title (a line starting with #).";
        return "No H1 title (a line starting with #) and no blockquote summary (a line starting with >).";
      }
      return notes;
    case "linked_pages_quality":
      if (notes === "no links to sample") return "No links in llms.txt for us to check.";
      if ((m = notes.match(/^(\d+)\/(\d+) sampled links return markdown-ish content$/))) {
        return `${m[1]} of the ${m[2]} llms.txt links we checked returned Markdown or plain text; the rest returned HTML or did not load.`;
      }
      return notes;
    case "curation_quality":
      if (notes === "clean link list") {
        return "The llms.txt link list has none of the problems we check for (more than 100 links, links to tag, archive or search-result pages, links with query strings).";
      }
      if (notes === "file missing — no link list to evaluate") return "There is no llms.txt file, so there is no link list to check.";
      if (notes === "empty file — no links to evaluate") return "The llms.txt file is empty, so there are no links to check.";
      return plainCurationProblems(notes) ?? notes;
    case "json_ld_present":
      if ((m = notes.match(/^(\d+) valid JSON-LD block\(s\) on homepage$/))) {
        return `The homepage has ${count(m[1], "valid JSON-LD block", "valid JSON-LD blocks")} (structured data).`;
      }
      if ((m = notes.match(/^(\d+) JSON-LD block\(s\) present but failed to parse$/))) {
        return `The homepage has ${count(m[1], "JSON-LD block", "JSON-LD blocks")} (structured data), but none could be read: the JSON is not valid.`;
      }
      return notes;
    case "service_offer_schema":
      if ((m = notes.match(/^(\d+) Service\/Product\/Offer block\(s\); best match has (\d)\/3 required fields(?: \(on the sampled product page (\S+); none on the homepage\))?$/))) {
        const where = m[3] ? ` on the product page we sampled (${m[3]}), and none on the homepage` : "";
        return `We found ${count(m[1], "Service, Product or Offer entry", "Service, Product or Offer entries")}${where}. The most complete one has ${m[2]} of the 3 fields we check: a name, a description, and who provides it (such as provider, brand or seller).`;
      }
      return notes;
    case "review_schema":
      if ((m = notes.match(/^(\d+) Review\/AggregateRating block\(s\); well-formed=(true|false)(?:: (.+))?$/))) {
        const found = `We found ${count(m[1], "Review or AggregateRating block", "Review or AggregateRating blocks")}`;
        const one = m[1] === "1";
        if (m[2] === "true" && !m[3]) return `${found}; ${one ? "it is" : "at least one is"} complete and valid.`;
        if (m[2] === "false" && m[3]) return `${found}, but ${one ? "it is not" : "none is"} complete and valid: ${m[3]}.`;
      }
      return notes;
    case "pricing_text_visibility":
      if ((m = notes.match(/^Detected (\S+); (.+)$/))) return plainPriceTokens(`Pricing page ${m[1]}: ${m[2]}`);
      if (notes.startsWith("No pricing page found, so we checked the prices shown on ")) return plainPriceTokens(notes);
      return notes;
    case "case_study_scannability":
      if ((m = notes.match(/^Sampled 1 page\(s\); avg (\d+)\/100\. (\S+) → \d+ \(headings: (yes|no), lists: (yes|no), bold text: (yes|no)\)\.( \(A case study linked from the index page \S+\.\))?$/))) {
        const parts: Array<[string, string]> = [["headings", m[3]], ["lists", m[4]], ["bold text", m[5]]];
        const has = parts.filter(([, v]) => yes(v)).map(([k]) => k);
        const lacks = parts.filter(([, v]) => !yes(v)).map(([k]) => k);
        const what =
          lacks.length === 0 ? `it has ${joinAnd(has)}` : has.length === 0 ? `it has no ${joinOr(lacks)}` : `it has ${joinAnd(has)} but no ${joinOr(lacks)}`;
        return `We checked one case-study page (${m[2]}) and scored it ${m[1]}/100: ${what}.${m[6] ?? ""}`;
      }
      return notes;
    case "organization_schema":
      if ((m = notes.match(ORG_NOTE))) return plainOrganizationNote(m);
      if ((m = notes.match(/^Organization found: name=(true|false), url=(true|false), description=(true|false), sameAs=\d+$/))) {
        const missing = [["name", m[1]], ["url", m[2]], ["description", m[3]]]
          .filter(([, v]) => !yes(v))
          .map(([k]) => k);
        return missing.length === 0
          ? "Organization markup found, with a name, url and description."
          : `Organization markup found, but it has no ${joinOr(missing)}.`;
      }
      return notes;
    case "well_known":
      if ((m = notes.match(/^valid card at (\S+) with name="(.*)", transports=(\d+)$/))) {
        return `Found a valid MCP server card at ${m[1]}. It names the server "${m[2]}" and lists ${count(m[3], "transport URL", "transport URLs")}.`;
      }
      return notes;
    case "oauth_metadata":
      if ((m = notes.match(/^auth=([^;]{1,40}); (.+)$/))) {
        const head = `The MCP server card declares sign-in (${m[1]})`;
        const rest = m[2];
        let r: RegExpMatchArray | null;
        if (rest === "OAuth metadata valid") return `${head}, and its OAuth metadata is valid.`;
        if (rest === "OAuth metadata missing required endpoints") {
          return `${head}, but its OAuth metadata is missing a required endpoint (authorization_endpoint or token_endpoint).`;
        }
        if (rest === "OAuth metadata invalid JSON") return `${head}, but its OAuth metadata is not valid JSON.`;
        if ((r = rest.match(/^(\S+) returned (\d{3})$/))) return `${head}, but its OAuth metadata at ${r[1]} did not load (HTTP ${r[2]}).`;
        if ((r = rest.match(/^(\S+) returned no response$/))) return `${head}, but its OAuth metadata at ${r[1]} did not load (no response).`;
      }
      return notes;
    case "discovery":
      if ((m = notes.match(/^Found via (well-known|canonical) (\S+) at (\S+) \(content-type=[^)]*\)\.(.*)$/))) {
        const how = m[1] === "well-known" ? "the standard address" : "the common address";
        return `Found your API description at ${m[3]}, through ${how} ${m[2]}.${m[4]}`;
      }
      if ((m = notes.match(/^Found via homepage link \S+ at (\S+) \(content-type=[^)]*\)\.(.*)$/))) {
        return `Found your API description at ${m[1]}, through a link on your homepage.${m[2]}`;
      }
      return notes;
    case "info_completeness":
      if ((m = notes.match(/^info: title=(yes|no), version=(yes|no), description=(yes|<20 chars or missing) \(\d\/3\)$/))) {
        const parts: Array<[string, string, string]> = [["a title", "title", m[1]], ["a version", "version", m[2]], ["a description", "description (of 20 characters or more)", m[3]]];
        const has = parts.filter(([, , v]) => yes(v)).map(([k]) => k);
        const lacks = parts.filter(([, , v]) => !yes(v)).map(([, k]) => k);
        const head = "The info section of your API description has";
        if (lacks.length === 0) return `${head} a title, a version and a description.`;
        if (has.length === 0) return `${head} no title, version or description (of 20 characters or more).`;
        return `${head} ${joinAnd(has)} but no ${joinOr(lacks)}.`;
      }
      return notes;
    case "operation_coverage":
      if ((m = notes.match(/^(\d+) operation\(s\); (\d+)\/(\d+) have a summary or description\. \(count=\d+, doc=\d+\)$/))) {
        return `Your API description defines ${count(m[1], "operation", "operations")}; ${m[2]} of ${m[3]} have a summary or description.`;
      }
      return notes;
    case "markdown_negotiation":
      if ((m = notes.match(/^Accept: text\/markdown returns .+? \((redirected to \.md variant|directly)\)\.((?: .*)?)$/))) {
        const how = m[1] === "directly" ? "" : ", by redirecting to a .md page";
        return `Your homepage returns Markdown when a request asks for it (Accept: text/markdown)${how}.${m[2]}`;
      }
      return notes;
    case "live_invocation":
      if ((m = notes.match(/^tools\/list returned (\d+) tools$/))) {
        return `The MCP server answered and listed ${m[1]} tool${m[1] === "1" ? "" : "s"}.`;
      }
      return notes;
    default:
      return notes;
  }
}
