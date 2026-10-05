import type { MetadataRoute } from "next";

// Test C-A (A5): public, indexable pages only. Per-scan / per-session pages
// (/score/[id], /audit-results/*) and account/onboarding flows are excluded.
const BASE_URL = "https://astrant.io";

const PATHS = [
  "/",
  "/audit",
  "/implementation",
  "/custom",
  "/subscriptions",
  "/score",
  "/score/methodology",
  "/methodology",
  "/methodology/calibration",
  "/privacy",
  "/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((p) => ({ url: p === "/" ? BASE_URL : `${BASE_URL}${p}` }));
}
