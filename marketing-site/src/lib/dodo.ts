// Dodo Payments API client + webhook signature verification.
//
// Two deviations from the original spec, per docs.dodopayments.com:
//   1. Checkout endpoint is `/checkouts` (not `/v1/checkout-sessions`),
//      and lives on a host that depends on mode (test.dodopayments.com vs
//      live.dodopayments.com).
//   2. The body uses `product_cart` array (with product_id + quantity)
//      instead of a flat `product_id`, and `return_url` instead of
//      `success_url`. `cancel_url` and `metadata` work as expected.
//
// Webhook verification follows the Standard Webhooks spec (the same scheme
// Svix uses). Secret format observed in production is `whsec_<base64>`;
// we strip the prefix and base64-decode for HMAC. If the secret doesn't
// have the prefix we fall back to treating it as raw bytes.

export type DodoEnvBindings = {
  DODO_API_KEY: string;
  DODO_WEBHOOK_SECRET: string;
  DODO_API_BASE?: string;
};

export const DEFAULT_DODO_API_BASE = "https://live.dodopayments.com";

export function dodoApiBase(env: DodoEnvBindings): string {
  if (env.DODO_API_BASE && env.DODO_API_BASE.length > 0) {
    return env.DODO_API_BASE.replace(/\/$/, "");
  }
  return DEFAULT_DODO_API_BASE;
}

export type CreateCheckoutOptions = {
  product_id: string;
  customer_email: string;
  metadata: Record<string, string>;
  return_url: string;
  cancel_url: string;
};

export type CreateCheckoutResult = {
  checkout_url: string;
  checkout_session_id: string;
};

export async function createCheckoutSession(
  env: DodoEnvBindings,
  opts: CreateCheckoutOptions
): Promise<CreateCheckoutResult> {
  const base = dodoApiBase(env);
  const res = await fetch(`${base}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.DODO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      product_cart: [{ product_id: opts.product_id, quantity: 1 }],
      customer: { email: opts.customer_email },
      metadata: opts.metadata,
      return_url: opts.return_url,
      cancel_url: opts.cancel_url,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Dodo checkout session create failed: ${res.status} ${body.slice(0, 500)}`
    );
  }
  const data = (await res.json()) as {
    session_id?: string;
    checkout_url?: string;
    url?: string;
    id?: string;
  };
  const checkout_url = data.checkout_url ?? data.url;
  const checkout_session_id = data.session_id ?? data.id;
  if (!checkout_url || !checkout_session_id) {
    throw new Error(
      `Dodo checkout response missing fields: ${JSON.stringify(data).slice(0, 500)}`
    );
  }
  return { checkout_url, checkout_session_id };
}

function decodeSecret(rawSecret: string): Uint8Array {
  // Standard Webhooks / Svix secrets typically arrive prefixed with `whsec_`
  // followed by a base64-encoded random key. If the prefix isn't there,
  // treat the secret as a raw UTF-8 string.
  if (rawSecret.startsWith("whsec_")) {
    const b64 = rawSecret.slice("whsec_".length);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(rawSecret);
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type WebhookVerifyResult =
  | { valid: true }
  | { valid: false; reason: string };

const STALE_THRESHOLD_SEC = 300;

export async function verifyWebhook(
  env: DodoEnvBindings,
  request: Request,
  body: string
): Promise<WebhookVerifyResult> {
  const id = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const signature = request.headers.get("webhook-signature");
  if (!id || !timestamp || !signature) {
    return { valid: false, reason: "missing webhook headers" };
  }

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    return { valid: false, reason: "invalid webhook-timestamp" };
  }
  const ageSec = Math.abs(Date.now() / 1000 - ts);
  if (ageSec > STALE_THRESHOLD_SEC) {
    return { valid: false, reason: `stale timestamp (age=${Math.round(ageSec)}s)` };
  }

  const keyBytes = decodeSecret(env.DODO_WEBHOOK_SECRET);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const message = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const expectedBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, message)
  );
  let expectedB64 = "";
  for (let i = 0; i < expectedBytes.length; i++) {
    expectedB64 += String.fromCharCode(expectedBytes[i]);
  }
  const expected = btoa(expectedB64);

  // Header may contain multiple space-separated `v1,<sig>` entries.
  const entries = signature.split(" ");
  for (const entry of entries) {
    const idx = entry.indexOf(",");
    if (idx <= 0) continue;
    const version = entry.slice(0, idx);
    const sig = entry.slice(idx + 1);
    if (version !== "v1") continue;
    if (constantTimeEqual(sig, expected)) return { valid: true };
  }
  return { valid: false, reason: "signature mismatch" };
}
