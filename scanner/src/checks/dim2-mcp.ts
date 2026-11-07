import type { DimensionResult, Env, SubCheck } from "../types";
import { dimensionScoreOrThrow, gradeFor } from "../scoring";
import { MAX_JSON_BYTES, safeFetch, type SafeResponse } from "../safe-fetch";
import { SCORING_VERSION } from "../version";
import { isSameSite, NO_SIGNALS, siteBase, type SiteSignals } from "./site-signals";

const FETCH_TIMEOUT_MS = 5000;

// Security pass 2026-11-04: validated hops (incl. the card's transport URL),
// max 3 redirects, one deadline covering headers AND body (see ../safe-fetch).
function timedFetch(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<SafeResponse | null> {
  return safeFetch(url, init, { timeoutMs });
}

/** Capped JSON read; throws (like Response.json) on a read error, truncation or bad JSON. */
async function readJson(r: SafeResponse): Promise<unknown> {
  const b = await r.body({ maxBytes: MAX_JSON_BYTES });
  if (!b.complete) throw new Error("body incomplete");
  return JSON.parse(b.text);
}

/** Protocol revision the scanner offers in `initialize` (servers may negotiate down). */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
/** One budget for the whole initialize -> initialized -> tools/list handshake. */
const LIVE_BUDGET_MS = 10000;

/**
 * E12: finds the JSON-RPC response with `id` in a Streamable HTTP reply. The
 * body is either JSON (one message or a batch) or an SSE stream whose events
 * each carry one message in their data: lines. Every candidate is parsed on
 * its own, so text between messages never merges into one match (the old
 * greedy /\{[\s\S]*\}/ spanned the first "{" to the last "}").
 *
 * Only a response counts: an object with this `id`, a `result` or `error`,
 * and no `method` (a server request may reuse the id). The first response
 * wins, so an error response ends the scan too.
 *
 * Bounded (Codex r2, r3): lines are scanned lazily (a forward regex search
 * for each line end, no global rewrite) and the scan stops at the first
 * response. Data that doesn't start with "{" or "[" is never parsed. JSON.parse
 * sees at most MAX_SSE_PARSE_CHARS characters across all SSE blocks (on top
 * of the one whole-body attempt) and at most MAX_JSON_PARSES attempts; the
 * reply body is already capped at MAX_JSON_BYTES. `exhausted` is true when a
 * budget, not the end of the body, stopped the scan. The counters are
 * returned so tests can assert the bounds.
 */
export const MAX_JSON_PARSES = 4096;
export const MAX_SSE_PARSE_CHARS = MAX_JSON_BYTES;

export type JsonRpcScan = {
  msg: Record<string, unknown> | null;
  sawJson: boolean;
  exhausted: boolean;
  blocks: number;
  parses: number;
  parsedChars: number;
  lines: number;
};

export function findJsonRpcResponse(text: string, id: string): JsonRpcScan {
  let sawJson = false;
  let blocks = 0;
  let parses = 0;
  let parsedChars = 0;
  let lines = 0;
  const done = (msg: Record<string, unknown> | null, exhausted: boolean): JsonRpcScan => ({
    msg,
    sawJson,
    exhausted,
    blocks,
    parses,
    parsedChars,
    lines,
  });
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
    sawJson = true;
    for (const m of Array.isArray(parsed) ? parsed : [parsed]) if (isResponse(m)) return m;
    return null;
  };
  const looksJson = (c: string) => {
    const head = c.trimStart()[0];
    return head === "{" || head === "[";
  };
  if (looksJson(text)) {
    const whole = tryParse(text);
    if (whole) return done(whole, false);
  }
  // SSE: CR / CRLF / LF each end a line; a blank line (or the end of the
  // body) dispatches the block's data lines. One charCode pass; only data
  // lines are sliced.
  const n = text.length;
  let data: string[] = [];
  let dataChars = 0;
  let pos = 0;
  for (;;) {
    let end = pos;
    for (let c = text.charCodeAt(end); end < n && c !== 10 && c !== 13; c = text.charCodeAt(++end));
    const atEof = end >= n;
    lines++;
    if (end - pos >= 5 && text.startsWith("data:", pos)) {
      const d = text.slice(text.charCodeAt(pos + 5) === 32 ? pos + 6 : pos + 5, end);
      data.push(d);
      dataChars += d.length + 1;
    }
    if ((end === pos || atEof) && data.length > 0) {
      blocks++;
      const payload = data.join("\n");
      data = [];
      if (looksJson(payload)) {
        if (parses >= MAX_JSON_PARSES || parsedChars + dataChars > MAX_SSE_PARSE_CHARS) return done(null, true);
        parsedChars += dataChars;
        const msg = tryParse(payload);
        if (msg) return done(msg, false);
      }
      dataChars = 0;
    }
    if (atEof) return done(null, false);
    pos = end + (text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? 2 : 1);
  }
}

