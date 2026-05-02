import type { DimensionResult, Env, SubCheck } from "../types";
import { dimensionScoreOrThrow, gradeFor } from "../scoring";

const FETCH_TIMEOUT_MS = 5000;

async function timedFetch(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
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
        const card = (await r.json()) as ServerCard;
        return { card, status: 200, from: path };
      } catch {
        return { card: null, status: 200, from: path };
      }
    }
  }
  return { card: null, status: 0, from: "" };
}

async function dnsTxt(host: string): Promise<{ found: boolean; note: string }> {
  try {
    const r = await timedFetch(
      `https://cloudflare-dns.com/dns-query?name=_mcp.${encodeURIComponent(host)}&type=TXT`,
      { headers: { Accept: "application/dns-json" } }
    );
    if (!r || r.status !== 200) return { found: false, note: `DoH status ${r?.status ?? "fetch failed"}` };
    const j = (await r.json()) as { Answer?: Array<{ data?: string }> };
    const found = !!j.Answer && j.Answer.length > 0;
    return { found, note: found ? `${j.Answer!.length} TXT record(s) at _mcp.${host}` : `no TXT at _mcp.${host}` };
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
        const meta = (await r.json()) as { authorization_endpoint?: string; token_endpoint?: string };
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
      const body = JSON.stringify({ jsonrpc: "2.0", id: "scanner-list", method: "tools/list" });
      const r = await timedFetch(
        transportUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
          body,
        },
        5000
      );
      if (!r) {
        liveNote = `tools/list timed out or failed for ${transportUrl}`;
      } else if (r.status >= 200 && r.status < 300) {
        try {
          const text = await r.text();
          // Streamable HTTP may return JSON or SSE-formatted; look for tools array either way
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const tools = parsed?.result?.tools;
            if (Array.isArray(tools)) {
              liveScore = 100;
              liveNote = `tools/list returned ${tools.length} tools`;
            } else {
              liveNote = `tools/list returned ${r.status} but no tools[] in body`;
            }
          } else {
            liveNote = `tools/list returned ${r.status} with non-JSON body`;
          }
        } catch (e) {
          liveNote = `tools/list parse error: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else {
        liveNote = `tools/list returned status ${r.status}`;
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
