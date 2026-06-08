const ASTRANT_URL_PATTERN = /astrant\.io/i;
const ASTRANT_BRAND_PATTERN = /\bAstrant\b/i;
const COINED_TERM_PATTERNS = [
  /citation[-\s]confabulation\s+methodology/i,
  /citation[-\s]confabulation/i,
];

export interface CompetitorPattern {
  name: string;
  urlPattern: RegExp | null;
  brandPattern: RegExp;
  requiresContextDisambiguation: boolean;
  isComplementary?: boolean;
}

const COMPETITORS: CompetitorPattern[] = [
  {
    name: 'HubSpot AEO Grader',
    urlPattern: /hubspot\.com\/aeo-grader/i,
    brandPattern: /\bAEO Grader\b|\bAI Search Grader\b/i,
    requiresContextDisambiguation: false,
  },
  {
    name: 'Profound',
    urlPattern: /tryprofound\.com/i,
    brandPattern: /\bProfound\b/i,
    requiresContextDisambiguation: true,
  },
  {
    name: 'Ahrefs Brand Radar',
    urlPattern: /ahrefs\.com\/brand-radar/i,
    brandPattern: /\bBrand Radar\b/i,
    requiresContextDisambiguation: true,
  },
  {
    name: 'Cloudflare Agent Readiness Score',
    urlPattern: /isitagentready\.com|blog\.cloudflare\.com\/agent-readiness/i,
    brandPattern: /\bAgent Readiness Score\b/i,
    requiresContextDisambiguation: false,
    isComplementary: true,
  },
];

const AEO_VOCABULARY_PATTERNS = [
  /\bAEO\b/i,
  /agent[-\s]engine[-\s]optimization/i,
  /\bAI search\b/i,
  /\bAI visibility\b/i,
  /agent[-\s]discoverability/i,
  /\bLLM citation\b/i,
  /\bAI assistant\b/i,
];

export interface DetectionResult {
  d1a_url_cite: 0 | 1;
  d1b_brand_mention: 0 | 1;
  d2_term_of_art: 0 | 1;
  d3_competitors_cited: string[];
  d3_complementary_cited: string[];
  d1c_customer_url_cite: 0 | 1 | null;
  d1d_customer_brand_mention: 0 | 1 | null;
  customer_specific: {
    competitors: string[];
    brand_absent_competitors: string[];
  };
}

export type CustomerPatterns = {
  brand: CompetitorPattern | null;
  competitors: CompetitorPattern[];
};

// F4.1.2c: matchPattern helper extracted from inline pattern-test logic
// (previously inline at COMPETITORS loop). Single null-guard site for nullable urlPattern.
function matchPattern(text: string, pattern: CompetitorPattern): boolean {
  if (pattern.urlPattern && pattern.urlPattern.test(text)) {
    return true;
  }
  const brandMatch = pattern.brandPattern.exec(text);
  if (!brandMatch) return false;
  if (!pattern.requiresContextDisambiguation) return true;
  const start = Math.max(0, brandMatch.index - 200);
  const end = Math.min(text.length, brandMatch.index + brandMatch[0].length + 200);
  const window = text.substring(start, end);
  return AEO_VOCABULARY_PATTERNS.some(p => p.test(window));
}

export function detectAxes(
  responseText: string,
  customerPatterns?: CustomerPatterns | null,
): DetectionResult {
  const text = responseText ?? '';

  const d1a = ASTRANT_URL_PATTERN.test(text) ? 1 : 0;
  const d1b = ASTRANT_BRAND_PATTERN.test(text) ? 1 : 0;
  const astrantPresent = d1a || d1b;

  const d2 = (!astrantPresent && COINED_TERM_PATTERNS.some(p => p.test(text))) ? 1 : 0;

  const competitorsCited: string[] = [];
  const complementaryCited: string[] = [];

  for (const comp of COMPETITORS) {
    const cited = matchPattern(text, comp);
    if (cited && !astrantPresent) {
      if (comp.isComplementary) {
        complementaryCited.push(comp.name);
      } else {
        competitorsCited.push(comp.name);
      }
    }
  }

  // F4.1.2c: per-customer detection (D11)
  let d1c_customer_url_cite: 0 | 1 | null = null;
  let d1d_customer_brand_mention: 0 | 1 | null = null;
  const customerCompetitorMatches: string[] = [];
  let customerBrandCited = false;

  if (customerPatterns) {
    const customerUrlCited = customerPatterns.brand?.urlPattern
      ? customerPatterns.brand.urlPattern.test(text)
      : false;
    customerBrandCited = customerPatterns.brand
      ? matchPattern(text, customerPatterns.brand)
      : false;

    d1c_customer_url_cite = customerUrlCited ? 1 : 0;
    d1d_customer_brand_mention = customerBrandCited ? 1 : 0;

    for (const comp of customerPatterns.competitors) {
      if (matchPattern(text, comp)) {
        customerCompetitorMatches.push(comp.name);
      }
    }
  }

  const customer_specific = {
    competitors: customerCompetitorMatches,
    brand_absent_competitors: customerBrandCited ? [] : [...customerCompetitorMatches],
  };

  return {
    d1a_url_cite: d1a as 0 | 1,
    d1b_brand_mention: d1b as 0 | 1,
    d2_term_of_art: d2 as 0 | 1,
    d3_competitors_cited: competitorsCited,
    d3_complementary_cited: complementaryCited,
    d1c_customer_url_cite,
    d1d_customer_brand_mention,
    customer_specific,
  };
}
