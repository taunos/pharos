import type { Customer } from './types';
import { CUSTOMER_TOOLS, executeTool } from './tools';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string };
}

function rpcSuccess(id: string | number | null | undefined, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: string | number | null | undefined, code: number, message: string): JsonRpcError {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function rpcResponse(body: JsonRpcSuccess | JsonRpcError, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleMcp(req: Request, customer: Customer): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return rpcResponse(rpcError(null, -32700, 'Parse error'), 400);
  }

  const { id, method, params } = body;

  if (method === 'initialize') {
    return rpcResponse(
      rpcSuccess(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: JSON.parse(customer.config_json).brand_name ?? customer.slug,
          version: '1.0',
        },
      }),
    );
  }

  if (method === 'tools/list') {
    return rpcResponse(rpcSuccess(id, { tools: CUSTOMER_TOOLS }));
  }

  if (method === 'tools/call') {
    const toolName = (params?.name as string | undefined) ?? '';
    try {
      const result = executeTool(toolName, customer);
      return rpcResponse(
        rpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      );
    } catch (e) {
      return rpcResponse(rpcError(id, -32602, `Invalid tool: ${toolName}`), 400);
    }
  }

  // Notifications (no id) — accept silently.
  if (method && (method.startsWith('notifications/') || method === 'initialized')) {
    return new Response(null, { status: 204 });
  }

  return rpcResponse(rpcError(id, -32601, `Method not found: ${method}`), 400);
}
