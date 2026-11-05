import type { DimensionResult, Env, SubCheck } from "../types";
import { dimensionScoreOrThrow, gradeFor } from "../scoring";
import { MAX_JSON_BYTES, safeFetch, type SafeResponse } from "../safe-fetch";
import { SCORING_VERSION } from "../version";

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
 */
export function findJsonRpcResponse(text: string, id: string): { msg: Record<string, unknown> | null; sawJson: boolean } {
  const candidates = [text];
  let data: string[] = [];
  for (const line of [...text.split(/\r\n|\r|\n/), ""]) {
    if (line === "") {
      if (data.length > 0) candidates.push(data.join("\n"));
      data = [];
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  let sawJson = false;
  for (const c of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(c);
    } catch {
      continue;
    }
    sawJson = true;
    for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
      if (m && typeof m === "object" && (m as { id?: unknown }).id === id) return { msg: m as Record<string, unknown>, sawJson };
    }
  }
  return { msg: null, sawJson };
}

type ServerCard = {
  name?: unknown;
  transports?: Array<{ url?: string; type?: string }>;
  authentication?: { type?: string };
  tools?: Array<{ description?: string; inputSchema?: unknown }>;
};

async function fetchCard(origin: string): Promise<{ card: ServerCard | null; status: number; from: string }> {
  for (const path of ["/.well-known/mcp.json", "/.well-known/mcp/server-card.json"]) {
    const url = `${origin}${path}`;
    const r = await timedFetch(url, { headers: { Accept: "application/json" } });
    if (!r) continue;
    if (r.status === 200) {
      try {
        const card = (await readJson(r)) as ServerCard;
        return { card, status: 200, from: path };
      } catch {
        return { card: null, status: 200, from: path };
      }
    }
    r.discard();
  }
  return { card: null, status: 0, from: "" };
}

