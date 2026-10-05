import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Test C-A (A5): no Cloudflare IMAGES binding — serve next/image sources
  // as-is instead of via /_next/image.
  images: { unoptimized: true },
  // Test C-A: force-dynamic pages (/audit) would otherwise stream metadata, so
  // <title>/<meta> land after </head> for HTML-limited bots and curl. Treat
  // every UA as HTML-limited → metadata always renders blocking in <head>.
  htmlLimitedBots: /.*/,
  async redirects() {
    return [
      { source: "/retainer", destination: "/subscriptions", permanent: true },
      { source: "/retainer.md", destination: "/subscriptions.md", permanent: true },
    ];
  },
};

export default nextConfig;

// OpenNext dev-time bindings hook. Safe no-op in non-CF environments.
// See https://opennext.js.org/cloudflare
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
