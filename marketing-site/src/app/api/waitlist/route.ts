import { NextResponse } from "next/server";

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

  console.log("[waitlist]", { url, email, at: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
