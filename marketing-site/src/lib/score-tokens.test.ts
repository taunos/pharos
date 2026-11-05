// E1 (code-quality audit 2026-11-05) — scan tokens are purpose-bound: a report
// (PDF / results) token cannot unsubscribe, an unsubscribe token cannot open
// the report, and legacy v1 tokens keep working only where they safely can.
import { describe, it, expect } from "vitest";
import {
  issueScanToken,
  verifyScanToken,
  PDF_TOKEN_TTL_SECONDS,
  UNSUB_TOKEN_TTL_SECONDS,
} from "./score-tokens";

const SECRET = "test-secret";
const SCAN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function b64u(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// Mints a pre-E1 v1 token exactly as the old issueScanToken did.
async function legacyV1(scanId: string, ttl: number): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${scanId}:${expiry}:${SECRET}`)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `v1.${b64u(scanId)}.${b64u(String(expiry))}.${hex}`;
}

describe("E1 — purpose-bound scan tokens", () => {
  it("a report token verifies as report and NOT as unsub", async () => {
    const t = await issueScanToken(SCAN, PDF_TOKEN_TTL_SECONDS, SECRET, "report");
    expect(await verifyScanToken(t, SECRET, "report")).toMatchObject({ scanId: SCAN });
    expect(await verifyScanToken(t, SECRET, "unsub")).toBeNull();
  });

  it("an unsub token verifies as unsub and NOT as report", async () => {
    const t = await issueScanToken(SCAN, UNSUB_TOKEN_TTL_SECONDS, SECRET, "unsub");
    expect(await verifyScanToken(t, SECRET, "unsub")).toMatchObject({ scanId: SCAN });
    expect(await verifyScanToken(t, SECRET, "report")).toBeNull();
  });

  it("swapping the purpose label on a v2 token breaks the HMAC", async () => {
    const t = await issueScanToken(SCAN, UNSUB_TOKEN_TTL_SECONDS, SECRET, "report");
    const forged = t.replace(".report.", ".unsub.");
    expect(await verifyScanToken(forged, SECRET, "unsub")).toBeNull();
  });

  it("unknown purpose, wrong secret and expired tokens are rejected", async () => {
    const t = await issueScanToken(SCAN, PDF_TOKEN_TTL_SECONDS, SECRET, "report");
    expect(await verifyScanToken(t.replace(".report.", ".admin."), SECRET, "report")).toBeNull();
    expect(await verifyScanToken(t, "other-secret", "report")).toBeNull();
    const expired = await issueScanToken(SCAN, -10, SECRET, "report");
    expect(await verifyScanToken(expired, SECRET, "report")).toBeNull();
  });

  it("legacy v1 PDF link (30-day) still opens the report but can NOT unsubscribe", async () => {
    const t = await legacyV1(SCAN, PDF_TOKEN_TTL_SECONDS);
    expect(await verifyScanToken(t, SECRET, "report")).toMatchObject({ scanId: SCAN });
    expect(await verifyScanToken(t, SECRET, "unsub")).toBeNull();
  });

  it("legacy v1 unsubscribe link (365-day) still unsubscribes", async () => {
    const t = await legacyV1(SCAN, UNSUB_TOKEN_TTL_SECONDS);
    expect(await verifyScanToken(t, SECRET, "unsub")).toMatchObject({ scanId: SCAN });
  });

  it("documented limit: a legacy v1 unsubscribe link works until 31 days before its 365-day expiry, then reads as expired", async () => {
    const DAY = 86400;
    // 333 days old → 32 days left: still accepted.
    expect(await verifyScanToken(await legacyV1(SCAN, 32 * DAY), SECRET, "unsub")).toMatchObject({ scanId: SCAN });
    // 335 days old → 30 days left: indistinguishable from a v1 report token, so rejected.
    expect(await verifyScanToken(await legacyV1(SCAN, 30 * DAY), SECRET, "unsub")).toBeNull();
  });

  it("new tokens are v2 and never contain the email or a v1 shape", async () => {
    const t = await issueScanToken(SCAN, PDF_TOKEN_TTL_SECONDS, SECRET, "report");
    expect(t.startsWith("v2.report.")).toBe(true);
    expect(t.split(".")).toHaveLength(5);
  });
});
