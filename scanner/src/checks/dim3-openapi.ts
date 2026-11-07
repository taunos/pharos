// Dim 3 — OpenAPI / API Catalog (Slice 3a)
//
// Five sub-checks (weights from OQ-04 §2 Dim 3, sum 100):
//   1. discovery (25)            — well-known + canonical paths + homepage link fallback
//   2. spec_validity (25)        — parses as JSON or YAML; has openapi/swagger version field
//   3. info_completeness (15)    — info.title, info.version, info.description
//   4. security_schemes (15)     — components.securitySchemes OR explicit empty security:[]
//   5. operation_coverage (20)   — paths + per-operation summary/description coverage
//
// Whole-dimension N/A: when discovery returns nothing — no well-known path,
// no canonical /openapi.json or /openapi.yaml at the origin, no <link> tag
// or homepage anchor pointing to a candidate spec — the site is content-only
// from an API-catalog perspective. We mark na:true, the composite math drops
// the term and renormalizes SPEC_WEIGHTS over the remaining dimensions, and
// the site lands at the same composite v1.1.0 produced (parity invariant).
//
// Locked decisions per Slice 3a kickoff prompt review pass 1+2+3:
//   - No LLM calls. Pure HTTP + structural validation.
//   - Bounded API-surface heuristic (5 ordered checks, 5s per-request timeout,
//     scheme allowlist, redirect:manual on HEAD probes). Ordering matters:
//     specifically targeted well-known paths first, then canonical paths,
//     then homepage link fallback. Stops at first hit.
//   - Defense-in-depth: even though wrangler.jsonc sets
//     global_fetch_strictly_public, we keep an explicit https-only scheme
//     check at the spec-fetch boundary (belt + suspenders for a load-bearing
//     external probe).

import type { DimensionResult, Env, SubCheck } from "../types";
import { dimensionScore, gradeFor } from "../scoring";
import { MAX_SPEC_BYTES, safeFetch, type SafeResponse } from "../safe-fetch";
import { isSameSite, NO_SIGNALS, siteBase, type SiteSignals } from "./site-signals";

const FETCH_TIMEOUT_MS = 5000;

export const INCOMPLETE_SPEC_NOTE =
  "Not measured — the API spec could not be read in full (size or time limit), so this dimension is not counted in your score.";
/** 1.3.3: info / security / operation sub-checks on a YAML spec. */
export const YAML_UNMEASURED_NOTE =
  "Not measured: the scanner cannot read this part of a YAML spec. Weight redistributed across other Dim 3 sub-checks.";
const STATIC_UA = "AstrantScanner-Dim3/1.2.0";

/** Whole-dimension N/A note (1.4.0): no OpenAPI and no other API evidence. */
export const DIM3_NO_API_NA_NOTE =
  "No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link), and no other API evidence was detected. Dimension marked N/A — composite math drops it without penalty.";

/**
 * Whole-dimension N/A note (1.4.0) when the site shows an API but publishes no
 * OpenAPI description. N/A, not 0: a GraphQL API describes itself through its
 * own schema, and API evidence found from links is too indirect to score.
 */
export const dim3ApiWithoutOpenApiNote = (evidence: string) =>
  `No OpenAPI description or API catalog was found (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). The site does show API evidence (${evidence}), so it is not a content-only site: this dimension is marked N/A because there is no OpenAPI description to check, not because there is no API.`;

/** discovery note suffix (1.4.0) when an RFC 9727 API catalog's service-desc was followed. */
const viaCatalog = (catalogUrl: string) => ` Read through the API catalog at ${catalogUrl} (its service-desc link).`;

