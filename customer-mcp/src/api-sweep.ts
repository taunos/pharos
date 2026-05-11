import type { Env } from './types';
import { requireInternalAuth } from './auth';
import { runSweep } from './sweep';

export async function handleSweep(req: Request, env: Env): Promise<Response> {
  const authFail = requireInternalAuth(req, env);
  if (authFail) return authFail;
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const result = await runSweep(env);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
