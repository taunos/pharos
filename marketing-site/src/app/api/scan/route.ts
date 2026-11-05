import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DEFAULT_SCANNER_URL, scannerFetch, type ScannerServiceEnv } from "@/lib/scanner-fetch";

type ScanProxyEnv = { SCAN_PROXY_KEY?: string } & ScannerServiceEnv;

export async function POST(req: Request) {
  const scannerBase = process.env.SCANNER_URL || DEFAULT_SCANNER_URL;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Pass the real client IP to the scanner's rate limiter. Cloudflare
  // replaces CF-Connecting-IP on this cross-zone Worker subrequest, so the IP
  // travels in x-astrant-client-ip, authenticated by x-astrant-proxy-key (the
  // scanner ignores the IP without a valid key). Only the incoming
  // cf-connecting-ip is used: x-forwarded-for is client-spoofable. The key
  // proves forwarding only; it grants no paid tier. Over the SCANNER_SVC
  // Service Binding the scanner likewise never sees the visitor's own
  // CF-Connecting-IP, so the same authenticated header carries it.
  const clientIp = req.headers.get("cf-connecting-ip") ?? "";
  // E11: the dedicated SCAN_PROXY_KEY only (the INTERNAL_FULFILL_KEY
  // transition fallback was removed 2026-11-05).
  const { SCAN_PROXY_KEY, SCANNER_SVC } = getCloudflareContext().env as unknown as ScanProxyEnv;
  const proxyKey = SCAN_PROXY_KEY;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (clientIp) {
    headers["CF-Connecting-IP"] = clientIp;
    if (proxyKey) {
      headers["x-astrant-client-ip"] = clientIp;
      headers["x-astrant-proxy-key"] = proxyKey;
    }
  }

  try {
    const upstream = await scannerFetch(SCANNER_SVC, `${scannerBase}/api/scan`, {
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
