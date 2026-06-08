// citation-tracking/src/customer-patterns.ts
// F4.1.2c — Per-customer pattern generation from onboarding free-text input.

import { CompetitorPattern, CustomerPatterns } from './detect';

// COMMON_WORDS lookup: lowercase keys; case-insensitive normalization at lookup time.
// 14 entries. Tightened to ambiguous-only entries (Notion/Stripe/Vector REMOVED
// to preserve recall for legitimate SaaS customers with those brand names).
const COMMON_WORDS = new Set<string>([
  'ai', 'ml', 'it', 'api', 'crm', 'erp', 'saas', 'b2b', 'b2c',
  'pro', 'standard', 'custom', 'premium', 'basic',
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requiresDisambiguation(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (COMMON_WORDS.has(normalized)) return true;
  if (normalized.length < 5) return true;
  if (/^[A-Z]+$/.test(name.trim())) return true;  // ALL-CAPS acronyms
  return false;
}

function isPureWordChars(name: string): boolean {
  return /^\w+$/.test(name);  // \w = [A-Za-z0-9_]
}

export function generateBrandPattern(brandName: string, domain: string | null): CompetitorPattern | null {
  const name = brandName.trim();
  if (!name) return null;

  if (!isPureWordChars(name)) {
    console.warn(`F4.1.2c: brand "${name}" contains non-word chars; word-boundary regex may not match. KNOWN LIMITATION.`);
  }

  const urlPattern: RegExp | null = domain
    ? new RegExp(escapeRegex(domain.replace(/^https?:\/\//, '').replace(/\/$/, '')), 'i')
    : null;  // null, NOT new RegExp('(?:)') which matches every string in JS

  return {
    name: name,
    brandPattern: new RegExp('\\b' + escapeRegex(name) + '\\b', 'i'),
    urlPattern,
    requiresContextDisambiguation: requiresDisambiguation(name),
    isComplementary: false,
  };
}

export function generateCompetitorPatterns(competitorsJson: string | null): CompetitorPattern[] {
  if (!competitorsJson) return [];
  let names: string[];
  try {
    const parsed = JSON.parse(competitorsJson);
    if (!Array.isArray(parsed)) return [];
    names = parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch (err) {
    console.warn(`F4.1.2c: competitors JSON parse failed: ${String(err)}; treating as empty.`);
    return [];
  }
  return names.map(name => {
    const trimmed = name.trim();
    if (!isPureWordChars(trimmed)) {
      console.warn(`F4.1.2c: competitor "${trimmed}" contains non-word chars; word-boundary regex may not match.`);
    }
    return {
      name: trimmed,
      brandPattern: new RegExp('\\b' + escapeRegex(trimmed) + '\\b', 'i'),
      urlPattern: null,  // KNOWN LIMITATION: no competitor URL pattern (onboarding captures names only)
      requiresContextDisambiguation: requiresDisambiguation(trimmed),
      isComplementary: false,
    };
  });
}

export function generateCustomerPatterns(row: {
  brand_name: string | null;
  domain: string | null;
  competitors: string | null;
}): CustomerPatterns | null {
  const brand = row.brand_name ? generateBrandPattern(row.brand_name, row.domain) : null;
  const competitors = generateCompetitorPatterns(row.competitors);
  if (!brand && competitors.length === 0) return null;
  return { brand, competitors };
}
