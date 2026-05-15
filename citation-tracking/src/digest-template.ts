import { CITATION_TRACKING_VERSION, OQ_H_BASELINE_END } from './version';

export const TREND_FIRST_DIGEST = '*Insufficient data for trend analysis; this is the first digest. Comparisons against prior months will appear from the second digest onward.*';

const D2_NO_HITS_ASTRANT_TEXT = '*No coined-term mentions detected this period. D2 axis fires only when an agent surfaces "citation-confabulation methodology" without explicit Astrant cite — a deeper-ingestion-but-incomplete-attribution signal that builds slowly.*';

const D2_EXPLAINER_ASTRANT_TEXT = '*D2 axis fires when an agent surfaces "citation-confabulation methodology" without explicit Astrant cite — a deeper-ingestion-but-incomplete-attribution signal that builds slowly. Non-zero D2 with 0% D1 cite-share indicates terminology penetration ahead of brand attribution.*';

const D2_CUSTOMER_PLACEHOLDER_TEXT = '*D2 vocabulary-association axis: pending per-customer methodology configuration (v1.1+).*';

export const AXIS_NO_CITES = '*No cites detected in this axis this period.*';

export function BRAND_BASELINE_ZERO_TEMPLATE(brand: string, _periodStart: number): string {
  return `*${brand} cite-share this month: 0%. Baseline phase — model-side cite-share signal not yet detected. Per the methodology, the baseline window precedes threshold-lock; once baseline cite-share patterns are established, subsequent cite-share emergence is measured against them.*`;
}

// F3 D10: first-month digest prose note. Activated when subscribedAt falls within the
// current digest period (customer onboarded mid-period). Astrant skips (subscribedAt=null).
export function FIRST_MONTH_NOTE_TEMPLATE(periodStart: number, periodEnd: number, _brand: string): string {
  const daysCovered = Math.floor((periodEnd - periodStart) / (24 * 60 * 60));
  const monthName = new Date(periodStart * 1000).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `*First-month digest. Data covers ${daysCovered} days of ${monthName}. Your next monthly digest will cover a full month.*`;
}

function renderHeadlineCiteShare(headlineShare: number, periodStart: number, brand: string): string {
  if (headlineShare === 0 && periodStart < OQ_H_BASELINE_END) {
    return BRAND_BASELINE_ZERO_TEMPLATE(brand, periodStart);
  }
  return `${brand} cite-share this month: ${(headlineShare * 100).toFixed(1)}%`;
}

function fmtUtcDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function fmtPeriodLabel(periodStart: number, periodEnd: number): string {
  const startDate = new Date(periodStart * 1000);
  const monthName = startDate.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = startDate.getUTCFullYear();
  const startDay = startDate.getUTCDate();
  const endDate = new Date((periodEnd - 1) * 1000);
  const endDay = endDate.getUTCDate();
  const daysCount = Math.round((periodEnd - periodStart) / 86400);
  const isFullMonth = startDay === 1;
  if (isFullMonth) {
    return `${monthName} ${year} (full month, ${daysCount} days)`;
  }
  return `${monthName} ${year} (partial — ${fmtUtcDate(periodStart)} through ${fmtUtcDate(periodEnd - 1)} = ${daysCount} days; subsequent digests cover full calendar months)`;
}

export interface ProviderRollup {
  provider: string;
  observations: number;
  cited_observations: number;
  cite_share: number;
  d1a_count: number;
  d1b_count: number;
  d2_count: number;
  partial_coverage_count: number;
  error_count: number;
  rate_limit_count: number;
  timeout_count: number;
}

export interface PromptRollup {
  prompt_id: string;
  axis: string;
  observations: number;
  cited_observations: number;
}

export interface AxisRollup {
  axis: string;
  observations: number;
  cited_observations: number;
  cite_share: number;
}

export interface CompetitorRollup {
  name: string;
  cites: number;
  is_complementary: boolean;
}

export interface ModelDeprecationFlag {
  provider: string;
  day: string;
  error_404_count: number;
  total_count: number;
  error_404_rate: number;
}

