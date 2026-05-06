import type { Env } from './index';
import { LOCKED_PROMPTS } from './prompts';
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

export async function runProbeCycle(env: Env): Promise<void> {
  try {
    console.log('[runProbeCycle] ENTER');
    const probeRunId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    console.log(`[runProbeCycle] probeRunId=${probeRunId} now=${now}`);

    const providers: ProviderSpec[] = [
      { name: 'openai',     apiKey: env.OPENAI_API_KEY,     fn: probeOpenAI },
      { name: 'anthropic',  apiKey: env.ANTHROPIC_API_KEY,  fn: probeAnthropic },
      { name: 'perplexity', apiKey: env.PERPLEXITY_API_KEY, fn: probePerplexity },
      { name: 'gemini',     apiKey: env.GEMINI_API_KEY,     fn: probeGemini },
    ];
    console.log(`[runProbeCycle] providers configured: ${providers.map(p => p.name).join(',')}`);
    console.log(`[runProbeCycle] api key lengths: openai=${env.OPENAI_API_KEY?.length ?? 'undef'} anthropic=${env.ANTHROPIC_API_KEY?.length ?? 'undef'} perplexity=${env.PERPLEXITY_API_KEY?.length ?? 'undef'} gemini=${env.GEMINI_API_KEY?.length ?? 'undef'}`);

    let batchCount = 0;
    for (const prompt of LOCKED_PROMPTS) {
      for (let replicate = 0; replicate < N_REPLICATES; replicate++) {
        batchCount++;
        console.log(`[runProbeCycle] batch ${batchCount}/45 prompt=${prompt.id} replicate=${replicate}`);
        const settled = await Promise.allSettled(
          providers.map(p => p.fn(prompt.text, p.apiKey))
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
                d3_competitors_cited, probe_run_id, status, error_message, http_status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            ).run();
          } catch (dbErr: any) {
            console.error(`[runProbeCycle] DB insert FAILED provider=${provider.name} prompt=${prompt.id}: ${dbErr?.message ?? dbErr}`);
            throw dbErr;
          }
        }
      }
    }
    console.log(`[runProbeCycle] DONE batches=${batchCount}`);
  } catch (e: any) {
    console.error(`[runProbeCycle] FATAL: ${e?.message ?? e}\n${e?.stack ?? ''}`);
    throw e;
  }
}
