const MODEL = 'claude-sonnet-4-5';

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

async function callAnthropic(promptText: string, apiKey: string): Promise<CallResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        system: '',
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

export async function probeAnthropic(promptText: string, apiKey: string): Promise<ProbeResult> {
  try {
    const first = await callAnthropic(promptText, apiKey);
    if (first.status === 200) {
      return {
        status: 'success',
        http_status: 200,
        response_text: first.body.content?.[0]?.text ?? '',
      };
    }
    if (first.status === 429 || first.status >= 500) {
      const delayMs = (first.retryAfterSeconds && !isNaN(first.retryAfterSeconds))
        ? Math.min(first.retryAfterSeconds * 1000, 60000)
        : 5000;
      await new Promise(r => setTimeout(r, delayMs));
      const second = await callAnthropic(promptText, apiKey);
      if (second.status === 200) {
        return {
          status: 'success',
          http_status: 200,
          response_text: second.body.content?.[0]?.text ?? '',
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
