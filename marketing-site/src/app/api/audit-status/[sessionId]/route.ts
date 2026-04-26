import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SessionRecord } from "@/lib/audit-types";

interface StatusEnv {
  SESSIONS: KVNamespace;
}

type StatusResponse =
  | { status: "awaiting_payment"; message: string }
  | { status: "fulfilling"; message: string; started_at?: number }
  | {
      status: "ready";
      pdf_url: string;
      json_url: string;
      completed_at?: number;
      composite_score?: number;
      grade?: string;
    }
  | {
      status: "error";
      error_message: string;
      can_retry: boolean;
    };

export async function GET(
  _req: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "sessionId required" },
      { status: 400 }
    );
  }

  const env = getCloudflareContext().env as unknown as StatusEnv;
  const raw = await env.SESSIONS.get(`audit:${sessionId}`);
  if (!raw) {
    return NextResponse.json(
      { ok: false, error: "Session not found." },
      { status: 404 }
    );
  }
  let record: SessionRecord;
  try {
    record = JSON.parse(raw) as SessionRecord;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Corrupt session record." },
      { status: 500 }
    );
  }

  let payload: StatusResponse;
  switch (record.status) {
    case "awaiting_payment":
      payload = {
        status: "awaiting_payment",
        message:
          "We haven't received payment confirmation yet. If you just paid, this should clear within a few seconds.",
      };
      break;
    case "fulfilling":
      payload = {
        status: "fulfilling",
        message:
          "Audit running — scanning your site, enriching each gap with remediation guidance, and rendering your PDF.",
        started_at: record.started_at,
      };
      break;
    case "ready":
      payload = {
        status: "ready",
        pdf_url: record.pdf_url ?? `/audit-results/${sessionId}/pdf`,
        json_url: record.json_url ?? `/audit-results/${sessionId}/json`,
        completed_at: record.completed_at,
        composite_score: record.composite_score,
        grade: record.grade,
      };
      break;
    case "error":
      payload = {
        status: "error",
        error_message:
          record.error_message ??
          "Something went wrong during fulfillment. We've been notified.",
        can_retry: true,
      };
      break;
  }

  return NextResponse.json({ ok: true, ...payload });
}
