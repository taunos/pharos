// P0-C2 Chunk F1 — POST /api/internal/r2/delete
//
// Dedicated-key-authenticated exact artifact delete, called by scanner
// reconciliation over a Service Binding. DORMANT until the binding + key are
// provisioned (no Wrangler changes in this chunk). Success is HTTP 200 only; any
// failure is non-200 so the caller never marks D1 purged on an unconfirmed delete.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { constantTimeEqual } from "@/lib/dodo";
import { deleteArtifact, R2OpError } from "@/lib/r2-reconcile-ops";

interface R2ReconcileEnv {
  AUDITS: R2Bucket;
  RECONCILE_R2_KEY?: string;
}

function authed(env: R2ReconcileEnv, provided: string | null): boolean {
  return !!env.RECONCILE_R2_KEY && !!provided && constantTimeEqual(provided, env.RECONCILE_R2_KEY);
}

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as R2ReconcileEnv;
  if (!authed(env, req.headers.get("x-internal-reconcile-key"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const key = (body as Record<string, unknown>)?.key;
  try {
    const r = await deleteArtifact(env.AUDITS, key);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof R2OpError) return NextResponse.json({ ok: false, status: "error", reason: e.code }, { status: 422 });
    console.error("[r2-reconcile] class=delete_error"); // fixed class only — no key / id
    return NextResponse.json({ ok: false, status: "error", reason: "r2_error" }, { status: 500 });
  }
}
