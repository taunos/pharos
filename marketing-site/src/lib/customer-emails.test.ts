import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// E1 — customer emails on the shared layout (email-layout.ts). Each send is
// captured from a mocked Resend; html + text are snapshotted, replyTo is
// asserted. Design-review previews:
//   EMAIL_PREVIEW_DIR=<dir> npx vitest run src/lib/customer-emails.test.ts

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: sendMock }; } }));
vi.mock("./onboarding-token", () => ({ issueOnboardingToken: async () => "onb-token-FIXED" }));
vi.mock("./account-link", () => ({
  issueAccountLink: async () => "https://astrant.io/account?t=acct-token-FIXED",
}));
vi.mock("./email-suppressions", () => ({
  isEmailSuppressed: async () => false,
  mintUnsubscribeToken: async () => "unsub-token-FIXED",
  buildUnsubscribeLink: (base: string, t: string) => `${base}/api/email/unsubscribe?t=${t}`,
}));

import {
  buildGapReportReadyPayload,
  sendGapReportDeferredEmail,
  sendDeletionConfirmEmail,
  sendAutoPilotAuditReadyEmail,
} from "./score-email";
import { sendF2PatchDeliveryEmail, sendF2DayNAuditEmail } from "./f2-email";
import { sendWelcomeEmail, type WelcomeEmailEnv } from "./welcome-email";
import type { ScanResult } from "./audit-types";
import type { AssignmentResult } from "./founding-pricing";

type Sent = { replyTo?: string; subject: string; text: string; html: string; headers?: Record<string, string> };

const scan: ScanResult = {
  id: "11111111-2222-4333-8444-555555555555",
  url: "https://acme-analytics.com/",
  composite: { score: 58, grade: "D" },
  dimensions: [
    {
      dimension_id: 1,
      dimension_name: "llms.txt",
      score: 30,
      grade: "F",
      sub_checks: [
        { id: "d1s1", name: "llms.txt present", weight: 1, score: 0, passed: false, notes: "No /llms.txt served at the site root." },
      ],
    },
    {
      dimension_id: 3,
      dimension_name: "OpenAPI catalog",
      score: 55,
      grade: "D",
      sub_checks: [
        { id: "d3s1", name: "OpenAPI spec discoverable", weight: 1, score: 40, passed: false, notes: "No spec linked from /.well-known or the docs index." },
        { id: "d3s2", name: "Spec <valid> & complete", weight: 1, score: 70, passed: false, notes: "3 endpoints lack response schemas." },
      ],
    },
    {
      dimension_id: 4,
      dimension_name: "Structured data",
      score: 90,
      grade: "A",
      sub_checks: [{ id: "d4s1", name: "Organization JSON-LD", weight: 1, score: 95, passed: true, notes: "Present." }],
    },
  ],
  dimensions_scored: 5,
  dimensions_total: 6,
  dimensions_applicable: 5,
  created_at: 1_760_000_000_000,
  scoring_version: "1.1.0",
  tier: "free",
};

const scoreInput = {
  toEmail: "jane@acme-analytics.com",
  scan,
  scanToken: "scan-token-FIXED",
  unsubscribeToken: "unsub-token-FIXED",
  origin: "https://astrant.io",
};

const env = {
  RESEND_API_KEY: "re_test",
  UNSUBSCRIBE_SECRET: "u",
  AUDITS: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) } as unknown as R2Bucket,
};

const welcomeEnv = {
  RESEND_API_KEY: "re_test",
  ACCOUNT_LINK_SECRET: "a",
  CITATION_DB: {},
  EMAIL_UNSUB_SIGNING_KEY: "k",
  ASTRANT_BASE_URL: "https://astrant.io",
} as unknown as WelcomeEmailEnv;

const recs = {
  whatChanged: "Your llms.txt and MCP server are live; agents now resolve your pricing page.",
  trajectoryInterpretation: "Improving — cite-share up in 3 of 4 providers",
  recommendations: [
    "Add response schemas to the 3 undocumented endpoints.",
    "Link the OpenAPI spec from /.well-known/ & the docs index.",
  ],
};

function lastSent(): Sent {
  const calls = sendMock.mock.calls;
  return calls[calls.length - 1][0] as Sent;
}

const sent: Record<string, Sent> = {};

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: "em_1" }, error: null });
});
afterEach(() => {
  vi.useRealTimers();
});

async function capture(name: string, fn: () => Promise<unknown>): Promise<Sent> {
  await fn();
  sent[name] = lastSent();
  return sent[name];
}