/** The card as published: any of the shapes normalizeCard reads. */
type RawCard = Record<string, unknown>;

/**
 * 1.4.0: one view of the server-card shapes in use. The scanner used to read
 * only `transports[]` and a top-level `authentication.type`, so a card in the
 * MCP Registry server.json shape (`remotes[]`), a single `remote` object
 * (`remote.url` + `remote.transport`, auth nested under it) or the
 * SEP-1649 server-card shape (`serverInfo.name`, `transport: {type, endpoint}`)
 * was reported as having no name, no transport and no auth.
 */
export type McpCard = {
  name: string | null;
  transports: Array<{ url: string; type: string }>;
  /** Declared auth type ("oauth2", "bearer", ...) or null when none is declared. */
  authType: string | null;
  /** Declared authorization server URL, when the card names one. */
  authServer: string | null;
  tools: unknown[] | null;
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function transportEntry(v: unknown, fallbackUrl: string | null = null): { url: string; type: string } | null {
  if (typeof v === "string") return fallbackUrl ? { url: fallbackUrl, type: v } : null;
  const o = obj(v);
  if (!o) return null;
  const url = str(o.url) ?? str(o.endpoint) ?? fallbackUrl;
  if (!url) return null;
  return { url, type: str(o.type) ?? str(o.transport) ?? str(o.transport_type) ?? "" };
}

function authOf(v: unknown): { type: string | null; server: string | null } | null {
  if (typeof v === "string") return str(v) ? { type: v.trim(), server: null } : null;
  const o = obj(v);
  if (!o) return null;
  const servers = Array.isArray(o.authorization_servers) ? o.authorization_servers : [];
  const server = str(o.authorization_server) ?? str(servers[0]) ?? str(o.issuer) ?? null;
  const schemes = Array.isArray(o.schemes) ? o.schemes.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  const type =
    str(o.type) ??
    (schemes.length > 0 ? schemes.join(", ") : null) ??
    (server || str(o.authorizationUrl) ? "oauth2" : null) ??
    (o.required === true ? "required" : null);
  return type || server ? { type, server } : null;
}

export function normalizeCard(raw: RawCard): McpCard {
  const serverInfo = obj(raw.serverInfo);
  const name = str(raw.name) ?? str(serverInfo?.name) ?? str(raw.title);
  const transports: Array<{ url: string; type: string }> = [];
  const push = (t: { url: string; type: string } | null) => {
    if (t && !transports.some((x) => x.url === t.url)) transports.push(t);
  };
  for (const list of [raw.transports, raw.remotes]) if (Array.isArray(list)) for (const t of list) push(transportEntry(t));
  push(transportEntry(raw.remote));
  push(transportEntry(raw.transport, str(raw.url) ?? str(raw.endpoint)));
  const remote = obj(raw.remote);
  let auth: { type: string | null; server: string | null } | null = null;
  for (const a of [raw.authentication, raw.auth, raw.authorization, remote?.authentication, remote?.auth, remote?.authorization]) {
    auth = authOf(a);
    if (auth) break;
  }
  return {
    name,
    transports,
    authType: auth?.type ?? null,
    authServer: auth?.server ?? null,
    tools: Array.isArray(raw.tools) ? raw.tools : null,
  };
}

async function fetchCard(origin: string): Promise<{ card: McpCard | null; status: number; from: string }> {
  for (const path of ["/.well-known/mcp.json", "/.well-known/mcp/server-card.json"]) {
    const url = `${origin}${path}`;
    const r = await timedFetch(url, { headers: { Accept: "application/json" } });
    if (!r) continue;
    if (r.status === 200) {
      try {
        const raw = obj(await readJson(r));
        return { card: raw ? normalizeCard(raw) : null, status: 200, from: path };
      } catch {
        return { card: null, status: 200, from: path };
      }
    }
    r.discard();
  }
  return { card: null, status: 0, from: "" };
}

/**
 * E12 (Codex r1): DoH JSON gives TXT `data` in presentation syntax: one or
 * more quoted character-strings (`"v=1; m" "cp=..."`) with backslash escapes
 * (`\"`, `\\`, and `\DDD` decimal bytes). Returns the concatenated text so a
 * value split across strings or escaped still matches. Unquoted data is
 * returned as is. Malformed data (an unterminated string, a \DDD above 255,
 * anything but whitespace between strings, or more than
 * MAX_TXT_PRESENTATION_CHARS) returns null: no match.
 */
/** TXT RDATA is at most 64 KiB; its presentation form at most 4x that (\DDD). */
const MAX_TXT_PRESENTATION_CHARS = 4 * 65536;

export function decodeTxtData(data: string): string | null {
  if (data.length > MAX_TXT_PRESENTATION_CHARS) return null;
  if (!data.includes('"')) return data;
  let out = "";
  let i = 0;
  while (i < data.length) {
    if (data[i] === " " || data[i] === "\t") {
      i++; // separator between character-strings
      continue;
    }
    if (data[i] !== '"') return null;
    i++;
    for (;;) {
      if (i >= data.length) return null; // unterminated
      const ch = data[i];
      if (ch === '"') break;
      if (ch === "\\") {
        if (i + 1 >= data.length) return null;
        const ddd = /^\d{3}/.exec(data.slice(i + 1, i + 4));
        if (ddd) {
          const code = Number(ddd[0]);
          if (code > 255) return null;
          out += String.fromCharCode(code);
          i += 4;
        } else {
          out += data[i + 1];
          i += 2;
        }
      } else {
        out += ch;
        i++;
      }
    }
    i++; // closing quote
  }
  return out;
}

/** dns_txt note suffix (1.4.0): the check is informational. */
export const DNS_TXT_INFO_NOTE =
  "Informational only: no ratified standard defines an _mcp DNS record, so this is not scored.";

async function dnsTxt(host: string): Promise<{ found: boolean; note: string; urls: string[] }> {
  try {
    const r = await timedFetch(
      `https://cloudflare-dns.com/dns-query?name=_mcp.${encodeURIComponent(host)}&type=TXT`,
      { headers: { Accept: "application/dns-json" } }
    );
    if (!r || r.status !== 200) {
      r?.discard();
      return { found: false, note: `DNS lookup for _mcp.${host} did not complete. ${DNS_TXT_INFO_NOTE}`, urls: [] };
    }
    const j = (await readJson(r)) as { Answer?: Array<{ name?: string; type?: number; data?: string }> };
    // E12: Answer also carries the CNAME chain (a wildcard CNAME answers every
    // name), so count only TXT records (type 16) at _mcp.<host> itself whose
    // text mentions mcp (the published research methodology's rule).
    const want = `_mcp.${host}`.toLowerCase().replace(/\.$/, "");
    const texts = (Array.isArray(j.Answer) ? j.Answer : [])
      .filter((a) => a?.type === 16 && typeof a.name === "string" && a.name.toLowerCase().replace(/\.$/, "") === want && typeof a.data === "string")
      .map((a) => decodeTxtData(a.data as string) ?? "")
      .filter((t) => /mcp/i.test(t));
    const found = texts.length > 0;
    // 1.4.0: a URL in the record is a candidate endpoint for the live check.
    const urls = texts.flatMap((t) => t.match(/https:\/\/[^\s;,"']{1,512}/g) ?? []);
    return {
      found,
      note: found
        ? `${texts.length} TXT record(s) at _mcp.${host}. ${DNS_TXT_INFO_NOTE}`
        : `No TXT record at _mcp.${host}. ${DNS_TXT_INFO_NOTE}`,
      urls,
    };
  } catch {
    return { found: false, note: `DNS lookup for _mcp.${host} did not complete. ${DNS_TXT_INFO_NOTE}`, urls: [] };
  }
}

/**
 * 1.4.0: Universal Commerce Protocol profile (/.well-known/ucp, served by
 * every Shopify store). Returns the MCP endpoints its services declare, or
 * null when there is no profile or it declares no MCP transport.
 */
async function ucpMcpEndpoints(origin: string): Promise<string[] | null> {
  const r = await timedFetch(`${origin}/.well-known/ucp`, { headers: { Accept: "application/json" } });
  if (!r) return null;
  if (r.status !== 200) {
    r.discard();
    return null;
  }
  try {
    const services = obj(obj(obj(await readJson(r))?.ucp)?.services);
    if (!services) return null;
    const endpoints: string[] = [];
    let mcp = false;
    for (const list of Object.values(services)) {
      if (!Array.isArray(list)) continue;
      for (const svc of list) {
        const o = obj(svc);
        if (!o || str(o.transport)?.toLowerCase() !== "mcp") continue;
        mcp = true;
        const e = str(o.endpoint);
        if (e && !endpoints.includes(e)) endpoints.push(e);
      }
    }
    return mcp ? endpoints : null;
  } catch {
    return null;
  }
}

type LiveResult = {
  score: number;
  note: string;
  /** A real MCP server answered (initialize result), or a declared endpoint answered with an OAuth challenge. */
  answered: boolean;
  /** The answer was a 401 Bearer challenge only. */
  authOnly?: boolean;
};

/**
 * E12: MCP lifecycle (spec 2025-06-18): initialize, then the
 * notifications/initialized notification, then requests carrying the
 * Mcp-Session-Id (when the server issued one) and MCP-Protocol-Version.
 */
async function liveProbe(transportUrl: string, budgetMs = LIVE_BUDGET_MS): Promise<LiveResult> {
  const liveDeadline = Date.now() + budgetMs;
  const post = (payload: unknown, extra: Record<string, string> = {}) =>
    timedFetch(
      transportUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...extra },
        body: JSON.stringify(payload),
      },
      Math.max(1, Math.min(5000, liveDeadline - Date.now()))
    );
  const init = await post({
    jsonrpc: "2.0",
    id: "scanner-init",
    method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "AstrantScanner", version: SCORING_VERSION } },
  });
  let session: Record<string, string> | null = null;
  if (!init) return { score: 0, note: `initialize timed out or failed for ${transportUrl}`, answered: false };
  if (init.status === 401 && /^\s*bearer\b/i.test(init.headers.get("www-authenticate") ?? "")) {
    // 1.4.0: the MCP authorization spec's answer to an anonymous client. The
    // server is real; its tools need the user's sign-in to list.
    init.discard();
    return { score: 75, note: mcpAuthRequiredNote(transportUrl), answered: true, authOnly: true };
  }
  if (init.status < 200 || init.status >= 300) {
    init.discard();
    return { score: 0, note: `initialize returned status ${init.status}`, answered: false };
  }
  const { msg, exhausted } = findJsonRpcResponse((await init.body({ maxBytes: MAX_JSON_BYTES })).text, "scanner-init");
  const result = msg?.result as { protocolVersion?: unknown } | undefined;
  if (exhausted) return { score: 0, note: `initialize returned ${init.status} but the reply exceeded the scan limit`, answered: false };
  if (!result || typeof result !== "object") return { score: 0, note: `initialize returned ${init.status} but no result in body`, answered: false };
  // Site-controlled values become request headers: keep only well-formed
  // ones (an invalid header value would throw inside fetch's Headers).
  const v = typeof result.protocolVersion === "string" && /^[\w.-]{1,32}$/.test(result.protocolVersion)
    ? result.protocolVersion
    : MCP_PROTOCOL_VERSION;
  session = { "MCP-Protocol-Version": v };
  const sid = init.headers.get("mcp-session-id");
  // Spec: visible ASCII (0x21-0x7E). 4096 keeps it header-safe.
  if (sid && sid.length <= 4096 && /^[\x21-\x7e]+$/.test(sid)) session["Mcp-Session-Id"] = sid;
  (await post({ jsonrpc: "2.0", method: "notifications/initialized" }, session))?.discard();
  const r = await post({ jsonrpc: "2.0", id: "scanner-list", method: "tools/list" }, session);
  if (!r) return { score: 0, note: `tools/list timed out or failed for ${transportUrl}`, answered: true };
  if (r.status < 200 || r.status >= 300) {
    r.discard();
    return { score: 0, note: `tools/list returned status ${r.status}`, answered: true };
  }
  const list = findJsonRpcResponse((await r.body({ maxBytes: MAX_JSON_BYTES })).text, "scanner-list");
  const tools = (list.msg?.result as { tools?: unknown } | undefined)?.tools;
  if (Array.isArray(tools)) return { score: 100, note: `tools/list returned ${tools.length} tools`, answered: true };
  if (list.exhausted) return { score: 0, note: `tools/list returned ${r.status} but the reply exceeded the scan limit`, answered: true };
  if (list.sawJson) return { score: 0, note: `tools/list returned ${r.status} but no tools[] in body`, answered: true };
  return { score: 0, note: `tools/list returned ${r.status} with non-JSON body`, answered: true };
}

