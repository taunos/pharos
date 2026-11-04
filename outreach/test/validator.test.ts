// S1: validator. Approved template outputs 100% accepted; adversarial corpus 100% rejected.
import { describe, it, expect } from "vitest";
import { COPY_RULES, type FactSheet, type Gap } from "../src/facts";
import { OPENER_VARIANTS, SUBJECT_VARIANTS } from "../src/copy";
import { bodyWords } from "../src/render";
import { APPROVED_NUMBER_WHITELIST, validateFields, validateRaw, type DraftFields } from "../src/validator";
import { templateFields } from "../src/writer";

const ctx = { benchmarkUrl: null, privacyUrl: "https://astrant.io/privacy#prospecting" };
const ctxBench = { benchmarkUrl: "https://astrant.io/benchmark", privacyUrl: ctx.privacyUrl };

function gapFrom(key: string, variant: string, domain: string): Gap {
  const r = COPY_RULES.find((x) => x.key === key)!;
  const numbers = key === "1.presence" && variant === "not_found" ? [404] : key === "1.spec_compliance" && variant !== "blockquote" ? [1] : [];
  return { id: `${key}.${variant}`, dimension: key.split(".")[0], anchor: r.anchor, canonical: r.variants[variant].replace(/\{domain\}/g, domain), numbers, rank: 1 };
}

function sheet(gaps: Gap[], domain = "example.com", score = 42): FactSheet {
  return { domain, score, grade: "D", dimensions_applicable: 5, score_url: `https://astrant.io/score/x`, scan_id: "x", gaps };
}

const allGaps = (domain: string) => COPY_RULES.flatMap((r) => Object.keys(r.variants).map((v) => gapFrom(r.key, v, domain)));

const DOMAINS = ["example.com", "acme-api.io", "b2b42.dev", "a-really-long-company-name-for-testing.com"];

