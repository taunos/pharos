// Test C-A R2-8 — POST /api/internal/audit-queue-smoke
//
// Operator-triggered synthetic Queue smoke, run in production BEFORE opening
// the Audit gate. Authenticated with INTERNAL_FULFILL_KEY (constant-time, same
// header + pattern as /api/audit-fulfill). Enqueues one message for a bogus
// session id `smoke-<uuid>`; the astrant-audit-fulfill consumer must log
// `AUDIT_FULFILL_NOOP ... reason=not_found` and ack — proving the producer →
// consumer wiring without touching any real session.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { constantTimeEqual } from "@/lib/dodo";
import { requestOrigin } from "@/lib/origin";
import type { AuditFulfillMessage } from "@/lib/audit-fulfill-queue-consumer";
import type { FulfillMessage } from "@/lib/fulfill-queue-consumer";

interface AuditQueueSmokeEnv {
  INTERNAL_FULFILL_KEY?: string;
  AUDIT_FULFILL_QUEUE?: Queue<AuditFulfillMessage>;
  FULFILL_QUEUE?: Queue<FulfillMessage>;
}

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as AuditQueueSmokeEnv;

  const provided = req.headers.get("x-internal-fulfill-key");
  if (
    !env.INTERNAL_FULFILL_KEY ||
    !provided ||
    !constantTimeEqual(provided, env.INTERNAL_FULFILL_KEY)
  ) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Slice Q (Q5): optional JSON body {target: "audit"|"impl"|"impl_day"};
  // default (no/empty/unparseable body) is "audit", unchanged.
  let target: unknown = "audit";
  try {
    const body = (await req.json()) as { target?: unknown } | null;
    if (body && typeof body === "object" && body.target !== undefined) target = body.target;
  } catch {
    // no body → audit
  }
  if (target === "impl" || target === "impl_day") {
    if (!env.FULFILL_QUEUE) {
      return NextResponse.json({ ok: false, error: "queue_not_bound" }, { status: 503 });
    }
    // impl-smoke- ids can't collide with real impl-pay_… ids. impl → claim
    // (0 changes) → not_found → smoke noop; impl_day → CAS (0 changes) → deduped.
    const smokeId = `impl-smoke-${crypto.randomUUID()}`;
    const message: FulfillMessage =
      target === "impl"
        ? { kind: "impl", session_id: smokeId }
        : { kind: "impl_day", f2_session_id: smokeId, day_n: 30 };
    try {
      await env.FULFILL_QUEUE.send(message);
    } catch (err) {
      console.error(
        `FULFILL_QUEUE_SMOKE_ENQUEUE_FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
      return NextResponse.json({ ok: false, error: "enqueue_failed" }, { status: 500 });
    }
    console.log(`FULFILL_QUEUE_SMOKE_ENQUEUED target=${target} session_id=${smokeId}`);
    return NextResponse.json({ ok: true, target, session_id: smokeId });
  }
  if (target !== "audit") {
    return NextResponse.json({ ok: false, error: "bad_target" }, { status: 400 });
  }

  if (!env.AUDIT_FULFILL_QUEUE) {
    return NextResponse.json({ ok: false, error: "queue_not_bound" }, { status: 503 });
  }

  const session_id = `smoke-${crypto.randomUUID()}`;
  try {
    await env.AUDIT_FULFILL_QUEUE.send({ session_id, origin: requestOrigin(req) });
  } catch (err) {
    console.error(
      `AUDIT_QUEUE_SMOKE_ENQUEUE_FAILED: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json({ ok: false, error: "enqueue_failed" }, { status: 500 });
  }
  console.log(`AUDIT_QUEUE_SMOKE_ENQUEUED session_id=${session_id}`);
  return NextResponse.json({ ok: true, session_id });
}