export interface SingleProviderOnlyFlag {
  prompt_id: string;
  axis: string;
  only_provider: string;
}

export interface DigestData {
  period_start: number;
  period_end: number;
  generated_at: number;
  total_probes: number;
  validated_probes: number;
  partial_coverage_count: number;
  partial_coverage_rate: number;
  headline_cite_share: number;
  per_provider: ProviderRollup[];
  per_axis: AxisRollup[];
  per_prompt_with_cites: PromptRollup[];
  d2_hits: number;
  competitors: CompetitorRollup[];
  complementary: CompetitorRollup[];
  model_deprecation_flags: ModelDeprecationFlag[];
  single_provider_only_flags: SingleProviderOnlyFlag[];
}

export function renderDigest(d: DigestData, brand: string, subscribedAt: number | null): string {
  const lines: string[] = [];

  lines.push(`# Citation-Tracking Digest — ${fmtPeriodLabel(d.period_start, d.period_end)}`);
  lines.push('');
  lines.push(`*Internal instrumentation report. Baseline measurement phase — no success/failure determination per OQ-H methodology until threshold-lock derives from baseline cite-share distribution.*`);
  lines.push('');

  // F3 D10: first-month-note. Fires only when subscribedAt falls within this digest period
  // (i.e., customer subscribed mid-period). Astrant case passes subscribedAt=null; skipped.
  if (subscribedAt !== null && subscribedAt >= d.period_start && subscribedAt < d.period_end) {
    lines.push(FIRST_MONTH_NOTE_TEMPLATE(subscribedAt, d.period_end, brand));
    lines.push('');
  }

  lines.push('## 1. Top-of-document warnings');
  lines.push('');
  const warnings: string[] = [];
  if (d.model_deprecation_flags.length > 0) {
    for (const f of d.model_deprecation_flags) {
      warnings.push(`- **MODEL DEPRECATION**: ${f.provider} returned HTTP 404 on ${(f.error_404_rate * 100).toFixed(0)}% of calls on ${f.day} (${f.error_404_count}/${f.total_count}). Per OQ-M, this signals model-identifier deprecation; verify locked model identifier in providers/${f.provider}.ts.`);
    }
  }
  if (d.partial_coverage_rate > 0.1) {
    warnings.push(`- **PARTIAL-COVERAGE RATE ALERT**: ${(d.partial_coverage_rate * 100).toFixed(1)}% of probe rows hit \`partial_coverage\` status (>10% threshold). Per OQ-K-2, the cross-provider headline KPI excludes these rows; per-provider trends remain analyzable but should be read with the elevated partial-coverage context.`);
  }
  if (d.single_provider_only_flags.length > 0) {
    warnings.push(`- **SINGLE-PROVIDER-ONLY SIGNAL FLAGS** (${d.single_provider_only_flags.length}): per OQ-I Mitigation 2, signals present on only one of 4 providers are flagged as low-confidence. See per-provider section for detail.`);
  }
  if (warnings.length === 0) {
    lines.push('*No warnings this period.*');
  } else {
    lines.push(...warnings);
  }
  lines.push('');

  lines.push('## 2. Headline KPI');
  lines.push('');
  lines.push(renderHeadlineCiteShare(d.headline_cite_share, d.period_start, brand));
  lines.push('');
  lines.push('### By axis');
  lines.push('');
  if (d.per_axis.length === 0) {
    lines.push(AXIS_NO_CITES);
  } else {
    lines.push('| Axis | Observations | Cited | Cite share |');
    lines.push('|---|---:|---:|---:|');
    for (const a of d.per_axis) {
      const display = a.cited_observations === 0
        ? AXIS_NO_CITES
        : `${(a.cite_share * 100).toFixed(1)}%`;
      lines.push(`| ${a.axis} | ${a.observations} | ${a.cited_observations} | ${display} |`);
    }
  }
  lines.push('');

  lines.push('## 3. Per-provider cite share');
  lines.push('');
  lines.push('| Provider | Observations | Cited | Cite share | Errors | Rate-limit | Timeout |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const p of d.per_provider) {
    lines.push(`| ${p.provider} | ${p.observations} | ${p.cited_observations} | ${(p.cite_share * 100).toFixed(1)}% | ${p.error_count} | ${p.rate_limit_count} | ${p.timeout_count} |`);
  }
  lines.push('');

  lines.push('## 4. Per-prompt — prompts that produced cites');
  lines.push('');
  if (d.per_prompt_with_cites.length === 0) {
    lines.push(AXIS_NO_CITES);
  } else {
    lines.push('| Prompt ID | Axis | Cite-firing observations / total |');
    lines.push('|---|---|---:|');
    for (const p of d.per_prompt_with_cites) {
      lines.push(`| ${p.prompt_id} | ${p.axis} | ${p.cited_observations}/${p.observations} |`);
    }
  }
  lines.push('');

  lines.push('## 5. Vocabulary association (D2)');
  lines.push('');
  if (brand !== 'Astrant') {
    lines.push(D2_CUSTOMER_PLACEHOLDER_TEXT);
  } else if (d.d2_hits === 0) {
    lines.push(D2_NO_HITS_ASTRANT_TEXT);
  } else {
    lines.push(`Coined-term mentions without explicit Astrant cite this period: **${d.d2_hits}**.`);
    lines.push('');
    lines.push(D2_EXPLAINER_ASTRANT_TEXT);
  }
  lines.push('');

  lines.push('## 6. Competitive context (D3)');
  lines.push('');
  const directRows = d.competitors.filter((c) => c.cites > 0);
  const compRows = d.complementary.filter((c) => c.cites > 0);
  if (directRows.length === 0 && compRows.length === 0) {
    lines.push('*No competitor cites detected this period.*');
  } else {
    if (directRows.length > 0) {
      lines.push(`### Direct competitors (${brand} absent in same response)`);
      lines.push('');
      lines.push('| Competitor | Cite-firing observations |');
      lines.push('|---|---:|');
      for (const c of directRows) {
        lines.push(`| ${c.name} | ${c.cites} |`);
      }
      lines.push('');
    }
    if (compRows.length > 0) {
      lines.push('### Complementary tools (flagged separately per OQ-D)');
      lines.push('');
      lines.push('| Tool | Cite-firing observations |');
      lines.push('|---|---:|');
      for (const c of compRows) {
        lines.push(`| ${c.name} | ${c.cites} |`);
      }
      lines.push('');
    }
  }

  lines.push('## 7. Trend (month-over-month)');
  lines.push('');
  lines.push(TREND_FIRST_DIGEST);
  lines.push('');

  lines.push('## 8. Operational health');
  lines.push('');
  lines.push(`- Total probe rows ingested this period: **${d.total_probes}**`);
  lines.push(`- Validated rows (status=success): **${d.validated_probes}**`);
  lines.push(`- Partial-coverage rows: **${d.partial_coverage_count}** (${(d.partial_coverage_rate * 100).toFixed(2)}%)`);
  lines.push('');
  lines.push('### Per-provider error breakdown');
  lines.push('');
  lines.push('| Provider | Error | Rate-limit | Timeout |');
  lines.push('|---|---:|---:|---:|');
  for (const p of d.per_provider) {
    lines.push(`| ${p.provider} | ${p.error_count} | ${p.rate_limit_count} | ${p.timeout_count} |`);
  }
  lines.push('');

  lines.push('## 9. Methodology footer');
  lines.push('');
  lines.push(`- Engine version: \`${CITATION_TRACKING_VERSION}\``);
  lines.push(`- Digest generated: ${new Date(d.generated_at * 1000).toISOString()}`);
  lines.push(`- Period: ${fmtUtcDate(d.period_start)} through ${fmtUtcDate(d.period_end - 1)} (UTC, half-open interval)`);
  lines.push(`- Cross-provider headline KPI uses OQ-I Mitigation 1 equal weighting; OQ-K-2 validity threshold (3-of-4 providers) applies.`);
  lines.push(`- Replicates collapsed via OQ-J majority-cite rule (≥2 of 3 replicates per provider/prompt/day fired the cite axis → day-level cite_present=1).`);

  return lines.join('\n') + '\n';
}
