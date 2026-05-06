const ASTRANT_URL_PATTERN = /astrant\.io/i;
const ASTRANT_BRAND_PATTERN = /\bAstrant\b/i;
const COINED_TERM_PATTERNS = [
  /citation[-\s]confabulation\s+methodology/i,
  /citation[-\s]confabulation/i,
];

interface CompetitorPattern {
  name: string;
  urlPattern: RegExp;
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
}

export function detectAxes(responseText: string): DetectionResult {
  const text = responseText ?? '';

  const d1a = ASTRANT_URL_PATTERN.test(text) ? 1 : 0;
  const d1b = ASTRANT_BRAND_PATTERN.test(text) ? 1 : 0;
  const astrantPresent = d1a || d1b;

  const d2 = (!astrantPresent && COINED_TERM_PATTERNS.some(p => p.test(text))) ? 1 : 0;

  const competitorsCited: string[] = [];
  const complementaryCited: string[] = [];

  for (const comp of COMPETITORS) {
    let cited = false;
    if (comp.urlPattern.test(text)) {
      cited = true;
    } else {
      const brandMatch = comp.brandPattern.exec(text);
      if (brandMatch) {
        if (comp.requiresContextDisambiguation) {
          const start = Math.max(0, brandMatch.index - 200);
          const end = Math.min(text.length, brandMatch.index + brandMatch[0].length + 200);
          const window = text.substring(start, end);
          if (AEO_VOCABULARY_PATTERNS.some(p => p.test(window))) {
            cited = true;
          }
        } else {
          cited = true;
        }
      }
    }
    if (cited && !astrantPresent) {
      if (comp.isComplementary) {
        complementaryCited.push(comp.name);
      } else {
        competitorsCited.push(comp.name);
      }
    }
  }

  return {
    d1a_url_cite: d1a as 0 | 1,
    d1b_brand_mention: d1b as 0 | 1,
    d2_term_of_art: d2 as 0 | 1,
    d3_competitors_cited: competitorsCited,
    d3_complementary_cited: complementaryCited,
  };
}
