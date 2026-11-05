import type { Env } from './types';

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function requireInternalAuth(req: Request, env: Env): Response | null {
  // Fail closed with a clear status when the secret is missing (previously the
  // comparison threw a TypeError on undefined → unhandled 500).
  if (!env.INTERNAL_PROVISION_KEY) return new Response('Misconfigured', { status: 503 });
  const header = req.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return new Response('Unauthorized', { status: 401 });
  if (!constantTimeEqual(match[1], env.INTERNAL_PROVISION_KEY)) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
}
