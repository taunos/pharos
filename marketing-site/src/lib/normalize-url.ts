/**
 * Normalize a user-typed URL: trim whitespace, prepend `https://` if no
 * scheme is present, and validate via WHATWG URL parser.
 *
 * Bare hostnames like `find-my-saas.com` are accepted and normalized to
 * `https://find-my-saas.com`. This matches user expectations — typing a
 * domain is the natural input mode for "scan my site" UX, but the scanner's
 * zod `z.string().url()` requires an absolute URL with scheme. Without
 * client-side normalization, the browser's native HTML5 `<input type="url">`
 * validation also rejects the input before submit.
 *
 * Returns null for empty input or strings that can't be parsed as URLs even
 * after prepending `https://`. Callers should display a "Please enter a
 * valid URL" error in that case.
 *
 * Schemes other than http/https are rejected — defense-in-depth against
 * `javascript:`, `file:`, `data:` URIs.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
