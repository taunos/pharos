// E8 (code-quality audit 2026-11-05): Service-Binding-only RPC entrypoint for
// pharos-mcp's score_url tool. Over HTTP, pharos-mcp's subrequest carried the
// mcp Worker's own address, so every MCP user shared one scan budget. Through
// this entrypoint the caller passes the end-user IP it saw (CF-Connecting-IP
// at mcp.astrant.io) and the scan runs the same free-tier path as POST
// /api/scan: same URL validation, same burst + KV limits (E15 /64 keying),
// same cached runScan. A WorkerEntrypoint named export is reachable only
// through a Service Binding, so the public fetch handler gains no new way to
// assert an IP.
import { WorkerEntrypoint } from "cloudflare:workers";
import { z } from "zod";
import type { Env } from "./types";
import { enforceScanLimits, isIpLiteral } from "./ratelimit";
import { isSafeTargetUrl } from "./safe-fetch";
import { runScan } from "./run-scan";

// Security pass 2026-11-04: only public http(s) hosts on 80/443 (no IP
// literals, localhost/internal suffixes, single-label hosts, credentials,
// other ports). Shared with POST /api/scan's body schema.
export const scanUrlSchema = z.string().max(2048).url().refine(isSafeTargetUrl);

export const INVALID_SCAN_INPUT = "Invalid input: url must be a valid URL; email and tier optional";

/** Mirrors the HTTP response POST /api/scan would give: status + JSON body. */
export type ScanRpcResponse = { status: number; body: unknown };

export async function rpcScan(env: Env, url: unknown, clientIp: unknown): Promise<ScanRpcResponse> {
  const parsed = scanUrlSchema.safeParse(url);
  if (!parsed.success) return { status: 400, body: { ok: false, error: INVALID_SCAN_INPUT } };
  // Fail closed: no usable end-user IP means no scan, never a shared or
  // unkeyed budget.
  const ip = typeof clientIp === "string" ? clientIp.trim() : "";
  if (!isIpLiteral(ip)) return { status: 400, body: { ok: false, error: "Invalid client IP" } };

  const limited = await enforceScanLimits(env, ip, parsed.data);
  if (limited) return limited;

  const result = await runScan(env, parsed.data, "free", {
    useCache: true,
    throwOnInsertFail: false,
  });
  return { status: 200, body: result };
}

export class ScanRpc extends WorkerEntrypoint<Env> {
  async scan(url: string, clientIp: string): Promise<ScanRpcResponse> {
    return rpcScan(this.env, url, clientIp);
  }
}