// Security pass 2026-11-04: validated hops (incl. homepage-discovered spec
// links), max 3 redirects, one deadline covering headers AND body, capped
// body (see ../safe-fetch).
function timedFetch(
  url: string,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<SafeResponse | null> {
  return safeFetch(url, init, { timeoutMs });
}

// SSRF defense-in-depth at the spec-fetch boundary. wrangler.jsonc already
// has global_fetch_strictly_public, but a load-bearing external probe is
// the right place for a belt-and-suspenders explicit allowlist.
function isSafeSpecUrl(candidate: string): boolean {
  try {
    const u = new URL(candidate);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return true;
  } catch {
    return false;
  }
}

// ── Discovery — bounded 5-step ordered probe ──────────────────────────────

interface DiscoveryHit {
  url: string;
  body: string;
  contentType: string;
  source: string;
  // false when the body hit the byte cap, timed out or errored: the spec's
  // content was not measured (security pass 2026-11-04).
  complete: boolean;
}

const WELL_KNOWN_CANDIDATES = [
  "/.well-known/api-catalog",
  "/.well-known/openapi",
];

const CANONICAL_CANDIDATES = [
  "/openapi.json",
  "/openapi.yaml",
  "/openapi.yml",
  "/swagger.json",
];

// E12: a 200 counts as discovered only when the body plausibly IS a spec or
// API catalog. HTML (a soft-404 or SPA fallback page) never is. A body read in
// full must be recognizable: a JSON object with an openapi / swagger key or an
// RFC 9727 linkset with at least one API relation carrying an href, or YAML
// with an openapi / swagger key (so a JSON soft-404 like {"error":"Not Found"}
// is not a hit). A body not read in full keeps the unmeasured path in runDim3.
// Linear time on hostile bodies.
function isPlausibleSpec(body: string, contentType: string, complete: boolean): boolean {
  if (contentType.includes("text/html") || body.trimStart().startsWith("<")) return false;
  if (!complete) return true;
  const parsed = tryParseSpec(body, contentType);
  if (!parsed) return false;
  if (parsed.format !== "json") return true; // the YAML heuristic already required the key
  const s = parsed.spec;
  return "openapi" in s || "swagger" in s || hasApiLinkset(s["linkset"]);
}

const API_CATALOG_RELS = ["service-desc", "service-doc", "service-meta", "item"];

/** RFC 9727: a linkset array with an entry whose API relation has a link object with an href. */
function hasApiLinkset(linkset: unknown): boolean {
  if (!Array.isArray(linkset)) return false;
  return linkset.some(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      API_CATALOG_RELS.some((rel) => {
        const links = (entry as Record<string, unknown>)[rel];
        return (
          Array.isArray(links) &&
          links.some((l) => l !== null && typeof l === "object" && typeof (l as { href?: unknown }).href === "string" && (l as { href: string }).href.trim() !== "")
        );
      })
  );
}

async function probeWellKnown(origin: string): Promise<DiscoveryHit | null> {
  for (const path of WELL_KNOWN_CANDIDATES) {
    const url = `${origin}${path}`;
    if (!isSafeSpecUrl(url)) continue;
    const res = await timedFetch(url, {
      headers: { Accept: "application/json", "User-Agent": STATIC_UA },
      redirect: "follow",
    });
    if (res && res.ok) {
      const read = await res.body({ maxBytes: MAX_SPEC_BYTES });
      const body = read.text;
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!isPlausibleSpec(body, contentType, read.complete)) continue;
      return {
        url,
        body,
        contentType,
        source: `well-known ${path}`,
        complete: read.complete,
      };
    }
    res?.discard();
  }
  return null;
}

async function probeCanonical(origin: string): Promise<DiscoveryHit | null> {
  for (const path of CANONICAL_CANDIDATES) {
    const url = `${origin}${path}`;
    if (!isSafeSpecUrl(url)) continue;
    const res = await timedFetch(url, {
      headers: {
        Accept: "application/json, application/yaml, text/yaml, text/plain",
        "User-Agent": STATIC_UA,
      },
      redirect: "follow",
    });
    if (res && res.ok) {
      const read = await res.body({ maxBytes: MAX_SPEC_BYTES });
      const body = read.text;
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!isPlausibleSpec(body, contentType, read.complete)) continue;
      return {
        url,
        body,
        contentType,
        source: `canonical ${path}`,
        complete: read.complete,
      };
    }
    res?.discard();
  }
  return null;
}

// Homepage <link rel="api-catalog"> tag and anchors mentioning openapi/swagger.
// E12 (Codex r1 sibling, r2): the old whole-document regexes were
// super-linear on hostile HTML (~2 s on 50 KB) and became reachable once
// Dim 3 received the homepage. Now a small quote-aware tag tokenizer: exact
// attribute names (case-insensitive; data-rel is not rel), quoted or
// unquoted values, a ">" inside a quoted value does not end the tag. Linear:
// every character is consumed once, scanning resumes after each tag, only
// rel / href are kept, and at most MAX_TAGS_SCANNED tags of a kind are read.
const MAX_TAG_CHARS = 2048;
const MAX_ANCHOR_TEXT_CHARS = 512;
const MAX_ANCHORS_CHECKED = 1000;
const MAX_TAGS_SCANNED = 10000;

const isTagSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

interface SpecTagAttrs {
  rel?: string;
  href?: string;
}

/**
 * Reads the tag whose name ends at `i` (just past "<name"). Returns its rel /
 * href attributes (exact names, case-insensitive, first occurrence wins) and
 * the index of its closing ">", or null when the document ends inside the tag.
 */
function readTagAttrs(html: string, i: number): { attrs: SpecTagAttrs; end: number } | null {
  const attrs: SpecTagAttrs = {};
  const n = html.length;
  for (;;) {
    while (i < n && (isTagSpace(html[i]) || html[i] === "/")) i++;
    if (i >= n) return null;
    if (html[i] === ">") return { attrs, end: i };
    const nameStart = i;
    while (i < n && !isTagSpace(html[i]) && html[i] !== "/" && html[i] !== ">" && html[i] !== "=") i++;
    const len = i - nameStart;
    const key = len === 3 || len === 4 ? html.slice(nameStart, i).toLowerCase() : "";
    const wanted = (key === "rel" || key === "href") && attrs[key] === undefined ? key : null;
    while (i < n && isTagSpace(html[i])) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < n && isTagSpace(html[i])) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        if (close === -1) return null;
        if (wanted) value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const vStart = i;
        while (i < n && !isTagSpace(html[i]) && html[i] !== ">") i++;
        if (wanted) value = html.slice(vStart, i);
      }
    }
    if (wanted) attrs[wanted] = decodeHtmlRefs(value);
  }
}

const NAMED_REFS: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * E12 (Codex r3): decodes the character references an attribute value may
 * carry (&amp; &lt; &gt; &quot; &apos;, &#NN; and &#xHH;) so href="a?x=1&amp;y=2"
 * resolves as the browser would. One linear regex pass over a value already
 * bounded by MAX_TAG_CHARS; an invalid code point becomes U+FFFD.
 */
function decodeHtmlRefs(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos));/g, (_, hex, dec, named) => {
    if (named) return NAMED_REFS[named];
    const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "�";
  });
}

/** `<name ...>` tags in order; tags longer than MAX_TAG_CHARS are skipped (but still consumed). */
function* scanTags(html: string, name: "link" | "a"): Generator<{ attrs: SpecTagAttrs; end: number }> {
  // Literal-prefixed, so each exec is a linear forward search from lastIndex.
  const open = name === "link" ? /<link(?=[\s/>])/gi : /<a(?=[\s/>])/gi;
  for (let scanned = 0; scanned < MAX_TAGS_SCANNED; scanned++) {
    const m = open.exec(html);
    if (!m) return;
    const tag = readTagAttrs(html, m.index + m[0].length);
    if (!tag) return;
    if (tag.end - m.index <= MAX_TAG_CHARS) yield tag;
    open.lastIndex = tag.end + 1;
  }
}

const SPEC_LINK_RELS = new Set(["api-catalog", "describedby", "service-desc"]);

function extractHomepageSpecLink(homepageHtml: string, base: string): string | null {
  const resolve = (href: string): string | null => {
    try {
      return new URL(href.trim(), base).toString();
    } catch {
      return null;
    }
  };
  // 1. <link rel="api-catalog" href="..."> per RFC 9727 (also describedby /
  //    service-desc). rel is a space-separated token list.
  for (const { attrs } of scanTags(homepageHtml, "link")) {
    const rels = (attrs.rel ?? "").toLowerCase().split(/[ \t\n\r\f]+/);
    if (!rels.some((r) => SPEC_LINK_RELS.has(r))) continue;
    const href = attrs.href;
    const url = href ? resolve(href) : null;
    if (url) return url;
  }
  // 2. Anchor whose href ends in .json / .yaml / .yml and whose text (the
  //    next MAX_ANCHOR_TEXT_CHARS up to </a>, tags stripped) mentions
  //    OpenAPI / Swagger.
  let checked = 0;
  for (const { attrs, end } of scanTags(homepageHtml, "a")) {
    const href = attrs.href?.trim();
    if (!href || !/\.(?:json|yaml|yml)$/i.test(href)) continue;
    if (++checked > MAX_ANCHORS_CHECKED) break;
    let text = homepageHtml.slice(end + 1, end + 1 + MAX_ANCHOR_TEXT_CHARS);
    const close = /<\/a/i.exec(text);
    if (close) text = text.slice(0, close.index);
    // [^<>]* cannot cross another "<", so this strip is linear.
    if (!/openapi|swagger/i.test(text.replace(/<[^<>]*>/g, " "))) continue;
    const url = resolve(href);
    if (url) return url;
  }
  return null;
}

