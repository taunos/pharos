// Slice 2b Phase 1 — GET /api/score/<id>/state
//
// Thin proxy that the /score/[id] polling component hits. Validates the
// scan-bound token (?t=), then forwards to the scanner's authenticated
// state endpoint. Returns the same booleans (no PII).

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyScanToken } from "@/lib/score-tokens";
import { getScanState } from "@/lib/score-scanner-client";

interface StateEnv {
  UNSUBSCRIBE_SECRET: string;
  INTERNAL_SCANNER_ADMIN_KEY: string;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const env = getCloudflareContext().env as unknown as StateEnv;
  const { id: scanId } = await context.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";

  if (!token || !env.UNSUBSCRIBE_SECRET || !env.INTERNAL_SCANNER_ADMIN_KEY) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const verified = await verifyScanToken(token, env.UNSUBSCRIBE_SECRET);
  if (!verified || verified.scanId !== scanId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const state = await getScanState(env, scanId);
  if (!state.ok) {
    return NextResponse.json({ ok: false, error: state.error }, { status: 502 });
  }
  return NextResponse.json({
    pdf_ready: state.pdf_ready,
    pdf_deferred_until_tomorrow: state.pdf_deferred_until_tomorrow,
    unsubscribed: state.unsubscribed,
    deletion_requested: state.deletion_requested,
  });
}
