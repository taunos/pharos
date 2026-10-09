import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { stripDodoReturnParams } from "@/lib/return-url-params";

const MD_ROUTES = new Set(["/audit", "/implementation", "/custom", "/subscriptions", "/score"]);

export function middleware(req: NextRequest) {
  const accept = (req.headers.get("accept") ?? "").toLowerCase();
  const wantsMarkdown = accept.includes("text/markdown");
  const wantsHtml = accept.includes("text/html");

  if (wantsMarkdown && !wantsHtml && MD_ROUTES.has(req.nextUrl.pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = `${req.nextUrl.pathname}.md`;
    return NextResponse.redirect(url, 307);
  }

  if (isDodoReturnPath(req.nextUrl.pathname)) {
    const cleaned = stripDodoReturnParams(new URL(req.url));
    if (cleaned) {
      const res = NextResponse.redirect(cleaned, 303);
      res.headers.set("Referrer-Policy", "no-referrer");
      return res;
    }
  }

  return NextResponse.next();
}

// Dodo checkout return_url targets (audit-create, f2-checkout-create).
function isDodoReturnPath(pathname: string): boolean {
  return pathname === "/f2-success" || /^\/audit-results\/[^/]+$/.test(pathname);
}

export const config = {
  matcher: [
    "/audit",
    "/implementation",
    "/custom",
    "/subscriptions",
    "/score",
    "/audit-results/:sessionId",
    "/f2-success",
  ],
};
