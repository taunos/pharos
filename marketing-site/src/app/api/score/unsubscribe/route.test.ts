// E1 (code-quality audit 2026-11-05): a report (PDF / results) token must not
// unsubscribe the scan's owner. Real token module; scanner client mocked.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ env: {} as Record<string, unknown>, unsubscribeScan: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: h.env }) }));
vi.mock("@/lib/score-scanner-client", () => ({ unsubscribeScan: h.unsubscribeScan }));

import { GET, POST } from "./route";
import { issueScanToken, PDF_TOKEN_TTL_SECONDS, UNSUB_TOKEN_TTL_SECONDS } from "@/lib/score-tokens";

const SECRET = "s";
const SCAN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const req = (method: string, t: string) =>
  new Request(`https://astrant.io/api/score/unsubscribe?t=${encodeURIComponent(t)}`, { method });

beforeEach(() => {
  h.env = { UNSUBSCRIBE_SECRET: SECRET, INTERNAL_SCANNER_ADMIN_KEY: "k" };
  h.unsubscribeScan.mockReset();
  h.unsubscribeScan.mockResolvedValue({ ok: true });
});

describe("E1 — /api/score/unsubscribe accepts only unsubscribe-purpose tokens", () => {
  it("a report token (the one that used to be returned in capture-email JSON) cannot unsubscribe", async () => {
    const report = await issueScanToken(SCAN, PDF_TOKEN_TTL_SECONDS, SECRET, "report");
    const res = await POST(req("POST", report));
    expect(await res.text()).toContain("invalid or expired");
    expect(h.unsubscribeScan).not.toHaveBeenCalled();
    expect(await (await GET(req("GET", report))).text()).toContain("invalid or expired");
  });

  it("the unsubscribe token from the email still works", async () => {
    const unsub = await issueScanToken(SCAN, UNSUB_TOKEN_TTL_SECONDS, SECRET, "unsub");
    const res = await POST(req("POST", unsub));
    expect(await res.text()).toContain("You've been unsubscribed.");
    expect(h.unsubscribeScan).toHaveBeenCalledWith(expect.anything(), SCAN);
  });
});
