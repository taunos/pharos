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

interface AuditQueueSmokeEnv {
  INTERNAL_FULFILL_KEY?: string;
  AUDIT_FULFILL_QUEUE?: Queue<AuditFulfillMessage>;
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
