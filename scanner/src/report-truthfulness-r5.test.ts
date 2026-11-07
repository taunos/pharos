// Report truthfulness r5 (1.4.2): same-site scope for pricing, MCP card and
// OpenAPI discovery; bounded pricing discovery; price visibility measured on
// the homepage or a homepage-linked page when there is no pricing page;
// rating scales; review_schema notes that name the validation failure;
// plain-word notes. Every fetch is stubbed.
import { describe, it, expect, vi, afterEach } from "vitest";
import { runDim2 } from "./checks/dim2-mcp";
import { runDim3 } from "./checks/dim3-openapi";
import {
  runDim4,
  REVIEW_INVALID_VALUE_NOTE,
  REVIEW_MISSING_FIELD_NOTE,
  REVIEW_MIXED_NOTE,
  SERVICE_OFFER_NOT_SELLING_NA_NOTE,
} from "./checks/dim4-structured";
import {
  runDim5,
  priceSampleLinks,
  pricesOnHomepageNote,
  pricesOnLinkedPageNote,
  pricingNotMeasuredNote,
} from "./checks/dim5-parsable";
import { SCORING_VERSION } from "./version";
import type { DimensionResult, SubCheck } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const env = () =>
  ({
    CACHE: { get: async () => null, put: async () => {} },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
    AI: { run: async () => ({ response: "50" }) },
  }) as never;

type Route = (init: RequestInit) => Response | Promise<Response>;
function routes(map: Record<string, Route>, onCall?: () => void) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init: RequestInit = {}) => {
      calls.push(String(u));
      onCall?.();
      return (map[String(u)] ?? (() => new Response("", { status: 404 })))(init);
    })
  );
  return calls;
}
const html = (s: string) => () => new Response(s, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const json = (v: unknown) => () => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { location } });
const page = (opts: { ld?: unknown[]; links?: Array<[string, string]>; body?: string }) =>
  `<!doctype html><html><head><title>t</title>${(opts.ld ?? [])
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join("")}</head><body>${(opts.links ?? []).map(([h, t]) => `<a href="${h}">${t}</a>`).join(" ")}${opts.body ?? ""}</body></html>`;
const sub = (d: DimensionResult, id: string) => d.sub_checks.find((s) => s.id === id) as SubCheck;
const offSite = (calls: string[]) => calls.filter((c) => !/^https:\/\/(?:[a-z0-9-]+\.)*acme\.com\//.test(c));
const ACME = "https://acme.com/";
const FIXED_PRICING = ["/pricing", "/plans", "/price", "/pricing.html"].map((p) => `https://acme.com${p}`);

// ── 1. Fetch scope and bounds ─────────────────────────────────────────────

describe("1.4.2 fetch scope: discovery stays on the audited site", () => {
  it("Dim 5: off-site pricing links are never fetched; same-site links once each, at most 3 (+ at most 3 price samples)", async () => {
    const links: Array<[string, string]> = [];
    for (let i = 0; i < 4000; i++) links.push([`https://evil${i}.example.net/pricing`, "Pricing"]);
    for (let i = 0; i < 3; i++) links.push(["/our-pricing#top", "Pricing"]);
    links.push(["/pricing", "Pricing"]);
    for (let i = 0; i < 10; i++) links.push([`/plans-${i}`, "Plans"]);
    const calls = routes({ [ACME]: html(page({ links })) });
    await runDim5(ACME, env(), "free");
    expect(offSite(calls)).toEqual([]);
    const pricingCalls = calls.filter((c) => /pricing|plans|price/.test(c) && !FIXED_PRICING.includes(c));
    // Discovery: 3 pricing links. Then, with no pricing page and no homepage
    // price, 3 other homepage links are sampled; nothing is requested twice.
    expect(pricingCalls).toEqual([
      "https://acme.com/our-pricing",
      "https://acme.com/plans-0",
      "https://acme.com/plans-1",
      "https://acme.com/plans-2",
      "https://acme.com/plans-3",
      "https://acme.com/plans-4",
    ]);
    expect(FIXED_PRICING.map((p) => calls.filter((c) => c === p).length)).toEqual([1, 1, 1, 1]);
  });

  it("Dim 5: a pricing path and the pricing page read that redirect off-site are not followed", async () => {
    const calls = routes({
      [ACME]: html(page({ links: [["/tarifs", "Pricing"]] })),
      "https://acme.com/pricing": redirect("https://evil.example.net/pricing"),
      "https://acme.com/tarifs": redirect("https://evil.example.net/tarifs"),
    });
    await runDim5(ACME, env(), "free");
    expect(offSite(calls)).toEqual([]);
  });

  it("Dim 5: discovery and sampling share one time budget", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const links: Array<[string, string]> = [];
    for (let i = 0; i < 10; i++) links.push([`/page-${i}`, "About"]);
    // Every request takes 6 s of the 25 s budget (as a slow site would).
    const calls = routes({ [ACME]: html(page({ links })) }, () => {
      now += 6000;
    });
    await runDim5(ACME, env(), "free");
    const pricingAndSamples = calls.filter((c) => FIXED_PRICING.includes(c) || /\/page-\d/.test(c));
    // 4 requests use 24 s; the fifth would start with 1 s left (allowed), the sixth with none.
    expect(pricingAndSamples.length).toBeLessThanOrEqual(5);
  });

  it("Dim 2: a card path that redirects off-site is not followed", async () => {
    const calls = routes({
      "https://acme.com/.well-known/mcp.json": redirect("https://evil.example.net/mcp.json"),
      "https://acme.com/.well-known/mcp/server-card.json": redirect("https://evil.example.net/card.json"),
    });
    await runDim2(ACME, env());
    expect(calls.some((c) => c.includes("evil.example.net"))).toBe(false);
  });

  it("Dim 3: well-known and canonical spec paths that redirect off-site are not followed", async () => {
    const calls = routes({
      "https://acme.com/.well-known/api-catalog": redirect("https://evil.example.net/catalog"),
      "https://acme.com/.well-known/openapi.json": redirect("https://evil.example.net/a"),
      "https://acme.com/openapi.json": redirect("https://evil.example.net/b"),
      "https://acme.com/swagger.json": redirect("https://evil.example.net/c"),
    });
    await runDim3(ACME, env());
    expect(calls.some((c) => c.includes("evil.example.net"))).toBe(false);
  });

  it("Dim 3: a homepage-linked spec on another site is not fetched; a same-site one is", async () => {
    let calls = routes({});
    await runDim3(ACME, env(), { html: `<a href="https://evil.example.net/openapi.json">OpenAPI</a>`, url: ACME });
    expect(calls.some((c) => c.includes("evil.example.net"))).toBe(false);
    calls = routes({});
    await runDim3(ACME, env(), { html: `<a href="https://api.acme.com/docs/openapi.json">OpenAPI</a>`, url: ACME });
    expect(calls).toContain("https://api.acme.com/docs/openapi.json");
  });
});

