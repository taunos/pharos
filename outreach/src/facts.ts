// §7.1 fact sheet + copy table + gap selection.
//
// Step-0 V-read classification (scanner/src/checks/*, 2026-11-04). Only
// DETERMINISTIC sub-checks whose failure mode can be read unambiguously from
// `notes` are in the copy table. Excluded (and why):
//   dim1.linked_pages_quality  deterministic, but a failed sample can be a fetch error (no status in notes)
//   dim1.curation_quality      deterministic heuristic; anti-pattern wording not a clear "gap" claim
//   dim1.blockquote_eval       MODEL-SCORED (llm-eval; AI failure defaults to 50)
//   dim2.*                     D6: MCP discovery is never a hook
//   dim3.*                     whole-dim N/A when no API surface; when found, discovery always >= 50
//   dim4.faq_schema            MODEL-SCORED in part (conversational eval)
//   dim4.review_schema         scanner itself says absence is common for B2B SaaS and "does not imply broken"
//   dim5.js_vs_no_js_render_diff  "minimal HTML" note is also produced by a fetch failure; "likely SPA" is a guess
//   dim5.page_weight_lcp       weight-only, LCP not measured on free tier; weak claim
//   dim5.pricing_text_visibility / case-study checks  non-200 notes don't say which status (could be 403/429)
//   dim6.*                     D6: free-tier Dim 6 is a demo preview
//
// Dim 4 reads the homepage, and its notes say "no JSON-LD found" even when
// the homepage fetch failed. Dim 4 gaps therefore also need positive proof
// that the homepage answered: Dim 5 markdown_negotiation either passed or
// reached its HTML fallback ("No markdown variant ...", which only happens
// after a 2xx HTML response).
import { UUID_RE, isAstrantUrl, isPublicHostname } from "./safety";
import type { DimensionResult, ScanResult, SubCheck } from "./types";

export type Gap = {
  id: string; // "<dim>.<sub_check.id>[.<variant>]"
  dimension: string;
  anchor: string;
  canonical: string;
  numbers: number[];
  rank: number;
};

export type FactSheet = {
  domain: string;
  score: number;
  grade: string;
  dimensions_applicable: number;
  score_url: string;
  scan_id: string;
  gaps: Gap[];
};

type Rule = {
  key: string; // "<dim>.<sub_check.id>"
  anchor: string;
  variants: Record<string, string>;
  /** Returns the variant to use, or null when this failure is not a claimable gap. */
  pick: (sc: SubCheck, scan: ScanResult) => { variant: string; numbers: number[] } | null;
};

const FETCH_FAILURE_RE = /timeout|timed out|fetch failed|blocked|status=(401|403|429|5\d\d)|\b(401|403|429|5\d\d)\b/i;

function sub(scan: ScanResult, dim: number, id: string): SubCheck | undefined {
  const d = scan.dimensions.find((x) => x.dimension_id === dim);
  return d?.sub_checks.find((s) => s.id === id);
}

export function homepageAnswered(scan: ScanResult): boolean {
  const md = sub(scan, 5, "markdown_negotiation");
  if (!md || md.na) return false;
  if (md.passed) return true;
  return /^No markdown variant or content negotiation\./.test(md.notes);
}

function jsonLdPresent(scan: ScanResult): boolean {
  const j = sub(scan, 4, "json_ld_present");
  return !!j && !j.na && j.passed && /valid JSON-LD block\(s\) on homepage/.test(j.notes);
}

