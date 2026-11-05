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
  // Security headers (2026-11-04 security pass). No CSP script policy yet
  // (Next inline scripts need nonces); frame-ancestors only. HSTS without
  // includeSubDomains/preload to stay reversible. Audit results URLs are
  // capabilities (the session UUID), so those pages send no Referer at all.
  async headers() {
    const base = [
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];
    return [
      { source: "/:path*", headers: base },
      {
        source: "/audit-results/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
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