/** live_invocation note (1.4.0) for an OAuth-protected MCP endpoint. */
export const mcpAuthRequiredNote = (url: string) =>
  `The MCP endpoint at ${url} answered and requires OAuth sign-in (HTTP 401 with a Bearer challenge), so its tools could not be listed without an account.`;

/** Whole-dimension N/A note (1.4.0): shown in the Score and Audit reports. */
export const DIM2_CONTENT_ONLY_NA_NOTE =
  "No supported MCP discovery signal was found: no MCP server card (/.well-known/mcp.json or /.well-known/mcp/server-card.json), nothing answering as an MCP server at /api/mcp, no MCP link in /llms.txt or on the homepage, no /.well-known/ucp profile declaring MCP and no _mcp DNS TXT record. No API evidence was found either (no OpenAPI description or API catalog, GraphQL endpoint or API documentation link). An MCP server may still exist elsewhere, so this dimension is marked N/A rather than scored.";

/** oauth_metadata N/A note (1.3.3): no MCP server card was found. */
export const OAUTH_NO_CARD_NA_NOTE =
  "No MCP server card found, so there is no declared authentication to check. This check is not counted in your score.";

/** oauth_metadata N/A note (1.4.0): a card that declares no authentication. */
export const OAUTH_NO_AUTH_NA_NOTE =
  "The MCP server card declares no authentication, so there is no OAuth metadata to check. This check is not counted in your score.";

