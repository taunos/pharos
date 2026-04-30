// Slice 2b Phase 1 — token utilities for the Score email-capture flow.
//
// Two token shapes, both versioned with a `v1.` prefix to enable future
// secret-rotation via dual-secret validation (no one-shot break of all
// in-flight tokens). See locked decision 7 in the slice prompt + the
// rotation runbook in DEPLOY.md.
//
// IMPORTANT: HMAC validation goes through `crypto.subtle.verify` for
// constant-time comparison. Do NOT compare hex strings with `===` (timing
// leak). Workers' subtle.verify takes raw signature bytes and returns a
// boolean.
//
// Token #1: scan-bound. Used for PDF download links, /score/[id]?t= entries
// from the email, and unsubscribe (same token, three uses, with a longer
// expiry on the unsubscribe link via UNSUB_TOKEN_TTL_SECONDS).
//   Format: v1.<b64u(scan_id)>.<b64u(expiry)>.<hex_hmac>
//   HMAC over: "<scan_id>:<expiry>:<UNSUBSCRIBE_SECRET>"
//   Email NEVER in URL — recovered from scanner D1 by scan_id.
//
// Token #2: deletion-confirm. Sent to the user's own inbox after they request
// deletion. Email IS in URL because the link goes to that user's own inbox
// — different threat model than a forwarded PDF link.
//   Format: v1.<b64u(email)>.<b64u(expiry)>.<hex_hmac>
//   HMAC over: "<email>:<expiry>:<UNSUBSCRIBE_SECRET>"
//
// Email normalization (F-01): every email-bearing entry point in this module
// applies normalizeEmail() at the top so HMAC payloads, R2 keys, and log
// hashes are all over the same canonical form regardless of user casing.

import { normalizeEmail } from "./email-normalize";

export const PDF_TOKEN_TTL_SECONDS = 30 * 86400;     // 30 days
export const UNSUB_TOKEN_TTL_SECONDS = 365 * 86400;  // 365 days
export const DELETION_TOKEN_TTL_SECONDS = 24 * 3600; // 24 hours

const TOKEN_VERSION = "v1";

// ─── base64url helpers ────────────────────────────────────────────────────

function b64uEncode(input: string): string {
  // btoa accepts a binary-string; encode UTF-8 bytes first then map to char codes.
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(input: string): string | null {
  try {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const bin = atob(padded + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

// ─── HMAC helpers ─────────────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const keyBytes = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw",
    // Workers strict-mode TS quirk: keyBytes is Uint8Array<ArrayBufferLike>
    // which doesn't directly satisfy BufferSource. Same cast used in
    // src/lib/dodo.ts for the Dodo webhook signature verification.
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function hexEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

function hexDecode(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

async function signHmac(key: CryptoKey, data: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data) as unknown as ArrayBuffer
  );
  return hexEncode(new Uint8Array(sig));
}

async function verifyHmac(
  key: CryptoKey,
  data: string,
  hexSignature: string
): Promise<boolean> {
  const sig = hexDecode(hexSignature);
  if (!sig) return false;
  // crypto.subtle.verify does the constant-time comparison internally.
  return crypto.subtle.verify(
    "HMAC",
    key,
    sig as unknown as ArrayBuffer,
    new TextEncoder().encode(data) as unknown as ArrayBuffer
  );
}

// ─── Scan-bound token (PDF / /score/[id]?t / unsubscribe) ────────────────

export async function issueScanToken(
  scanId: string,
  expirySeconds: number,
  secret: string
): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + expirySeconds;
  const key = await importHmacKey(secret);
  const data = `${scanId}:${expiry}:${secret}`;
  const hmac = await signHmac(key, data);
  return `${TOKEN_VERSION}.${b64uEncode(scanId)}.${b64uEncode(String(expiry))}.${hmac}`;
}

export async function verifyScanToken(
  token: string,
  secret: string
): Promise<{ scanId: string; expiry: number } | null> {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, b64ScanId, b64Expiry, hexHmac] = parts;
  if (version !== TOKEN_VERSION) return null;

  const scanId = b64uDecode(b64ScanId);
  const expiryStr = b64uDecode(b64Expiry);
  if (scanId === null || expiryStr === null) return null;
  const expiry = parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry)) return null;

  // Expiry check first — cheaper than a constant-time verify.
  const now = Math.floor(Date.now() / 1000);
  if (now > expiry) return null;

  const key = await importHmacKey(secret);
  const data = `${scanId}:${expiry}:${secret}`;
  const ok = await verifyHmac(key, data, hexHmac);
  return ok ? { scanId, expiry } : null;
}

// ─── Deletion-confirm token (sent to user's own inbox) ───────────────────

export async function issueDeletionToken(
  email: string,
  expirySeconds: number,
  secret: string
): Promise<string> {
  const normalized = normalizeEmail(email);
  const expiry = Math.floor(Date.now() / 1000) + expirySeconds;
  const key = await importHmacKey(secret);
  const data = `${normalized}:${expiry}:${secret}`;
  const hmac = await signHmac(key, data);
  return `${TOKEN_VERSION}.${b64uEncode(normalized)}.${b64uEncode(String(expiry))}.${hmac}`;
}

export async function verifyDeletionToken(
  token: string,
  secret: string
): Promise<{ email: string; expiry: number } | null> {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, b64Email, b64Expiry, hexHmac] = parts;
  if (version !== TOKEN_VERSION) return null;

  const email = b64uDecode(b64Email);
  const expiryStr = b64uDecode(b64Expiry);
  if (email === null || expiryStr === null) return null;
  const expiry = parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (now > expiry) return null;

  const key = await importHmacKey(secret);
  // Token's HMAC was signed over the normalized form at issuance; the
  // recovered email is therefore already normalized. No re-normalization
  // needed here — re-applying would be a no-op given idempotence of
  // lowercase+trim, but skipping it makes the contract explicit.
  const data = `${email}:${expiry}:${secret}`;
  const ok = await verifyHmac(key, data, hexHmac);
  return ok ? { email, expiry } : null;
}

// ─── Email hashing for log redaction ──────────────────────────────────────
//
// Used in PDF-download / capture-email logs so abuse correlation works
// (same email → same hash) without raw PII in tail logs. The salt is the
// UNSUBSCRIBE_SECRET so an attacker who reads logs can't precompute hashes
// for known email addresses. Truncated to 16 hex chars (8 bytes) — plenty
// of collision space for log-correlation purposes, fits cleanly in line.

export async function hashEmailForLog(
  email: string,
  secret: string
): Promise<string> {
  const normalized = normalizeEmail(email);
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized + secret) as unknown as ArrayBuffer
  );
  return hexEncode(new Uint8Array(buf)).slice(0, 16);
}

// ─── Email hashing for R2 key derivation ─────────────────────────────────
//
// Per locked decision 8: R2 key is `score-reports/<scan_id>/<sha256(email)[:16]>.pdf`.
// This hash is NOT salted — it must be deterministic across all writers/readers
// of the bucket given the same email, so the marketing-site Worker can always
// recompute it from a captured email value alone.

export async function hashEmailForR2Key(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized) as unknown as ArrayBuffer
  );
  return hexEncode(new Uint8Array(buf)).slice(0, 16);
}
