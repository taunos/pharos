// Test C-B — pure helpers for the open-state AuditCheckoutForm (client side).

// Same shape check as /api/audit-create (UUID v4). The server silently drops
// anything else; the client only forwards a value that would be accepted.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseSourceScanId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return UUID_V4_RE.test(v) ? v : null;
}

// Map an /api/audit-create error to buyer-facing text. Raw server error
// strings are never shown. A 400 is a field-validation refusal.
export function checkoutErrorMessage(
  code: string | undefined,
  status?: number,
): string {
  if (code === "RATE_LIMITED") {
    return "Too many checkout attempts — try again in an hour or email contact@astrant.io.";
  }
  if (status === 400) {
    return "Check your URL and email and try again.";
  }
  return "Checkout isn't available right now — email contact@astrant.io and we'll sort it out.";
}
