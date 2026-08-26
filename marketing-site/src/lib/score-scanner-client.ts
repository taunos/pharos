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

// P0-C2 capture cutover (spec CD7 / GD13): caller-side bounds. Every helper's
// fetch carries AbortSignal.timeout; abort/timeout normalizes to the helper's
// existing failure shape with error "timeout". Every other throw propagates
// unchanged.
const SCANNER_CLIENT_TIMEOUT_MS = 10_000;
// Binding relation: > PD_REQUEST_BUDGET_MS (25_000, scanner privacy-delete.ts)
// — change one, change both. Single source of truth: imported by the
// delete-me/confirm route and tC11, never re-declared.
export const DELETE_PII_TIMEOUT_MS = 30_000;

// Name-only predicate — no `instanceof Error` runtime-stack assumption.
function isTimeoutError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    ((e as { name: string }).name === "TimeoutError" || (e as { name: string }).name === "AbortError")
  );
}

// fetch with a timeout signal; timeout/abort → "timeout", anything else rethrows.
async function boundedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response | "timeout"> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (isTimeoutError(e)) return "timeout";
    throw e;
  }
}

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
  const res = await boundedFetch(`${SCANNER_BASE}/api/scan/${scanId}/capture-email`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify(payload),
  }, SCANNER_CLIENT_TIMEOUT_MS);
  if (res === "timeout") return { ok: false, error: "timeout" };
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
  const res = await boundedFetch(`${SCANNER_BASE}/api/scan/${scanId}/pdf-generated`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify(payload),
  }, SCANNER_CLIENT_TIMEOUT_MS);
  if (res === "timeout") return { ok: false, error: "timeout" };
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
  const res = await boundedFetch(`${SCANNER_BASE}/api/scan/${scanId}/unsubscribe`, {
    method: "POST",
    headers: authHeaders(env),
  }, SCANNER_CLIENT_TIMEOUT_MS);
  if (res === "timeout") return { ok: false, error: "timeout" };
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
  const res = await boundedFetch(`${SCANNER_BASE}/api/scan/${scanId}/delete-pii`, {
    method: "POST",
    headers: authHeaders(env),
  }, DELETE_PII_TIMEOUT_MS);
  if (res === "timeout") return { ok: false, error: "timeout" };
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
  const res = await boundedFetch(`${SCANNER_BASE}/api/internal/scan/${scanId}/email`, {
    method: "GET",
    headers: authHeaders(env),
  }, SCANNER_CLIENT_TIMEOUT_MS);
  if (res === "timeout") return { ok: false, error: "timeout" };
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
  const res = await boundedFetch(`${SCANNER_BASE}/api/scan/by-email-internal`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify({ email }),
  }, SCANNER_CLIENT_TIMEOUT_MS);
  if (res === "timeout") return { ok: false, error: "timeout" };
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
  const res = await boundedFetch(`${SCANNER_BASE}/api/scan/${scanId}/state`, {
    method: "GET",
    headers: authHeaders(env),
  }, SCANNER_CLIENT_TIMEOUT_MS);
  if (res === "timeout") return { ok: false, error: "timeout" };
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
  const res = await boundedFetch(`${SCANNER_BASE}/api/scan/${scanId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }, SCANNER_CLIENT_TIMEOUT_MS);
  if (res === "timeout") return { ok: false, error: "timeout" };
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true, data: await res.json() };
}

// ── P0-C2 capture cutover — new helpers (never throw) ─────────────────────────

// CD3: outbox producer call (scanner POST /api/scan/:id/capture-outbox).
export type CaptureOutboxOutcome =
  | { status: "deferred"; enqueued: boolean }
  | { status: "conflict" }
  | { status: "not_found" }
  | { status: "unavailable" }
  | { status: "transport_error" };

export async function captureOutbox(
  env: ScannerEnv,
  scanId: string,
  payload: {
    email: string;
    email_opted_in_rescan: boolean;
    unsubscribe_token: string;
  }
): Promise<CaptureOutboxOutcome> {
  let res: Response;
  try {
    res = await fetch(`${SCANNER_BASE}/api/scan/${scanId}/capture-outbox`, {
      method: "POST",
      headers: authHeaders(env),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SCANNER_CLIENT_TIMEOUT_MS),
    });
  } catch {
    return { status: "transport_error" };
  }
  if (res.status === 409) return { status: "conflict" };
  if (res.status === 404) return { status: "not_found" };
  if (res.status === 503) return { status: "unavailable" };
  if (res.status !== 200) return { status: "transport_error" };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { status: "transport_error" };
  }
  if (!data || typeof data !== "object" || (data as { status?: unknown }).status !== "deferred") {
    return { status: "transport_error" };
  }
  return { status: "deferred", enqueued: (data as { enqueued?: unknown }).enqueued === true };
}

// CD6: committed active-object pointer lookup (scanner GET /api/internal/scan/:id/pdf-key).
export async function getPdfKey(
  env: ScannerEnv,
  scanId: string
): Promise<{ ok: true; pdf_r2_key: string | null } | { ok: false }> {
  let res: Response;
  try {
    res = await fetch(`${SCANNER_BASE}/api/internal/scan/${scanId}/pdf-key`, {
      method: "GET",
      headers: authHeaders(env),
      signal: AbortSignal.timeout(SCANNER_CLIENT_TIMEOUT_MS),
    });
  } catch {
    return { ok: false };
  }
  if (res.status !== 200) return { ok: false };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false };
  }
  if (!data || typeof data !== "object" || (data as { ok?: unknown }).ok !== true) return { ok: false };
  const key = (data as { pdf_r2_key?: unknown }).pdf_r2_key;
  if (key === null || key === undefined) return { ok: true, pdf_r2_key: null };
  if (typeof key !== "string") return { ok: false };
  return { ok: true, pdf_r2_key: key };
}
