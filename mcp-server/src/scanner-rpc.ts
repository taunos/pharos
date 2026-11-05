// E8 (code-quality audit 2026-11-05): score_url reaches the scanner through a
// Service Binding to pharos-scanner's ScanRpc entrypoint (wrangler.jsonc
// "services"), passing the end-user IP this Worker saw, so each MCP user gets
// their own scan budget instead of all sharing this Worker's address.

/** pharos-scanner ScanRpc.scan: the status + JSON body POST /api/scan would give. */
export interface ScanRpcBinding {
  scan(url: string, clientIp: string): Promise<{ status: number; body: unknown }>;
}

export const SCANNER_BINDING_MISSING = "SCANNER_BINDING_MISSING";

/**
 * Fails closed: without the binding, throws (score_url reports an error)
 * rather than falling back to an unkeyed HTTP scan. A missing client IP is
 * passed as "" and the scanner refuses it.
 */
export async function requestScan(
  scanner: ScanRpcBinding | undefined,
  url: string,
  clientIp: string | null,
  timeoutMs = 120_000
): Promise<{ status: number; body: unknown }> {
  if (!scanner || typeof scanner.scan !== "function") throw new Error(SCANNER_BINDING_MISSING);
  // A hung scanner must not hang the agent's tool call.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
      timeoutMs
    );
  });
  try {
    return await Promise.race([scanner.scan(url, clientIp ?? ""), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
