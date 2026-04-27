import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  llmEnrichGaps,
  renderAuditHtml,
  generatePdf,
  runScan,
  storeJson,
  storePdf,
  REMEDIATION_ENGINE_VERSION_TAG,
  type AuditEnv,
} from "@/lib/audit-pipeline";
import type { AuditResult, SessionRecord } from "@/lib/audit-types";

interface FulfillEnv extends AuditEnv {
  INTERNAL_FULFILL_KEY: string;
}

const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

export const maxDuration = 300;

async function readSession(
  env: FulfillEnv,
  sessionId: string
): Promise<SessionRecord | null> {
  const raw = await env.SESSIONS.get(`audit:${sessionId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

async function writeSession(
  env: FulfillEnv,
  record: SessionRecord
): Promise<void> {
  await env.SESSIONS.put(
    `audit:${record.session_id}`,
    JSON.stringify(record),
    { expirationTtl: SESSION_TTL_SEC }
  );
}

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as FulfillEnv;

  const provided = req.headers.get("x-internal-fulfill-key");
  if (
    !env.INTERNAL_FULFILL_KEY ||
    !provided ||
    provided !== env.INTERNAL_FULFILL_KEY
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

  const record = await readSession(env, sessionId);
  if (!record) {
    return NextResponse.json(
      { ok: false, error: "session not found" },
      { status: 404 }
    );
  }

  if (record.status !== "fulfilling") {
    return NextResponse.json(
      {
        ok: false,
        error: `session not in fulfilling state (status=${record.status})`,
      },
      { status: 400 }
    );
  }

  try {
    const scan = await runScan(record.url);
    const gaps = await llmEnrichGaps(env, scan, sessionId);
    const audit: AuditResult = {
      scan,
      gaps,
      engine_version: REMEDIATION_ENGINE_VERSION_TAG,
    };
    const html = renderAuditHtml(audit, sessionId);
    const pdf = await generatePdf(env, html);
    await storePdf(env, sessionId, pdf);
    await storeJson(env, sessionId, audit);

    const next: SessionRecord = {
      ...record,
      status: "ready",
      completed_at: Date.now(),
      pdf_url: `/audit-results/${sessionId}/pdf`,
      json_url: `/audit-results/${sessionId}/json`,
      composite_score: scan.composite.score,
      grade: scan.composite.grade,
    };
    await writeSession(env, next);

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      composite_score: scan.composite.score,
      grade: scan.composite.grade,
      gap_count: gaps.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[audit-fulfill] session=${sessionId} failed: ${message}`
    );
    const next: SessionRecord = {
      ...record,
      status: "error",
      error_message: message.slice(0, 500),
    };
    await writeSession(env, next).catch(() => {});
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
