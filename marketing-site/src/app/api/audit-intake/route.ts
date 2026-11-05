import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  INTAKE_TAXONOMY_VERSION,
  intakeKey,
  isIntakeSessionId,
  validateIntake,
  type IntakeRecord,
} from "@/lib/dataset-intake";

// Dataset spec v2 §3 — optional post-purchase intake for a standalone Audit.
//
// Authorization: the session id (a random UUID v4 returned only to the buyer
// who created the checkout, and the same capability that opens their results
// page and PDF) must name an existing `audit:` session. Write-once per
// session: a second submit is refused, which also rate-limits by session.
//
// Never logs the request body. The free text stays in SESSIONS KV with the
// order's 30-day TTL and goes nowhere else.

const SESSION_TTL_SEC = 30 * 24 * 60 * 60;
const MAX_BODY_BYTES = 8 * 1024;

interface IntakeEnv {
  SESSIONS: KVNamespace;
}

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as IntakeEnv;

  const text = await req.text().catch(() => null);
  if (text === null) return fail("INVALID_BODY", 400);
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return fail("BODY_TOO_LARGE", 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("INVALID_BODY", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("INVALID_BODY", 400);
  }
  const b = body as Record<string, unknown>;

  const sessionId = b.session_id;
  if (!isIntakeSessionId(sessionId)) {
    return fail("SESSION_NOT_FOUND", 404);
  }

  const v = validateIntake(b);
  if (!v.ok) return fail(v.error, 400);

  if (!(await env.SESSIONS.get(`audit:${sessionId}`))) {
    return fail("SESSION_NOT_FOUND", 404);
  }
  const key = intakeKey("audit", sessionId);
  if (await env.SESSIONS.get(key)) {
    return fail("ALREADY_SUBMITTED", 409);
  }

  // Everything skipped: nothing to store.
  if (Object.keys(v.answers).length === 0 && v.notes === undefined) {
    return NextResponse.json({ ok: true, stored: false });
  }

  const record: IntakeRecord = {
    taxonomy_version: INTAKE_TAXONOMY_VERSION,
    submitted_at: Date.now(),
    answers: v.answers,
    ...(v.notes !== undefined ? { notes: v.notes } : {}),
  };
  try {
    await env.SESSIONS.put(key, JSON.stringify(record), {
      expirationTtl: SESSION_TTL_SEC,
    });
  } catch {
    console.error(`AUDIT_INTAKE_WRITE_FAILED session_id=${sessionId}`);
    return fail("WRITE_FAILED", 500);
  }
  return NextResponse.json({ ok: true, stored: true });
}