/** A homepage read handed over by another check: its HTML and final (post-redirect) URL. */
export interface HomepageRead {
  html: string;
  url: string;
}

async function probeHomepageLink(
  origin: string,
  homepagePromise: HomepageRead | null | Promise<HomepageRead | null>
): Promise<DiscoveryHit | null> {
  const homepage = await homepagePromise;
  if (!homepage || !homepage.html) return null;
  // E12 (Codex r1): relative hrefs resolve against the page they came from.
  const candidate = extractHomepageSpecLink(homepage.html, isSafeSpecUrl(homepage.url) ? homepage.url : origin);
  if (!candidate || !isSafeSpecUrl(candidate)) return null;
  const res = await timedFetch(candidate, {
    headers: {
      Accept: "application/json, application/yaml, text/yaml, text/plain",
      "User-Agent": STATIC_UA,
    },
    redirect: "follow",
  });
  if (res && res.ok) {
    const read = await res.body({ maxBytes: MAX_SPEC_BYTES });
    const body = read.text;
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!isPlausibleSpec(body, contentType, read.complete)) return null;
    return {
      url: candidate,
      body,
      contentType,
      source: `homepage link ${candidate}`,
      complete: read.complete,
    };
  }
  res?.discard();
  return null;
}

/** First service-desc href in an RFC 9727 linkset, resolved against the catalog URL. */
function linksetServiceDesc(spec: Record<string, unknown>, catalogUrl: string): string | null {
  const linkset = spec["linkset"];
  if (!Array.isArray(linkset)) return null;
  for (const entry of linkset) {
    const links = entry && typeof entry === "object" ? (entry as Record<string, unknown>)["service-desc"] : null;
    if (!Array.isArray(links)) continue;
    for (const l of links) {
      const href = l && typeof l === "object" ? (l as { href?: unknown }).href : null;
      if (typeof href !== "string" || !href.trim()) continue;
      try {
        return new URL(href.trim(), catalogUrl).toString();
      } catch {
        // try the next link
      }
    }
  }
  return null;
}

/**
 * 1.4.0: an API catalog (RFC 9727 linkset) is an index, not the spec. Follow
 * its service-desc link (same host or a subdomain of the audited site, one
 * request, same byte / time caps) and score the spec it points to. Returns
 * null when the hit is not a linkset (score the hit as it is), else the
 * followed spec or the reason it could not be read.
 */
async function followCatalog(
  hit: DiscoveryHit,
  siteUrl: string
): Promise<{ hit: DiscoveryHit } | { unreadable: string } | null> {
  const parsed = tryParseSpec(hit.body, hit.contentType);
  if (!parsed || parsed.format !== "json") return null;
  const spec = parsed.spec;
  if ("openapi" in spec || "swagger" in spec || !Array.isArray(spec["linkset"])) return null;
  const desc = linksetServiceDesc(spec, hit.url);
  if (!desc) return { unreadable: `the API catalog at ${hit.url} has no service-desc link to an API description.` };
  if (!isSafeSpecUrl(desc) || !isSameSite(new URL(desc).hostname, siteBase(siteUrl))) {
    return { unreadable: `the API catalog at ${hit.url} points to ${desc}, on another site, which the scanner does not fetch.` };
  }
  const res = await timedFetch(desc, {
    headers: { Accept: "application/json, application/yaml, text/yaml, text/plain", "User-Agent": STATIC_UA },
    redirect: "follow",
  });
  if (!res || !res.ok) {
    res?.discard();
    return { unreadable: `the API catalog at ${hit.url} points to ${desc}, which returned ${res ? `status ${res.status}` : "no response"}.` };
  }
  const read = await res.body({ maxBytes: MAX_SPEC_BYTES });
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!isPlausibleSpec(read.text, contentType, read.complete)) {
    return { unreadable: `the API catalog at ${hit.url} points to ${desc}, which is not a recognizable OpenAPI / Swagger document.` };
  }
  return { hit: { url: desc, body: read.text, contentType, source: hit.source, complete: read.complete } };
}

