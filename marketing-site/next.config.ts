import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
