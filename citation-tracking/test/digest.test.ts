// citation-tracking/test/digest.test.ts
// F4.1.2c — deterministic coverage of computeDigestData D13 branch.
// Invoked via: tsx test/digest.test.ts (matches cadence.test.ts convention).

import { computeDigestData } from '../src/digest';

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

// Synthetic ProbeRow factory.
function makeRow(opts: {
  customer_id?: string | null;
  d1a?: number | null;
  d1b?: number | null;
  d1c?: number | null;
  d1d?: number | null;
  d2?: number;
  d3_direct?: string[];
  d3_complementary?: string[];
  cs_competitors?: string[];
  cs_brand_absent_competitors?: string[];
  provider?: string;
  prompt_id?: string;
  timestamp?: number;
}): any {
  return {
    customer_id: opts.customer_id ?? null,
    provider: opts.provider ?? 'openai',
    prompt_id: opts.prompt_id ?? 'p1',
    prompt_axis: 'aeo_category',
    response_excerpt: '',
    d1a_url_cite: opts.d1a ?? 0,
    d1b_brand_mention: opts.d1b ?? 0,
    d1c_customer_url_cite: opts.d1c ?? null,
    d1d_customer_brand_mention: opts.d1d ?? null,
    d2_term_of_art: opts.d2 ?? 0,
    d3_competitors_cited: JSON.stringify({
      direct: opts.d3_direct ?? [],
      complementary: opts.d3_complementary ?? [],
      customer_specific: {
        competitors: opts.cs_competitors ?? [],
        brand_absent_competitors: opts.cs_brand_absent_competitors ?? [],
      },
    }),
    probe_run_id: 'test-run',
    status: 'success',
    error_message: null,
    http_status: 200,
    timestamp: opts.timestamp ?? 1715600000,
  };
}

const PERIOD_START = 1715000000;
const PERIOD_END = 1718000000;

// AC-13: Astrant baseline branch — reads direct/complementary; ignores customer_specific
{
  const rows = [
    makeRow({d1a: 1, d3_direct: ['Profound', 'HubSpot AEO Grader'], cs_brand_absent_competitors: ['ShouldNotAppear']}),
    makeRow({d1a: 1, d3_direct: ['Profound'], cs_brand_absent_competitors: ['ShouldNotAppear']}),
    makeRow({d1b: 1, d3_direct: ['HubSpot AEO Grader'], cs_brand_absent_competitors: ['ShouldNotAppear']}),
  ];
  const data: any = computeDigestData(rows, PERIOD_START, PERIOD_END, true /* isAstrantBaseline */);
  const competitorNames = (data.competitors ?? []).map((c: any) => c.name);
  assert(competitorNames.includes('Profound'), 'AC-13a: Astrant branch reads direct (Profound)');
  assert(competitorNames.includes('HubSpot AEO Grader'), 'AC-13b: Astrant branch reads direct (HubSpot AEO Grader)');
  assert(!competitorNames.includes('ShouldNotAppear'), 'AC-13c: Astrant branch IGNORES customer_specific.brand_absent_competitors');
}

// AC-14: Customer branch — reads customer_specific.brand_absent_competitors; ignores direct/complementary
{
  const rows = [
    makeRow({customer_id: 'cust1', d1d: 1, d3_direct: ['ShouldNotAppear'], cs_brand_absent_competitors: ['Mailchimp']}),
    makeRow({customer_id: 'cust1', d1d: 1, d3_direct: ['ShouldNotAppear'], cs_brand_absent_competitors: ['ConvertKit']}),
    makeRow({customer_id: 'cust1', d1c: 1, d3_direct: ['ShouldNotAppear'], cs_brand_absent_competitors: ['Mailchimp']}),
  ];
  const data: any = computeDigestData(rows, PERIOD_START, PERIOD_END, false /* isAstrantBaseline */);
  const competitorNames = (data.competitors ?? []).map((c: any) => c.name);
  assert(competitorNames.includes('Mailchimp'), 'AC-14a: Customer branch reads brand_absent_competitors (Mailchimp)');
  assert(competitorNames.includes('ConvertKit'), 'AC-14b: Customer branch reads brand_absent_competitors (ConvertKit)');
  assert(!competitorNames.includes('ShouldNotAppear'), 'AC-14c: Customer branch IGNORES direct/complementary');
}

