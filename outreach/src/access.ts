// §9.5 defence in depth: verify the Cloudflare Access JWT (Cf-Access-Jwt-Assertion)
// against CF_ACCESS_AUD / CF_ACCESS_TEAM_DOMAIN. Missing/invalid ⇒ null ⇒ 403.
import { b64urlDecode } from "./crypto";
import type { Env } from "./types";

type Jwk = JsonWebKey & { kid?: string };
let certCache: { team: string; keys: Jwk[]; exp: number } | null = null;

export function _resetAccessCache(): void {
  certCache = null;
}

async function certs(team: string, f: typeof fetch, nowMs: number): Promise<Jwk[]> {
  if (certCache && certCache.team === team && certCache.exp > nowMs) return certCache.keys;
  const res = await f(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("ACCESS_CERTS_FETCH_FAILED");
  const j = (await res.json()) as { keys?: Jwk[] };
  certCache = { team, keys: j.keys ?? [], exp: nowMs + 3600_000 };
  return certCache.keys;
}

function json(b: Uint8Array | null): Record<string, unknown> | null {
  if (!b) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function verifyAccessJwt(req: Request, env: Env, f: typeof fetch, nowMs: number): Promise<{ email: string } | null> {
  const team = (env.CF_ACCESS_TEAM_DOMAIN ?? "").trim();
  const aud = (env.CF_ACCESS_AUD ?? "").trim();
  if (!team || !aud) return null; // unconfigured ⇒ fail closed
  const tok = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!tok) return null;
  const parts = tok.split(".");
  if (parts.length !== 3) return null;
  const header = json(b64urlDecode(parts[0]));
  const payload = json(b64urlDecode(parts[1]));
  const sig = b64urlDecode(parts[2]);
  if (!header || !payload || !sig || header.alg !== "RS256") return null;
  let keys: Jwk[];
  try {
    keys = await certs(team, f, nowMs);
  } catch {
    return null;
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
  } catch {
    return null;
  }
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  const nowS = Math.floor(nowMs / 1000);
  if (typeof payload.exp !== "number" || payload.exp < nowS) return null;
  if (typeof payload.nbf === "number" && payload.nbf > nowS + 60) return null;
  if (payload.iss !== `https://${team}`) return null;
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email) return null;
  const want = (env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (want && email !== want) return null;
  return { email };
}
