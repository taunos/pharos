// F-Fnd OQ3 path (b): SHA-256 email hash + suppression check + signed-token mint/verify.
// Async crypto.subtle is acceptable — endpoints are NOT in webhook-hot-path.

import type { D1Database } from '@cloudflare/workers-types';

const ENC = new TextEncoder();

export async function hashEmailSha256(email: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', ENC.encode(email.toLowerCase().trim()));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function isEmailSuppressed(
  env: { CITATION_DB: D1Database },
  email: string,
): Promise<boolean> {
  const hash = await hashEmailSha256(email);
  const row = await env.CITATION_DB.prepare(
    'SELECT 1 FROM email_suppressions WHERE email_hash = ?'
  ).bind(hash).first();
  return row !== null;
}

export async function recordSuppression(
  env: { CITATION_DB: D1Database },
  email: string,
  reason: string,
): Promise<void> {
  const hash = await hashEmailSha256(email);
  const nowSec = Math.floor(Date.now() / 1000);
  await env.CITATION_DB.prepare(
    'INSERT OR IGNORE INTO email_suppressions (email_hash, suppressed_at, reason) VALUES (?, ?, ?)'
  ).bind(hash, nowSec, reason).run();
}

export async function mintUnsubscribeToken(
  env: { EMAIL_UNSUB_SIGNING_KEY: string },
  email: string,
  ttlSeconds: number = 60 * 60 * 24 * 30,
): Promise<string> {
  const emailHash = await hashEmailSha256(email);
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = { e: emailHash, exp, v: 1 };
  const payloadB64 = b64url(ENC.encode(JSON.stringify(payload)));
  const sig = await hmacSha256(env.EMAIL_UNSUB_SIGNING_KEY, payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifyUnsubscribeToken(
  env: { EMAIL_UNSUB_SIGNING_KEY: string },
  token: string,
): Promise<{ valid: true; emailHash: string } | { valid: false; reason: string }> {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };
  const [payloadB64, sig] = parts;
  const expectedSig = await hmacSha256(env.EMAIL_UNSUB_SIGNING_KEY, payloadB64);
  if (sig.length !== expectedSig.length) return { valid: false, reason: 'sig-mismatch' };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  if (diff !== 0) return { valid: false, reason: 'sig-mismatch' };

  let payload: { e: string; exp: number; v: number };
  try {
    const json = new TextDecoder().decode(b64urlDecode(payloadB64));
    payload = JSON.parse(json);
  } catch {
    return { valid: false, reason: 'payload-parse' };
  }
  if (payload.v !== 1) return { valid: false, reason: 'version' };
  if (Math.floor(Date.now() / 1000) > payload.exp) return { valid: false, reason: 'expired' };
  return { valid: true, emailHash: payload.e };
}

async function hmacSha256(keyStr: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', ENC.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(message));
  return b64url(new Uint8Array(sig));
}

function b64url(buf: Uint8Array): string {
  // Byte-by-byte construction over Uint8Array; correct in Workers runtime.
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function buildUnsubscribeLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}
