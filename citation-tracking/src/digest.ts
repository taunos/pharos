import type { Env } from './index';
import {
  renderDigest,
  type DigestData,
  type ProviderRollup,
  type AxisRollup,
  type PromptRollup,
  type CompetitorRollup,
  type ModelDeprecationFlag,
  type SingleProviderOnlyFlag,
} from './digest-template';
import { CITATION_TRACKING_VERSION } from './version';

const PROVIDERS = ['openai', 'anthropic', 'perplexity', 'gemini'] as const;

interface ProbeRow {
  timestamp: number;
  provider: string;
  prompt_id: string;
  prompt_axis: string;
  d1a_url_cite: number;
  d1b_brand_mention: number;
  d2_term_of_art: number;
  d3_competitors_cited: string | null;
  status: string;
  http_status: number | null;
  d1c_customer_url_cite?: number | null;
  d1d_customer_brand_mention?: number | null;
}

export async function aggregateAndRender(
  env: Env,
  periodStart: number,
  periodEnd: number,
  customerId: string | null,
  brand: string,
  subscribedAt: number | null,
): Promise<string> {
  const result = customerId === null
    ? await env.DB.prepare(`
        SELECT timestamp, provider, prompt_id, prompt_axis,
               d1a_url_cite, d1b_brand_mention, d2_term_of_art, d3_competitors_cited,
               d1c_customer_url_cite, d1d_customer_brand_mention,
               status, http_status
        FROM probe_runs
        WHERE timestamp >= ? AND timestamp < ? AND customer_id IS NULL
      `).bind(periodStart, periodEnd).all<ProbeRow>()
    : await env.DB.prepare(`
        SELECT timestamp, provider, prompt_id, prompt_axis,
               d1a_url_cite, d1b_brand_mention, d2_term_of_art, d3_competitors_cited,
               d1c_customer_url_cite, d1d_customer_brand_mention,
               status, http_status
        FROM probe_runs
        WHERE timestamp >= ? AND timestamp < ? AND customer_id = ?
      `).bind(periodStart, periodEnd, customerId).all<ProbeRow>();

  // F4.1.2c D13: isAstrantBaseline determined from customerId (canonical at digest layer).
  const isAstrantBaseline = customerId === null;

  // Subs-V2 D13: gap-intelligence entitlement gate. aggregateAndRender is the sole
  // production funnel to computeDigestData (all four render paths reach it), so the
  // signal is resolved once here. Keyed on current probe_cadence='daily' (the Pro
  // proxy already present in this Worker — no cross-Worker product-id dependency,
  // Bruno lock #16). status='active' guards operator-preview of stale rows.
  let gapEligible = false;
  if (customerId !== null) {
    const t = await env.DB.prepare(
      `SELECT probe_cadence FROM customer_probe_targets WHERE customer_id = ? AND status = 'active'`
    ).bind(customerId).first<{ probe_cadence: string }>();
    gapEligible = t?.probe_cadence === 'daily';
  }

  const data = computeDigestData(result.results ?? [], periodStart, periodEnd, isAstrantBaseline, gapEligible);
  return renderDigest(data, brand, subscribedAt);
}

