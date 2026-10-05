import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Test C-A (A5): no Cloudflare IMAGES binding — serve next/image sources
  // as-is instead of via /_next/image.
  images: { unoptimized: true },
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
