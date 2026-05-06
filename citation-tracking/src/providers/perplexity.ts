const MODEL = 'sonar';

export interface ProbeResult {
  status: 'success' | 'rate_limit' | 'timeout' | 'error';
  http_status?: number;
  response_text?: string;
  error_message?: string;
}

interface CallResult {
  status: number;
  body: any;
  retryAfterSeconds: number | null;
}

async function callPerplexity(promptText: string, apiKey: string): Promise<CallResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: promptText }],
        temperature: 0,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
    const body = await response.json();
    return { status: response.status, body, retryAfterSeconds };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function probePerplexity(promptText: string, apiKey: string): Promise<ProbeResult> {
  try {
    const first = await callPerplexity(promptText, apiKey);
    if (first.status === 200) {
      return {
        status: 'success',
        http_status: 200,
        response_text: first.body.choices?.[0]?.message?.content ?? '',
      };
    }
    if (first.status === 429 || first.status >= 500) {
      const delayMs = (first.retryAfterSeconds && !isNaN(first.retryAfterSeconds))
        ? Math.min(first.retryAfterSeconds * 1000, 60000)
        : 5000;
      await new Promise(r => setTimeout(r, delayMs));
      const second = await callPerplexity(promptText, apiKey);
      if (second.status === 200) {
        return {
          status: 'success',
          http_status: 200,
          response_text: second.body.choices?.[0]?.message?.content ?? '',
        };
      }
      return {
        status: second.status === 429 ? 'rate_limit' : 'error',
        http_status: second.status,
        error_message: JSON.stringify(second.body).substring(0, 500),
      };
    }
    return {
      status: 'error',
      http_status: first.status,
      error_message: JSON.stringify(first.body).substring(0, 500),
    };
  } catch (e: any) {
    if (e.name === 'AbortError') return { status: 'timeout', error_message: 'Request timed out after 60s' };
    return { status: 'error', error_message: e.message };
  }
}
