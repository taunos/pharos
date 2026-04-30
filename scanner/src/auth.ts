/**
 * Constant-time string comparison for header-secret authentication.
 *
 * Mirrors marketing-site/src/lib/dodo.ts. Used by:
 *   - score-admin's `requireAdminAuth` (INTERNAL_SCANNER_ADMIN_KEY)
 *   - index.ts paid-tier scan auth (INTERNAL_FULFILL_KEY)
 *
 * Length-mismatch short-circuits to false (this leaks length, but length is
 * already public — the secret's length is fixed by our generator). The XOR
 * loop runs to completion when lengths match so the comparison time does
 * not depend on the position of the first differing byte.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