export async function runMonthlyDigest(
  env: Env,
  periodStart: number,
  periodEnd: number,
  customerId: string | null,
  brand: string,
  subscribedAt: number | null,
): Promise<{ row_id: number; period_start: number; period_end: number; generated_at: number; markdown: string }> {
  const markdown = await aggregateAndRender(env, periodStart, periodEnd, customerId, brand, subscribedAt);
  const generated_at = Math.floor(Date.now() / 1000);

  const writeResult = await env.DB.prepare(`
    INSERT OR REPLACE INTO digests (period_start, period_end, generated_at, markdown, digest_version, customer_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(periodStart, periodEnd, generated_at, markdown, CITATION_TRACKING_VERSION, customerId).run();

  const row_id = (writeResult.meta?.last_row_id ?? 0) as number;
  return { row_id, period_start: periodStart, period_end: periodEnd, generated_at, markdown };
}

export async function computeDefaultPeriod(env: Env): Promise<{ periodStart: number; periodEnd: number }> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();

  const nominalMonthStart = Math.floor(Date.UTC(year, monthIndex, 1) / 1000);
  const periodEnd = Math.floor(Date.UTC(year, monthIndex + 1, 1) / 1000);

  const minTsRow = await env.DB.prepare('SELECT MIN(timestamp) AS min_ts FROM probe_runs').first<{ min_ts: number | null }>();
  const minTsTruncated = minTsRow?.min_ts ? Math.floor(minTsRow.min_ts / 86400) * 86400 : nominalMonthStart;
  const periodStart = Math.max(nominalMonthStart, minTsTruncated);

  return { periodStart, periodEnd };
}

interface DayLevelObservation {
  provider: string;
  prompt_id: string;
  prompt_axis: string;
  day: number;
  cite_present: number;
  d2_present: number;
  d1a_present: number;
  d1b_present: number;
  competitors_present: Set<string>;
  complementary_present: Set<string>;
  gap_competitors_present: Set<string>;
}

export function computeDigestData(
  rows: ProbeRow[],
  periodStart: number,
  periodEnd: number,
  isAstrantBaseline: boolean,
  gapEligible: boolean,
): DigestData {
  const generated_at = Math.floor(Date.now() / 1000);
  const total_probes = rows.length;
  const validated_probes = rows.filter((r) => r.status === 'success').length;
  const partial_coverage_count = rows.filter((r) => r.status === 'partial_coverage').length;
  const partial_coverage_rate = total_probes > 0 ? partial_coverage_count / total_probes : 0;

  const groups: Map<string, ProbeRow[]> = new Map();
  for (const row of rows) {
    if (row.status === 'partial_coverage') continue;
    const day = Math.floor(row.timestamp / 86400);
    const key = `${row.provider}|${row.prompt_id}|${day}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const dayObs: DayLevelObservation[] = [];
  for (const [key, groupRows] of groups.entries()) {
    const parts = key.split('|');
    const provider = parts[0];
    const prompt_id = parts[1];
    const day = parseInt(parts[2], 10);
    const promptAxis = groupRows[0].prompt_axis;

    // F4.1.2c D13/D14: cite-share signal swap per audience.
    // Astrant baseline uses d1a||d1b (Astrant URL/brand); customer rows use d1c||d1d (per-customer URL/brand).
    const citeReplicates = isAstrantBaseline
      ? groupRows.filter((r) => r.d1a_url_cite === 1 || r.d1b_brand_mention === 1).length
      : groupRows.filter((r) => r.d1c_customer_url_cite === 1 || r.d1d_customer_brand_mention === 1).length;
    const d2Replicates = groupRows.filter((r) => r.d2_term_of_art === 1).length;
    const d1aReplicates = groupRows.filter((r) => r.d1a_url_cite === 1).length;
    const d1bReplicates = groupRows.filter((r) => r.d1b_brand_mention === 1).length;

    // F4.1.2c D13: competitor rollup sub-bucket swap per audience.
    // Astrant baseline reads direct + complementary (curated AEO landscape).
    // Customer rows read customer_specific.brand_absent_competitors (matches detect.ts:93 brand-absent-only semantic).
    const competitors = new Set<string>();
    const complementary = new Set<string>();
    const gapCompetitors = new Set<string>();
    for (const r of groupRows) {
      if (!r.d3_competitors_cited) continue;
      try {
        const d3 = JSON.parse(r.d3_competitors_cited) as {
          direct?: string[];
          complementary?: string[];
          customer_specific?: { competitors?: string[]; brand_absent_competitors?: string[] };
        };
        if (isAstrantBaseline) {
          if (d3.direct) for (const c of d3.direct) competitors.add(c);
          if (d3.complementary) for (const c of d3.complementary) complementary.add(c);
        } else {
          // Subs-V2 D13: two-concept split for customer rows.
          // PRESENCE (competitors) — all tracked competitors cited; rendered for BOTH tiers.
          // GAP (gapCompetitors) — competitors cited where the brand was absent; Pro-only (gapEligible).
          if (d3.customer_specific?.competitors) {
            for (const c of d3.customer_specific.competitors) competitors.add(c);
          }
          if (gapEligible && d3.customer_specific?.brand_absent_competitors) {
            for (const c of d3.customer_specific.brand_absent_competitors) gapCompetitors.add(c);
          }
          // complementary stays empty for customer rows.
        }
      } catch (_e) {
        // malformed JSON — skip
      }
    }

    dayObs.push({
      provider,
      prompt_id,
      prompt_axis: promptAxis,
      day,
      cite_present: citeReplicates >= 2 ? 1 : 0,
      d2_present: d2Replicates >= 2 ? 1 : 0,
      d1a_present: d1aReplicates >= 2 ? 1 : 0,
      d1b_present: d1bReplicates >= 2 ? 1 : 0,
      competitors_present: competitors,
      complementary_present: complementary,
      gap_competitors_present: gapCompetitors,
    });
  }

  const per_provider: ProviderRollup[] = [];
  for (const provider of PROVIDERS) {
    const providerObs = dayObs.filter((o) => o.provider === provider);
    const observations = providerObs.length;
    const cited_observations = providerObs.filter((o) => o.cite_present === 1).length;
    const cite_share = observations > 0 ? cited_observations / observations : 0;

    const providerRows = rows.filter((r) => r.provider === provider);

    per_provider.push({
      provider,
      observations,
      cited_observations,
      cite_share,
      d1a_count: providerObs.filter((o) => o.d1a_present === 1).length,
      d1b_count: providerObs.filter((o) => o.d1b_present === 1).length,
      d2_count: providerObs.filter((o) => o.d2_present === 1).length,
      partial_coverage_count: providerRows.filter((r) => r.status === 'partial_coverage').length,
      error_count: providerRows.filter((r) => r.status === 'error').length,
      rate_limit_count: providerRows.filter((r) => r.status === 'rate_limit').length,
      timeout_count: providerRows.filter((r) => r.status === 'timeout').length,
    });
  }

  const providersWithData = per_provider.filter((p) => p.observations > 0);
  const headline_cite_share = providersWithData.length > 0
    ? providersWithData.reduce((sum, p) => sum + p.cite_share, 0) / providersWithData.length
    : 0;

  const axisMap: Map<string, { observations: number; cited_observations: number }> = new Map();
  for (const o of dayObs) {
    if (!axisMap.has(o.prompt_axis)) axisMap.set(o.prompt_axis, { observations: 0, cited_observations: 0 });
    const m = axisMap.get(o.prompt_axis)!;
    m.observations++;
    if (o.cite_present === 1) m.cited_observations++;
  }
  const per_axis: AxisRollup[] = [];
  for (const [axis, m] of axisMap.entries()) {
    per_axis.push({
      axis,
      observations: m.observations,
      cited_observations: m.cited_observations,
      cite_share: m.observations > 0 ? m.cited_observations / m.observations : 0,
    });
  }
  per_axis.sort((a, b) => a.axis.localeCompare(b.axis));

  const promptMap: Map<string, { axis: string; observations: number; cited_observations: number }> = new Map();
  for (const o of dayObs) {
    if (!promptMap.has(o.prompt_id)) promptMap.set(o.prompt_id, { axis: o.prompt_axis, observations: 0, cited_observations: 0 });
    const m = promptMap.get(o.prompt_id)!;
    m.observations++;
    if (o.cite_present === 1) m.cited_observations++;
  }
  const per_prompt_with_cites: PromptRollup[] = [];
  for (const [prompt_id, m] of promptMap.entries()) {
    if (m.cited_observations > 0) {
      per_prompt_with_cites.push({ prompt_id, axis: m.axis, observations: m.observations, cited_observations: m.cited_observations });
    }
  }
  per_prompt_with_cites.sort((a, b) => b.cited_observations - a.cited_observations);

  const d2_hits = dayObs.filter((o) => o.d2_present === 1).length;

  const competitorMap: Map<string, number> = new Map();
  const complementaryMap: Map<string, number> = new Map();
  const gapCompetitorMap: Map<string, number> = new Map();
  for (const o of dayObs) {
    for (const c of o.competitors_present) {
      competitorMap.set(c, (competitorMap.get(c) ?? 0) + 1);
    }
    for (const c of o.complementary_present) {
      complementaryMap.set(c, (complementaryMap.get(c) ?? 0) + 1);
    }
    for (const c of o.gap_competitors_present) {
      gapCompetitorMap.set(c, (gapCompetitorMap.get(c) ?? 0) + 1);
    }
  }
  const competitors: CompetitorRollup[] = [];
  for (const [name, cites] of competitorMap.entries()) {
    competitors.push({ name, cites, is_complementary: false });
  }
  competitors.sort((a, b) => b.cites - a.cites);
  const complementary: CompetitorRollup[] = [];
  for (const [name, cites] of complementaryMap.entries()) {
    complementary.push({ name, cites, is_complementary: true });
  }
  complementary.sort((a, b) => b.cites - a.cites);
  // Subs-V2 D13: gap rollup (Pro-only). Empty for Standard (gapEligible=false).
  const gap_competitors: CompetitorRollup[] = [];
  for (const [name, cites] of gapCompetitorMap.entries()) {
    gap_competitors.push({ name, cites, is_complementary: false });
  }
  gap_competitors.sort((a, b) => b.cites - a.cites);

  const promptProviderCite: Map<string, Set<string>> = new Map();
  for (const o of dayObs) {
    if (o.cite_present === 1) {
      const key = `${o.prompt_id}|${o.prompt_axis}`;
      if (!promptProviderCite.has(key)) promptProviderCite.set(key, new Set());
      promptProviderCite.get(key)!.add(o.provider);
    }
  }
  const single_provider_only_flags: SingleProviderOnlyFlag[] = [];
  for (const [key, provs] of promptProviderCite.entries()) {
    if (provs.size === 1) {
      const parts = key.split('|');
      single_provider_only_flags.push({ prompt_id: parts[0], axis: parts[1], only_provider: Array.from(provs)[0] });
    }
  }

  const dayProviderMap: Map<string, { error_404: number; total: number }> = new Map();
  for (const r of rows) {
    const day = new Date(r.timestamp * 1000).toISOString().slice(0, 10);
    const key = `${r.provider}|${day}`;
    if (!dayProviderMap.has(key)) dayProviderMap.set(key, { error_404: 0, total: 0 });
    const m = dayProviderMap.get(key)!;
    m.total++;
    if (r.status === 'error' && r.http_status === 404) m.error_404++;
  }
  const model_deprecation_flags: ModelDeprecationFlag[] = [];
  for (const [key, m] of dayProviderMap.entries()) {
    const rate = m.error_404 / m.total;
    if (rate >= 0.5) {
      const parts = key.split('|');
      model_deprecation_flags.push({ provider: parts[0], day: parts[1], error_404_count: m.error_404, total_count: m.total, error_404_rate: rate });
    }
  }

  return {
    period_start: periodStart,
    period_end: periodEnd,
    generated_at,
    total_probes,
    validated_probes,
    partial_coverage_count,
    partial_coverage_rate,
    headline_cite_share,
    per_provider,
    per_axis,
    per_prompt_with_cites,
    d2_hits,
    competitors,
    complementary,
    gap_competitors,
    gap_eligible: gapEligible,
    model_deprecation_flags,
    single_provider_only_flags,
  };
}

export async function deriveBrandForDigest(
  env: Env,
  customerId: string | null,
): Promise<
  | { ok: true; brand: string }
  | { ok: false; status: number; code: string; message: string }
> {
  if (customerId === null) {
    return { ok: true, brand: 'Astrant' };
  }
  const row = await env.DB.prepare(
    `SELECT brand_name FROM customer_probe_targets WHERE customer_id = ?`
  ).bind(customerId).first<{ brand_name: string }>();
  if (!row) {
    return {
      ok: false,
      status: 404,
      code: 'CUSTOMER_NOT_FOUND',
      message: `customer_id ${customerId} not found in customer_probe_targets`,
    };
  }
  return { ok: true, brand: row.brand_name };
}