// ── 2. Price visibility without a pricing page ───────────────────────────

describe("1.4.2 Dim 5: prices measured where they are shown", () => {
  const pricing = async () => sub(await runDim5(ACME, env(), "free"), "pricing_text_visibility");

  it("Ugmonk / Coffee Circle: prices on the homepage are scored from the homepage", async () => {
    routes({ [ACME]: html(page({ body: "<p>Desk Shelf $75</p><p>Notebook $29</p>" })) });
    const s = await pricing();
    expect(s.na).toBeUndefined();
    expect(s.score).toBe(100);
    expect(s.notes).toBe(pricesOnHomepageNote(ACME, "2 text-based price token(s); 0 with a billing period or marked one-time"));
  });

  it("Rachel: a price on a homepage-linked page (any path) is found and scored", async () => {
    routes({
      [ACME]: html(page({ links: [["/mapa-do-casal", "Mapa do Casal"], ["/politica-de-privacidade", "Privacidade"]], body: "<p>Psicoterapia</p>" })),
      "https://acme.com/mapa-do-casal": html(page({ body: "<p>Por apenas R$ 139,90 pagamento único</p>" })),
    });
    const s = await pricing();
    expect(s.score).toBe(100);
    expect(s.notes).toBe(
      pricesOnLinkedPageNote("https://acme.com/mapa-do-casal", "1 text-based price token(s); 1 with a billing period or marked one-time")
    );
  });

  it("product pages are sampled first", () => {
    const h = page({ links: [["/about", "About"], ["/blog", "Blog"], ["/contact", "Contact"], ["/products/tote", "Tote"], ["/account/login", "Login"], ["/logo.png", "x"], ["#top", "Top"], ["/", "Home"]] });
    expect(priceSampleLinks(h, ACME)).toEqual(["https://acme.com/products/tote", "https://acme.com/about", "https://acme.com/blog"]);
  });

  it("no prices anywhere checked: 'not measured', not 'does not apply'", async () => {
    routes({ [ACME]: html(page({ links: [["/about", "About"]], body: "<p>We defend civil liberties.</p>" })), "https://acme.com/about": html(page({ body: "<p>Team</p>" })) });
    const s = await pricing();
    expect(s).toMatchObject({ na: true, notes: pricingNotMeasuredNote(1) });
    expect(s.notes.startsWith("Not measured: we found no pricing page to check")).toBe(true);
  });

  it("an unreadable homepage: 'not measured'", async () => {
    routes({});
    expect(await pricing()).toMatchObject({ na: true, notes: pricingNotMeasuredNote(null) });
  });

  it("a found pricing page is still read as before", async () => {
    routes({ [ACME]: html(page({})), "https://acme.com/pricing": html(page({ body: "<p>$10 / month</p>" })) });
    expect((await pricing()).notes).toBe("Detected https://acme.com/pricing; 1 text-based price token(s); 1 with a billing period or marked one-time.");
  });
});

