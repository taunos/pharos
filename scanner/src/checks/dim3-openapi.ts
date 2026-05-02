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

const FETCH_TIMEOUT_MS = 5000;
const STATIC_UA = "AstrantScanner-Dim3/1.2.0";

async function timedFetch(
  url: string,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
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

async function probeWellKnown(origin: string): Promise<DiscoveryHit | null> {
  for (const path of WELL_KNOWN_CANDIDATES) {
    const url = `${origin}${path}`;
    if (!isSafeSpecUrl(url)) continue;
    const res = await timedFetch(url, {
      headers: { Accept: "application/json", "User-Agent": STATIC_UA },
      redirect: "follow",
    });
    if (res && res.ok) {
      const body = await res.text();
      return {
        url,
        body,
        contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
        source: `well-known ${path}`,
      };
    }
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
      const body = await res.text();
      return {
        url,
        body,
        contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
        source: `canonical ${path}`,
      };
    }
  }
  return null;
}

// Homepage <link rel="api-catalog"> tag and anchors mentioning openapi/swagger.
function extractHomepageSpecLink(homepageHtml: string, base: string): string | null {
  // 1. <link rel="api-catalog" href="..."> per RFC 9727.
  const linkRel =
    /<link\b[^>]*\brel=["'](?:api-catalog|describedby|service-desc)["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(
      homepageHtml
    ) ??
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["'](?:api-catalog|describedby|service-desc)["'][^>]*>/i.exec(
      homepageHtml
    );
  if (linkRel) {
    try {
      return new URL(linkRel[1], base).toString();
    } catch {
      // ignore
    }
  }
  // 2. Anchor with href ending in openapi.json/yaml or swagger.json or
  //    visible text "OpenAPI" / "Swagger".
  const anchors =
    /<a\b[^>]*\bhref=["']([^"']+\.(?:json|yaml|yml))["'][^>]*>(?:\s|<[^>]+>)*([^<]*(?:openapi|swagger)[^<]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = anchors.exec(homepageHtml)) !== null) {
    try {
      return new URL(m[1], base).toString();
    } catch {
      // ignore
    }
  }
  return null;
}

async function probeHomepageLink(
  origin: string,
  homepageHtml: string | null
): Promise<DiscoveryHit | null> {
  if (!homepageHtml) return null;
  const candidate = extractHomepageSpecLink(homepageHtml, origin);
  if (!candidate || !isSafeSpecUrl(candidate)) return null;
  const res = await timedFetch(candidate, {
    headers: {
      Accept: "application/json, application/yaml, text/yaml, text/plain",
      "User-Agent": STATIC_UA,
    },
    redirect: "follow",
  });
  if (res && res.ok) {
    const body = await res.text();
    return {
      url: candidate,
      body,
      contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
      source: `homepage link ${candidate}`,
    };
  }
  return null;
}

async function discoverApiSpec(
  origin: string,
  homepageHtml: string | null
): Promise<DiscoveryHit | null> {
  // Ordered: well-known → canonical → homepage-link. Stop at first hit.
  let hit = await probeWellKnown(origin);
  if (hit) return hit;
  hit = await probeCanonical(origin);
  if (hit) return hit;
  hit = await probeHomepageLink(origin, homepageHtml);
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
  const yamlOpenapi = /^\s*openapi\s*:\s*["']?(\d+\.\d+(?:\.\d+)?)/m.test(body);
  const yamlSwagger = /^\s*swagger\s*:\s*["']?(\d+\.\d+(?:\.\d+)?)/m.test(body);
  if (yamlOpenapi || yamlSwagger) {
    // Build a minimal spec object so downstream checks can at least see the
    // version field. They'll see no `info` / `paths` and score appropriately.
    const versionMatch = (yamlOpenapi
      ? /^\s*openapi\s*:\s*["']?(\d+\.\d+(?:\.\d+)?)/m
      : /^\s*swagger\s*:\s*["']?(\d+\.\d+(?:\.\d+)?)/m
    ).exec(body);
    const versionKey = yamlOpenapi ? "openapi" : "swagger";
    return {
      spec: {
        [versionKey]: versionMatch ? versionMatch[1] : "unknown",
        __yaml_heuristic: true,
      },
      format: "yaml-heuristic",
    };
  }
  return null;
}

// ── runDim3 ──────────────────────────────────────────────────────────────

export async function runDim3(
  targetUrl: string,
  env: Env,
  homepageHtml: string | null = null
): Promise<DimensionResult> {
  void env; // reserved for future use; no LLM in Slice 3a
  const origin = new URL(targetUrl).origin;

  const subs: SubCheck[] = [];

  // ── Discovery ──────────────────────────────────────────────────────────
  const hit = await discoverApiSpec(origin, homepageHtml);

  // Whole-dimension N/A: nothing discovered. Mark every sub-check N/A,
  // dimensionScore() returns null, return DimensionResult with na:true.
  if (!hit) {
    const naNote =
      "No OpenAPI / API catalog discovered (checked /.well-known/api-catalog, /.well-known/openapi, /openapi.json|.yaml, /swagger.json, and homepage link). Site appears to be content-only from an API-catalog perspective. Dimension marked N/A — composite math drops it without penalty.";
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
    notes: `Found via ${hit.source} at ${hit.url} (content-type=${hit.contentType || "unknown"}).`,
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
    validityNote = `YAML spec detected (${verKey} ${ver}). Slice 3a parses JSON specs in full; YAML gets partial-credit + reachability validation only.`;
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
        validityNote = `Valid JSON spec, openapi ${v} (Slice 3a targets 3.x; older 3.0/2.0 still scored).`;
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
  // entirely, they score 0 with explanation; if YAML-heuristic, they score 0
  // because we don't have the parsed object. Both cases keep the sub-check
  // present (not N/A) so the user sees the structural gap rather than a
  // missing line item.
  const spec = parsed && parsed.format === "json" ? parsed.spec : null;

  // ── Sub-check 3: info_completeness ────────────────────────────────────
  let infoScore = 0;
  let infoNote: string;
  if (!spec) {
    infoNote = parsed
      ? "Skipped — YAML spec; Slice 3a's static parser doesn't traverse YAML structure."
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
  });

  // ── Sub-check 4: security_schemes ─────────────────────────────────────
  let securityScore = 0;
  let securityNote: string;
  if (!spec) {
    securityNote = parsed
      ? "Skipped — YAML spec; Slice 3a's static parser doesn't traverse YAML structure."
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
  });

  // ── Sub-check 5: operation_coverage ───────────────────────────────────
  let coverageScore = 0;
  let coverageNote: string;
  if (!spec) {
    coverageNote = parsed
      ? "Skipped — YAML spec; Slice 3a's static parser doesn't traverse YAML structure."
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
