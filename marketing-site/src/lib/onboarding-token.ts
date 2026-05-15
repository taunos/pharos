// F3 D5: HS256-signed JWT for the post-purchase onboarding form. 7-day TTL,
// bound to subscription_id. See pharos-f3-autopilot-fulfillment-spec.md v3.2 §5.

export interface OnboardingTokenEnv {
  ONBOARDING_TOKEN_SECRET: string;
}

interface OnboardingTokenClaims {
  sub: string; // subscription_id
  iat: number;
  exp: number;
  v: 1;
}

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_VERSION = 1;

async function hmacSign(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function issueOnboardingToken(
  env: OnboardingTokenEnv,
  subscriptionId: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: OnboardingTokenClaims = {
    sub: subscriptionId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    v: TOKEN_VERSION,
  };
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const message = `${header}.${body}`;
  const sig = await hmacSign(env.ONBOARDING_TOKEN_SECRET, message);
  return `${message}.${sig}`;
}

export type OnboardingTokenVerifyResult =
  | { ok: true; subscriptionId: string; issuedAt: number; expiresAt: number }
  | { ok: false; status: number; code: string; message: string };

export async function verifyOnboardingToken(
  env: OnboardingTokenEnv,
  token: string,
): Promise<OnboardingTokenVerifyResult> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, status: 400, code: "ONBOARDING_TOKEN_REQUIRED", message: "token required" };
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, status: 400, code: "ONBOARDING_TOKEN_INVALID", message: "malformed token" };
  }
  const [header, body, sig] = parts;
  const expectedSig = await hmacSign(env.ONBOARDING_TOKEN_SECRET, `${header}.${body}`);
  // Constant-time comparison.
  if (sig.length !== expectedSig.length) {
    return { ok: false, status: 400, code: "ONBOARDING_TOKEN_INVALID", message: "signature mismatch" };
  }
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  if (diff !== 0) {
    return { ok: false, status: 400, code: "ONBOARDING_TOKEN_INVALID", message: "signature mismatch" };
  }
  let claims: OnboardingTokenClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  } catch {
    return { ok: false, status: 400, code: "ONBOARDING_TOKEN_INVALID", message: "malformed claims" };
  }
  if (claims.v !== TOKEN_VERSION) {
    return { ok: false, status: 400, code: "ONBOARDING_TOKEN_VERSION", message: "token version unsupported" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) {
    return { ok: false, status: 400, code: "ONBOARDING_TOKEN_EXPIRED", message: "token expired" };
  }
  return { ok: true, subscriptionId: claims.sub, issuedAt: claims.iat, expiresAt: claims.exp };
}
