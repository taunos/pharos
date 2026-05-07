// src/lib/origin.ts
//
// Returns the request's origin from req.url ONLY — does NOT trust the
// X-Forwarded-Host header. Cloudflare Workers don't have intermediate
// proxies that legitimately set X-Forwarded-Host, so the header is
// either edge-controlled (redundant with req.url) or attacker-controlled
// (defense-in-depth: don't read it).
//
// Use this helper in any route that needs the inbound origin for URL
// construction (return_url, redirect targets, fulfillment dispatch, etc.).
//
// Phase 1.5 hardening (F-10) — replaces 4 copy-pasted originFromRequest()
// patterns across audit-create, dodo-webhook, score/delete-me,
// score/capture-email.

export function requestOrigin(req: Request): string {
  return new URL(req.url).origin;
}