describe("E1 customer emails", () => {
  it("#1/#2 gap-report ready (payload builder)", () => {
    const p = buildGapReportReadyPayload({ ...scoreInput, requestedDate: "2026-10-08" });
    sent["gap-report-ready"] = p as Sent;
    expect(p.replyTo).toBe("contact@astrant.io");
    expect(p.headers).toEqual({
      "List-Unsubscribe": "<https://astrant.io/api/score/unsubscribe?t=unsub-token-FIXED>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(p.html).toContain(`href="https://astrant.io/api/score/unsubscribe?t=unsub-token-FIXED"`);
    expect(p.html).toContain(">Unsubscribe from rescan emails</a>");
    expect(p.html).toContain(`href="https://astrant.io/score/delete-me"`);
    expect(p.html).toContain(">Delete all my data</a>");
    expect(p.html).toContain("Spec &lt;valid&gt; &amp; complete");
    expect(p.html).not.toContain("<valid>");
    expect(p.text).toMatchSnapshot("text");
    expect(p.html).toMatchSnapshot("html");
  });

  it("#3 gap-report deferred", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
    const s = await capture("gap-report-deferred", () => sendGapReportDeferredEmail(env, scoreInput));
    expect(s.replyTo).toBe("contact@astrant.io");
    expect(s.headers?.["List-Unsubscribe"]).toBe("<https://astrant.io/api/score/unsubscribe?t=unsub-token-FIXED>");
    expect(s.html).toContain(">Unsubscribe from rescan emails</a>");
    expect(s.html).toContain(">Delete all your data</a>");
    expect(s.text).toMatchSnapshot("text");
    expect(s.html).toMatchSnapshot("html");
  });

  it("#4 deletion confirm", async () => {
    const s = await capture("deletion-confirm", () =>
      sendDeletionConfirmEmail(env, { toEmail: "jane+x@acme-analytics.com", deletionToken: "del-token-FIXED", origin: "https://astrant.io" }),
    );
    expect(s.replyTo).toBe("contact@astrant.io");
    expect(s.html).toContain(`href="https://astrant.io/api/score/delete-me/confirm?t=del-token-FIXED"`);
    expect(s.text).toMatchSnapshot("text");
    expect(s.html).toMatchSnapshot("html");
  });

  it("#5 AutoPilot audit-ready (date clause removed, dims list fixed)", async () => {
    const s = await capture("autopilot-audit-ready", () =>
      sendAutoPilotAuditReadyEmail(env, { toEmail: "jane@acme-analytics.com", sessionId: "ap-sub_123-1", pdfR2Key: "audits/ap-sub_123-1.pdf", origin: "https://astrant.io" }),
    );
    expect(s.replyTo).toBe("contact@astrant.io");
    expect(s.text).not.toContain("2026-06-01");
    expect(s.html).not.toContain("2026-06-01");
    expect(s.text).toContain("- Dim 1-5: llms.txt, MCP server, OpenAPI catalog, structured data, agent-parsable content");
    expect(s.text).toMatchSnapshot("text");
    expect(s.html).toMatchSnapshot("html");
  });

  it("#6 F2 patch delivery", async () => {
    const s = await capture("f2-patch-delivery", () =>
      sendF2PatchDeliveryEmail(env, { toEmail: "jane@acme-analytics.com", brandName: "Acme", patchR2Key: "f2/patch", sessionId: "impl-1" }),
    );
    expect(s.replyTo).toBe("contact@astrant.io");
    expect(s.html).toContain("cd mcp-server &amp;&amp; npx wrangler login &amp;&amp; npx wrangler deploy");
    expect(s.text).toMatchSnapshot("text");
    expect(s.html).toMatchSnapshot("html");
  });

  for (const dayN of [30, 60, 90] as const) {
    it(`#7 F2 Day-${dayN} audit`, async () => {
      const s = await capture(`f2-day${dayN}-audit`, () =>
        sendF2DayNAuditEmail(env, {
          toEmail: "jane@acme-analytics.com",
          brandName: "Acme",
          dayN,
          sessionId: "impl-1",
          recs,
          baselineScore: 42,
          currentScore: 71,
          citeShareBaselinePct: 3.2,
          citeShareCurrentPct: 11.75,
          autoPilotCheckoutUrl: dayN === 90 ? "https://checkout.example/standard?a=1&b=2" : undefined,
        }),
      );
      expect(s.replyTo).toBe("contact@astrant.io");
      expect(s.html).toContain("/.well-known/ &amp; the docs index.");
      if (dayN === 90) expect(s.html).toContain(`href="https://checkout.example/standard?a=1&amp;b=2"`);
      expect(s.text).toMatchSnapshot("text");
      expect(s.html).toMatchSnapshot("html");
    });
  }

  const welcomeVariants: Array<[string, AssignmentResult | null]> = [
    ["welcome-standard", null],
    [
      "welcome-founding-new",
      { kind: "newly_assigned", foundingOrderSeq: 7, foundingTierLocks: { standard: 14900 } } as unknown as AssignmentResult,
    ],
    [
      "welcome-founder-back",
      { kind: "already_founder", founding_status: "active", foundingOrderSeq: 7, foundingTierLocks: { standard: 14900 } } as unknown as AssignmentResult,
    ],
  ];
  for (const [name, founding] of welcomeVariants) {
    it(`#8 ${name}`, async () => {
      const s = await capture(name, () => sendWelcomeEmail(welcomeEnv, "sub_123", "jane@acme-analytics.com", founding));
      expect(s.replyTo).toBe("contact@astrant.io");
      expect(s.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(s.html).toContain(`href="https://astrant.io/api/email/unsubscribe?t=unsub-token-FIXED"`);
      // No raw Markdown in either part.
      for (const part of [s.text, s.html]) {
        expect(part).not.toContain("**");
        expect(part).not.toMatch(/\]\(/);
      }
      if (founding === null) {
        expect(s.text).toContain("Next step: tell us what to monitor.");
        expect(s.text).toContain("Set up monitoring: https://astrant.io/onboarding?t=onb-token-FIXED");
        expect(s.html).toContain("<strong>Next step</strong>: tell us what to monitor.");
        expect(s.html).toMatch(/<a href="https:\/\/astrant.io\/onboarding\?t=onb-token-FIXED"[^>]*>Set up monitoring<\/a>/);
      }
      expect(s.text).toMatchSnapshot("text");
      expect(s.html).toMatchSnapshot("html");
    });
  }

  it("writes preview files when EMAIL_PREVIEW_DIR is set", () => {
    const dir = process.env.EMAIL_PREVIEW_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const [name, s] of Object.entries(sent)) writeFileSync(join(dir, `${name}.html`), s.html, "utf8");
  });
});
