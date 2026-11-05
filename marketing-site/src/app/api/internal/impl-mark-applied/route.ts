// Implementation verification report v1 — POST /api/internal/impl-mark-applied
//
// Operator-only. Marks a delivered Implementation (status 'awaiting_application')
// as applied: runs the acceptance checks, stores the Day-0 verification record
// and anchors Day-30/60/90 on applied_at (lib/impl-verification.ts). Idempotent:
// a repeat call answers already_applied and writes nothing.
// Auth: x-internal-fulfill-key = INTERNAL_FULFILL_KEY (same as /api/impl-fulfill).
// Body: { "session_id": "impl-<dodo_payment_id>" }

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { constantTimeEqual } from "@/lib/dodo";
import { markImplementationApplied, type ImplVerificationEnv } from "@/lib/impl-verification";
import { loadImplVerifier } from "@/lib/impl-verify-adapter";

export const dynamic = "force-dynamic";

const IMPL_ID_RE = /^impl-[A-Za-z0-9_-]+$/;

interface MarkAppliedEnv extends ImplVerificationEnv {
  INTERNAL_FULFILL_KEY: string;
}

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as MarkAppliedEnv;
  const provided = req.headers.get("x-internal-fulfill-key");
  if (!env.INTERNAL_FULFILL_KEY || !provided || !constantTimeEqual(provided, env.INTERNAL_FULFILL_KEY)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: { session_id?: unknown };
  try {
    body = (await req.json()) as { session_id?: unknown };
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!IMPL_ID_RE.test(sessionId)) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const result = await markImplementationApplied(env, sessionId, "operator", { verifier: loadImplVerifier() });
  switch (result.kind) {
    case "applied":
      return NextResponse.json({ ok: true, applied_at: result.applied_at, checks: result.checks });
    case "already_applied":
      return NextResponse.json({ ok: true, deduped: true, applied_at: result.applied_at });
    case "not_verified":
      return NextResponse.json({ ok: false, error: "NOT_VERIFIED", checks: result.checks }, { status: 409 });
    case "not_found":
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    case "wrong_status":
      return NextResponse.json({ ok: false, error: "WRONG_STATUS", status: result.status }, { status: 409 });
    case "bundle_expired":
      return NextResponse.json({ ok: false, error: "BUNDLE_EXPIRED" }, { status: 409 });
    case "patch_missing":
      return NextResponse.json({ ok: false, error: "PATCH_MISSING" }, { status: 409 });
    case "verifier_unavailable":
      return NextResponse.json({ ok: false, error: "VERIFIER_UNAVAILABLE" }, { status: 503 });
  }
}
