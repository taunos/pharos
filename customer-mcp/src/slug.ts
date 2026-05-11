const RESERVED_SLUGS = new Set([
  'www', 'api', 'mcp', 'astrant', 'admin', 'auth', 'login', 'signup',
  'account', 'app', 'staging', 'dev', 'test', 'support', 'help', 'docs',
  'blog', 'mail', 'email', 'status', 'health',
]);

export type SlugError =
  | { kind: 'SLUG_NON_ASCII' }
  | { kind: 'SLUG_RESERVED' }
  | { kind: 'SLUG_TOO_LONG' }
  | { kind: 'SLUG_COLLISION_EXHAUSTED' };

export type SlugResult =
  | { ok: true; slug: string }
  | { ok: false; error: SlugError };

export async function generateSlug(
  domain: string,
  db: D1Database,
): Promise<SlugResult> {
  // 1. Strip protocol / path / query
  let d = domain.toLowerCase().trim();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/[\/?#].*$/, '');
  // 2. Strip last dotted segment (TLD)
  const parts = d.split('.');
  if (parts.length >= 2) parts.pop();
  // 3. ASCII-only check on the PRE-replacement stripped input.
  //    CRITICAL: must run BEFORE step 4's non-alphanumeric replacement,
  //    otherwise non-ASCII chars (e.g., `ü` in `münchen`) get silently
  //    replaced with `-` and the check on the post-replacement value
  //    passes — leaving `m-nchen` as a valid-looking slug instead of
  //    rejecting per spec §3 D2.
  const stripped = parts.join('.');
  if (!/^[\x00-\x7F]*$/.test(stripped)) {
    return { ok: false, error: { kind: 'SLUG_NON_ASCII' } };
  }
  // 4. Now-known-ASCII: replace dots and non-alphanumeric (except `-`) with `-`
  const base = stripped.replace(/\./g, '-').replace(/[^a-z0-9-]/g, '-');
  // 5. Defensive belt-and-suspenders check (should be redundant given step 3)
  if (!/^[a-z0-9-]+$/.test(base)) {
    return { ok: false, error: { kind: 'SLUG_NON_ASCII' } };
  }
  // 6. Reserved-slug check
  if (RESERVED_SLUGS.has(base)) {
    return { ok: false, error: { kind: 'SLUG_RESERVED' } };
  }
  // 7. Length check (DNS label limit 63)
  if (base.length > 63) {
    return { ok: false, error: { kind: 'SLUG_TOO_LONG' } };
  }
  // 8. Collision check — try base, then base-2 through base-99
  let candidate = base;
  for (let i = 1; i <= 99; i++) {
    if (i > 1) candidate = `${base}-${i}`;
    if (candidate.length > 63) {
      return { ok: false, error: { kind: 'SLUG_TOO_LONG' } };
    }
    const existing = await db
      .prepare('SELECT slug FROM customers WHERE slug = ? LIMIT 1')
      .bind(candidate)
      .first();
    if (!existing) return { ok: true, slug: candidate };
  }
  return { ok: false, error: { kind: 'SLUG_COLLISION_EXHAUSTED' } };
}
