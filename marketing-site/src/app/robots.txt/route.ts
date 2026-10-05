// Test C-A (A5) crawl policy, served as a route handler since Test C-B so it
// can carry Content-Signal (Next's MetadataRoute.Robots has no custom
// directives). Index the public marketing surface; keep APIs,
// account/onboarding flows, private results and one-off pages out.
// Built with join (not a template literal) so line endings stay LF even in a
// CRLF checkout.
export const dynamic = "force-static";

const ROBOTS_TXT = [
  "User-Agent: *",
  "Content-Signal: search=yes, ai-input=yes",
  "Allow: /",
  "Disallow: /api/",
  "Disallow: /account",
  "Disallow: /onboarding",
  "Disallow: /audit-results/",
  "Disallow: /score/delete-me",
  "Disallow: /f2-success",
  "",
  "Sitemap: https://astrant.io/sitemap.xml",
  "",
].join(String.fromCharCode(10));

export function GET() {
  return new Response(ROBOTS_TXT, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
