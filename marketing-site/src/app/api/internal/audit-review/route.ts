// Audit review hold — operator-only reviewer endpoint (lib/audit-review-admin.ts).
//
// Auth: x-internal-fulfill-key = INTERNAL_FULFILL_KEY (same as /api/audit-fulfill).
//   GET                                   → list held reports
//   GET  ?session_id=<id>                 → report JSON + Dim 6 cells/evidence
//   GET  ?session_id=<id>&format=pdf      → the held PDF
//   POST { "session_id": "<id>" }         → release: deliver through the normal
//                                           buyer-email code. Idempotent.
//   POST { "session_id": "<id>", "reconcile_send": "delivered" | "not_sent" }
//                                         → resolve a send whose outcome was
//                                           unknown, after checking Resend.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { constantTimeEqual } from "@/lib/dodo";
import { publicOrigin } from "@/lib/origin";
import type { AuditRunEnv } from "@/lib/audit-fulfill-run";
import { AuditReadyEmailError } from "@/lib/audit-fulfill-run";
import {
  getHeldAuditForReview,
  getHeldAuditPdf,
  listHeldAudits,
  reconcileHeldAuditSend,
  releaseHeldAudit,
} from "@/lib/audit-review-admin";

export const dynamic = "force-dynamic";

const SESSION_ID_RE = /^[a-zA-Z0-9-]{1,128}$/;

type ReviewEnv = AuditRunEnv & { PUBLIC_ORIGIN?: string };

function authorized(req: Request, env: ReviewEnv): boolean {
  const provided = req.headers.get("x-internal-fulfill-key");
  return !!env.INTERNAL_FULFILL_KEY && !!provided && constantTimeEqual(provided, env.INTERNAL_FULFILL_KEY);
}

const unauthorized = () => NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

export async function GET(req: Request) {
  const env = getCloudflareContext().env as unknown as ReviewEnv;
  if (!authorized(req, env)) return unauthorized();
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  if (sessionId === null) {
    return NextResponse.json({ ok: true, held: await listHeldAudits(env) });
  }
  if (!SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json({ ok: false, error: "bad session_id" }, { status: 400 });
  }
  if (url.searchParams.get("format") === "pdf") {
    const pdf = await getHeldAuditPdf(env, sessionId);
    if (!pdf) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return new Response(pdf.body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="review-${sessionId.slice(0, 8)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const review = await getHeldAuditForReview(env, sessionId);
  if (!review) return NextResponse.json({ ok: false, error: "not held" }, { status: 404 });
  return NextResponse.json({ ok: true, ...review }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as ReviewEnv;
  if (!authorized(req, env)) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const sessionId =
    body && typeof body === "object" && typeof (body as { session_id?: unknown }).session_id === "string"
      ? (body as { session_id: string }).session_id
      : "";
  if (!SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json({ ok: false, error: "session_id required" }, { status: 400 });
  }
  const reconcile = (body as { reconcile_send?: unknown }).reconcile_send;
  if (reconcile !== undefined) {
    if (reconcile !== "delivered" && reconcile !== "not_sent") {
      return NextResponse.json(
        { ok: false, error: "reconcile_send must be delivered or not_sent" },
        { status: 400 },
      );
    }
    const r = await reconcileHeldAuditSend(env, sessionId, reconcile);
    return r.kind === "reconciled"
      ? NextResponse.json({ ok: true, session_id: sessionId, reconciled: reconcile })
      : NextResponse.json({ ok: false, error: "nothing to reconcile" }, { status: 409 });
  }
  try {
    const result = await releaseHeldAudit(env, sessionId, publicOrigin(env, req));
    switch (result.kind) {
      case "not_held":
        return NextResponse.json({ ok: false, error: "not held" }, { status: 404 });
      case "not_ready":
        return NextResponse.json(
          { ok: false, error: `report not ready (status=${result.status})` },
          { status: 409 },
        );
      case "released":
        return NextResponse.json({
          ok: true,
          session_id: sessionId,
          released_at: result.hold.released_at,
          email: result.email,
        });
    }
  } catch (err) {
    if (err instanceof AuditReadyEmailError) {
      // Release is recorded; the email failed. POST again to retry the email.
      console.error(`AUDIT_REVIEW_RELEASE_EMAIL_FAILED session_id=${sessionId} reason=${err.reason}`);
      return NextResponse.json(
        { ok: false, released: true, error: "email_failed", reason: err.reason },
        { status: 502 },
      );
    }
    // D1/KV error: state unknown; check with GET and retry.
    console.error(
      `AUDIT_REVIEW_RELEASE_FAILED session_id=${sessionId} class=${err instanceof Error ? err.name : typeof err}`,
    );
    return NextResponse.json({ ok: false, error: "release_failed" }, { status: 500 });
  }
}
