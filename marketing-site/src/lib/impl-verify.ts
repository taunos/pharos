// Implementation verification report — per-artifact acceptance checks
// (DECISION 2026-11-05: "Day 0 = verified application, not payment").
//
// Given what an Implementation patch delivered (expectedFromDelivery) and the
// customer's live site, verifyArtifacts checks each delivered artifact for
// CONTENT and BEHAVIOUR, not just HTTP 200:
//   llms_txt    GET <site>/llms.txt: delivered H1, ## sections and links present
//   openapi     GET <site>/openapi.yaml: parses (JSON, or the block-YAML subset
//               the generator emits), is ours (title or server URL), and has
//               every delivered path + operation
//   json_ld     GET <site>/: an application/ld+json node of each delivered
//               @type with the delivered key fields
//   mcp_server  the URL the customer reports: MCP JSON-RPC initialize ->
//               notifications/initialized -> tools/list with the delivered tool
//               names -> tools/call of one delivered tool (content[]); if that
//               URL does not speak JSON-RPC, the endpoint named by its origin's
//               /.well-known/mcp.json card is tried once; a card without a
//               JSON-RPC endpoint is "legacy non-MCP protocol" (mismatch)
//
// States: working | absent (404/410, soft-404, not in the page) | blocked
// (401/403/407/451, WAF challenge, robots.txt disallow) | mismatch (present but
// not ours, altered, unparseable, oversized) | unobservable (timeout, network,
// 5xx/429, refused non-public redirect, no URL to check).
//
// Hostile-input discipline: every fetch goes through ./safe-fetch (public
// http(s) only, every redirect hop re-validated, one deadline per fetch
// covering headers and body, byte caps). Parsing is linear indexOf/charCode
// scanning or anchored regexes on bounded lines; JSON.parse only sees capped
// input. Nothing read from the site is sent anywhere: the only outbound
// requests are GETs to the site and the MCP handshake to the reported URL.
// Pure module: no Next, no bindings (the operator CLI runs it under Node).

import {
  MAX_HTML_BYTES,
  MAX_JSON_BYTES,
  MAX_SPEC_BYTES,
  MAX_TEXT_BYTES,
  safeFetch,
  validateTargetUrl,
  type SafeFetchFailure,
  type SafeResponse,
} from "./safe-fetch";

export const VERIFY_ENGINE = "impl-verify:v1";

export type ArtifactState = "working" | "absent" | "blocked" | "mismatch" | "unobservable";

export type ArtifactCheck = {
  artifact: "llms_txt" | "openapi" | "json_ld" | "mcp_server" | string;
  state: ArtifactState;
  url: string;
  evidence: { status?: number; contentType?: string; matched?: string[]; missing?: string[]; note?: string };
  checkedAt: string;
};

export interface ExpectedLlmsTxt {
  /** Served path (patch file public/llms.txt -> /llms.txt). */
  path: string;
  /** The delivered file, for the byte-identical check. */
  content: string;
  /** H1 text, without "# ". */
  title: string;
  /** "## " heading texts in delivered order. */
  headings: string[];
  /** Markdown link targets. */
  links: string[];
}

export interface ExpectedOpenApi {
  path: string;
  content: string;
  version: string;
  title: string;
  servers: string[];
  /** path -> lowercase HTTP methods. */
  paths: Record<string, string[]>;
  operationCount: number;
}

export interface ExpectedJsonLdNode {
  type: string;
  /** Top-level string fields that identify the node (name, url, serviceType). */
  fields: Record<string, string>;
}

export interface ExpectedJsonLd {
  /** Page the blocks are meant to be inserted into (the homepage). */
  path: string;
  nodes: ExpectedJsonLdNode[];
}

export interface ExpectedMcpServer {
  brandName: string;
  domain: string;
  toolNames: string[];
}

export interface ExpectedArtifacts {
  engine: typeof VERIFY_ENGINE;
  llms_txt?: ExpectedLlmsTxt;
  openapi?: ExpectedOpenApi;
  json_ld?: ExpectedJsonLd;
  mcp_server?: ExpectedMcpServer;
}

/**
 * What impl-fulfill-run persists for a delivery: the git-am patch bytes at R2
 * `f2-patches/<session_id>.patch` (or, in-process, the `allFiles` map it was
 * assembled from).
 */
export type ImplDelivery = { patch: string | Uint8Array } | { files: Record<string, string> };

// ── Limits ────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 8000;
/** One budget for the whole MCP handshake (scanner dim2 uses the same). */
const MCP_BUDGET_MS = 10000;
const MAX_PATCH_BYTES = 5 * 1024 * 1024;
const MAX_PATHS = 20000;
const MAX_LINE_CHARS = 4096;
const MAX_LIST = 200;
const MAX_LD_SCRIPTS = 64;
const MAX_LD_SCRIPT_CHARS = 512 * 1024;
const MAX_LD_NODES = 1000;
const MAX_LD_DEPTH = 6;
const MAX_ROBOTS_RULES = 2000;
const USER_AGENT = "AstrantVerify/1.0 (+https://astrant.io)";
const MCP_PROTOCOL_VERSION = "2025-06-18";
/** Crawlers whose robots.txt group is evaluated besides "*". */
const ROBOTS_AGENTS = ["*", "GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot"];
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

// ── expectedFromDelivery ─────────────────────────────────────────────────

const LLMS_FILE = "public/llms.txt";
const OPENAPI_FILE = "public/openapi.yaml";
const JSONLD_FILE = "app/layout-jsonld.html";
const MCP_WORKER_FILE = "mcp-server/index.ts";

/** Throws on a patch it cannot read: the input is operator-supplied, not site content. */
export function expectedFromDelivery(delivery: ImplDelivery): ExpectedArtifacts {
  const files = "files" in delivery ? delivery.files : filesFromPatch(delivery.patch);
  const out: ExpectedArtifacts = { engine: VERIFY_ENGINE };

  const llms = files[LLMS_FILE];
  if (typeof llms === "string") {
    const p = parseLlmsTxt(llms);
    out.llms_txt = {
      path: servedPath(LLMS_FILE),
      content: llms,
      title: p.title ?? "",
      headings: p.headings,
      links: p.links,
    };
  }

  const spec = files[OPENAPI_FILE];
  if (typeof spec === "string") {
    const p = parseOpenApi(spec);
    if (!p) throw new Error(`${OPENAPI_FILE} in the delivery does not parse`);
    out.openapi = {
      path: servedPath(OPENAPI_FILE),
      content: spec,
      version: p.version,
      title: p.title ?? "",
      servers: p.servers,
      paths: p.paths ?? {},
      operationCount: countOperations(p.paths ?? {}),
    };
  }

  const ld = files[JSONLD_FILE];
  if (typeof ld === "string") {
    const nodes: ExpectedJsonLdNode[] = [];
    for (const node of collectLdNodes(ld, false).nodes) {
      const type = typeList(node)[0];
      if (!type) continue;
      const fields: Record<string, string> = {};
      for (const k of ["name", "url", "serviceType"]) {
        if (typeof node[k] === "string") fields[k] = node[k] as string;
      }
      nodes.push({ type, fields });
    }
    if (nodes.length === 0) throw new Error(`${JSONLD_FILE} in the delivery has no JSON-LD nodes`);
    out.json_ld = { path: "/", nodes };
  }

  const worker = files[MCP_WORKER_FILE];
  if (typeof worker === "string") out.mcp_server = parseMcpWorker(worker);

  return out;
}

