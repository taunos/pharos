// Canonical HMAC-signed account-link helper per F3.2 v4 §15 D15.
// Subsequent within-marketing-site signed-URL surfaces import from here.
// Citation-tracking MIRRORS this file at citation-tracking/src/lib/account-link.ts.

export type AccountLinkEnv = {
  ACCOUNT_LINK_SECRET: string;
};

export async function signSubscriptionId(
  env: AccountLinkEnv,
  subscriptionId: string,
): Promise<string> {
  return hmacSign(env.ACCOUNT_LINK_SECRET, subscriptionId);
}

export async function issueAccountLink(
  env: AccountLinkEnv,
  subscriptionId: string,
  baseUrl: string,
): Promise<string> {
  const sig = await signSubscriptionId(env, subscriptionId);
  return `${baseUrl}/account?s=${encodeURIComponent(subscriptionId)}&sig=${sig}`;
}

export async function verifyAccountLink(
  env: AccountLinkEnv,
  subscriptionId: string,
  sig: string,
): Promise<boolean> {
  if (typeof subscriptionId !== "string" || subscriptionId.length === 0) return false;
  if (typeof sig !== "string" || sig.length === 0) return false;
  const expected = await hmacSign(env.ACCOUNT_LINK_SECRET, subscriptionId);
  return constantTimeEqual(sig, expected);
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return base64UrlEncode(new Uint8Array(sigBytes));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
