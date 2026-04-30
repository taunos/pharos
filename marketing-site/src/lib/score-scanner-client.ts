// Slice 2b Phase 1 — thin client for marketing-site → scanner internal endpoints.
//
// The scanner mounts a set of admin endpoints (see scanner/src/score-admin.ts)
// guarded by INTERNAL_SCANNER_ADMIN_KEY. This module wraps them with typed
// helpers so the route handlers stay readable.
//
// Note: scanner is reached via the internal workers.dev URL (not via the
// public scanner.astrant.io custom domain). Keeps marketing-site → scanner
// traffic on the Cloudflare backbone and avoids a public DNS round-trip.

const SCANNER_BASE = "https://pharos-scanner.pharos-dev.workers.dev";

export interface ScannerEnv {
  INTERNAL_SCANNER_ADMIN_KEY: string;
}

function authHeaders(env: ScannerEnv): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-internal-scanner-admin-key": env.INTERNAL_SCANNER_ADMIN_KEY,
  };
}

export async function captureEmail(
  env: ScannerEnv,
  scanId: string,
  payload: {
    email: string;
    email_opted_in_rescan: boolean;
    unsubscribe_token: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${SCANNER_BASE}/api/scan/${scanId}/capture-email`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

export async function markPdfGenerated(
  env: ScannerEnv,
  scanId: string,
  payload: { pdf_template_version: string; pdf_deferred_until_tomorrow?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${SCANNER_BASE}/api/scan/${scanId}/pdf-generated`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

export async function unsubscribeScan(
  env: ScannerEnv,
  scanId: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${SCANNER_BASE}/api/scan/${scanId}/unsubscribe`, {
    method: "POST",
    headers: authHeaders(env),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

export async function deletePiiForScan(
  env: ScannerEnv,
  scanId: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${SCANNER_BASE}/api/scan/${scanId}/delete-pii`, {
    method: "POST",
    headers: authHeaders(env),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

export async function getEmailForScan(
  env: ScannerEnv,
  scanId: string
): Promise<{ ok: true; email: string | null } | { ok: false; error: string }> {
  const res = await fetch(`${SCANNER_BASE}/api/internal/scan/${scanId}/email`, {
    method: "GET",
    headers: authHeaders(env),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  const data = (await res.json()) as { ok: true; email: string | null } | { ok: false; error: string };
  if (!data.ok) return data;
  return { ok: true, email: data.email };
}

export async function getScansByEmail(
  env: ScannerEnv,
  email: string
): Promise<{ ok: true; scan_ids: string[] } | { ok: false; error: string }> {
  const res = await fetch(`${SCANNER_BASE}/api/scan/by-email-internal`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  const data = (await res.json()) as { ok: true; scan_ids: string[] } | { ok: false; error: string };
  if (!data.ok) return data;
  return { ok: true, scan_ids: data.scan_ids };
}

export async function getScanState(
  env: ScannerEnv,
  scanId: string
): Promise<
  | {
      ok: true;
      has_email_captured: boolean;
      email_opted_in_rescan: boolean;
      pdf_ready: boolean;
      unsubscribed: boolean;
      deletion_requested: boolean;
      pdf_deferred_until_tomorrow: boolean;
      pdf_template_version: string | null;
    }
  | { ok: false; error: string }
> {
  const res = await fetch(`${SCANNER_BASE}/api/scan/${scanId}/state`, {
    method: "GET",
    headers: authHeaders(env),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  return (await res.json()) as
    | {
        ok: true;
        has_email_captured: boolean;
        email_opted_in_rescan: boolean;
        pdf_ready: boolean;
        unsubscribed: boolean;
        deletion_requested: boolean;
        pdf_deferred_until_tomorrow: boolean;
        pdf_template_version: string | null;
      }
    | { ok: false; error: string };
}

// Public scan record (composite + dimensions + scoring_version) — uses the
// existing public GET /api/scan/:id endpoint, no auth needed (scanner already
// returns this anonymously to render free-tier results).
//
// Returns the same ScanResult shape audit-pipeline.runScan returns. Caller
// must validate the `id` matches what they expect.
export async function getPublicScan(
  scanId: string
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const res = await fetch(`${SCANNER_BASE}/api/scan/${scanId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true, data: await res.json() };
}
