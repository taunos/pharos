export type BrandNameError =
  | 'BRAND_NAME_REQUIRED'
  | 'BRAND_NAME_TOO_LONG'
  | 'BRAND_NAME_INVALID_CHAR';

const INVISIBLE_RANGES: Array<[number, number]> = [
  [0x0000, 0x001F], // C0 controls
  [0x007F, 0x007F], // DEL
  [0x200B, 0x200D], // ZWSP, ZWNJ, ZWJ
  [0xFEFF, 0xFEFF], // BOM
  [0x202A, 0x202E], // LRE..RLO (bidi override)
  [0x2066, 0x2069], // LRI..PDI (bidi isolate)
];

function hasInvisible(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    for (const [lo, hi] of INVISIBLE_RANGES) {
      if (cp >= lo && cp <= hi) return true;
    }
  }
  return false;
}

const ALLOWED_BRAND_RE = /^[\p{L}\p{N}\p{M} .\-&,']+$/u;

export function validateBrandName(value: unknown):
  | { ok: true; value: string }
  | { ok: false; code: BrandNameError; message: string }
{
  if (typeof value !== 'string') {
    return { ok: false, code: 'BRAND_NAME_REQUIRED', message: 'brand_name must be a string' };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: 'BRAND_NAME_REQUIRED', message: 'brand_name must be non-empty after trim' };
  }
  if (trimmed.length > 50) {
    return { ok: false, code: 'BRAND_NAME_TOO_LONG', message: 'brand_name must be at most 50 chars' };
  }
  if (hasInvisible(trimmed)) {
    return { ok: false, code: 'BRAND_NAME_INVALID_CHAR', message: 'brand_name must not contain control or invisible chars' };
  }
  if (!ALLOWED_BRAND_RE.test(trimmed)) {
    return { ok: false, code: 'BRAND_NAME_INVALID_CHAR', message: "brand_name allowed chars: letters, digits, space, . - & , '" };
  }
  return { ok: true, value: trimmed };
}