describe("S1 approved copy is 100% accepted", () => {
  for (const domain of DOMAINS) {
    it(`every subject/opener variant × every copy-table row (${domain})`, () => {
      const gaps = allGaps(domain);
      let checked = 0;
      for (const g1 of gaps) {
        for (const g2 of gaps) {
          if (g1 === g2 || g1.dimension === g2.dimension) continue; // one gap per dimension
          for (let v = 0; v < SUBJECT_VARIANTS.length; v++) {
            const s = sheet([g1, g2], domain);
            const f = templateFields(s, v);
            for (const c of [ctx, ctxBench]) {
              const r = validateFields(f, s, (x) => bodyWords(x, s, c));
              if (!r.ok) {
                // Long domains may push a subject past 60 chars; the writer then tries the next variant.
                const onlyLength = r.failures.every((x) => x === "length:subject");
                expect(onlyLength && domain.length > 30, `${domain} ${g1.id} ${g2.id} v${v}: ${r.failures.join(", ")}`).toBe(true);
              }
              checked++;
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(50);
    });
  }

  it("number whitelist is derived from approved copy, not hand-typed", () => {
    // "100" from "{score}/100", "2" from "B2B" in the benchmark line.
    expect([...APPROVED_NUMBER_WHITELIST].sort()).toEqual(["100", "2"]);
    // copy-table numbers are NOT in the global whitelist
    expect(APPROVED_NUMBER_WHITELIST.has("404")).toBe(false);
  });
  it("there are exactly 3 subject and 3 opener variants", () => {
    expect(SUBJECT_VARIANTS.length).toBe(3);
    expect(OPENER_VARIANTS.length).toBe(3);
  });
});

describe("S1 adversarial corpus is 100% rejected", () => {
  const s = sheet([gapFrom("1.presence", "not_found", "example.com"), gapFrom("4.json_ld_present", "none", "example.com")]);
  // Codex review #1: the only passing drafts are approved text filled from the scan.
  const good: DraftFields = templateFields(s, 0);

  const words = (f: DraftFields) => bodyWords(f, s, ctx);
  it("the baseline draft passes", () => {
    expect(validateFields(good, s, words)).toEqual({ ok: true, fields: good });
  });

  const corpus: [string, Partial<DraftFields>, RegExp][] = [
    // preambles / meta
    ["preamble sure", { opener: "Sure, here's the email: I'm Bruno from Astrant." }, /preamble/],
    ["preamble here is", { subject: "Here is a subject line" }, /preamble/],
    ["preamble certainly", { finding_1: "Certainly! llms.txt is missing (404)." }, /preamble/],
    ["preamble dear", { opener: "Dear example.com team, I'm Bruno." }, /preamble/],
    ["preamble subject:", { subject: "Subject: two fixes" }, /preamble/],
    ["preamble okay", { opener: "Okay. I'm Bruno from Astrant." }, /preamble/],
    ["meta as an ai", { opener: "I'm Bruno; as an AI language model I can help." }, /meta|preamble/],
    ["meta i cannot", { finding_2: "I cannot verify the JSON-LD on the homepage." }, /meta/],
    // markdown
    ["markdown bold", { finding_1: "**llms.txt** returns a 404." }, /markdown/],
    ["markdown link", { finding_1: "See [llms.txt](x) which returns a 404." }, /markdown|placeholder/],
    ["markdown bullet", { finding_1: "- llms.txt returns a 404." }, /markdown/],
    ["markdown heading", { opener: "# Hi, I'm Bruno" }, /markdown/],
    ["markdown backtick", { finding_1: "`llms.txt` returns a 404." }, /markdown/],
    ["markdown underscore", { finding_2: "No JSON-LD _at all_ on the homepage." }, /markdown/],
    // placeholders
    ["placeholder braces", { opener: "I'm {name}, I build Astrant." }, /placeholder/],
    ["placeholder brackets", { opener: "I'm [Your Name], founder of Astrant." }, /placeholder|markdown/],
    ["placeholder lorem", { finding_2: "Lorem ipsum JSON-LD." }, /placeholder/],
    ["placeholder tbd", { finding_2: "JSON-LD status TBD." }, /placeholder/],
    ["placeholder n/a", { finding_2: "JSON-LD: n/a on the homepage." }, /placeholder/],
    ["placeholder company name", { opener: "I'm Bruno and I help Company Name with fixes." }, /placeholder/],
    // invented numbers
    ["invented number", { finding_1: "llms.txt returns a 404 on 3 of your pages." }, /grounding:number/],
    ["invented score", { opener: "I'm Bruno. Your site scored 37 on two things worth fixing." }, /grounding:number/],
    ["percentage", { finding_2: "The homepage JSON-LD is 50% missing." }, /banned:.*%|grounding:number/],
    ["404 borrowed by a non-404 sheet", {}, /grounding:number/], // handled below
    // extra domains / URLs
    ["url", { finding_1: "https://example.com/llms.txt returns a 404." }, /grounding:url/],
    ["www", { finding_1: "www.example.com/llms.txt returns a 404." }, /grounding:url/],
    ["other domain", { finding_2: "Unlike stripe.com, your homepage has no JSON-LD." }, /grounding:domain/],
    // competitor / AI product names
    ["ChatGPT", { finding_2: "Without JSON-LD, ChatGPT gets less about you." }, /grounding:entity/],
    ["Perplexity", { opener: "I'm Bruno; Perplexity and two things on example.com." }, /grounding:entity/],
    ["Google", { finding_2: "Google can't read your JSON-LD." }, /grounding:entity|banned/],
    ["Claude", { opener: "I'm Bruno, Claude and I build Astrant." }, /grounding:entity/],
    // banned claims
    ["invisible", { finding_2: "You're invisible without JSON-LD." }, /banned/],
    ["can't find", { finding_1: "Assistants can't find llms.txt (404)." }, /banned/],
    ["losing", { finding_2: "You're losing deals without JSON-LD." }, /banned/],
    ["guarantee", { opener: "I'm Bruno; I guarantee two fixes." }, /banned/],
    ["ranking", { finding_2: "JSON-LD hurts your ranking." }, /banned/],
    ["cited", { finding_2: "Sites with JSON-LD get cited." }, /banned/],
    ["traffic", { finding_2: "JSON-LD brings traffic." }, /banned/],
    ["competitor", { finding_2: "Your competitor has JSON-LD." }, /banned/],
    ["best", { opener: "I'm Bruno, the best at this. Two things:" }, /banned/],
    ["only", { finding_2: "Only JSON-LD matters." }, /banned/],
    ["urgent", { subject: "Urgent fix for example.com" }, /banned/],
    ["discount", { opener: "I'm Bruno. Discount on two fixes:" }, /banned/],
    // D17 false effort / method
    ["I spent time", { opener: "I'm Bruno, I spent time on example.com and found two things." }, /d17/],
    ["I personally reviewed", { opener: "I'm Bruno and I personally reviewed example.com." }, /d17/],
    ["I looked through", { opener: "I'm Bruno; I looked through example.com." }, /d17/],
    ["I noticed", { opener: "I'm Bruno and I noticed two things on example.com." }, /d17/],
    ["I came across", { opener: "I'm Bruno, I came across example.com." }, /d17/],
    ["been following", { opener: "I'm Bruno, I've been following example.com." }, /d17/],
    ["scan", { opener: "I'm Bruno; a scan of example.com shows two things." }, /d17/],
    ["scanner", { opener: "I'm Bruno; our scanner flagged two things." }, /d17/],
    ["automated", { opener: "I'm Bruno; an automated check found two things." }, /d17/],
    ["automatically", { opener: "I'm Bruno; this was automatically written." }, /d17/],
    ["fan of", { opener: "I'm Bruno, a big fan of example.com." }, /d17/],
    ["love your", { opener: "I'm Bruno and I love your product." }, /d17/],
    ["impressed", { opener: "I'm Bruno, impressed by example.com." }, /d17/],
    ["congrats", { opener: "I'm Bruno, congrats on the launch." }, /d17/],
    ["saw your", { opener: "I'm Bruno, I saw your post." }, /d17/],
    // anchors
    ["missing anchor", { finding_1: "A file at the root returns a 404." }, /finding_1_anchor/],
    ["foreign anchor", { finding_2: "The homepage has no JSON-LD and no Markdown version." }, /foreign_anchor/],
    // shape / length / subject
    ["newline", { opener: "I'm Bruno.\nTwo things:" }, /newline/],
    ["subject too long", { subject: "Two fixes for example.com that are really worth your time today" }, /length:subject/],
    ["opener too long", { opener: "I'm Bruno. " + "Two things on example.com are worth fixing. ".repeat(6) }, /length:opener/],
    ["all caps subject", { subject: "TWO FIXES FOR EXAMPLE.COM" }, /all_caps/],
    ["exclamation", { subject: "Two fixes for example.com!" }, /exclamation/],
    ["re:", { subject: "Re: example.com" }, /re_fwd/],
    ["fwd:", { subject: "Fwd: example.com" }, /re_fwd/],
    ["emoji", { subject: "Two fixes for example.com \u{1F680}" }, /emoji/],
    ["empty", { finding_2: "" }, /empty/],
  ];
  for (const [name, patch, expected] of corpus) {
    if (name.startsWith("404 borrowed")) continue;
    it(`rejects: ${name}`, () => {
      const r = validateFields({ ...good, ...patch }, s, words);
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.failures.join(" ")).toMatch(expected);
    });
  }

  it("rejects a 404 when this lead's llms.txt gap is the HTML variant (no borrowed numbers)", () => {
    const s2 = sheet([gapFrom("1.presence", "html", "example.com"), gapFrom("4.json_ld_present", "none", "example.com")]);
    const r = validateFields({ ...good, finding_1: "/llms.txt on example.com returns a 404 page." }, s2, (f) => bodyWords(f, s2, ctx));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.join(" ")).toMatch(/grounding:number:finding_1:404/);
  });

  it("rejects raw model output that is not exactly the JSON object", () => {
    expect(validateRaw("Sure! {\"subject\":\"x\"}", s, words).ok).toBe(false);
    expect(validateRaw("not json", s, words).ok).toBe(false);
    expect(validateRaw(JSON.stringify({ ...good, extra: "x" }), s, words).ok).toBe(false);
    expect(validateRaw(JSON.stringify({ subject: good.subject, opener: good.opener, finding_1: good.finding_1 }), s, words).ok).toBe(false);
    expect(validateRaw([good], s, words).ok).toBe(false);
    expect(validateRaw(JSON.stringify(good), s, words).ok).toBe(true);
  });

  it("rejects a body over 120 words", () => {
    const r = validateFields(good, s, () => 121);
    expect(r.ok).toBe(false);
  });
});