async function dnsTxt(host: string): Promise<{ found: boolean; note: string }> {
  try {
    const r = await timedFetch(
      `https://cloudflare-dns.com/dns-query?name=_mcp.${encodeURIComponent(host)}&type=TXT`,
      { headers: { Accept: "application/dns-json" } }
    );
    if (!r || r.status !== 200) {
      r?.discard();
      return { found: false, note: `DoH status ${r?.status ?? "fetch failed"}` };
    }
    const j = (await readJson(r)) as { Answer?: Array<{ name?: string; type?: number; data?: string }> };
    // E12: Answer also carries the CNAME chain (a wildcard CNAME answers every
    // name), so count only TXT records (type 16) at _mcp.<host> itself whose
    // text mentions mcp (the published research methodology's rule).
    const want = `_mcp.${host}`.toLowerCase().replace(/\.$/, "");
    const txt = (Array.isArray(j.Answer) ? j.Answer : []).filter(
      (a) =>
        a?.type === 16 &&
        typeof a.name === "string" &&
        a.name.toLowerCase().replace(/\.$/, "") === want &&
        typeof a.data === "string" &&
        /mcp/i.test(a.data)
    );
    const found = txt.length > 0;
    return { found, note: found ? `${txt.length} TXT record(s) at _mcp.${host}` : `no TXT at _mcp.${host}` };
  } catch (e) {
    return { found: false, note: `DoH error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function runDim2(targetUrl: string, env: Env): Promise<DimensionResult> {
  const u = new URL(targetUrl);
  const origin = u.origin;
  const subs: SubCheck[] = [];

  // 1. well_known
  const { card, status: cardStatus, from } = await fetchCard(origin);
  let wellKnownScore = 0;
  let wellKnownNote = `no card at /.well-known/mcp.json or /.well-known/mcp/server-card.json`;
  if (cardStatus === 200 && card) {
    if (card.name && Array.isArray(card.transports) && card.transports.length > 0) {
      wellKnownScore = 100;
      wellKnownNote = `valid card at ${from} with name="${String(card.name)}", transports=${card.transports.length}`;
    } else {
      wellKnownScore = 50;
      wellKnownNote = `card present at ${from} but missing name or transports[]`;
    }
  } else if (cardStatus === 200 && !card) {
    wellKnownScore = 50;
    wellKnownNote = `card present at ${from} but invalid JSON`;
  }
  subs.push({
    id: "well_known",
    name: "Well-known discovery (mcp.json / server-card.json)",
    weight: 30,
    score: wellKnownScore,
    passed: wellKnownScore >= 70,
    notes: wellKnownNote,
  });

  // 2. tool_coverage
  let toolScore = 0;
  let toolNote = "no card or no tools declared";
  if (card && Array.isArray(card.tools)) {
    const qualified = card.tools.filter(
      (t) => typeof t.description === "string" && t.description.trim().length > 0 && t.inputSchema !== undefined
    ).length;
    if (qualified >= 3) toolScore = 100;
    else if (qualified >= 1) toolScore = 50;
    toolNote = `${qualified} of ${card.tools.length} tools have description + inputSchema`;
  } else if (card) {
    toolNote = "card has no tools[] field (may be a minimal/discovery-only card)";
  }
  subs.push({
    id: "tool_coverage",
    name: "Tool coverage and quality",
    weight: 20,
    score: toolScore,
    passed: toolScore >= 70,
    notes: toolNote,
  });

  // 3. oauth_metadata
  let oauthScore = 100;
  let oauthNote = "no auth declared (N/A)";
  if (card?.authentication?.type && card.authentication.type !== "none") {
    const r = await timedFetch(`${origin}/.well-known/oauth-authorization-server`, {
      headers: { Accept: "application/json" },
    });
    if (r && r.status === 200) {
      try {
        const meta = (await readJson(r)) as { authorization_endpoint?: string; token_endpoint?: string };
        if (meta.authorization_endpoint && meta.token_endpoint) {
          oauthScore = 100;
          oauthNote = `auth=${card.authentication.type}; OAuth metadata valid`;
        } else {
          oauthScore = 0;
          oauthNote = `auth=${card.authentication.type}; OAuth metadata missing required endpoints`;
        }
      } catch {
        oauthScore = 0;
        oauthNote = `auth=${card.authentication.type}; OAuth metadata invalid JSON`;
      }
    } else {
      r?.discard();
      oauthScore = 0;
      oauthNote = `auth=${card.authentication.type}; /.well-known/oauth-authorization-server returned ${r?.status ?? "no response"}`;
    }
  }
  subs.push({
    id: "oauth_metadata",
    name: "OAuth metadata (when auth declared)",
    weight: 15,
    score: oauthScore,
    passed: oauthScore >= 70,
    notes: oauthNote,
  });

  // 4. live_invocation
  let liveScore = 0;
  let liveNote = "no transport URL in card to invoke";
  if (card && Array.isArray(card.transports) && card.transports.length > 0) {
    const t = card.transports[0];
    const transportUrl = t.url ? new URL(t.url, origin).toString() : "";
    if (transportUrl) {
      // E12: MCP lifecycle (spec 2025-06-18): initialize, then the
      // notifications/initialized notification, then requests carrying the
      // Mcp-Session-Id (when the server issued one) and MCP-Protocol-Version.
      const liveDeadline = Date.now() + LIVE_BUDGET_MS;
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
      if (!init) {
        liveNote = `initialize timed out or failed for ${transportUrl}`;
      } else if (init.status >= 200 && init.status < 300) {
        const { msg } = findJsonRpcResponse((await init.body({ maxBytes: MAX_JSON_BYTES })).text, "scanner-init");
        const result = msg?.result as { protocolVersion?: unknown } | undefined;
        if (result && typeof result === "object") {
          // Site-controlled values become request headers: keep only well-formed
          // ones (an invalid header value would throw inside fetch's Headers).
          const v = typeof result.protocolVersion === "string" && /^[\w.-]{1,32}$/.test(result.protocolVersion)
            ? result.protocolVersion
            : MCP_PROTOCOL_VERSION;
          session = { "MCP-Protocol-Version": v };
          const sid = init.headers.get("mcp-session-id");
          if (sid && /^[\x21-\x7e]{1,256}$/.test(sid)) session["Mcp-Session-Id"] = sid;
        } else {
          liveNote = `initialize returned ${init.status} but no result in body`;
        }
      } else {
        init.discard();
        liveNote = `initialize returned status ${init.status}`;
      }
      if (session) {
        (await post({ jsonrpc: "2.0", method: "notifications/initialized" }, session))?.discard();
        const r = await post({ jsonrpc: "2.0", id: "scanner-list", method: "tools/list" }, session);
        if (!r) {
          liveNote = `tools/list timed out or failed for ${transportUrl}`;
        } else if (r.status >= 200 && r.status < 300) {
          const { msg, sawJson } = findJsonRpcResponse((await r.body({ maxBytes: MAX_JSON_BYTES })).text, "scanner-list");
          const tools = (msg?.result as { tools?: unknown } | undefined)?.tools;
          if (Array.isArray(tools)) {
            liveScore = 100;
            liveNote = `tools/list returned ${tools.length} tools`;
          } else if (sawJson) {
            liveNote = `tools/list returned ${r.status} but no tools[] in body`;
          } else {
            liveNote = `tools/list returned ${r.status} with non-JSON body`;
          }
        } else {
          r.discard();
          liveNote = `tools/list returned status ${r.status}`;
        }
      }
    }
  }
  subs.push({
    id: "live_invocation",
    name: "Live MCP tools/list invocation",
    weight: 25,
    score: liveScore,
    passed: liveScore >= 70,
    notes: liveNote,
  });

  // 5. dns_txt
  const dns = await dnsTxt(u.host);
  subs.push({
    id: "dns_txt",
    name: "DNS TXT discovery (_mcp subdomain)",
    weight: 10,
    score: dns.found ? 100 : 0,
    passed: dns.found,
    notes: dns.note,
  });

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