// AC-15: Customer cite-share derives from d1c||d1d (NOT d1a||d1b)
{
  const rows = [
    makeRow({customer_id: 'cust1', d1c: 1, d1d: 0, d1a: 0, d1b: 0, provider: 'openai', prompt_id: 'p1', timestamp: 1715600000}),
    makeRow({customer_id: 'cust1', d1c: 1, d1d: 0, d1a: 0, d1b: 0, provider: 'openai', prompt_id: 'p1', timestamp: 1715600001}),
    makeRow({customer_id: 'cust1', d1c: 1, d1d: 0, d1a: 0, d1b: 0, provider: 'openai', prompt_id: 'p1', timestamp: 1715600002}),
  ];
  const data: any = computeDigestData(rows, PERIOD_START, PERIOD_END, false);
  assert(data.headline_cite_share > 0, 'AC-15: customer branch cite-share derives from d1c (d1a/d1b=0)');
}

// AC-15.5: Customer branch — d1c+d1d null → cite_share === 0 (verify NOT falling through to d1a/d1b)
{
  const rows = [
    makeRow({customer_id: 'cust1', d1c: null, d1d: null, d1a: 1, d1b: 1, provider: 'openai', prompt_id: 'p1', timestamp: 1715600010}),
    makeRow({customer_id: 'cust1', d1c: null, d1d: null, d1a: 1, d1b: 1, provider: 'openai', prompt_id: 'p1', timestamp: 1715600011}),
    makeRow({customer_id: 'cust1', d1c: null, d1d: null, d1a: 1, d1b: 1, provider: 'openai', prompt_id: 'p1', timestamp: 1715600012}),
  ];
  const data: any = computeDigestData(rows, PERIOD_START, PERIOD_END, false);
  assert(data.headline_cite_share === 0, 'AC-15.5: customer branch does NOT fall through to d1a/d1b when d1c/d1d null');
}

// AC-16: Astrant baseline cite-share derives from d1a||d1b (regression check)
{
  const rows = [
    makeRow({d1a: 1, d1b: 0, d1c: null, d1d: null, provider: 'openai', prompt_id: 'p1', timestamp: 1715600020}),
    makeRow({d1a: 1, d1b: 0, d1c: null, d1d: null, provider: 'openai', prompt_id: 'p1', timestamp: 1715600021}),
    makeRow({d1b: 1, d1a: 0, d1c: null, d1d: null, provider: 'openai', prompt_id: 'p1', timestamp: 1715600022}),
  ];
  const data: any = computeDigestData(rows, PERIOD_START, PERIOD_END, true);
  assert(data.headline_cite_share > 0, 'AC-16: Astrant baseline cite-share derives from d1a/d1b');
}

// AC-17: Customer branch with empty customer_specific
{
  const rows = [
    makeRow({customer_id: 'cust1', d1d: 0, cs_brand_absent_competitors: [], cs_competitors: []}),
    makeRow({customer_id: 'cust1', d1d: 0, cs_brand_absent_competitors: [], cs_competitors: []}),
  ];
  const data: any = computeDigestData(rows, PERIOD_START, PERIOD_END, false);
  const competitorNames = (data.competitors ?? []).map((c: any) => c.name);
  assert(competitorNames.length === 0, 'AC-17: empty customer_specific → empty competitor rollup');
}

// Summary
console.log(`\nResults: ${passCount} pass, ${failCount} fail`);
if (failCount > 0) {
  process.exit(1);
}