/** Live probes of endpoints the site declares (llms.txt / homepage / UCP / TXT), beyond the card's own. */
const MAX_DECLARED_PROBES = 2;
/** The guessed /api/mcp path gets a shorter budget than a declared endpoint. */
const GUESSED_BUDGET_MS = 5000;

export async function runDim2(
  targetUrl: string,
  env: Env,
  // 1.3.2: true when Dim 3 is whole-dimension N/A for "no API surface" (not
  // unmeasured). run-scan passes Dim 3's result as a promise; awaited only
  // when no MCP artifact was found.
  contentOnly: boolean | Promise<boolean> = false,
  // 1.4.0: MCP / API links from /llms.txt and the homepage (site-signals).
  // Awaited only when there is no MCP card.
  signals: SiteSignals | Promise<SiteSignals> = NO_SIGNALS
): Promise<DimensionResult> {
  const u = new URL(targetUrl);
  const origin = u.origin;
  const base = siteBase(targetUrl);
  const subs: SubCheck[] = [];

  // 1. well_known
  const { card, status: cardStatus, from } = await fetchCard(origin);
  const dnsP = dnsTxt(u.host);
  const ucpP = cardStatus === 200 ? Promise.resolve(null) : ucpMcpEndpoints(origin);
  let wellKnownScore = 0;
  let wellKnownNote = `no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json`;
  if (cardStatus === 200 && card) {
    if (card.name && card.transports.length > 0) {
      wellKnownScore = 100;
      wellKnownNote = `valid card at ${from} with name="${card.name}", transports=${card.transports.length}`;
    } else {
      wellKnownScore = 50;
      const missing = [
        card.name ? "" : "a server name",
        card.transports.length > 0 ? "" : "a transport URL (transports[], remotes[] or remote.url)",
      ].filter(Boolean);
      wellKnownNote = `card present at ${from} but missing ${missing.join(" and ")}`;
    }
  } else if (cardStatus === 200 && !card) {
    wellKnownScore = 50;
    wellKnownNote = `card present at ${from} but invalid JSON`;
  }

  // 2. tool_coverage
  let toolScore = 0;
  let toolNote = "no card or no tools declared";
  if (card && card.tools) {
    const tools = card.tools.map((t) => obj(t) ?? {});
    const described = tools.filter((t) => typeof t.description === "string" && t.description.trim().length > 0);
    const withSchema = tools.filter((t) => t.inputSchema !== undefined || t.input_schema !== undefined).length;
    const qualified = described.filter((t) => t.inputSchema !== undefined || t.input_schema !== undefined).length;
    // 1.4.0: a card that describes 3+ tools passes (70) without schemas —
    // schemas are also available from tools/list once connected; full marks
    // need both. 12 described tools must never score 0 (resend.com).
    if (qualified >= 3) toolScore = 100;
    else if (described.length >= 3) toolScore = 70;
    else if (qualified >= 1 || described.length >= 1) toolScore = 50;
    toolNote = `${tools.length} tool(s) declared: ${described.length} with a description, ${withSchema} with an input schema (inputSchema); ${qualified} have both`;
  } else if (card) {
    toolNote = "card has no tools[] field (may be a minimal/discovery-only card)";
  }

  // 3. oauth_metadata
  let oauth: Pick<SubCheck, "score" | "passed" | "notes" | "na">;
  if (!card) {
    // 1.3.3: no usable MCP card means no declared auth to check: N/A (weight
    // redistributed), not a passing 100 for a server that doesn't exist.
    oauth = { score: 0, passed: false, notes: OAUTH_NO_CARD_NA_NOTE, na: true };
  } else if (!card.authType || /^none$/i.test(card.authType)) {
    // 1.4.0: no declared auth is N/A too (it scored 100 with an "N/A" note).
    oauth = { score: 0, passed: false, notes: OAUTH_NO_AUTH_NA_NOTE, na: true };
  } else {
    const authType = card.authType;
    // The card's declared authorization server first (RFC 8414 path
    // insertion), when it is on this site or a subdomain; then the site root.
    const metaUrls: string[] = [];
    if (card.authServer) {
      try {
        const as = new URL(card.authServer);
        if (isSameSite(as.hostname, base)) {
          const path = as.pathname.replace(/\/$/, "");
          metaUrls.push(`${as.origin}/.well-known/oauth-authorization-server${path}`);
        }
      } catch {
        // not a URL: fall back to the site root
      }
    }
    const rootMeta = `${origin}/.well-known/oauth-authorization-server`;
    if (!metaUrls.includes(rootMeta)) metaUrls.push(rootMeta);
    let score = 0;
    let note = "";
    for (const metaUrl of metaUrls) {
      const r = await timedFetch(metaUrl, { headers: { Accept: "application/json" } });
      if (r && r.status === 200) {
        try {
          const meta = (await readJson(r)) as { authorization_endpoint?: string; token_endpoint?: string };
          if (meta.authorization_endpoint && meta.token_endpoint) {
            score = 100;
            note = `auth=${authType}; OAuth metadata valid`;
            break;
          }
          note = `auth=${authType}; OAuth metadata missing required endpoints`;
        } catch {
          note = `auth=${authType}; OAuth metadata invalid JSON`;
        }
      } else {
        r?.discard();
        if (!note) note = `auth=${authType}; ${new URL(metaUrl).pathname} returned ${r?.status ?? "no response"}`;
      }
    }
    oauth = { score, passed: score >= 70, notes: note };
  }

  // 4. live_invocation
  let live: LiveResult = { score: 0, note: "no transport URL in card to invoke", answered: false };
  let liveUrl = "";
  const cardTransport = card?.transports[0]?.url ? new URL(card.transports[0].url, origin).toString() : "";
  // Evidence beyond the card, gathered only when the card gives no transport.
  let sig: SiteSignals = NO_SIGNALS;
  let ucp: string[] | null = null;
  let dns: Awaited<ReturnType<typeof dnsTxt>> | null = null;
  if (cardTransport) {
    live = await liveProbe(cardTransport);
    liveUrl = cardTransport;
  } else {
    // The /api/mcp path Shopify stores serve, probed while the other
    // evidence is gathered (it does not depend on it).
    const guessed = `${origin}/api/mcp`;
    const guessedP = card ? null : liveProbe(guessed, GUESSED_BUDGET_MS);
    [sig, ucp, dns] = await Promise.all([Promise.resolve(signals).catch(() => NO_SIGNALS), ucpP, dnsP]);
    // Endpoints the site declares, on this site or a subdomain.
    const declared: string[] = [];
    for (const raw of [...sig.mcpUrls, ...(ucp ?? []), ...dns.urls]) {
      try {
        const e = new URL(raw, origin);
        if (isSameSite(e.hostname, base) && !declared.includes(e.toString())) declared.push(e.toString());
      } catch {
        // ignore
      }
    }
    const tried: string[] = [];
    const take = (r: LiveResult, e: string) => {
      if (r.answered && (!live.answered || r.score > live.score)) [live, liveUrl] = [r, e];
    };
    if (guessedP) {
      tried.push(guessed);
      const r = await guessedP;
      // A guessed path counts only when a real MCP server answers (a 401 on
      // /api/* says nothing: many sites guard every /api route), unless the
      // site itself declares that URL.
      if (!r.authOnly || declared.includes(guessed)) take(r, guessed);
    }
    for (const e of declared.filter((d) => !tried.includes(d)).slice(0, MAX_DECLARED_PROBES)) {
      if (live.score === 100) break;
      tried.push(e);
      take(await liveProbe(e), e);
    }
    if (!live.answered) {
      live = {
        score: 0,
        answered: false,
        note: card
          ? `no transport URL in card to invoke${tried.length > 0 ? `, and ${tried.join(", ")} did not answer an MCP initialize request` : ""}`
          : `no MCP endpoint answered: no server card with a transport URL, and ${tried.join(", ")} did not answer an MCP initialize request`,
      };
    }
  }
  dns ??= await dnsP;

  // 1.4.0: what showed this site has an MCP server, when the card didn't.
  const mcpEvidence = live.answered
    ? `an MCP endpoint answered at ${liveUrl}`
    : ucp
      ? `the /.well-known/ucp profile declares an MCP endpoint${ucp.length > 0 ? ` (${ucp[0]})` : ""}`
      : sig.mcpUrls.length > 0
        ? `the site links an MCP endpoint (${sig.mcpUrls[0]})`
        : dns.found
          ? "a _mcp DNS TXT record mentions MCP"
          : "";
  if (cardStatus !== 200 && mcpEvidence) {
    wellKnownNote += `; an MCP server was found (${mcpEvidence}) but it is not advertised with a server card`;
  }

  subs.push(
    {
      id: "well_known",
      name: "Well-known discovery (mcp.json / server-card.json)",
      weight: 30,
      score: wellKnownScore,
      passed: wellKnownScore >= 70,
      notes: wellKnownNote,
    },
    {
      id: "tool_coverage",
      name: "Tool coverage and quality",
      weight: 20,
      score: toolScore,
      passed: toolScore >= 70,
      notes: toolNote,
    },
    {
      id: "oauth_metadata",
      name: "OAuth metadata (when auth declared)",
      weight: 15,
      ...oauth,
    },
    {
      id: "live_invocation",
      name: "Live MCP tools/list invocation",
      weight: 25,
      score: live.score,
      passed: live.score >= 70,
      notes: live.note,
    },
    // 5. dns_txt. 1.4.0: informational (weight redistributed): no ratified
    // standard defines an _mcp TXT record, so its absence is not a gap.
    {
      id: "dns_txt",
      name: "DNS TXT discovery (_mcp subdomain)",
      weight: 10,
      score: 0,
      passed: false,
      notes: dns.note,
      na: true,
    }
  );

  // 1.3.2 / 1.4.0: N/A only on positive absence: no 200 at either card path,
  // no _mcp TXT, no UCP profile declaring MCP, no MCP or API link on the site,
  // nothing answering as an MCP server, and Dim 3 found no API surface.
  const noEvidence =
    cardStatus !== 200 && !mcpEvidence && sig.apiSignals.length === 0 && sig.mcpUrls.length === 0;
  if (noEvidence && (await contentOnly)) {
    return {
      dimension_id: 2,
      dimension_name: "MCP Server Discoverability",
      score: 0,
      grade: gradeFor(0),
      sub_checks: subs.map((s) => ({ ...s, score: 0, passed: false, notes: DIM2_CONTENT_ONLY_NA_NOTE, na: true })),
      na: true,
    };
  }

  const score = dimensionScoreOrThrow(subs);
  // Suppress unused-env warning (env reserved for future LLM-augmented checks).
  void env;
  return {
    dimension_id: 2,
    dimension_name: "MCP Server Discoverability",
    score,
    grade: gradeFor(score),
    sub_checks: subs,
  };
}
