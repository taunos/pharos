// Outreach slice (spec §6.2 item 2): Service-Binding-only RPC entrypoint used
// by pharos-outreach. A WorkerEntrypoint named export is reachable only
// through a Service Binding, never over HTTP on scanner.astrant.io.
//
// scan(url): free tier, no email, NO rate-limit call, NO KV cache read/write,
// writes `source='outreach'` (requires migration 0005), throws if the D1
// insert fails.
// deleteScan(id): deletes only rows with source='outreach', so it can never
// touch a customer or public scan.
import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env, ScanResult } from "./types";
import { runScan } from "./run-scan";

// SSRF guard for the RPC path: public https hosts on 443 only. No IP literals,
// no localhost/private-use suffixes, no punycode, no credentials, no ports.
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME_RE = new RegExp(`^(?:${LABEL}\\.)+[a-z]{2,63}$`);
const BLOCKED_SUFFIXES = ["localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "private", "test", "example", "invalid", "onion", "arpa"];

export function assertProspectUrl(url: unknown): string {
  if (typeof url !== "string" || url.length > 2048) throw new Error("INVALID_URL");
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("INVALID_URL");
  }
  if (u.protocol !== "https:") throw new Error("INVALID_URL");
  if (u.username || u.password) throw new Error("INVALID_URL");
  if (u.port !== "" && u.port !== "443") throw new Error("INVALID_URL");
  const h = u.hostname;
  if (!HOSTNAME_RE.test(h) || h.split(".").some((l) => l.startsWith("xn--"))) throw new Error("INVALID_URL");
  if (BLOCKED_SUFFIXES.some((s) => h === s || h.endsWith("." + s))) throw new Error("INVALID_URL");
  return u.toString();
}

export async function prospectScan(env: Env, url: unknown): Promise<ScanResult> {
  const target = assertProspectUrl(url);
  return runScan(env, target, "free", {
    useCache: false,
    throwOnInsertFail: true,
    source: "outreach",
  });
}

export const DELETE_OUTREACH_SCAN_SQL = `DELETE FROM scans WHERE id = ? AND source = 'outreach'`;

export async function prospectDeleteScan(env: Env, id: unknown): Promise<{ deleted: number }> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("INVALID_SCAN_ID");
  const r = await env.DB.prepare(DELETE_OUTREACH_SCAN_SQL).bind(id).run();
  return { deleted: Number(r.meta?.changes ?? 0) };
}

export class ProspectScan extends WorkerEntrypoint<Env> {
  async scan(url: string): Promise<ScanResult> {
    return prospectScan(this.env, url);
  }
  async deleteScan(id: string): Promise<{ deleted: number }> {
    return prospectDeleteScan(this.env, id);
  }
}
