import type { MetadataRoute } from "next";

// Test C-A (A5): crawl policy. Index the public marketing surface; keep APIs,
// account/onboarding flows, private results and one-off pages out.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/account",
        "/onboarding",
        "/audit-results/",
        "/score/delete-me",
        "/f2-success",
      ],
    },
    sitemap: "https://astrant.io/sitemap.xml",
  };
}
