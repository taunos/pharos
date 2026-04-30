import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hashEmailForLog } from "@/lib/score-tokens";
import { normalizeEmail } from "@/lib/email-normalize";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Expected JSON object with url and email." },
      { status: 400 }
    );
  }

  const { url, email } = body as { url?: unknown; email?: unknown };

  if (typeof url !== "string" || typeof email !== "string") {
    return NextResponse.json(
      { ok: false, error: "Both url and email must be strings." },
      { status: 400 }
    );
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json(
      { ok: false, error: "url is not a valid URL." },
      { status: 400 }
    );
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "email is not a valid email address." },
      { status: 400 }
    );
  }

  // F-01: normalize before any downstream use.
  const normalizedEmail = normalizeEmail(email);

  // F-04: never log raw email. Hash with UNSUBSCRIBE_SECRET when bound.
  const env = getCloudflareContext().env as unknown as { UNSUBSCRIBE_SECRET?: string };
  const emailHash = env.UNSUBSCRIBE_SECRET
    ? await hashEmailForLog(normalizedEmail, env.UNSUBSCRIBE_SECRET)
    : "[unsalted]";
  console.log("[waitlist]", { url, email_hash: emailHash, at: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