// ── 3. Ratings ────────────────────────────────────────────────────────────

describe("1.4.2 Dim 4: rating scale needs bestRating above 5; notes name the failure", () => {
  const d4 = async (...ld: unknown[]) => {
    routes({ [ACME]: html(page({ ld })) });
    return sub(await runDim4(ACME, env()), "review_schema");
  };

  it.each([
    [{ "@type": "AggregateRating", ratingValue: 99, reviewCount: 1 }, 50],
    [{ "@type": "AggregateRating", ratingValue: 87, ratingCount: 10 }, 50],
    [{ "@type": "AggregateRating", ratingValue: 87, bestRating: 100, ratingCount: 10 }, 100],
    [{ "@type": "AggregateRating", ratingValue: 0, worstRating: 0, ratingCount: 10 }, 100],
    [{ "@type": "AggregateRating", ratingValue: 4.6, ratingCount: 10 }, 100],
  ])("rating %j => %i", async (block, score) => {
    expect((await d4(block)).score).toBe(score);
  });

  it.each([
    [[{ "@type": "AggregateRating", ratingValue: 99, reviewCount: 1 }], REVIEW_INVALID_VALUE_NOTE],
    [[{ "@type": "AggregateRating", ratingValue: 4, ratingCount: 0 }], REVIEW_INVALID_VALUE_NOTE],
    [[{ "@type": "Review", author: "Ana", reviewRating: { ratingValue: 9 } }], REVIEW_INVALID_VALUE_NOTE],
    [[{ "@type": "AggregateRating", ratingValue: 4 }], REVIEW_MISSING_FIELD_NOTE],
    [[{ "@type": "Review", reviewRating: { ratingValue: 4 } }], REVIEW_MISSING_FIELD_NOTE],
    [[{ "@type": "AggregateRating", ratingValue: 4 }, { "@type": "AggregateRating", ratingValue: 9, ratingCount: 3 }], REVIEW_MIXED_NOTE],
  ])("note for %j names the failure", async (ld, why) => {
    expect((await d4(...ld)).notes).toBe(`${ld.length} Review/AggregateRating block(s); well-formed=false: ${why}`);
  });

  it("a well-formed block keeps the plain note", async () => {
    expect((await d4({ "@type": "AggregateRating", ratingValue: 4.6, ratingCount: 10 })).notes).toBe("1 Review/AggregateRating block(s); well-formed=true");
  });

  it("FAQ: an untyped acceptedAnswer counts (range Answer); a typed non-Answer does not", async () => {
    routes({
      [ACME]: html(
        page({
          ld: [
            {
              "@type": "FAQPage",
              mainEntity: [
                { "@type": "Question", name: "Open Sundays?", acceptedAnswer: { text: "Yes." } },
                { "@type": "Question", name: "Parking?", acceptedAnswer: { "@type": "Comment", text: "Street." } },
              ],
            },
          ],
        })
      ),
    });
    expect(sub(await runDim4(ACME, env()), "faq_schema").notes).toContain("1 Q&A pair(s)");
  });
});

// ── 4. Wording ────────────────────────────────────────────────────────────

describe("1.4.2 notes", () => {
  it("service_offer_schema N/A says what was checked", () => {
    expect(SERVICE_OFFER_NOT_SELLING_NA_NOTE).toBe(
      "We found no product pages, no prices on the homepage and no pricing page, so this check is not counted in your score."
    );
  });

  it("case-study note uses plain words, not h:/l:/b: marks", async () => {
    const study = page({ body: "<h2>Challenge</h2><h2>Solution</h2><h2>Results</h2><ul><li>a</li></ul>" + "<p>" + "We worked with the client. ".repeat(30) + "</p>" });
    routes({ [ACME]: html(page({ links: [["/case-studies/one", "Case"]] })), "https://acme.com/case-studies/one": html(study) });
    const s = sub(await runDim5(ACME, env(), "free"), "case_study_scannability");
    expect(s.notes).toContain("(headings: yes, lists: yes, bold text: no)");
    expect(s.notes).not.toMatch(/[hlb]:[^ ]/);
  });

  it("SCORING_VERSION is 1.4.2", () => expect(SCORING_VERSION).toBe("1.4.2"));
});
