// HMAC helpers: opt-out tokens (§9.2), suppression hashes (§5), admin CSRF.
const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

function hex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// token = base64url(message_id || HMAC(OPTOUT_HMAC_SECRET, message_id)); no email in the URL.
export async function makeOptoutToken(secret: string, messageId: string): Promise<string> {
  const id = enc.encode(messageId);
  const mac = await hmac(secret, "optout:" + messageId);
  const out = new Uint8Array(1 + id.length + mac.length);
  out[0] = id.length;
  out.set(id, 1);
  out.set(mac, 1 + id.length);
  return b64url(out);
}

export async function verifyOptoutToken(secret: string, token: string): Promise<string | null> {
  if (token.length > 200) return null;
  const raw = b64urlDecode(token);
  if (!raw || raw.length < 2) return null;
  const n = raw[0];
  if (raw.length !== 1 + n + 32) return null;
  const messageId = new TextDecoder().decode(raw.slice(1, 1 + n));
  const expected = await hmac(secret, "optout:" + messageId);
  return constantTimeEqualBytes(expected, raw.slice(1 + n)) ? messageId : null;
}

export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

export async function emailHash(secret: string, email: string): Promise<string> {
  return hex(await hmac(secret, "email:" + normalizeEmail(email)));
}
export async function domainHash(secret: string, domain: string): Promise<string> {
  return hex(await hmac(secret, "domain:" + domain.trim().toLowerCase()));
}

export async function csrfToken(secret: string, identity: string, scope: string): Promise<string> {
  return b64url(await hmac(secret, `csrf:${identity}:${scope}`));
}
export async function verifyCsrf(secret: string, identity: string, scope: string, token: string): Promise<boolean> {
  const exp = enc.encode(await csrfToken(secret, identity, scope));
  return constantTimeEqualBytes(exp, enc.encode(token));
}