/** public/<x> is served at /<x> (Next.js App Router static files). */
function servedPath(file: string): string {
  return file.startsWith("public/") ? file.slice("public".length) : "/" + file;
}

/**
 * Reads the new-file blocks of a patch emitted by f2-patch-assembler.ts:
 * `diff --git a/P b/P` ... `+++ b/P`, `@@ -0,0 +1,N @@`, then exactly N
 * "+"-prefixed lines, then an optional "\ No newline at end of file".
 */
export function filesFromPatch(patch: string | Uint8Array): Record<string, string> {
  const text = typeof patch === "string" ? patch : new TextDecoder("utf-8", { fatal: true }).decode(patch);
  if (utf8Bytes(text) > MAX_PATCH_BYTES) throw new Error("patch exceeds size limit");
  const lines = text.split("\n");
  const files: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("diff --git a/")) continue;
    const plus = lines[i + 4] ?? "";
    const hunk = /^@@ -0,0 \+1(?:,(\d{1,7}))? @@$/.exec(lines[i + 5] ?? "");
    if (!plus.startsWith("+++ b/") || !hunk) throw new Error(`malformed diff block at line ${i + 1}`);
    const path = plus.slice(6);
    const n = hunk[1] === undefined ? 1 : Number(hunk[1]);
    const body: string[] = [];
    for (let k = 0; k < n; k++) {
      const l = lines[i + 6 + k];
      if (l === undefined || !l.startsWith("+")) throw new Error(`hunk for ${path} is short`);
      body.push(l.slice(1));
    }
    let j = i + 6 + n;
    const noNewline = lines[j] === "\\ No newline at end of file";
    if (noNewline) j++;
    if (path in files) throw new Error(`duplicate file ${path}`);
    files[path] = body.join("\n") + (noNewline ? "" : "\n");
    i = j - 1;
  }
  if (Object.keys(files).length === 0) throw new Error("patch has no files");
  return files;
}

/**
 * The rendered Worker (f2-mcp-server-template/worker-template.ts): tool names
 * are the keys of the `const TOOL_RESPONSES: ... = {...};` JSON literal; brand
 * and domain come from the MCP_DISCOVERY JSON string literals.
 */
function parseMcpWorker(src: string): ExpectedMcpServer {
  const decl = src.indexOf("const TOOL_RESPONSES");
  const eq = decl < 0 ? -1 : src.indexOf(" = ", decl);
  // JSON.stringify(_, null, 2) closes the top-level object with "}" at column 0.
  const end = eq < 0 ? -1 : src.indexOf("\n};", eq);
  if (end < 0) throw new Error(`${MCP_WORKER_FILE} has no TOOL_RESPONSES literal`);
  let tools: unknown;
  try {
    tools = JSON.parse(src.slice(eq + 3, end + 2));
  } catch {
    throw new Error(`${MCP_WORKER_FILE} TOOL_RESPONSES is not JSON`);
  }
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    throw new Error(`${MCP_WORKER_FILE} TOOL_RESPONSES is not an object`);
  }
  const disc = src.indexOf("const MCP_DISCOVERY = {");
  return {
    brandName: disc < 0 ? "" : jsStringField(src, disc, "name"),
    domain: disc < 0 ? "" : jsStringField(src, disc, "domain"),
    toolNames: Object.keys(tools),
  };
}

/** Value of the first `  <field>: "..."` line after `from` (a JSON string literal). */
function jsStringField(src: string, from: number, field: string): string {
  const key = `\n  ${field}: `;
  const at = src.indexOf(key, from);
  if (at < 0 || src[at + key.length] !== '"') return "";
  const q = readDoubleQuoted(src, at + key.length);
  return q ? q.value : "";
}

/**
 * The double-quoted string starting at s[start] (a '"'), decoded with JSON
 * string rules (a subset of YAML's double-quoted escapes). Stops at a line
 * break. null = unterminated or not a valid JSON string.
 */
