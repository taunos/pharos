// §7.1 fact sheet + copy table + gap selection.
//
// OBSERVATION-ONLY CLAIMS (orchestrator decision after Codex round 3; Bruno's
// top risk is a false claim under his name). A finding may reach a draft only if
// it states a directly observed fact about ONE specific request to the lead's
// OWN host, proven by that request's own evidence:
//   - requested URL: https on the lead's domain (or www.), at the exact path;
//   - final URL (after redirects): https, host = the lead's domain or www.domain;
//     any other host (including other subdomains and look-alikes) => no finding;
//   - status code and content type from that same response;
//   - when the claim depends on the body: the whole body read, no error, and
//     the scanner's text-level proof (ld_json_absent_proven).
// Missing, partial, ambiguous or cross-host evidence => the finding is dropped;
// with fewer than MIN_GAPS findings the lead gets no draft.
//
// Only three findings meet that bar. Everything else was REMOVED (round 3):
//   1.spec_compliance (H1 / blockquote)  the scanner searches only the first
//        50/10 lines and a body read error looks like an empty file: whole-file
//        absence is not provable.
//   4.json_ld_present.invalid            "invalid JSON" depends on our parser and
//        on HTML wrappers consumers tolerate.
//   4.organization_schema / 4.service_offer_schema  @type can be an IRI, an array
//        or nested in @graph; absence of a type is not provable for all encodings.
//   5.markdown_negotiation               a 403 on the probes plus an HTML 200 can't
//        prove "no Markdown version".
// Earlier exclusions (model-scored checks, Dim 2 MCP, Dim 6 citation demo, ...)
// still apply: nothing outside the table below can ever become a claim.
import { UUID_RE, isAstrantUrl, isPublicHostname, sameSite } from "./safety";
import type { DimensionResult, ScanResult, SubCheck } from "./types";

export type Gap = {
  id: string; // "<dim>.<sub_check.id>.<variant>"
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
  /** Returns the variant to use, or null when this result is not a provable observation. */
  pick: (sc: SubCheck, domain: string) => { variant: string; numbers: number[] } | null;
};

function parseHttps(u: unknown): URL | null {
  if (typeof u !== "string" || !u) return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && !x.username && !x.password && (x.port === "" || x.port === "443") ? x : null;
  } catch {
    return null;
  }
}

/** The evidence is about exactly one request to `path` on the lead's own site, and it ended on that site. */
export function ownSiteRequest(sc: SubCheck, domain: string, path: string): boolean {
  const e = sc.evidence;
  if (!e) return false;
  const req = parseHttps(e.requested_url);
  const fin = parseHttps(e.final_url);
  if (!req || !fin) return false;
  if (!sameSite(req.hostname, domain) || req.pathname !== path) return false;
  return sameSite(fin.hostname, domain);
}

const HTML_CT_RE = /^text\/html\s*(;|$)/i;

export const COPY_RULES: Rule[] = [
  {
    key: "1.presence",
    anchor: "llms.txt",
    variants: {
      not_found: "When we requested {domain}/llms.txt, the server answered with a 404 (not found).",
      // States only the DECLARED content type (headers), not what the body is.
      html: "When we requested {domain}/llms.txt, the server declared its response as HTML (content type text/html).",
    },
    pick: (sc, domain) => {
      if (!ownSiteRequest(sc, domain, "/llms.txt")) return null;
      const e = sc.evidence!;
      if (e.status === 404) return { variant: "not_found", numbers: [404] };
      if (e.status === 200 && HTML_CT_RE.test(e.content_type.trim())) return { variant: "html", numbers: [] };
      return null;
    },
  },
  {
    key: "4.json_ld_present",
    anchor: "JSON-LD",
    variants: {
      none: "When we requested the {domain} homepage, its HTML had no JSON-LD block (no script of type application/ld+json).",
    },
    pick: (sc, domain) => {
      if (!ownSiteRequest(sc, domain, "/")) return null;
      const e = sc.evidence!;
      if (e.status !== 200 || !HTML_CT_RE.test(e.content_type.trim())) return null;
      if (e.body_complete !== true || e.parsed !== true || e.ld_json_absent_proven !== true) return null;
      if (sc.notes !== "no JSON-LD found on homepage") return null; // the scanner's own parse agrees
      return { variant: "none", numbers: [] };
    },
  },
];

/** Every canonical template, for copy approval and the validator's number whitelist. */
export const COPY_TABLE_TEMPLATES: string[] = COPY_RULES.flatMap((r) => Object.values(r.variants));

/** Anchor terms across the whole copy table (validator: no anchor of a gap not in the sheet). */
export const ALL_ANCHORS: string[] = [...new Set(COPY_RULES.map((r) => r.anchor))];

const HOOK_DIMENSIONS = new Set([1, 4]); // the only dimensions with provable observations

function fillDomain(tpl: string, domain: string): string {
  return tpl.replace(/\{domain\}/g, domain);
}

export function selectGaps(scan: ScanResult, domain: string): Gap[] {
  const candidates: Gap[] = [];
  for (const dim of scan.dimensions as DimensionResult[]) {
    if (!HOOK_DIMENSIONS.has(dim.dimension_id) || dim.na) continue;
    for (const sc of dim.sub_checks) {
      if (sc.passed || sc.na) continue;
      const rule = COPY_RULES.find((r) => r.key === `${dim.dimension_id}.${sc.id}`);
      if (!rule) continue;
      const picked = rule.pick(sc, domain);
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
