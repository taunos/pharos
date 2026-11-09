import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderEmailLayout, escapeHtml, EMAIL_WORDMARK_URL } from "./email-layout";
import { AUDIT_READY_EMAIL_COPY } from "./score-email";

// Test C-B (item 4) — shared customer-email layout. Pure + deterministic.

const FULL = {
  preheader: "Preheader <text>",
  heading: "Heading & more",
  subheading: "Sub",
  cards: ["<p>Card one</p>", "<p>Card two</p>"],
  cta: { label: "Open it", href: "https://astrant.io/x?a=1&b=2", caption: "Caption" },
  footerLines: ["Line one", "Line two"],
};

describe("renderEmailLayout", () => {
  it("is deterministic", () => {
    expect(renderEmailLayout(FULL)).toBe(renderEmailLayout(FULL));
  });

  it("full input snapshot", () => {
    expect(renderEmailLayout(FULL)).toMatchSnapshot();
  });

  it("minimal input snapshot (no subheading, no CTA)", () => {
    expect(
      renderEmailLayout({ preheader: "P", heading: "H", cards: ["<p>C</p>"], footerLines: ["F"] }),
    ).toMatchSnapshot();
  });

  it("hosted wordmark, hidden preheader, escaped text fields", () => {
    const html = renderEmailLayout(FULL);
    expect(html).toContain(`<img src="${EMAIL_WORDMARK_URL}"`);
    expect(EMAIL_WORDMARK_URL).toBe("https://astrant.io/brand/astrant-wordmark.png");
    expect(html).not.toContain("data:");
    expect(html).toMatch(/<div style="display: none;[^"]*">Preheader &lt;text&gt;<\/div>/);
    expect(html).toContain(">Heading &amp; more</h1>");
    expect(html).toContain(`href="https://astrant.io/x?a=1&amp;b=2"`);
    // Card bodies are pre-rendered HTML, passed through as-is.
    expect(html).toContain("<p>Card one</p>");
  });

  it("escapeHtml escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("Audit-ready email HTML (C5 via renderEmailLayout)", () => {
  const args = {
    url: "https://example.com/",
    pdfUrl: "https://astrant.io/audit-results/11111111-2222-4333-8444-555555555555/pdf",
  };
  const html = AUDIT_READY_EMAIL_COPY!.html(args);

  it("snapshot", () => {
    expect(html).toMatchSnapshot();
  });

  it("heading, C5 body, CTA, row-51 footer", () => {
    expect(html).toContain(">Your Astrant Audit is ready</h1>");
    expect(html).toContain("Your Astrant Audit for https://example.com/ is ready.");
    expect(html).toContain("The PDF is attached. You can also open it here:");
    expect(html).toContain("Questions or something looks wrong? Reply to this email or write to");
    expect(html).toContain(`href="${args.pdfUrl}"`);
    expect(html).toContain(">Open your Audit (PDF)</a>");
    expect(html).toContain("Astrant — Agent Discoverability · contact@astrant.io");
    expect(html).not.toContain("placeholder");
  });

  // Design-review preview: EMAIL_PREVIEW_DIR=<dir> npx vitest run src/lib/email-layout.test.ts
  it("writes a preview file when EMAIL_PREVIEW_DIR is set", () => {
    const dir = process.env.EMAIL_PREVIEW_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "audit-ready.html"), html, "utf8");
  });
});