export const COPY_RULES: Rule[] = [
  {
    key: "1.presence",
    anchor: "llms.txt",
    variants: {
      not_found: "{domain}/llms.txt returns a 404, so there is no llms.txt file for AI assistants to read.",
      html: "/llms.txt on {domain} returns an HTML page (content type text/html) instead of a text file, so tools that look for the file get a web page.",
    },
    pick: (sc) => {
      if (/^status=404$/.test(sc.notes)) return { variant: "not_found", numbers: [404] };
      if (/^status=200, content-type="text\/html/i.test(sc.notes)) return { variant: "html", numbers: [] };
      return null;
    },
  },
  {
    key: "1.spec_compliance",
    anchor: "llms.txt",
    variants: {
      both: "The llms.txt file on {domain} has no H1 title and no blockquote summary, the two lines the llms.txt format puts at the top.",
      h1: "The llms.txt file on {domain} has no H1 title line, which the llms.txt format puts at the top.",
      blockquote: "The llms.txt file on {domain} has no blockquote summary line under the title, which the llms.txt format expects.",
    },
    pick: (sc, scan) => {
      const presence = sub(scan, 1, "presence");
      if (!presence || !presence.passed) return null; // only about a file that exists
      const m = /^h1=(yes|no), blockquote=(yes|no)$/.exec(sc.notes);
      if (!m) return null;
      // The 1 in "H1" is a number token, so it is carried as this gap's number.
      if (m[1] === "no" && m[2] === "no") return { variant: "both", numbers: [1] };
      if (m[1] === "no") return { variant: "h1", numbers: [1] };
      if (m[2] === "no") return { variant: "blockquote", numbers: [] };
      return null;
    },
  },
  {
    key: "4.json_ld_present",
    anchor: "JSON-LD",
    variants: {
      none: "The {domain} homepage has no JSON-LD structured data, so it doesn't describe your company or product in machine-readable form.",
      invalid: "The JSON-LD on the {domain} homepage doesn't parse as valid JSON, so machines reading it get nothing from it.",
    },
    pick: (sc, scan) => {
      if (!homepageAnswered(scan)) return null;
      if (sc.notes === "no JSON-LD found on homepage") return { variant: "none", numbers: [] };
      if (/^\d+ JSON-LD block\(s\) present but failed to parse$/.test(sc.notes)) return { variant: "invalid", numbers: [] };
      return null;
    },
  },
  {
    key: "4.organization_schema",
    anchor: "JSON-LD",
    variants: {
      missing: "The JSON-LD on the {domain} homepage has no Organization entry, so your company's name, URL and profiles aren't stated in machine-readable form.",
    },
    pick: (sc, scan) => {
      if (!homepageAnswered(scan) || !jsonLdPresent(scan)) return null;
      return sc.notes === "no Organization schema" ? { variant: "missing", numbers: [] } : null;
    },
  },
  {
    key: "4.service_offer_schema",
    anchor: "JSON-LD",
    variants: {
      missing: "The JSON-LD on the {domain} homepage has no Product, Service or Offer entry, so what you sell isn't described in machine-readable form.",
    },
    pick: (sc, scan) => {
      if (!homepageAnswered(scan) || !jsonLdPresent(scan)) return null;
      return sc.notes === "no Service / Product / Offer schema" ? { variant: "missing", numbers: [] } : null;
    },
  },
  {
    key: "5.markdown_negotiation",
    anchor: "Markdown",
    variants: {
      none: "The {domain} homepage doesn't return Markdown when a client asks for it, and there is no Markdown version of the page, so AI agents have to pull the text out of the HTML themselves.",
    },
    pick: (sc) =>
      /^No markdown variant or content negotiation\./.test(sc.notes) ? { variant: "none", numbers: [] } : null,
  },
];

/** Every canonical template, for copy approval and the validator's number whitelist. */
export const COPY_TABLE_TEMPLATES: string[] = COPY_RULES.flatMap((r) => Object.values(r.variants));

/** Anchor terms across the whole copy table (validator: no anchor of a gap not in the sheet). */
export const ALL_ANCHORS: string[] = [...new Set(COPY_RULES.map((r) => r.anchor))];

const HOOK_DIMENSIONS = new Set([1, 3, 4, 5]); // D6: never 2 or 6

function fillDomain(tpl: string, domain: string): string {
  return tpl.replace(/\{domain\}/g, domain);
}

export function selectGaps(scan: ScanResult, domain: string): Gap[] {
  const candidates: Gap[] = [];
  for (const dim of scan.dimensions as DimensionResult[]) {
    if (!HOOK_DIMENSIONS.has(dim.dimension_id) || dim.na) continue;
    for (const sc of dim.sub_checks) {
      if (sc.passed || sc.na) continue;
      if (FETCH_FAILURE_RE.test(sc.notes)) continue;
      const rule = COPY_RULES.find((r) => r.key === `${dim.dimension_id}.${sc.id}`);
      if (!rule) continue;
      const picked = rule.pick(sc, scan);
      if (!picked) continue;
      candidates.push({
        id: `${rule.key}.${picked.variant}`,
        dimension: dim.dimension_name,
        anchor: rule.anchor,
        canonical: fillDomain(rule.variants[picked.variant], domain),
        numbers: picked.numbers,
        rank: sc.weight * (100 - sc.score),
      });
    }
  }
  // At most one gap per dimension (keeps findings distinct and anchors unambiguous),
  // ranked by weight × (100 − score), top 3.
  candidates.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  const seenDim = new Set<string>();
  const out: Gap[] = [];
  for (const g of candidates) {
    if (seenDim.has(g.dimension)) continue;
    seenDim.add(g.dimension);
    out.push(g);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * The scan result is untrusted input too (it describes a hostile site). Only
 * typed, validated values leave this function: a strict public hostname, an
 * integer score 0..100, a known grade, a UUID scan id, and copy-table gaps.
 */
export function buildFactSheet(scan: ScanResult, domain: string, scoreBaseUrl: string): FactSheet {
  if (!isPublicHostname(domain)) throw new Error("FACTS_INVALID:domain");
  if (typeof scan?.id !== "string" || !UUID_RE.test(scan.id)) throw new Error("FACTS_INVALID:scan_id");
  const score = scan.composite?.score;
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error("FACTS_INVALID:score");
  if (!/^[A-F][+-]?$/.test(String(scan.composite?.grade ?? ""))) throw new Error("FACTS_INVALID:grade");
  if (!Array.isArray(scan.dimensions)) throw new Error("FACTS_INVALID:dimensions");
  if (!isAstrantUrl(scoreBaseUrl) || !scoreBaseUrl.endsWith("/score/")) throw new Error("FACTS_INVALID:score_base_url");
  return {
    domain,
    score: scan.composite.score,
    grade: scan.composite.grade,
    dimensions_applicable: Number.isInteger(scan.dimensions_applicable) ? scan.dimensions_applicable : 0,
    score_url: `${scoreBaseUrl}${scan.id}`,
    scan_id: scan.id,
    gaps: selectGaps(scan, domain),
  };
}

export const MIN_GAPS = 2;
