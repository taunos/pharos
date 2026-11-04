// §5 suppression list (HMAC hashes) + scan-row deletion requests (§6.2).
import { domainHash, emailHash } from "./crypto";
import type { Env } from "./types";

export function suppressionSecret(env: Env): string {
  const s = env.SUPPRESSION_HMAC_SECRET;
  if (!s) throw new Error("SUPPRESSION_HMAC_SECRET_MISSING"); // fail closed
  return s;
}

export async function suppressStmts(
  env: Env,
  now: number,
  opts: { email?: string | null; domain?: string | null; reason: string }
): Promise<D1PreparedStatement[]> {
  const secret = suppressionSecret(env);
  const out: D1PreparedStatement[] = [];
  if (opts.email) {
    out.push(
      env.DB.prepare("INSERT OR IGNORE INTO suppression (hash, kind, reason, created_at) VALUES (?, 'email', ?, ?)").bind(
        await emailHash(secret, opts.email),
        opts.reason,
        now
      )
    );
  }
  if (opts.domain) {
    out.push(
      env.DB.prepare("INSERT OR IGNORE INTO suppression (hash, kind, reason, created_at) VALUES (?, 'domain', ?, ?)").bind(
        await domainHash(secret, opts.domain),
        opts.reason,
        now
      )
    );
  }
  return out;
}

export async function isSuppressed(env: Env, opts: { email?: string | null; domain: string }): Promise<boolean> {
  const secret = suppressionSecret(env);
  const hashes = [await domainHash(secret, opts.domain)];
  if (opts.email) hashes.push(await emailHash(secret, opts.email));
  const r = await env.DB.prepare(`SELECT 1 AS x FROM suppression WHERE hash IN (${hashes.map(() => "?").join(",")}) LIMIT 1`)
    .bind(...hashes)
    .first();
  return !!r;
}

export function requestScanDeletionStmt(db: D1Database, leadId: string, now: number): D1PreparedStatement {
  return db
    .prepare("UPDATE lead_scans SET delete_requested_at = COALESCE(delete_requested_at, ?) WHERE lead_id = ? AND deleted_at IS NULL")
    .bind(now, leadId);
}

/** Deletes requested scan rows via ProspectScan.deleteScan (outreach rows only). Runs in every mode. */
export async function processScanDeletions(env: Env, now: number, limit = 10): Promise<number> {
  const rows = await env.DB.prepare(
    "SELECT scan_id FROM lead_scans WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL ORDER BY delete_requested_at LIMIT ?"
  )
    .bind(limit)
    .all<{ scan_id: string }>();
  let done = 0;
  for (const r of rows.results ?? []) {
    try {
      await env.SCANNER.deleteScan(r.scan_id);
      await env.DB.prepare("UPDATE lead_scans SET deleted_at = ? WHERE scan_id = ? AND deleted_at IS NULL").bind(now, r.scan_id).run();
      done++;
    } catch (e) {
      console.error("scan_delete_failed", r.scan_id, e instanceof Error ? e.message : String(e));
    }
  }
  return done;
}
