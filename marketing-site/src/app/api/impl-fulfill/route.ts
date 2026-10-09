// F2 v6.1 D9 — POST /api/impl-fulfill.
//
// Slice Q (Q1h): thin operator-replay wrapper. Paid Implementation orders are
// fulfilled by the astrant-fulfill Queue consumer (lib/fulfill-queue-consumer.ts,
// enqueued by /api/dodo-webhook); no producer calls this route any more. The
// run itself lives in lib/impl-fulfill-run.ts and runs here as a final attempt
// (a failure is written + alerted, never left for a retry).

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { constantTimeEqual } from "@/lib/dodo";
import { runImplFulfillment, type ImplRunEnv } from "@/lib/impl-fulfill-run";

export const maxDuration = 300;

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as ImplRunEnv;

  // Auth — constant-time compare to deny timing-side-channel inference
  const provided = req.headers.get("x-internal-fulfill-key");
  if (
    !env.INTERNAL_FULFILL_KEY ||
    !provided ||
    !constantTimeEqual(provided, env.INTERNAL_FULFILL_KEY)
  ) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: { session_id?: unknown };
  try {
    body = (await req.json()) as { session_id?: unknown };
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  let result;
  try {
    result = await runImplFulfillment(env, sessionId, { finalAttempt: true });
  } catch (err) {
    // The final-attempt failure write itself threw (alert already sent).
    console.error(
      `F2_FULFILLMENT_FAILED_FINAL_UNWRITTEN session_id=${sessionId} err=${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json({ error: "FULFILLMENT_FAILED" }, { status: 500 });
  }

  switch (result.kind) {
    case "done":
      return NextResponse.json({ ok: true, session_id: sessionId });
    case "in_flight":
    case "noop_terminal":
      return NextResponse.json({ ok: true, deduped: true });
    case "not_found":
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    case "failed_final":
      return NextResponse.json({ error: "FULFILLMENT_FAILED" }, { status: 500 });
    case "terminal_outcome":
      if (result.status === "failed_validation") {
        return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 500 });
      }
      if (result.status === "failed_ceiling") {
        return NextResponse.json({ error: "AT_CAPACITY" }, { status: 503 });
      }
      return NextResponse.json({ ok: true, status: "active_email_pending" });
  }
}
