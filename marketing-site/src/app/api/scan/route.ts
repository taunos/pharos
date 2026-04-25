import { NextResponse } from "next/server";

const DEFAULT_SCANNER_URL = "https://pharos-scanner.pharos-dev.workers.dev";

export async function POST(req: Request) {
  const scannerBase = process.env.SCANNER_URL || DEFAULT_SCANNER_URL;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Pass the real client IP through so the scanner's rate limiter sees it.
  const clientIp =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (clientIp) headers["CF-Connecting-IP"] = clientIp;

  try {
    const upstream = await fetch(`${scannerBase}/api/scan`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "Scanner unavailable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}
