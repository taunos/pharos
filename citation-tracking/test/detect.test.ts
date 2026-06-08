// citation-tracking/test/detect.test.ts
// F4.1.2c — deterministic coverage of detectAxes + customer-patterns pattern generation.
// Invoked via: tsx test/detect.test.ts (matches cadence.test.ts convention).

import { detectAxes } from '../src/detect';
import { generateCustomerPatterns } from '../src/customer-patterns';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    passCount++;
    console.log(`PASS: ${name}`);
  } else {
    failCount++;
    console.log(`FAIL: ${name}`);
  }
}

// AC-1: customer brand match populates customer_specific + d1d
{
  const patterns = generateCustomerPatterns({
    brand_name: 'Mailchimp',
    domain: 'mailchimp.com',
    competitors: JSON.stringify(['ConvertKit', 'Klaviyo']),
  });
  const result = detectAxes(
    'Top email marketing tools: Mailchimp is widely used, alongside ConvertKit and Klaviyo.',
    patterns,
  );
  assert(result.customer_specific.competitors.includes('ConvertKit'), 'AC-1a: ConvertKit in competitors');
  assert(result.customer_specific.competitors.includes('Klaviyo'), 'AC-1b: Klaviyo in competitors');
  assert(result.customer_specific.brand_absent_competitors.length === 0, 'AC-1c: brand_absent_competitors empty when brand cited');
  assert(result.d1d_customer_brand_mention === 1, 'AC-1d: d1d === 1');
}

// AC-2: competitor cited; brand absent
{
  const patterns = generateCustomerPatterns({
    brand_name: 'Mailchimp',
    domain: 'mailchimp.com',
    competitors: JSON.stringify(['ConvertKit', 'Klaviyo']),
  });
  const result = detectAxes(
    'Top email marketing tools today: ConvertKit and Klaviyo dominate the SMB segment.',
    patterns,
  );
  assert(result.customer_specific.competitors.length === 2, 'AC-2a: 2 competitor matches');
  assert(result.customer_specific.brand_absent_competitors.length === 2, 'AC-2b: brand_absent_competitors populated when brand absent');
  assert(result.d1d_customer_brand_mention === 0, 'AC-2c: d1d === 0');
}

// AC-3: empty competitors → empty arrays
{
  const patterns = generateCustomerPatterns({
    brand_name: 'Mailchimp', domain: 'mailchimp.com', competitors: null,
  });
  const result = detectAxes('Top tools: Mailchimp leads.', patterns);
  assert(result.customer_specific.competitors.length === 0, 'AC-3a: empty competitors array');
  assert(result.customer_specific.brand_absent_competitors.length === 0, 'AC-3b: empty brand_absent_competitors');
}

// AC-4: Astrant baseline (null patterns) — REGRESSION-CRITICAL post-matchPattern-refactor
{
  const result = detectAxes(
    'AEO landscape: Profound and HubSpot AEO Grader lead the citation-tracking space alongside Cloudflare Agent Readiness Score.',
    null,
  );
  assert(result.d3_competitors_cited.length > 0, 'AC-4a: Astrant direct competitors populated');
  assert(result.customer_specific.competitors.length === 0, 'AC-4b: customer_specific.competitors empty for Astrant baseline');
  assert(result.customer_specific.brand_absent_competitors.length === 0, 'AC-4c: brand_absent_competitors empty for Astrant baseline');
  assert(result.d1c_customer_url_cite === null, 'AC-4d: d1c NULL for Astrant baseline');
  assert(result.d1d_customer_brand_mention === null, 'AC-4e: d1d NULL for Astrant baseline');
}

// AC-5 + AC-6: D11 derivation covered by AC-1 + AC-2

// AC-7: D10 regex bug — null urlPattern when domain missing
{
  const patterns = generateCustomerPatterns({brand_name: 'Acme Widgets', domain: null, competitors: null});
  assert(patterns?.brand?.urlPattern === null, 'AC-7: urlPattern null when domain missing');
}

// AC-8: D10 distinctive name skips disambiguation
{
  const patterns = generateCustomerPatterns({brand_name: 'Mailchimp', domain: 'mailchimp.com', competitors: null});
  assert(patterns?.brand?.requiresContextDisambiguation === false, 'AC-8: Mailchimp distinctive');
}

// AC-9: D10 short name requires disambiguation
{
  const patterns = generateCustomerPatterns({brand_name: 'AI', domain: null, competitors: null});
  assert(patterns?.brand?.requiresContextDisambiguation === true, 'AC-9: AI requires disambiguation');
}

// AC-10: case-insensitive COMMON_WORDS lookup
{
  const p1 = generateCustomerPatterns({brand_name: 'ai', domain: null, competitors: null});
  assert(p1?.brand?.requiresContextDisambiguation === true, 'AC-10a: lowercase ai requires disambiguation');
  const p2 = generateCustomerPatterns({brand_name: 'CRM', domain: null, competitors: null});
  assert(p2?.brand?.requiresContextDisambiguation === true, 'AC-10b: CRM requires disambiguation');
  const p3 = generateCustomerPatterns({brand_name: 'Notion', domain: 'notion.so', competitors: null});
  assert(p3?.brand?.requiresContextDisambiguation === false, 'AC-10c: Notion distinctive (removed from COMMON_WORDS)');
}

// AC-11: COMMON_WORDS tightened — Notion/Stripe/Vector distinctive
{
  const stripe = generateCustomerPatterns({brand_name: 'Stripe', domain: 'stripe.com', competitors: null});
  assert(stripe?.brand?.requiresContextDisambiguation === false, 'AC-11a: Stripe distinctive');
  const vector = generateCustomerPatterns({brand_name: 'Vector', domain: null, competitors: null});
  assert(vector?.brand?.requiresContextDisambiguation === false, 'AC-11b: Vector distinctive');
}

// AC-12: special-char names — warning logged; regex compiles; no match for C++
{
  const patterns = generateCustomerPatterns({brand_name: 'C++', domain: null, competitors: null});
  assert(patterns?.brand !== null, 'AC-12a: pattern object created for C++');
  assert(patterns?.brand?.brandPattern instanceof RegExp, 'AC-12b: regex compiled for C++');
  const result = detectAxes('I use C++ for low-level work.', patterns);
  assert(result.d1d_customer_brand_mention === 0, 'AC-12c: no match for C++ due to \\b limitation');
}

// Summary
console.log(`\nResults: ${passCount} pass, ${failCount} fail`);
if (failCount > 0) {
  process.exit(1);
}
