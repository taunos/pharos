// P0-C2 Chunk F1 — POST /api/internal/r2/purge-prefix
//
// Dedicated-key-authenticated UUID-scoped prefix purge (list → delete → re-list
// from start until empty), bounded + fail-closed on overflow. DORMANT until the
// binding + key are provisioned. Success is HTTP 200 only.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { constantTimeEqual } from "@/lib/dodo";
import { purgePrefix, R2OpError } from "@/lib/r2-reconcile-ops";

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
  const prefix = (body as Record<string, unknown>)?.prefix;
  try {
    const r = await purgePrefix(env.AUDITS, prefix);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof R2OpError) {
      // bad_prefix = caller error (422); cap overflow = fail-closed halt (422).
      console.error(`[r2-reconcile] class=purge_${e.code}`);
      return NextResponse.json({ ok: false, status: "error", reason: e.code }, { status: 422 });
    }
    console.error("[r2-reconcile] class=purge_error");
    return NextResponse.json({ ok: false, status: "error", reason: "r2_error" }, { status: 500 });
  }
}
