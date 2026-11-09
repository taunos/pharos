import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// E1 — customer emails on the shared layout (email-layout.ts). Each send is
// captured from a mocked Resend; html + text are snapshotted, replyTo is
// asserted. Design-review previews:
//   EMAIL_PREVIEW_DIR=<dir> npx vitest run src/lib/customer-emails.test.ts

const { sendMock, tok } = vi.hoisted(() => ({ sendMock: vi.fn(), tok: { real: false } }));
vi.mock("resend", () => ({ Resend: class { emails = { send: sendMock }; } }));
vi.mock("./onboarding-token", () => ({ issueOnboardingToken: async () => "onb-token-FIXED" }));
vi.mock("./account-link", () => ({
  issueAccountLink: async () => "https://astrant.io/account?t=acct-token-FIXED",
}));
// Real buildUnsubscribeLink (the /api/email/unsubscribe route reads `?token=`).
// mintUnsubscribeToken is real for the "-real-token" variants (signed, ~170
// chars), a short fixed token otherwise.
vi.mock("./email-suppressions", async (importOriginal) => {
  const real = await importOriginal<typeof import("./email-suppressions")>();
  return {
    ...real,
    isEmailSuppressed: async () => false,
    mintUnsubscribeToken: async (env: { EMAIL_UNSUB_SIGNING_KEY: string }, email: string) =>
      tok.real ? real.mintUnsubscribeToken(env, email) : "unsub-token-FIXED",
  };
});

import {
  buildGapReportReadyPayload,
  sendGapReportReadyEmail,
  sendGapReportDeferredEmail,
  sendDeletionConfirmEmail,
  sendAutoPilotAuditReadyEmail,
} from "./score-email";
import { sendF2PatchDeliveryEmail, sendF2DayNAuditEmail } from "./f2-email";
import { sendWelcomeEmail, type WelcomeEmailEnv } from "./welcome-email";
import type { ScanResult } from "./audit-types";
import type { AssignmentResult } from "./founding-pricing";

