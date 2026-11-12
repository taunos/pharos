import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { constantTimeEqual } from "@/lib/dodo";
import { publicOrigin } from "@/lib/origin";
import {
  readAuditSession,
  runAuditFulfillment,
  writeAuditSession,
  type AuditRunEnv,
} from "@/lib/audit-fulfill-run";
import { updateFunnelStatus } from "@/lib/audit-funnel";
import { errorClass, releaseApAuditClaim } from "@/lib/audit-fulfill-queue-consumer";
import type { FulfillMessage } from "@/lib/fulfill-queue-consumer";
import type { AuditFulfillMessage } from "@/lib/audit-fulfill-queue-consumer";

// Test C-A (A3): thin operator-replay wrapper. Paid standalone Audits are
// fulfilled by the AUDIT_FULFILL_QUEUE consumer, and (Slice Q) so is the ap-
// (onboarding) welcome audit; this route stays for operator replay. The run
// itself lives in lib/audit-fulfill-run.ts. Slice Q (Q4): impl-day ids are
// enqueued onto astrant-fulfill (kind "impl_day") and run by its consumer
// (lib/impl-day-audit-run.ts) instead of inside this request.
type FulfillEnv = AuditRunEnv & {
  PUBLIC_ORIGIN?: string;
  FULFILL_QUEUE?: Queue<FulfillMessage>;
  AUDIT_FULFILL_QUEUE?: Queue<AuditFulfillMessage>;
};

// F2 v6.1 D19 — parse `impl-day{30|60|90}-impl-{dodo_payment_id}` shape.
// Returns {day_n, f2_session_id} where f2_session_id is the underlying
// implementation_sessions row's PRIMARY KEY (also `impl-{dodo_payment_id}` shape).
function parseImplementationAuditSessionId(
  sessionId: string,
): { day_n: 30 | 60 | 90; f2_session_id: string } | null {
  const match = sessionId.match(/^impl-day(30|60|90)-(impl-[A-Za-z0-9_-]+)$/);
  if (!match) return null;
  return {
    day_n: parseInt(match[1], 10) as 30 | 60 | 90,
    f2_session_id: match[2],
  };
}

export const maxDuration = 300;

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as FulfillEnv;

  const provided = req.headers.get("x-internal-fulfill-key");
  // F-03: constant-time comparison to deny timing-side-channel inference
  // of the secret. Length-mismatch short-circuits to false in the helper.
  if (
    !env.INTERNAL_FULFILL_KEY ||
    !provided ||
    !constantTimeEqual(provided, env.INTERNAL_FULFILL_KEY)
  ) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const sessionId =
    body && typeof body === "object" && typeof (body as { session_id?: unknown }).session_id === "string"
      ? ((body as { session_id: string }).session_id)
      : "";
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "session_id required" },
      { status: 400 }
    );
  }

  // F2 v6.1 D19 — discriminator BEFORE SESSIONS.get (per Codex HIGH v3 fold).
  // F2 day-N audit session_ids have shape `impl-day{30|60|90}-impl-{dodo_payment_id}`;
  // they don't exist in SESSIONS KV (records live in implementation_sessions D1 table).
  const implAudit = parseImplementationAuditSessionId(sessionId);
  if (implAudit !== null) {
    // Slice Q (Q4): 202 on enqueue (the citation-tracking cron treats it as
    // resp.ok); 503 on a send failure, so fired_at stays NULL and the next
    // daily sweep re-sends.
    try {
      if (!env.FULFILL_QUEUE) throw new Error("FULFILL_QUEUE binding missing");
      await env.FULFILL_QUEUE.send({
        kind: "impl_day",
        f2_session_id: implAudit.f2_session_id,
        day_n: implAudit.day_n,
      });
    } catch (err) {
      console.error(
        `F2_DAYN_ENQUEUE_FAILED session_id=${implAudit.f2_session_id} day_n=${implAudit.day_n} class=${errorClass(err)}`,
      );
      return NextResponse.json({ ok: false, error: "enqueue failed" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, enqueued: true }, { status: 202 });
  }

  try {
    // onCap "partial": pre-C-A behaviour on this path — when the Dim 6 daily
    // cap is hit, ship `ready` with Dim 6 n/a instead of deferring.
    const result = await runAuditFulfillment(env, sessionId, new URL(req.url).origin, {
      onCap: "partial",
      // An HTTP request has no enforced wall time, so it may not write a
      // review-held report (the generation lease assumes a bounded writer).
      mayGenerateHeld: false,
    });
    switch (result.kind) {
      case "not_found":
        return NextResponse.json(
          { ok: false, error: "session not found" },
          { status: 404 }
        );
      case "not_yet_paid":
      case "noop_terminal":
        return NextResponse.json(
          {
            ok: false,
            error: `session not in fulfilling state (status=${result.kind === "not_yet_paid" ? "awaiting_payment" : result.status})`,
          },
          { status: 400 }
        );
      case "held_requires_queue":
        // Review-held order: hand the run to the queue consumer instead.
        if (!env.AUDIT_FULFILL_QUEUE) {
          return NextResponse.json({ ok: false, error: "queue_not_bound" }, { status: 503 });
        }
        try {
          await env.AUDIT_FULFILL_QUEUE.send({ session_id: sessionId, origin: publicOrigin(env, req) });
        } catch (err) {
          // No state change: a failed hand-off must not mark the order `error`.
          console.error(`AUDIT_REVIEW_HELD_ENQUEUE_FAILED session_id=${sessionId} class=${errorClass(err)}`);
          return NextResponse.json({ ok: false, error: "enqueue failed" }, { status: 503 });
        }
        return NextResponse.json({ ok: true, enqueued: true, review_held: true }, { status: 202 });
      case "generation_in_progress":
        return NextResponse.json(
          { ok: false, error: "review-held report generation in progress; retry after the lease" },
          { status: 409 }
        );
      case "cap_deferred":
        // Unreachable under onCap "partial"; kept for exhaustiveness.
        console.error(`[audit-fulfill] session=${sessionId} dim6 daily cap reached; deferred`);
        return NextResponse.json(
          { ok: false, error: "dim6_cap_deferred" },
          { status: 503 }
        );
      case "done":
        return NextResponse.json({
          ok: true,
          session_id: sessionId,
          composite_score: result.composite_score,
          grade: result.grade,
          gap_count: result.gap_count,
        });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[audit-fulfill] session=${sessionId} failed: ${message}`
    );
    // Today's behaviour for the operator / ap- path: mark the session `error`.
    // A `ready` session (email-step failure) is never downgraded.
    const record = await readAuditSession(env, sessionId).catch(() => null);
    if (record && record.status !== "ready") {
      await writeAuditSession(env, {
        ...record,
        status: "error",
        error_message: message.slice(0, 500),
      }).catch(() => {});
      await updateFunnelStatus(env.SESSIONS, sessionId, "failed");
      // Slice Q fix round (A5 on the replay path): an ap- welcome audit that
      // ends in `error` releases subscriptions.audit_fired_at so a resubmit
      // re-fires it. Best-effort, like the error write above.
      await releaseApAuditClaim(env, sessionId).catch(() => {});
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