function readDoubleQuoted(s: string, start: number): { value: string; end: number } | null {
  for (let i = start + 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10 || c === 13) return null;
    if (c === 92) i++; // backslash: skip the escaped char
    else if (c === 34) {
      try {
        return { value: JSON.parse(s.slice(start, i + 1)) as string, end: i + 1 };
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ── verifyArtifacts ──────────────────────────────────────────────────────

export interface VerifyInput {
  /** Customer site, e.g. "https://acme.com" or "acme.com". Only its origin is used. */
  siteUrl: string;
  expected: ExpectedArtifacts;
  /** Deployed MCP Worker URL as the customer reports it (the patch does not fix one). */
  mcpUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface Ctx {
  origin: string | null;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => Date;
  robots: Promise<RobotsGroup[] | null> | null;
}

export async function verifyArtifacts(input: VerifyInput): Promise<ArtifactCheck[]> {
  const now = input.now ?? (() => new Date());
  let origin: string | null = null;
  try {
    const raw = /^[a-z][a-z0-9+.-]*:/i.test(input.siteUrl.trim()) ? input.siteUrl.trim() : `https://${input.siteUrl.trim()}`;
    origin = validateTargetUrl(raw).origin;
  } catch {
    origin = null;
  }
  const f = input.fetchImpl;
  const ctx: Ctx = {
    origin,
    fetchImpl: f ? (i, n) => f(i, n) : undefined,
    now,
    robots: null,
  };
  const e = input.expected;
  const jobs: Promise<ArtifactCheck>[] = [];
  if (e.llms_txt) jobs.push(checkLlmsTxt(ctx, e.llms_txt));
  if (e.openapi) jobs.push(checkOpenApi(ctx, e.openapi));
  if (e.json_ld) jobs.push(checkJsonLd(ctx, e.json_ld));
  if (e.mcp_server) jobs.push(checkMcp(ctx, e.mcp_server, input.mcpUrl));
  return Promise.all(jobs);
}

type Evidence = ArtifactCheck["evidence"];

function result(ctx: Ctx, artifact: string, url: string, state: ArtifactState, evidence: Evidence): ArtifactCheck {
  const ev: Evidence = {};
  for (const [k, v] of Object.entries(evidence) as [keyof Evidence, unknown][]) {
    if (v === undefined || (Array.isArray(v) && v.length === 0) || v === "") continue;
    (ev as Record<string, unknown>)[k] = v;
  }
  return { artifact, state, url, evidence: ev, checkedAt: ctx.now().toISOString() };
}

type Got =
  | { ok: false; reason: SafeFetchFailure }
  | { ok: true; res: SafeResponse };

async function get(ctx: Ctx, url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Got> {
  let reason: SafeFetchFailure = "network";
  const headers = new Headers(init.headers);
  headers.set("User-Agent", USER_AGENT);
  const res = await safeFetch(
    url,
    { ...init, headers },
    { timeoutMs, fetchImpl: ctx.fetchImpl, onFail: (r) => (reason = r) },
  );
  return res ? { ok: true, res } : { ok: false, reason };
}

const FAIL_NOTES: Record<SafeFetchFailure, string> = {
  unsafe_url: "refused: the URL or a redirect hop is not a public http(s) address",
  timeout: "timed out",
  network: "network error",
};

/** null = 2xx (go on and read the body); otherwise the state this status means. */
function classifyStatus(res: SafeResponse): { state: ArtifactState; note: string } | null {
  if ((res.headers.get("cf-mitigated") ?? "").toLowerCase().includes("challenge")) {
    return { state: "blocked", note: "WAF challenge (cf-mitigated: challenge)" };
  }
  const s = res.status;
  if (s >= 200 && s < 300) return null;
  if (s === 401 || s === 403 || s === 407 || s === 451) return { state: "blocked", note: `HTTP ${s}` };
  if (s === 404 || s === 410) return { state: "absent", note: `HTTP ${s}` };
  if (s >= 300 && s < 400) return { state: "unobservable", note: `HTTP ${s}: redirect not followed (hop limit or no Location)` };
  if (s === 429) return { state: "unobservable", note: "HTTP 429: rate limited" };
  return { state: "unobservable", note: `HTTP ${s}` };
}

function looksHtml(contentType: string, body: string): boolean {
  if (/^\s*text\/html/i.test(contentType) || /^\s*application\/xhtml/i.test(contentType)) return true;
  return body.trimStart().startsWith("<");
}

/** Fetch a text artifact; returns either a final check or the body to judge. */
async function fetchArtifactText(
  ctx: Ctx,
  artifact: string,
  path: string,
  maxBytes: number,
): Promise<{ done: ArtifactCheck } | { url: string; status: number; contentType: string; text: string }> {
  if (!ctx.origin) {
    return { done: result(ctx, artifact, path, "unobservable", { note: "site URL is not a public http(s) URL" }) };
  }
  const url = ctx.origin + path;
  const got = await get(ctx, url, { headers: { Accept: "text/plain, application/json, application/yaml, text/yaml, */*" } });
  if (!got.ok) return { done: result(ctx, artifact, url, "unobservable", { note: FAIL_NOTES[got.reason] }) };
  const { res } = got;
  const contentType = res.headers.get("content-type") ?? "";
  const bad = classifyStatus(res);
  if (bad) {
    res.discard();
    return { done: result(ctx, artifact, url, bad.state, { status: res.status, contentType, note: bad.note }) };
  }
  const body = await res.body({ maxBytes, countUpTo: maxBytes + 1 });
  if (body.truncated) {
    return {
      done: result(ctx, artifact, url, "mismatch", {
        status: res.status,
        contentType,
        note: `body exceeds ${maxBytes} bytes; not the delivered file`,
      }),
    };
  }
  if (!body.complete) {
    return { done: result(ctx, artifact, url, "unobservable", { status: res.status, contentType, note: "body read failed or timed out" }) };
  }
  if (looksHtml(contentType, body.text)) {
    return {
      done: result(ctx, artifact, url, "absent", {
        status: res.status,
        contentType,
        note: "soft 404: an HTML page is served at this path",
      }),
    };
  }
  return { url, status: res.status, contentType, text: body.text };
}

/** working -> blocked when robots.txt disallows the path for a listed crawler. */
async function applyRobots(ctx: Ctx, check: ArtifactCheck, path: string): Promise<ArtifactCheck> {
  if (check.state !== "working" && check.state !== "mismatch") return check;
  const groups = await loadRobots(ctx);
  if (!groups) return check;
  const denied = ROBOTS_AGENTS.filter((a) => !robotsAllows(groups, a, path));
  if (denied.length === 0) return check;
  const note = `robots.txt disallows ${path} for ${denied.join(", ")}`;
  const prev = check.evidence.note;
  return {
    ...check,
    state: check.state === "working" ? "blocked" : check.state,
    evidence: { ...check.evidence, note: prev ? `${prev}; ${note}` : note },
  };
}

function loadRobots(ctx: Ctx): Promise<RobotsGroup[] | null> {
  if (!ctx.robots) {
    ctx.robots = (async () => {
      if (!ctx.origin) return null;
      const got = await get(ctx, ctx.origin + "/robots.txt");
      if (!got.ok) return null;
      if (got.res.status < 200 || got.res.status >= 300) {
        got.res.discard();
        return null;
      }
      const body = await got.res.body({ maxBytes: MAX_TEXT_BYTES });
      if (looksHtml(got.res.headers.get("content-type") ?? "", body.text)) return null;
      return parseRobots(body.text);
    })();
  }
  return ctx.robots;
}

// ── llms.txt ─────────────────────────────────────────────────────────────

async function checkLlmsTxt(ctx: Ctx, exp: ExpectedLlmsTxt): Promise<ArtifactCheck> {
  const f = await fetchArtifactText(ctx, "llms_txt", exp.path, MAX_TEXT_BYTES);
  if ("done" in f) return f.done;
  const got = parseLlmsTxt(f.text);
  const matched: string[] = [];
  const missing: string[] = [];
  const titleOk = got.title !== null && norm(got.title) === norm(exp.title);
  (titleOk ? matched : missing).push(`title:${exp.title}`);
  const heads = new Set(got.headings.map(norm));
  for (const h of exp.headings) (heads.has(norm(h)) ? matched : missing).push(`section:${h}`);
  const links = new Set(got.links.map(normUrl));
  for (const l of exp.links) (links.has(normUrl(l)) ? matched : missing).push(`link:${l}`);
  const identical = sameBytes(f.text, exp.content);
  const note = identical
    ? "byte-identical to the delivered file"
    : !titleOk && matched.length === 0
      ? "an llms.txt is served but it is not the delivered file"
      : missing.length > 0
        ? "delivered file altered: some delivered sections or links are gone"
        : "differs from the delivered bytes; every delivered title, section and link is present";
  const state: ArtifactState = missing.length === 0 ? "working" : "mismatch";
  return applyRobots(
    ctx,
    result(ctx, "llms_txt", f.url, state, { status: f.status, contentType: f.contentType, matched, missing, note }),
    exp.path,
  );
}

/** H1 (first non-blank line, "# "), "## " headings and [text](target) links. Linear. */
export function parseLlmsTxt(text: string): { title: string | null; headings: string[]; links: string[] } {
  let title: string | null = null;
  let sawContent = false;
  const headings: string[] = [];
  const links: string[] = [];
  forEachLine(text, (line) => {
    const t = line.trim();
    if (!sawContent && t !== "") {
      sawContent = true;
      if (t.startsWith("# ")) title = t.slice(2).trim();
    }
    if (t.startsWith("## ") && headings.length < MAX_LIST) headings.push(t.slice(3).trim());
    if (t.length > MAX_LINE_CHARS) return;
    const open = t.indexOf("[");
    let from = 0;
    while (open >= 0 && links.length < MAX_LIST) {
      const mid = t.indexOf("](", from);
      if (mid < 0) break;
      const close = t.indexOf(")", mid + 2);
      if (close < 0) break;
      if (open < mid) links.push(t.slice(mid + 2, close).trim());
      from = close + 1;
    }
  });
  return { title, headings, links };
}

// ── OpenAPI ──────────────────────────────────────────────────────────────

async function checkOpenApi(ctx: Ctx, exp: ExpectedOpenApi): Promise<ArtifactCheck> {
  const f = await fetchArtifactText(ctx, "openapi", exp.path, MAX_SPEC_BYTES);
  if ("done" in f) return f.done;
  const ev = { status: f.status, contentType: f.contentType };
  const spec = parseOpenApi(f.text);
  if (!spec) {
    return applyRobots(
      ctx,
      result(ctx, "openapi", f.url, "mismatch", { ...ev, note: "does not parse as an OpenAPI 3.x document" }),
      exp.path,
    );
  }
  const matched: string[] = [`openapi:${spec.version}`];
  const missing: string[] = [];
  const titleOk = spec.title !== null && norm(spec.title) === norm(exp.title);
  const servers = new Set(spec.servers.map(normUrl));
  const serverHits = exp.servers.filter((s) => servers.has(normUrl(s)));
  if (titleOk) matched.push(`title:${exp.title}`);
  for (const s of serverHits) matched.push(`server:${s}`);
  if (!titleOk && serverHits.length === 0) {
    missing.push(`title:${exp.title}`, ...exp.servers.map((s) => `server:${s}`));
    return applyRobots(
      ctx,
      result(ctx, "openapi", f.url, "mismatch", {
        ...ev,
        matched,
        missing,
        note: "an OpenAPI document is served but it is not the delivered spec (neither title nor server URL match)",
      }),
      exp.path,
    );
  }
  if (spec.paths === null) {
    if (exp.operationCount > 0 || Object.keys(exp.paths).length > 0) {
      missing.push("paths:unreadable");
    }
  } else {
    for (const [p, methods] of Object.entries(exp.paths)) {
      const served = spec.paths[p];
      if (!served) {
        missing.push(`path:${p}`);
        continue;
      }
      for (const m of methods) (served.includes(m) ? matched : missing).push(`op:${m.toUpperCase()} ${p}`);
    }
  }
  const servedOps = spec.paths === null ? null : countOperations(spec.paths);
  const identical = sameBytes(f.text, exp.content);
  const parts = [
    identical ? "byte-identical to the delivered file" : "differs from the delivered bytes",
    servedOps === null
      ? "paths not traversable by the bounded parser"
      : `${servedOps} operations served, ${exp.operationCount} delivered`,
  ];
  return applyRobots(
    ctx,
    result(ctx, "openapi", f.url, missing.length === 0 ? "working" : "mismatch", {
      ...ev,
      matched,
      missing,
      note: parts.join("; "),
    }),
    exp.path,
  );
}

export interface ParsedOpenApi {
  version: string;
  title: string | null;
  servers: string[];
  /** null when paths exist but the subset parser cannot traverse them (flow style). */
  paths: Record<string, string[]> | null;
}

/** JSON, or the block-style YAML subset the generator emits. null = not OpenAPI 3.x. */
export function parseOpenApi(text: string): ParsedOpenApi | null {
  const head = text.trimStart()[0];
  const parsed = head === "{" ? parseOpenApiJson(text) : parseOpenApiYaml(text);
  if (!parsed || !/^3\.\d+(\.\d+)?$/.test(parsed.version)) return null;
  return parsed;
}

function parseOpenApiJson(text: string): ParsedOpenApi | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  if (typeof d.openapi !== "string") return null;
  const info = d.info as Record<string, unknown> | undefined;
  const servers: string[] = [];
  if (Array.isArray(d.servers)) {
    for (const s of d.servers.slice(0, MAX_LIST)) {
      const u = (s as { url?: unknown } | null)?.url;
      if (typeof u === "string") servers.push(u);
    }
  }
  let paths: Record<string, string[]> | null = {};
  if (d.paths !== undefined) {
    if (!d.paths || typeof d.paths !== "object" || Array.isArray(d.paths)) paths = null;
    else {
      for (const [p, item] of Object.entries(d.paths as Record<string, unknown>)) {
        paths[p] =
          item && typeof item === "object" ? Object.keys(item as object).filter((k) => HTTP_METHODS.has(k)) : [];
      }
    }
  }
  return {
    version: d.openapi,
    title: info && typeof info.title === "string" ? info.title : null,
    servers,
    paths,
  };
}

/**
 * Block-style YAML subset: `key: value` mappings by indentation, `- url: x`
 * sequence items under servers, `|`/`>` block scalars skipped, `{}` / `[]`
 * as empty flow collections. Any other syntax anywhere (other flow
 * collections, unterminated quotes, anchors/tags, a nested line under a
 * scalar) -> null (does not parse); a path whose value is not a nested block
 * -> paths null. Per-line work is anchored and bounded (lines over MAX_LINE_CHARS fail).
 */
function parseOpenApiYaml(text: string): ParsedOpenApi | null {
  let version: string | null = null;
  let title: string | null = null;
  const servers: string[] = [];
  let paths: Record<string, string[]> | null = {};
  let pathsSeen = false;
  let top = "";
  let childIndent = -1; // indent of the first child under the current top-level key
  let pathKey: string | null = null;
  let opIndent = -1;
  let blockIndent = -1; // inside a block scalar whose key sat at this indent
  let pathCount = 0;
  const levels = [0]; // open indentation levels, innermost last
  let opened = false; // the previous line was a key opening a nested block
  let failed = false;
  forEachLine(text, (raw) => {
    if (failed) return;
    if (raw.length > MAX_LINE_CHARS) {
      failed = true;
      return;
    }
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    let indent = 0;
    while (indent < line.length && line.charCodeAt(indent) === 32) indent++;
    const rest = line.slice(indent);
    if (rest === "" || rest.startsWith("#")) return;
    if (blockIndent >= 0) {
      if (indent > blockIndent) return;
      blockIndent = -1;
    }
    if (rest.startsWith("\t")) {
      failed = true;
      return;
    }
    const isItem = rest === "-" || rest.startsWith("- ");
    const content = rest === "-" ? "" : isItem ? rest.slice(2) : rest;
    const kv = splitKeyValue(content);
    // Syntax gate: every line is `key: value` (or an item holding one, or a
    // scalar) whose key and value the subset supports, at an indent its parent
    // allows. Anything else is not read as fields: the document does not parse.
    if (kv ? !kv.valid : !(isItem && readScalar(content).valid)) {
      failed = true;
      return;
    }
    // Indentation: a deeper line opens a new level, and only right after a key
    // that opens a nested block (empty value); a dedent must land exactly on
    // a level that is still open.
    if (indent > levels[levels.length - 1]) {
      if (!opened) {
        failed = true;
        return;
      }
      levels.push(indent);
    } else {
      while (levels[levels.length - 1] > indent) levels.pop();
      if (levels[levels.length - 1] !== indent) {
        failed = true;
        return;
      }
    }
    if (isItem && kv) levels.push(indent + 2); // the item's mapping column
    opened = kv !== null && kv.value === "";
    if (kv && /^[|>][-+0-9]*$/.test(kv.value)) blockIndent = indent;
    if (indent === 0 && !isItem) {
      if (!kv) {
        failed = true;
        return;
      }
      top = kv.key;
      childIndent = -1;
      pathKey = null;
      if (top === "openapi") version = kv.value;
      if (top === "paths") {
        pathsSeen = true;
        if (kv.value !== "" && kv.value !== "{}") paths = null;
      }
      return;
    }
    if (childIndent < 0) childIndent = indent;
    if (top === "info" && indent === childIndent && kv?.key === "title") title = kv.value;
    if (top === "servers" && kv?.key === "url" && servers.length < MAX_LIST) servers.push(kv.value);
    if (top === "paths" && paths) {
      if (indent === childIndent) {
        if (!kv || isItem || ++pathCount > MAX_PATHS) {
          paths = null;
          return;
        }
        pathKey = kv.key;
        opIndent = -1;
        paths[pathKey] = [];
        if (kv.value !== "" && kv.value !== "{}") paths = null;
      } else if (pathKey !== null && indent > childIndent) {
        if (opIndent < 0) opIndent = indent;
        if (indent === opIndent && kv && HTTP_METHODS.has(kv.key.toLowerCase())) paths[pathKey].push(kv.key.toLowerCase());
      }
    }
  });
  if (failed || version === null) return null;
  return { version, title, servers, paths: pathsSeen ? paths : {} };
}

/**
 * `key: value` / `key:` with an unquoted or quoted key; strips quotes and " #"
 * comments from the value. valid = key and value are in the supported subset.
 */
function splitKeyValue(s: string): { key: string; value: string; valid: boolean } | null {
  let key: string;
  let after: number;
  let keyOk = true;
  const q = s[0];
  if (q === '"' || q === "'") {
    const k = readQuoted(s, 0);
    if (!k || s[k.end] !== ":") return null;
    key = k.value;
    after = k.end + 1;
    keyOk = after === s.length || s[after] === " ";
  } else {
    const colon = s.indexOf(": ");
    const at = colon >= 0 ? colon : s.endsWith(":") ? s.length - 1 : -1;
    if (at <= 0) return null;
    key = s.slice(0, at).trim();
    after = at + 1;
    keyOk = !PLAIN_BAD_START.test(key) && !key.startsWith("#");
  }
  const v = readScalar(s.slice(after));
  return { key, value: v.value, valid: keyOk && v.valid };
}

// Plain scalars may not start with a YAML indicator (flow collections, anchors,
// aliases, tags, block scalars, quotes, reserved) or with "- ", "? ", ": ".
const PLAIN_BAD_START = /^(?:[[\]{},&*!|>%@`'"]|[-?:](?: |$))/;

/**
 * A value in the supported subset: empty (or only a comment), a whole quoted
 * scalar, `{}` / `[]`, a block-scalar header, or a plain scalar that is not
 * flow syntax and holds no further `key: value`. valid false = anything else
 * (unterminated quotes or flow collections, anchors, tags, ...).
 */
function readScalar(raw: string): { value: string; valid: boolean } {
  const v = raw.trim();
  if (v === "" || v.startsWith("#")) return { value: "", valid: true };
  if (v[0] === '"' || v[0] === "'") {
    const quoted = readQuoted(v, 0);
    if (!quoted) return { value: v, valid: false };
    const tail = v.slice(quoted.end);
    const valid = tail.trim() === "" || (tail.startsWith(" ") && tail.trim().startsWith("#"));
    return { value: quoted.value, valid };
  }
  const hash = v.indexOf(" #");
  const value = hash >= 0 ? v.slice(0, hash).trim() : v;
  if (value === "{}" || value === "[]") return { value, valid: true };
  if (/^[|>][-+0-9]*$/.test(value)) return { value, valid: true };
  const valid = !PLAIN_BAD_START.test(value) && !value.includes(": ") && !value.endsWith(":");
  return { value, valid };
}

/** A YAML flow scalar quoted with " (JSON escapes) or ' ('' is a quote) at s[start]. */
function readQuoted(s: string, start: number): { value: string; end: number } | null {
  if (s[start] === '"') return readDoubleQuoted(s, start);
  let out = "";
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] !== "'") out += s[i];
    else if (s[i + 1] === "'") {
      out += "'";
      i++;
    } else return { value: out, end: i + 1 };
  }
  return null;
}

function countOperations(paths: Record<string, string[]>): number {
  let n = 0;
  for (const m of Object.values(paths)) n += m.length;
  return n;
}

// ── JSON-LD ──────────────────────────────────────────────────────────────

async function checkJsonLd(ctx: Ctx, exp: ExpectedJsonLd): Promise<ArtifactCheck> {
  if (!ctx.origin) {
    return result(ctx, "json_ld", exp.path, "unobservable", { note: "site URL is not a public http(s) URL" });
  }
  const url = ctx.origin + exp.path;
  const got = await get(ctx, url, { headers: { Accept: "text/html, application/xhtml+xml" } });
  if (!got.ok) return result(ctx, "json_ld", url, "unobservable", { note: FAIL_NOTES[got.reason] });
  const { res } = got;
  const contentType = res.headers.get("content-type") ?? "";
  const bad = classifyStatus(res);
  if (bad) {
    res.discard();
    return result(ctx, "json_ld", url, bad.state, { status: res.status, contentType, note: bad.note });
  }
  const body = await res.body({ maxBytes: MAX_HTML_BYTES, countUpTo: MAX_HTML_BYTES + 1 });
  const ev = { status: res.status, contentType };
  if (!body.complete && !body.truncated) {
    return result(ctx, "json_ld", url, "unobservable", { ...ev, note: "body read failed or timed out" });
  }
  const { nodes, invalid, scripts } = collectLdNodes(body.text);
  const matched: string[] = [];
  const missing: string[] = [];
  let typesFound = 0;
  for (const want of exp.nodes) {
    const candidates = nodes.filter((n) => typeList(n).includes(want.type));
    if (candidates.length === 0) {
      missing.push(want.type);
      continue;
    }
    typesFound++;
    // The candidate matching the most delivered fields is the one we report.
    let best: { ok: string[]; miss: string[] } | null = null;
    for (const c of candidates) {
      const ok: string[] = [];
      const miss: string[] = [];
      for (const [k, v] of Object.entries(want.fields)) {
        const served = c[k];
        const same = typeof served === "string" && (k === "url" ? normUrl(served) === normUrl(v) : norm(served) === norm(v));
        (same ? ok : miss).push(k);
      }
      if (!best || miss.length < best.miss.length) best = { ok, miss };
      if (miss.length === 0) break;
    }
    if (!best) continue;
    if (best.miss.length === 0) matched.push(want.type);
    for (const k of best.ok) matched.push(`${want.type}.${k}`);
    for (const k of best.miss) missing.push(`${want.type}.${k}`);
  }
  if (body.text.includes("astrant-jsonld:begin")) matched.push("marker:astrant-jsonld");
  const notes: string[] = [`${scripts} ld+json script(s), ${nodes.length} node(s)`];
  if (invalid > 0) notes.push(`${invalid} ld+json block(s) are not valid JSON`);
  if (body.truncated) notes.push(`page exceeds ${MAX_HTML_BYTES} bytes; only the first ${MAX_HTML_BYTES} were checked`);
  let state: ArtifactState;
  if (missing.length === 0) state = "working";
  else if (body.truncated) state = "unobservable";
  else if (typesFound === 0) state = "absent";
  else state = "mismatch";
  return applyRobots(ctx, result(ctx, "json_ld", url, state, { ...ev, matched, missing, note: notes.join("; ") }), exp.path);
}

type LdNode = Record<string, unknown>;

/**
 * Typed nodes in the page's application/ld+json scripts, bounded. nested=true
 * (the served page) also collects nodes inside values; false (the delivery)
 * only top-level nodes, array members and @graph members.
 */
export function collectLdNodes(html: string, nested = true): { nodes: LdNode[]; invalid: number; scripts: number } {
  const nodes: LdNode[] = [];
  let invalid = 0;
  let scripts = 0;
  const visit = (v: unknown, depth: number) => {
    if (nodes.length >= MAX_LD_NODES || depth > MAX_LD_DEPTH || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    const o = v as LdNode;
    if (typeList(o).length > 0) nodes.push(o);
    for (const k of Object.keys(o)) {
      if (k === "@context" || (!nested && k !== "@graph")) continue;
      visit(o[k], depth + 1);
    }
  };
  for (const tag of scanScriptTags(html)) {
    if (scripts >= MAX_LD_SCRIPTS) break;
    if (!isJsonLdType(tag.attrs.type)) continue;
    scripts++;
    const raw = tag.body.trim();
    if (raw.length > MAX_LD_SCRIPT_CHARS) {
      invalid++;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCdata(raw));
    } catch {
      invalid++;
      continue;
    }
    visit(parsed, 0);
  }
  return { nodes, invalid, scripts };
}

function stripCdata(s: string): string {
  return s.startsWith("<![CDATA[") && s.endsWith("]]>") ? s.slice(9, -3).trim() : s;
}

/** "@type" as a list, with a schema.org IRI prefix removed. */
function typeList(o: LdNode): string[] {
  const t = o["@type"];
  const raw = typeof t === "string" ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
  return raw.map((x) => x.replace(/^https?:\/\/schema\.org\//i, ""));
}

// Copied from scanner/src/checks/dim4-structured.ts (outreach security round
// 2): HTML-attribute-tolerant <script> scanning. Linear: one forward pass;
// the attribute regex has no nested quantifiers.
type ScriptTag = { attrs: Record<string, string>; body: string };

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

function isJsonLdType(type: string | undefined): boolean {
  if (type === undefined) return false;
  return type.split(";")[0].trim().toLowerCase() === "application/ld+json";
}

// ── MCP server ───────────────────────────────────────────────────────────

async function checkMcp(ctx: Ctx, exp: ExpectedMcpServer, mcpUrl: string | undefined): Promise<ArtifactCheck> {
  if (!mcpUrl) {
    return result(ctx, "mcp_server", "", "unobservable", {
      note: "no deployed MCP URL reported; the patch does not fix one (customer deploys to their own workers.dev or domain)",
    });
  }
  let target: URL;
  try {
    target = validateTargetUrl(mcpUrl.trim());
  } catch {
    return result(ctx, "mcp_server", mcpUrl, "unobservable", { note: "MCP URL is not a public http(s) URL" });
  }
  const deadline = Date.now() + MCP_BUDGET_MS;
  const left = () => Math.max(1, deadline - Date.now());
  const url = target.toString();
  const first = await mcpJsonRpc(ctx, exp, url, left);
  if ("check" in first) return first.check;
  return checkMcpCard(ctx, exp, target, left, `initialize at ${url} got no JSON-RPC result (HTTP ${first.noRpc})`);
}

/**
 * MCP over Streamable HTTP at `url`: initialize -> notifications/initialized
 * -> tools/list (every delivered tool) -> tools/call of one delivered tool
 * (must return content[]). { noRpc } = initialize got no JSON-RPC result.
 */
async function mcpJsonRpc(
  ctx: Ctx,
  exp: ExpectedMcpServer,
  url: string,
  left: () => number,
): Promise<{ check: ArtifactCheck } | { noRpc: number }> {
  const done = (state: ArtifactState, evidence: Evidence) => ({ check: result(ctx, "mcp_server", url, state, evidence) });
  const post = (payload: unknown, extra: Record<string, string> = {}) =>
    get(
      ctx,
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...extra },
        body: JSON.stringify(payload),
      },
      left(),
    );

  const init = await post({
    jsonrpc: "2.0",
    id: "verify-init",
    method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "AstrantVerify", version: "1" } },
  });
  if (!init.ok) return done("unobservable", { note: `initialize: ${FAIL_NOTES[init.reason]}` });
  const initRes = init.res;
  const initType = initRes.headers.get("content-type") ?? "";
  const initBad = classifyStatus(initRes);
  if (initBad && initBad.state !== "absent" && initRes.status !== 400 && initRes.status !== 405) {
    initRes.discard();
    return done(initBad.state, { status: initRes.status, contentType: initType, note: `initialize: ${initBad.note}` });
  }
  let session: Record<string, string> | null = null;
  let serverName: string | null = null;
  if (!initBad) {
    const ib = await rpcBody(initRes, "initialize");
    if ("state" in ib) return done(ib.state, { status: initRes.status, contentType: initType, note: ib.note });
    const { msg } = findJsonRpcResponse(ib.text, "verify-init");
    const r = msg?.result as { protocolVersion?: unknown; serverInfo?: { name?: unknown } } | undefined;
    if (r && typeof r === "object") {
      const v =
        typeof r.protocolVersion === "string" && /^[\w.-]{1,32}$/.test(r.protocolVersion) ? r.protocolVersion : MCP_PROTOCOL_VERSION;
      session = { "MCP-Protocol-Version": v };
      const sid = initRes.headers.get("mcp-session-id");
      if (sid && sid.length <= 4096 && /^[\x21-\x7e]+$/.test(sid)) session["Mcp-Session-Id"] = sid;
      if (typeof r.serverInfo?.name === "string") serverName = r.serverInfo.name;
    }
  } else {
    initRes.discard();
  }
  if (!session) return { noRpc: initRes.status };

  const notified = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
  if (notified.ok) notified.res.discard();
  const list = await post({ jsonrpc: "2.0", id: "verify-list", method: "tools/list" }, session);
  if (!list.ok) return done("unobservable", { note: `tools/list: ${FAIL_NOTES[list.reason]}` });
  const lr = list.res;
  const ev = { status: lr.status, contentType: lr.headers.get("content-type") ?? "" };
  const lbad = classifyStatus(lr);
  if (lbad) {
    lr.discard();
    return done(lbad.state === "absent" ? "mismatch" : lbad.state, { ...ev, note: `tools/list: ${lbad.note}` });
  }
  const lb = await rpcBody(lr, "tools/list");
  if ("state" in lb) return done(lb.state, { ...ev, note: lb.note });
  const { msg, exhausted } = findJsonRpcResponse(lb.text, "verify-list");
  const tools = (msg?.result as { tools?: unknown } | undefined)?.tools;
  if (!Array.isArray(tools)) {
    return done(exhausted ? "unobservable" : "mismatch", {
      ...ev,
      note: exhausted ? "tools/list reply exceeded the scan limit" : "tools/list reply has no tools[]",
    });
  }
  const served = toolNames(tools);

  // Behaviour: one delivered tool (served, if any is) must answer tools/call with content[].
  const probe = exp.toolNames.find((t) => served.includes(t)) ?? exp.toolNames[0];
  let call: { probe: string; ok: boolean } | null = null;
  let callNote = "no delivered tool to call";
  if (probe) {
    const got = await post(
      { jsonrpc: "2.0", id: "verify-call", method: "tools/call", params: { name: probe, arguments: {} } },
      session,
    );
    if (!got.ok) return done("unobservable", { ...ev, note: `tools/call ${probe}: ${FAIL_NOTES[got.reason]}` });
    const cbad = classifyStatus(got.res);
    if (cbad) {
      got.res.discard();
      if (cbad.state === "unobservable") return done("unobservable", { ...ev, note: `tools/call ${probe}: ${cbad.note}` });
      call = { probe, ok: false };
      callNote = `tools/call ${probe}: ${cbad.note}`;
    } else {
      const cb = await rpcBody(got.res, `tools/call ${probe}`);
      if ("state" in cb) return done(cb.state, { ...ev, note: cb.note });
      const reply = findJsonRpcResponse(cb.text, "verify-call");
      if (reply.exhausted) return done("unobservable", { ...ev, note: `tools/call ${probe}: reply exceeded the scan limit` });
      const r = reply.msg?.result as { content?: unknown; isError?: unknown } | undefined;
      const ok = !!r && Array.isArray(r.content) && r.content.length > 0 && r.isError !== true;
      call = { probe, ok };
      callNote = ok
        ? `tools/call ${probe} returned content`
        : `tools/call ${probe}: ${reply.msg?.error ? "JSON-RPC error" : r?.isError === true ? "isError result" : "no content[]"}`;
    }
  }

  const matched: string[] = [];
  const missing: string[] = [];
  const have = new Set(served);
  for (const t of exp.toolNames) (have.has(t) ? matched : missing).push(`tool:${t}`);
  if (call) (call.ok ? matched : missing).push(`call:${call.probe}`);
  if (exp.brandName) (serverName !== null && norm(serverName) === norm(exp.brandName) ? matched : missing).push(`name:${exp.brandName}`);
  return done(missing.length === 0 ? "working" : "mismatch", {
    ...ev,
    matched,
    missing,
    note: `MCP JSON-RPC: initialize + tools/list returned ${served.length} tool(s); ${callNote}`,
  });
}

/**
 * A JSON-RPC reply body, read whole or not at all: a reply over the cap is
 * mismatch (its prefix is never parsed), a failed read is unobservable.
 */
async function rpcBody(res: SafeResponse, step: string): Promise<{ text: string } | { state: ArtifactState; note: string }> {
  const body = await res.body({ maxBytes: MAX_JSON_BYTES });
  if (body.truncated) return { state: "mismatch", note: `${step}: reply exceeds ${MAX_JSON_BYTES} bytes` };
  if (!body.complete) return { state: "unobservable", note: `${step}: body read failed or timed out` };
  return { text: body.text };
}

/**
 * The reported URL does not speak JSON-RPC. The delivered Worker's
 * /.well-known/mcp.json names its MCP endpoint (transports[].url): when that is
 * another URL on the same origin, run the JSON-RPC check there once. Anything
 * else (e.g. the pre-JSON-RPC Astrant template: card + POST /mcp/call) is a
 * mismatch, never working: real MCP clients cannot use it.
 */
async function checkMcpCard(
  ctx: Ctx,
  exp: ExpectedMcpServer,
  target: URL,
  left: () => number,
  pre: string,
): Promise<ArtifactCheck> {
  const cardUrl = target.origin + "/.well-known/mcp.json";
  const card = await get(ctx, cardUrl, { headers: { Accept: "application/json" } }, left());
  if (!card.ok) return result(ctx, "mcp_server", cardUrl, "unobservable", { note: `${pre}; discovery card: ${FAIL_NOTES[card.reason]}` });
  const cr = card.res;
  const ev = { status: cr.status, contentType: cr.headers.get("content-type") ?? "" };
  const cbad = classifyStatus(cr);
  if (cbad) {
    cr.discard();
    return result(ctx, "mcp_server", cardUrl, cbad.state, { ...ev, note: `${pre}; discovery card: ${cbad.note}` });
  }
  const body = await cr.body({ maxBytes: MAX_JSON_BYTES });
  let doc: unknown = null;
  try {
    doc = body.complete ? JSON.parse(body.text) : null;
  } catch {
    doc = null;
  }
  const d = doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null;
  if (!d || (!Array.isArray(d.tools) && !Array.isArray(d.transports))) {
    return result(ctx, "mcp_server", cardUrl, looksHtml(ev.contentType, body.text) ? "absent" : "mismatch", {
      ...ev,
      note: `${pre}; /.well-known/mcp.json is not an MCP card`,
    });
  }

  const endpoint = cardEndpoint(d, target);
  let tried = pre;
  if (endpoint && endpoint !== target.toString()) {
    const second = await mcpJsonRpc(ctx, exp, endpoint, left);
    if ("check" in second) return second.check;
    tried = `${pre}; card endpoint ${endpoint} got no JSON-RPC result either (HTTP ${second.noRpc})`;
  }
  const served = Array.isArray(d.tools) ? toolNames(d.tools) : [];
  const have = new Set(served);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const t of exp.toolNames) (have.has(t) ? matched : missing).push(`tool:${t}`);
  return result(ctx, "mcp_server", cardUrl, "mismatch", {
    ...ev,
    matched,
    missing,
    note: `legacy non-MCP protocol: no MCP JSON-RPC endpoint answers (${tried}); card lists ${served.length} tool(s)`,
  });
}

/** The card's first transports[].url, resolved against the origin; same-origin only. */
function cardEndpoint(card: Record<string, unknown>, target: URL): string | null {
  if (!Array.isArray(card.transports)) return null;
  for (const t of card.transports.slice(0, MAX_LIST)) {
    const u = (t as { url?: unknown } | null)?.url;
    if (typeof u !== "string" || u.length > MAX_LINE_CHARS) continue;
    try {
      const abs = new URL(u, target.origin);
      return abs.origin === target.origin ? abs.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toolNames(tools: unknown[]): string[] {
  const out: string[] = [];
  for (const t of tools.slice(0, MAX_LIST)) {
    const n = (t as { name?: unknown } | null)?.name;
    if (typeof n === "string") out.push(n);
  }
  return out;
}

// Copied from scanner/src/checks/dim2-mcp.ts findJsonRpcResponse (E12, Codex
// r2/r3 bounded): JSON body (one message or a batch) or an SSE stream; lines
// scanned lazily, at most MAX_JSON_PARSES parses over MAX_JSON_BYTES chars.
const MAX_JSON_PARSES = 4096;

function findJsonRpcResponse(text: string, id: string): { msg: Record<string, unknown> | null; exhausted: boolean } {
  let parses = 0;
  let parsedChars = 0;
  const isResponse = (m: unknown): m is Record<string, unknown> =>
    m !== null &&
    typeof m === "object" &&
    !Array.isArray(m) &&
    (m as { id?: unknown }).id === id &&
    !("method" in m) &&
    ("result" in m || "error" in m);
  const tryParse = (c: string): Record<string, unknown> | null => {
    parses++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(c);
    } catch {
      return null;
    }
    for (const m of Array.isArray(parsed) ? parsed : [parsed]) if (isResponse(m)) return m;
    return null;
  };
  const looksJson = (c: string) => {
    const head = c.trimStart()[0];
    return head === "{" || head === "[";
  };
  if (looksJson(text)) {
    const whole = tryParse(text);
    if (whole) return { msg: whole, exhausted: false };
  }
  const n = text.length;
  let data: string[] = [];
  let dataChars = 0;
  let pos = 0;
  for (;;) {
    let end = pos;
    for (let c = text.charCodeAt(end); end < n && c !== 10 && c !== 13; c = text.charCodeAt(++end));
    const atEof = end >= n;
    if (end - pos >= 5 && text.startsWith("data:", pos)) {
      const d = text.slice(text.charCodeAt(pos + 5) === 32 ? pos + 6 : pos + 5, end);
      data.push(d);
      dataChars += d.length + 1;
    }
    if ((end === pos || atEof) && data.length > 0) {
      const payload = data.join("\n");
      data = [];
      if (looksJson(payload)) {
        if (parses >= MAX_JSON_PARSES || parsedChars + dataChars > MAX_JSON_BYTES) return { msg: null, exhausted: true };
        parsedChars += dataChars;
        const msg = tryParse(payload);
        if (msg) return { msg, exhausted: false };
      }
      dataChars = 0;
    }
    if (atEof) return { msg: null, exhausted: false };
    pos = end + (text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? 2 : 1);
  }
}

// ── robots.txt (RFC 9309, bounded) ───────────────────────────────────────

export interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  let rules = 0;
  forEachLine(text, (raw) => {
    if (rules >= MAX_ROBOTS_RULES || raw.length > MAX_LINE_CHARS) return;
    const hash = raw.indexOf("#");
    const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    const colon = line.indexOf(":");
    if (colon <= 0) return;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      return;
    }
    if ((field === "allow" || field === "disallow") && cur) {
      lastWasAgent = false;
      if (value === "" || value.length > 512) return;
      cur.rules.push({ allow: field === "allow", pattern: value });
      rules++;
      return;
    }
    lastWasAgent = false;
  });
  return groups;
}

/** Longest matching rule wins; Allow wins a tie; no matching group or rule = allowed. */
export function robotsAllows(groups: RobotsGroup[], agent: string, path: string): boolean {
  const a = agent.toLowerCase();
  let applicable = groups.filter((g) => a !== "*" && g.agents.includes(a));
  if (applicable.length === 0) applicable = groups.filter((g) => g.agents.includes("*"));
  let best = -1;
  let allow = true;
  for (const g of applicable) {
    for (const r of g.rules) {
      if (!robotsMatch(r.pattern, path)) continue;
      const len = r.pattern.length;
      if (len > best || (len === best && r.allow)) {
        best = len;
        allow = r.allow;
      }
    }
  }
  return allow;
}

/** Prefix match with `*` and a trailing `$`. Two-pointer glob, O(len(p) * len(path)) worst case on bounded inputs. */
function robotsMatch(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const p = anchored ? pattern.slice(0, -1) : pattern + "*";
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (j < path.length) {
    if (i < p.length && p[i] !== "*" && p[i] === path[j]) {
      i++;
      j++;
    } else if (i < p.length && p[i] === "*") {
      star = i++;
      mark = j;
    } else if (star >= 0) {
      i = star + 1;
      j = ++mark;
    } else return false;
  }
  while (i < p.length && p[i] === "*") i++;
  return i === p.length;
}

// ── Shared helpers ───────────────────────────────────────────────────────

/** Calls fn per line (LF split, trailing CR removed). Linear; the caller caps the text. */
function forEachLine(text: string, fn: (line: string) => void): void {
  let pos = 0;
  for (;;) {
    let end = text.indexOf("\n", pos);
    if (end < 0) end = text.length;
    const line = text.slice(pos, end);
    fn(line.endsWith("\r") ? line.slice(0, -1) : line);
    if (end >= text.length) return;
    pos = end + 1;
  }
}

function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function normUrl(s: string): string {
  const t = s.trim();
  let end = t.length;
  while (end > 0 && t.charCodeAt(end - 1) === 47) end--; // trailing "/" (a loop: /\/+$/ backtracks)
  return t.slice(0, end).toLowerCase();
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

// Built from code points (escape sequences in generated files have turned
// into raw bytes before).
const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);

/** Equal up to CRLF line endings (a Windows checkout may serve CRLF). */
function sameBytes(served: string, delivered: string): boolean {
  return served === delivered || served.split(CRLF).join(LF) === delivered;
}
