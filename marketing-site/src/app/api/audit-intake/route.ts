import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SessionRecord } from "@/lib/audit-types";
import {
  INTAKE_MAX_WRITES,
  intakeKey,
  isIntakeSessionId,
  nextIntakeRecord,
  validateIntake,
  type IntakeRecord,
} from "@/lib/dataset-intake";

// Dataset spec v2 §3 — optional post-purchase intake for a standalone Audit.
//
// Authorization: the session id (a random UUID v4 returned only to the buyer
// who created the checkout, and the same capability that opens their results
// page and PDF) must name an existing `audit:` session whose payment the
// dodo-webhook has confirmed (paid_at). Last write wins for the session
// holder, up to INTAKE_MAX_WRITES submissions (best-effort counter).
//
// Retention: the intake key expires with the order record (same absolute
// expiration), never later. Never logs the request body; the free text goes
// nowhere but SESSIONS KV.

const MAX_BODY_BYTES = 8 * 1024;
// KV refuses expirations less than 60 s ahead.
const MIN_REMAINING_SEC = 60;

interface IntakeEnv {
  SESSIONS: KVNamespace;
}

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Reads at most `max` bytes; returns null (and stops reading) past the cap.
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as IntakeEnv;

  let text: string | null;
  try {
    text = await readCapped(req, MAX_BODY_BYTES);
  } catch {
    return fail("INVALID_BODY", 400);
  }
  if (text === null) return fail("BODY_TOO_LARGE", 413);
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

  const sessionKey = `audit:${sessionId}`;
  const raw = await env.SESSIONS.get(sessionKey);
  if (!raw) return fail("SESSION_NOT_FOUND", 404);
  let session: SessionRecord;
  try {
    session = JSON.parse(raw) as SessionRecord;
  } catch {
    return fail("SESSION_NOT_FOUND", 404);
  }
  if (typeof session.paid_at !== "number") return fail("not_paid_yet", 409);

  // The order's absolute expiration (unix seconds), from the key listing.
  const listed = await env.SESSIONS.list({ prefix: sessionKey, limit: 1 });
  const entry = listed.keys.find((k) => k.name === sessionKey);
  const expiration = entry?.expiration;
  if (
    typeof expiration !== "number" ||
    expiration - Math.floor(Date.now() / 1000) <= MIN_REMAINING_SEC
  ) {
    return fail("SESSION_EXPIRED", 410);
  }

  const key = intakeKey("audit", sessionId);
  let prev: IntakeRecord | null = null;
  const prevRaw = await env.SESSIONS.get(key);
  if (prevRaw) {
    try {
      prev = JSON.parse(prevRaw) as IntakeRecord;
    } catch {
      prev = null;
    }
  }
  if ((prev?.write_count ?? 0) >= INTAKE_MAX_WRITES) {
    return fail("WRITE_LIMIT", 429);
  }

  // Everything skipped and nothing stored yet: nothing to do.
  if (!prev && Object.keys(v.answers).length === 0 && v.notes === undefined) {
    return NextResponse.json({ ok: true, stored: false });
  }

  const record = nextIntakeRecord(prev, v, Date.now());
  try {
    await env.SESSIONS.put(key, JSON.stringify(record), { expiration });
  } catch {
    console.error(`AUDIT_INTAKE_WRITE_FAILED session_id=${sessionId}`);
    return fail("WRITE_FAILED", 500);
  }
  return NextResponse.json({ ok: true, stored: true });
}
