import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIVACY_MD, TERMS_MD } from "./legal-content";

// /privacy and /terms render from legal-content.ts; public/privacy.md and
// public/terms.md are the static content-negotiation mirrors. Neither can read
// the Audit gate, so their availability sentences must be true in both states.
const readPublic = (name: string) =>
  readFileSync(join(__dirname, "..", "..", "public", name), "utf-8").replace(/\r\n/g, "\n");

describe("legal-content mirrors", () => {
  it("PRIVACY_MD matches public/privacy.md byte-for-byte", () => {
    expect(PRIVACY_MD).toBe(readPublic("privacy.md"));
  });

  it("TERMS_MD matches public/terms.md byte-for-byte", () => {
    expect(TERMS_MD).toBe(readPublic("terms.md"));
  });
});

describe("legal availability sentences (gate-independent)", () => {
  it("terms do not claim the Audit is available now", () => {
    expect(TERMS_MD).not.toContain("The Audit is available now");
    expect(TERMS_MD).toContain(
      "Some of these tiers are still in pre-launch verification at the time you're reading this. Active checkout availability is shown on each tier's page. Payments are processed by Dodo Payments, our merchant of record, and your purchase is also subject to Dodo's checkout terms.",
    );
  });

  it("privacy has the open-gate (C-B) email-collection sentence", () => {
    expect(PRIVACY_MD).toContain("receive your gap-report PDF, buy an Audit, opt into");
    expect(PRIVACY_MD).toContain(
      "paid tiers — Implementation, Custom, Standard, Pro — open for purchase",
    );
  });
});
