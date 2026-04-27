import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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

  return NextResponse.next();
}

export const config = {
  matcher: ["/audit", "/implementation", "/custom", "/subscriptions", "/score"],
};
