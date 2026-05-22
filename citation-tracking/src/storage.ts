import type { Env } from './index';
import { LOCKED_PROMPTS, renderPrompt } from './prompts';
import { detectAxes } from './detect';
import { probeOpenAI } from './providers/openai';
import { probeAnthropic } from './providers/anthropic';
import { probePerplexity } from './providers/perplexity';
import { probeGemini } from './providers/gemini';

const N_REPLICATES = 3;

interface ProviderSpec {
  name: 'openai' | 'anthropic' | 'perplexity' | 'gemini';
  apiKey: string;
  fn: (text: string, key: string) => Promise<{
    status: 'success' | 'rate_limit' | 'timeout' | 'error';
    http_status?: number;
    response_text?: string;
    error_message?: string;
  }>;
}

// D24-G1 (spec V10): extracted provider-list builder so the drain handler can reuse the same
// configuration without duplicating the runProbeCycle literal.
function buildProvidersFromEnv(env: Env): ProviderSpec[] {
  return [
    { name: 'openai',     apiKey: env.OPENAI_API_KEY,     fn: probeOpenAI },
    { name: 'anthropic',  apiKey: env.ANTHROPIC_API_KEY,  fn: probeAnthropic },
    { name: 'perplexity', apiKey: env.PERPLEXITY_API_KEY, fn: probePerplexity },
    { name: 'gemini',     apiKey: env.GEMINI_API_KEY,     fn: probeGemini },
  ];
}

// D24 (spec): exported wrapper isolating drain handler from probeOneTarget's signature surface.
// `probeSubject` corresponds to probeOneTarget's slot 6 (shipped name 'brand'; shipped-misnomer
// per H1-v4 spec). Value: literal 'Astrant' for baseline; customer's domain for customer probes
// (NEVER brand_name; see deploy-prompt C8).
export async function probeSingleTarget(
  env: Env,
  customerId: string | null,
  probeSubject: string,
  category: string,
  probeRunId: string,
): Promise<void> {
  const providers = buildProvidersFromEnv(env);
  const now = Math.floor(Date.now() / 1000);
  const debug = env.DEBUG_PROBE_LOGS === '1';
  await probeOneTarget(env, providers, probeRunId, now, customerId, probeSubject, category, debug);
}

export async function runProbeCycle(env: Env): Promise<void> {
  const DEBUG = env.DEBUG_PROBE_LOGS === '1';
  try {
    if (DEBUG) console.log('[runProbeCycle] ENTER');
    const probeRunId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    if (DEBUG) console.log(`[runProbeCycle] probeRunId=${probeRunId} now=${now}`);

    const providers: ProviderSpec[] = buildProvidersFromEnv(env);
    if (DEBUG) console.log(`[runProbeCycle] providers configured: ${providers.map(p => p.name).join(',')}`);
    if (DEBUG) console.log(`[runProbeCycle] api key lengths: openai=${env.OPENAI_API_KEY?.length ?? 'undef'} anthropic=${env.ANTHROPIC_API_KEY?.length ?? 'undef'} perplexity=${env.PERPLEXITY_API_KEY?.length ?? 'undef'} gemini=${env.GEMINI_API_KEY?.length ?? 'undef'}`);

    // Astrant probe (customer_id=NULL)
    await probeOneTarget(env, providers, probeRunId, now, null, 'Astrant', 'AEO tools', DEBUG);

    // Iterate active customer probe targets
    const activeTargets = await env.DB.prepare(
      `SELECT customer_id, domain, category, brand_name FROM customer_probe_targets WHERE status='active'`
    ).all<{ customer_id: string; domain: string; category: string; brand_name: string }>();

    for (const target of activeTargets.results ?? []) {
      await probeOneTarget(env, providers, probeRunId, now, target.customer_id, target.domain, target.category, DEBUG);
    }
  } catch (e: any) {
    console.error(`[runProbeCycle] FATAL: ${e?.message ?? e}\n${e?.stack ?? ''}`);
    throw e;
  }
}

async function probeOneTarget(
  env: Env,
  providers: ProviderSpec[],
  probeRunId: string,
  now: number,
  customerId: string | null,
  brand: string,
  category: string,
  DEBUG: boolean,
): Promise<void> {
  let batchCount = 0;
  for (const prompt of LOCKED_PROMPTS) {
    const renderedText = renderPrompt(prompt.text, brand, category);
    for (let replicate = 0; replicate < N_REPLICATES; replicate++) {
      batchCount++;
      if (DEBUG) console.log(`[runProbeCycle] target=${customerId ?? 'astrant'} batch ${batchCount}/45 prompt=${prompt.id} replicate=${replicate}`);
      const settled = await Promise.allSettled(
        providers.map(p => p.fn(renderedText, p.apiKey))
      );

      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        const s = settled[i];
        let result;
        if (s.status === 'fulfilled') {
          result = s.value;
        } else {
          const reasonStr = s.reason instanceof Error ? s.reason.message : String(s.reason);
          result = { status: 'error' as const, error_message: `Probe rejection: ${reasonStr.slice(0, 240)}` };
        }

        const detection = detectAxes(result.response_text ?? '');

        try {
          await env.DB.prepare(`
            INSERT INTO probe_runs (
              timestamp, provider, prompt_id, prompt_axis, response_excerpt,
              d1a_url_cite, d1b_brand_mention, d2_term_of_art,
              d3_competitors_cited, probe_run_id, status, error_message, http_status,
              customer_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            now,
            provider.name,
            prompt.id,
            prompt.axis,
            (result.response_text ?? '').substring(0, 2000),
            detection.d1a_url_cite,
            detection.d1b_brand_mention,
            detection.d2_term_of_art,
            JSON.stringify({
              direct: detection.d3_competitors_cited,
              complementary: detection.d3_complementary_cited,
            }),
            probeRunId,
            result.status,
            result.error_message ?? null,
            result.http_status ?? null,
            customerId,
          ).run();
        } catch (dbErr: any) {
          console.error(`[runProbeCycle] DB insert FAILED provider=${provider.name} prompt=${prompt.id} target=${customerId ?? 'astrant'}: ${dbErr?.message ?? dbErr}`);
          throw dbErr;
        }
      }
    }
  }
  if (DEBUG) console.log(`[runProbeCycle] target=${customerId ?? 'astrant'} DONE batches=${batchCount}`);
}