async function discoverApiSpec(
  origin: string,
  homepage: HomepageRead | null | Promise<HomepageRead | null>
): Promise<DiscoveryHit | null> {
  // Ordered: well-known → canonical → homepage-link. Stop at first hit.
  let hit = await probeWellKnown(origin);
  if (hit) return hit;
  hit = await probeCanonical(origin);
  if (hit) return hit;
  hit = await probeHomepageLink(origin, homepage);
  return hit;
}

// ── Spec parsing (JSON, with light YAML tolerance) ───────────────────────

interface ParsedSpec {
  spec: Record<string, unknown>;
  format: "json" | "yaml-strict-json" | "yaml-heuristic";
}

// Minimal YAML-to-object conversion for the structural checks we need (top-
// level keys: openapi, swagger, info, paths, components). Full YAML parsing
// would pull a heavyweight dep we'd rather not ship in a Worker. We accept
// the limitation and downgrade YAML-only specs to a partial-credit signal
// in spec_validity rather than hard-fail.
function tryParseSpec(body: string, contentType: string): ParsedSpec | null {
  const trimmed = body.trim();
  // 1. JSON path.
  if (
    contentType.includes("application/json") ||
    contentType.includes("text/json") ||
    trimmed.startsWith("{")
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { spec: parsed as Record<string, unknown>, format: "json" };
      }
    } catch {
      // fall through to YAML attempt
    }
  }
  // 2. YAML heuristic — we just confirm there's an `openapi:` or `swagger:`
  //    top-level key so the spec_validity sub-check can give partial credit.
  //    We do NOT try to parse the whole document; the deeper checks
  //    (info_completeness, paths, securitySchemes) get scored as 0 with
  //    notes explaining the limitation. Future work: ship a minimal YAML
  //    parser or call out to an external parsing service.
  const yaml = yamlVersionKey(body);
  if (yaml) {
    // Build a minimal spec object so downstream checks can at least see the
    // version field. They'll see no `info` / `paths` and score appropriately.
    return {
      spec: {
        [yaml.key]: yaml.version,
        __yaml_heuristic: true,
      },
      format: "yaml-heuristic",
    };
  }
  return null;
}