type Sent = {
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string }>;
};

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
const BRAND_FOOTER = "Astrant — Agent Discoverability · contact@astrant.io";

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
    expect(p).not.toHaveProperty("replyTo"); // frozen payload stays six fields
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

  it("#1 gap-report ready send adds replyTo at send time", async () => {
    const s = await capture("gap-report-ready-send", () => sendGapReportReadyEmail(env, scoreInput));
    expect(s.replyTo).toBe("contact@astrant.io");
    delete sent["gap-report-ready-send"]; // same HTML as gap-report-ready; no extra preview
  });

  it("#3 gap-report deferred", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
    const s = await capture("gap-report-deferred", () => sendGapReportDeferredEmail(env, scoreInput));
    expect(s.replyTo).toBe("contact@astrant.io");
    expect(s.headers?.["List-Unsubscribe"]).toBe("<https://astrant.io/api/score/unsubscribe?t=unsub-token-FIXED>");
    expect(s.html).toContain(">Unsubscribe from rescan emails</a>");
    expect(s.html).toContain(">Delete all my data</a>");
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
    expect(s.attachments?.map((a) => a.filename)).toEqual(["astrant-audit-ap-sub_123-1.pdf"]);
    expect(s.text).not.toContain("2026-06-01");
    expect(s.html).not.toContain("2026-06-01");
    expect(s.html).toContain(">Your Astrant Audit is ready</h1>");
    expect(s.html).toContain(BRAND_FOOTER);
    expect(s.text).toContain("- Dim 1-5: llms.txt, MCP server, OpenAPI catalog, structured data, agent-parsable content");
    expect(s.text).toContain(
      "Your first monthly tracking digest arrives on the 1st of next month, with citation-tracking data from your subscription start onward.",
    );
    expect(s.text).toMatchSnapshot("text");
    expect(s.html).toMatchSnapshot("html");
  });

  it("#6 F2 patch delivery", async () => {
    const s = await capture("f2-patch-delivery", () =>
      sendF2PatchDeliveryEmail(env, {
        toEmail: "jane@acme-analytics.com",
        brandName: "Acme",
        patchR2Key: "f2/patch",
        sessionId: "impl-1",
        includesOpenApi: true,
      }),
    );
    expect(s.replyTo).toBe("contact@astrant.io");
    expect(s.html).toContain(BRAND_FOOTER);
    expect(s.html).toMatch(/<pre [^>]*>cd mcp-server &amp;&amp; npx wrangler login &amp;&amp; npx wrangler deploy<\/pre>/);
    expect(s.text).toMatchSnapshot("text");
    expect(s.html).toMatchSnapshot("html");
  });

  it("#6b F2 patch delivery without an OpenAPI spec: the list omits only that item", async () => {
    const input = { toEmail: "jane@acme-analytics.com", brandName: "Acme", patchR2Key: "f2/patch", sessionId: "impl-1" };
    await sendF2PatchDeliveryEmail(env, { ...input, includesOpenApi: true });
    const withSpec = lastSent();
    const without = await capture("f2-patch-delivery-no-openapi", () => sendF2PatchDeliveryEmail(env, { ...input, includesOpenApi: false }));
    expect(without.text).not.toContain("OpenAPI");
    expect(without.html).not.toContain("OpenAPI");
    expect(without.text).toBe(withSpec.text.replace("  - OpenAPI spec scaffold for your category\n", ""));
    expect(without.html).toContain("JSON-LD schema blocks for your root layout");
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
      if (dayN === 90) {
        // text-labelled link wraps normally (no break-all)
        expect(s.html).toContain(`<a href="https://checkout.example/standard?a=1&amp;b=2" style="color: #18181b;">start Standard ($149/mo)</a>`);
      }
      expect(s.html).toContain(BRAND_FOOTER);
      expect(s.html).not.toMatch(/<h1[^>]*>[^<]*\.<\/h1>/);
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
      expect(s.html).toContain(`href="https://astrant.io/api/email/unsubscribe?token=unsub-token-FIXED"`);
      expect(s.html).toMatch(/>Unsubscribe<\/a><\/div>/);
      // HTML shows labelled links, not raw URLs; the text part keeps the URLs.
      expect(s.html).not.toContain(">https://");
      expect(s.text).toContain("https://astrant.io/api/email/unsubscribe?token=unsub-token-FIXED");
      expect(s.text).not.toContain("The Astrant team");
      expect(s.html).not.toContain("The Astrant team");
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

  for (const [name, founding] of welcomeVariants) {
    it(`#8 ${name} with a real signed unsubscribe token (preview only)`, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
      tok.real = true;
      try {
        const s = await capture(`${name}-real-token`, () =>
          sendWelcomeEmail({ ...welcomeEnv, EMAIL_UNSUB_SIGNING_KEY: "preview-signing-key" } as WelcomeEmailEnv, "sub_123", "jane@acme-analytics.com", founding),
        );
        const m = s.text.match(/unsubscribe\?token=([^\s]+)/);
        expect(m).not.toBeNull();
        expect(decodeURIComponent(m![1]).length).toBeGreaterThan(150);
        expect(s.html).toMatch(/>Unsubscribe<\/a><\/div>/);
      } finally {
        tok.real = false;
      }
    });
  }

  it("writes preview files when EMAIL_PREVIEW_DIR is set", () => {
    const dir = process.env.EMAIL_PREVIEW_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const [name, s] of Object.entries(sent)) writeFileSync(join(dir, `${name}.html`), s.html, "utf8");
  });
});

// E4 (2026-11-05): the Resend SDK returns API failures in `error` instead of
// throwing; sendWelcomeEmail must throw so the webhook does not stamp
// welcome_email_sent_at for an email Resend never accepted.
describe("E4 — sendWelcomeEmail surfaces a Resend API error", () => {
  it("throws when Resend returns { error }", async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: "domain not verified", name: "validation_error" } });
    await expect(sendWelcomeEmail(welcomeEnv, "sub_123", "jane@acme-analytics.com", null)).rejects.toThrow(/Resend/);
  });
  it("resolves on a normal send", async () => {
    await expect(sendWelcomeEmail(welcomeEnv, "sub_123", "jane@acme-analytics.com", null)).resolves.toBeUndefined();
  });
});
