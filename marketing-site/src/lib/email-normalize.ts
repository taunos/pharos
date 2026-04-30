/**
 * Canonical email normalization for the entire project.
 *
 * Used at every email entry point BEFORE: HMAC payload construction,
 * R2 key derivation (hashEmailForR2Key), log redaction (hashEmailForLog),
 * scanner D1 storage/lookup, and any other email-comparison surface.
 *
 * Rationale: email local-part is technically case-sensitive per RFC 5321
 * §2.3.11, but in practice 100% of providers treat it case-insensitive.
 * Normalizing prevents user-visible inconsistencies in unsubscribe,
 * deletion, and PDF download flows where the user enters the same email
 * with different casing across multiple submissions.
 *
 * Definition: lowercase + trim. Deliberately conservative — does NOT
 * normalize plus-aliases (foo+bar@x.com → foo@x.com) because that would
 * collapse intentional aliases users rely on for inbox routing.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