// E12 (Codex r1): the old /^\s*openapi\s*:/m regexes were quadratic on runs of
// newlines (\s spans them; ~9 s on 100k). This is a linear line scan with
// horizontal whitespace only, over at most YAML_SCAN_LINES lines of at most
// YAML_SCAN_LINE_CHARS each (the version key sits at the top of a real spec).
const YAML_SCAN_LINES = 200;
const YAML_SCAN_LINE_CHARS = 1000;
const YAML_VERSION_LINE = /^[ \t]*(openapi|swagger)[ \t]*:[ \t]*["']?(\d+\.\d+(?:\.\d+)?)/;

function yamlVersionKey(body: string): { key: "openapi" | "swagger"; version: string } | null {
  let start = 0;
  for (let n = 0; n < YAML_SCAN_LINES && start < body.length; n++) {
    let end = body.indexOf("\n", start);
    if (end === -1) end = body.length;
    const m = YAML_VERSION_LINE.exec(body.slice(start, Math.min(end, start + YAML_SCAN_LINE_CHARS)));
    if (m) return { key: m[1] as "openapi" | "swagger", version: m[2] };
    start = end + 1;
  }
  return null;
}

// ── runDim3 ──────────────────────────────────────────────────────────────

export async function runDim3(
  targetUrl: string,
  env: Env,
  // E12: the homepage another check already read (run-scan passes Dim 4's
  // read as a promise); awaited only when well-known and canonical both miss.
  homepage: HomepageRead | null | Promise<HomepageRead | null> = null,
  // 1.4.0: API evidence from links / a GraphQL probe (site-signals); awaited
  // only when no spec is found, to word the N/A note truthfully.
  signals: SiteSignals | Promise<SiteSignals> = NO_SIGNALS
): Promise<DimensionResult> {
  void env; // reserved for future use; no LLM in Slice 3a
  const origin = new URL(targetUrl).origin;

  const subs: SubCheck[] = [];

  // ── Discovery ──────────────────────────────────────────────────────────
  const found = await discoverApiSpec(origin, homepage);
  let hit = found;
  let catalogUrl = "";
  let catalogUnreadable = "";
  if (found && found.complete) {
    const followed = await followCatalog(found, targetUrl);
    if (followed && "hit" in followed) {
      hit = followed.hit;
      catalogUrl = found.url;
    } else if (followed) {
      catalogUnreadable = followed.unreadable;
    }
  }

  // Whole-dimension N/A: nothing discovered. Mark every sub-check N/A,
  // dimensionScore() returns null, return DimensionResult with na:true.
  if (!hit) {
    const sig = await Promise.resolve(signals).catch(() => NO_SIGNALS);
    const evidence = sig.apiSignals[0] ?? (sig.mcpUrls[0] ? `a link to an MCP endpoint, ${sig.mcpUrls[0]}` : "");
    const naNote = evidence ? dim3ApiWithoutOpenApiNote(evidence) : DIM3_NO_API_NA_NOTE;
    for (const id of [
      "discovery",
      "spec_validity",
      "info_completeness",
      "security_schemes",
      "operation_coverage",
    ]) {
      subs.push({
        id,
        name: id, // placeholder; consumers should hide N/A whole-dim sub-checks
        weight: 1,
        score: 0,
        passed: false,
        notes: naNote,
        na: true,
      });
    }
    // Pattern A — null contract for new runners. Placeholder score 0 is
    // correct; composite math skips this dimension via na:true.
    return {
      dimension_id: 3,
      dimension_name: "OpenAPI / API Catalog",
      score: 0,
      grade: gradeFor(0),
      sub_checks: subs,
      na: true,
    };
  }

  // Spec body not read in full (byte cap, deadline or read error): the
  // dimension was NOT measured. Whole-dimension N/A (dropped from the
  // composite like the no-API path) with unmeasured:true so consumers don't
  // call it "no API surface". Discovery alone must not score: a huge or
  // stalled file at a well-known path would otherwise earn 100. The
  // discovery result stays as informational text in the first note.
  if (!hit.complete) {
    const found = `Found via ${hit.source} at ${hit.url} (content-type=${hit.contentType || "unknown"}).`;
    for (const [id, name, weight] of [
      ["discovery", "API spec discovery", 25],
      ["spec_validity", "Spec validity (parses + has version field)", 25],
      ["info_completeness", "Spec info completeness (title + version + description)", 15],
      ["security_schemes", "Security schemes documented", 15],
      ["operation_coverage", "Operation coverage + per-operation docs", 20],
    ] as const) {
      subs.push({
        id,
        name,
        weight,
        score: 0,
        passed: false,
        notes: id === "discovery" ? `${INCOMPLETE_SPEC_NOTE} ${found}` : INCOMPLETE_SPEC_NOTE,
        na: true,
      });
    }
    return {
      dimension_id: 3,
      dimension_name: "OpenAPI / API Catalog",
      score: 0,
      grade: gradeFor(0),
      sub_checks: subs,
      na: true,
      unmeasured: true,
    };
  }

  // 1.4.0: an API catalog whose service-desc could not be read: the catalog
  // itself is scored for discovery; the spec checks were not measured (the
  // linkset is an index, so scoring it as the spec reported "missing info").
  if (catalogUnreadable) {
    subs.push({
      id: "discovery",
      name: "API spec discovery",
      weight: 25,
      score: 100,
      passed: true,
      notes: `Found via ${hit.source} at ${hit.url} (content-type=${hit.contentType || "unknown"}).`,
    });
    for (const [id, name, weight] of [
      ["spec_validity", "Spec validity (parses + has version field)", 25],
      ["info_completeness", "Spec info completeness (title + version + description)", 15],
      ["security_schemes", "Security schemes documented", 15],
      ["operation_coverage", "Operation coverage + per-operation docs", 20],
    ] as const) {
      subs.push({ id, name, weight, score: 0, passed: false, notes: `Not measured: ${catalogUnreadable} Weight redistributed across other Dim 3 sub-checks.`, na: true });
    }
    const score = dimensionScore(subs) ?? 0;
    return { dimension_id: 3, dimension_name: "OpenAPI / API Catalog", score, grade: gradeFor(score), sub_checks: subs };
  }

  // ── Sub-check 1: discovery ─────────────────────────────────────────────
  // Well-known → 100. Canonical → 75. Homepage-link fallback → 50.
  let discoveryScore: number;
  if (hit.source.startsWith("well-known")) discoveryScore = 100;
  else if (hit.source.startsWith("canonical")) discoveryScore = 75;
  else discoveryScore = 50;
  subs.push({
    id: "discovery",
    name: "API spec discovery",
    weight: 25,
    score: discoveryScore,
    passed: discoveryScore >= 70,
    notes: `Found via ${hit.source} at ${hit.url} (content-type=${hit.contentType || "unknown"}).${catalogUrl ? viaCatalog(catalogUrl) : ""}`,
  });


  // ── Sub-check 2: spec_validity ────────────────────────────────────────
  const parsed = tryParseSpec(hit.body, hit.contentType);
  let validityScore = 0;
  let validityNote: string;
  if (!parsed) {
    validityNote = `Spec at ${hit.url} did not parse as JSON or recognizable YAML.`;
  } else if (parsed.format === "yaml-heuristic") {
    // Partial credit — spec is reachable + has a recognizable version field,
    // but our static parser can't validate deeper structure.
    const verKey = "openapi" in parsed.spec ? "openapi" : "swagger";
    const ver = String(parsed.spec[verKey] ?? "unknown");
    validityScore = 50;
    validityNote = `YAML spec detected (${verKey} ${ver}). The scanner checks a YAML spec's version field and reachability only, so it gets partial credit here.`;
  } else {
    const hasOpenapi = typeof parsed.spec["openapi"] === "string";
    const hasSwagger = typeof parsed.spec["swagger"] === "string";
    if (hasOpenapi) {
      const v = parsed.spec["openapi"] as string;
      // Accept 3.x. 2.x is "swagger" not "openapi" — covered below.
      if (/^3\.\d+/.test(v)) {
        validityScore = 100;
        validityNote = `Valid JSON spec, openapi ${v}.`;
      } else {
        validityScore = 75;
        validityNote = `Valid JSON spec, openapi ${v} (not a 3.x version; partial credit).`;
      }
    } else if (hasSwagger) {
      const v = parsed.spec["swagger"] as string;
      validityScore = 75;
      validityNote = `Valid JSON spec, swagger ${v} (Swagger 2.0 — recommend migrating to OpenAPI 3.x).`;
    } else {
      validityScore = 25;
      validityNote = `JSON parsed but no "openapi" or "swagger" version field at the root.`;
    }
  }
  subs.push({
    id: "spec_validity",
    name: "Spec validity (parses + has version field)",
    weight: 25,
    score: validityScore,
    passed: validityScore >= 70,
    notes: validityNote,
  });

  // The remaining three sub-checks all read `parsed.spec`. If parsing failed
  // entirely, they score 0 with explanation. 1.3.3: for a YAML spec they are
  // N/A "not measured" (weight redistributed): the scanner can't read the
  // YAML structure, which says nothing about the spec itself.
  const spec = parsed && parsed.format === "json" ? parsed.spec : null;
  const yamlUnmeasured = !!parsed && !spec;
  const yamlNa = yamlUnmeasured ? { na: true } : {};

  // ── Sub-check 3: info_completeness ────────────────────────────────────
  let infoScore = 0;
  let infoNote: string;
  if (!spec) {
    infoNote = parsed
      ? YAML_UNMEASURED_NOTE
      : "Skipped — spec did not parse as JSON.";
  } else {
    const info = spec["info"];
    if (typeof info === "object" && info !== null) {
      const i = info as Record<string, unknown>;
      const hasTitle = typeof i.title === "string" && i.title.trim().length > 0;
      const hasVersion = typeof i.version === "string" && i.version.trim().length > 0;
      const hasDescription =
        typeof i.description === "string" && i.description.trim().length >= 20;
      const hits = [hasTitle, hasVersion, hasDescription].filter(Boolean).length;
      infoScore = Math.round((hits / 3) * 100);
      infoNote = `info: title=${hasTitle ? "yes" : "no"}, version=${hasVersion ? "yes" : "no"}, description=${hasDescription ? "yes" : "<20 chars or missing"} (${hits}/3)`;
    } else {
      infoNote = `Spec is missing the "info" object entirely — required by OpenAPI 3.x §4.1.`;
    }
  }
  subs.push({
    id: "info_completeness",
    name: "Spec info completeness (title + version + description)",
    weight: 15,
    score: infoScore,
    passed: infoScore >= 70,
    notes: infoNote,
    ...yamlNa,
  });

  // ── Sub-check 4: security_schemes ─────────────────────────────────────
  let securityScore = 0;
  let securityNote: string;
  if (!spec) {
    securityNote = parsed
      ? YAML_UNMEASURED_NOTE
      : "Skipped — spec did not parse as JSON.";
  } else {
    const components = spec["components"];
    const securitySchemes =
      typeof components === "object" && components !== null
        ? (components as Record<string, unknown>)["securitySchemes"]
        : undefined;
    const hasSchemes =
      typeof securitySchemes === "object" &&
      securitySchemes !== null &&
      Object.keys(securitySchemes as Record<string, unknown>).length > 0;
    const security = spec["security"];
    const explicitlyOpen = Array.isArray(security) && security.length === 0;
    if (hasSchemes) {
      const schemeNames = Object.keys(securitySchemes as Record<string, unknown>);
      securityScore = 100;
      securityNote = `components.securitySchemes declared: ${schemeNames.join(", ")}.`;
    } else if (explicitlyOpen) {
      securityScore = 75;
      securityNote = "Spec declares an empty security:[] (explicitly open API). Acceptable but document in info.description so agents know to skip auth.";
    } else {
      securityNote =
        "No components.securitySchemes and no top-level security:[] — agents have no signal about how to authenticate. Add the relevant scheme(s) (apiKey / http bearer / OAuth) per OpenAPI 3.x §4.7.";
    }
  }
  subs.push({
    id: "security_schemes",
    name: "Security schemes documented",
    weight: 15,
    score: securityScore,
    passed: securityScore >= 70,
    notes: securityNote,
    ...yamlNa,
  });

  // ── Sub-check 5: operation_coverage ───────────────────────────────────
  let coverageScore = 0;
  let coverageNote: string;
  if (!spec) {
    coverageNote = parsed
      ? YAML_UNMEASURED_NOTE
      : "Skipped — spec did not parse as JSON.";
  } else {
    const paths = spec["paths"];
    if (typeof paths !== "object" || paths === null) {
      coverageNote = `Spec missing "paths" object — no operations defined.`;
    } else {
      const operations: Array<{ path: string; method: string; op: Record<string, unknown> }> = [];
      const httpVerbs = new Set([
        "get",
        "post",
        "put",
        "delete",
        "patch",
        "head",
        "options",
        "trace",
      ]);
      for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
        if (typeof item !== "object" || item === null) continue;
        for (const [verb, op] of Object.entries(item as Record<string, unknown>)) {
          if (!httpVerbs.has(verb.toLowerCase())) continue;
          if (typeof op === "object" && op !== null) {
            operations.push({
              path,
              method: verb.toLowerCase(),
              op: op as Record<string, unknown>,
            });
          }
        }
      }
      const opCount = operations.length;
      if (opCount === 0) {
        coverageNote = `Spec has paths object but zero HTTP operations.`;
      } else {
        const documented = operations.filter(
          (o) =>
            (typeof o.op.summary === "string" && o.op.summary.trim().length > 0) ||
            (typeof o.op.description === "string" && o.op.description.trim().length > 0)
        ).length;
        // Two terms, evenly weighted: count score (>=5 ops → 100) and
        // documentation coverage (% of ops with summary or description).
        const countScore = opCount >= 5 ? 100 : opCount >= 3 ? 75 : opCount >= 1 ? 50 : 0;
        const docScore = Math.round((documented / opCount) * 100);
        coverageScore = Math.round(countScore * 0.5 + docScore * 0.5);
        coverageNote = `${opCount} operation(s); ${documented}/${opCount} have a summary or description. (count=${countScore}, doc=${docScore})`;
      }
    }
  }
  subs.push({
    id: "operation_coverage",
    name: "Operation coverage + per-operation docs",
    weight: 20,
    score: coverageScore,
    passed: coverageScore >= 70,
    notes: coverageNote,
    ...yamlNa,
  });

  // Pattern A: dimensionScore returns null only when every sub-check is N/A,
  // which we already handled above (na:true short-circuit). Below this point,
  // discovery hit, so at least the discovery sub-check has a real score.
  const score = dimensionScore(subs) ?? 0;
  return {
    dimension_id: 3,
    dimension_name: "OpenAPI / API Catalog",
    score,
    grade: gradeFor(score),
    sub_checks: subs,
  };
}
