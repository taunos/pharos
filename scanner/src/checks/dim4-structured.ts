import type { DimensionResult, Env, SubCheck } from "../types";
import { dimensionScoreOrThrow, gradeFor } from "../scoring";
import { evalWithCache } from "./llm-eval";

const FETCH_TIMEOUT_MS = 8000;

async function timedFetch(url: string, init?: RequestInit): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      out.push({ __invalid: true, __raw: raw.slice(0, 200) });
    }
  }
  return out;
}

function findByType(blocks: unknown[], typeName: string): Record<string, unknown>[] {
  const matches: Record<string, unknown>[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const obj = b as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string" && t === typeName) matches.push(obj);
    else if (Array.isArray(t) && t.includes(typeName)) matches.push(obj);
    // also descend into @graph if present
    const graph = obj["@graph"];
    if (Array.isArray(graph)) matches.push(...findByType(graph, typeName));
  }
  return matches;
}

async function evalConversational(env: Env, questions: string[]): Promise<{ score: number; note: string }> {
  if (questions.length === 0) return { score: 0, note: "no questions to evaluate" };
  const sample = questions.slice(0, 8).join("\n");
  const prompt = `You are evaluating FAQ questions for whether they sound conversational and natural — the kind of question a human would actually type into ChatGPT, Claude, or Perplexity. Score each question 0-100 based on:

1. Sounds like natural human phrasing (not corporate jargon)
2. Asks a specific, answerable question
3. Would plausibly appear in an AI assistant query

Return a single average score 0-100, nothing else.

QUESTIONS:
${sample}`;

  const { score, cached } = await evalWithCache(env, prompt);
  const tag = cached ? " (cached)" : "";
  return { score, note: `LLM rated ${questions.length} question(s) avg ${score}/100${tag}` };
}

export async function runDim4(targetUrl: string, env: Env): Promise<DimensionResult> {
  const subs: SubCheck[] = [];

  const res = await timedFetch(targetUrl, { headers: { "User-Agent": "AstrantScanner/0.1", Accept: "text/html" } });
  let html = "";
  let blocks: unknown[] = [];
  let invalidCount = 0;
  if (res && res.status === 200) {
    try {
      html = await res.text();
      blocks = extractJsonLdBlocks(html);
      invalidCount = blocks.filter((b) => (b as { __invalid?: boolean })?.__invalid).length;
    } catch {
      // ignore
    }
  }
  const validBlocks = blocks.filter((b) => !(b as { __invalid?: boolean })?.__invalid);

  // 1. json_ld_present
  let presentScore = 0;
  let presentNote = "no JSON-LD found on homepage";
  if (validBlocks.length > 0) {
    presentScore = 100;
    presentNote = `${validBlocks.length} valid JSON-LD block(s) on homepage`;
  } else if (invalidCount > 0) {
    presentScore = 50;
    presentNote = `${invalidCount} JSON-LD block(s) present but failed to parse`;
  }
  subs.push({
    id: "json_ld_present",
    name: "JSON-LD present on homepage",
    weight: 25,
    score: presentScore,
    passed: presentScore >= 70,
    notes: presentNote,
  });

  // 2. organization_schema
  const orgs = findByType(validBlocks, "Organization");
  let orgScore = 0;
  let orgNote = "no Organization schema";
  if (orgs.length > 0) {
    const o = orgs[0];
    let s = 0;
    if (typeof o.name === "string" && o.name) s += 20;
    if (typeof o.url === "string" && o.url) s += 20;
    if (typeof o.description === "string" && o.description) s += 20;
    const sameAs = Array.isArray(o.sameAs) ? o.sameAs : [];
    if (sameAs.length >= 3) s += 40;
    else if (sameAs.length >= 1) s += Math.round((sameAs.length / 3) * 40);
    orgScore = s;
    orgNote = `Organization found: name=${!!o.name}, url=${!!o.url}, description=${!!o.description}, sameAs=${sameAs.length}`;
  }
  subs.push({
    id: "organization_schema",
    name: "Organization schema completeness",
    weight: 20,
    score: orgScore,
    passed: orgScore >= 70,
    notes: orgNote,
  });

  // 3. service_offer_schema
  const services = [
    ...findByType(validBlocks, "Service"),
    ...findByType(validBlocks, "Product"),
    ...findByType(validBlocks, "Offer"),
  ];
  let svcScore = 0;
  let svcNote = "no Service / Product / Offer schema";
  if (services.length > 0) {
    let bestPartial = 0;
    let bestFull = false;
    for (const s of services) {
      const hasName = typeof s.name === "string" && !!s.name;
      const hasDesc = typeof s.description === "string" && !!s.description;
      const hasProvider = !!s.provider || !!s.brand;
      const offers = s.offers;
      const offerArr = Array.isArray(offers) ? offers : offers ? [offers] : [];
      const hasPrice = offerArr.some(
        (o: unknown) =>
          typeof o === "object" &&
          o !== null &&
          ("price" in o || "priceSpecification" in o || "priceCurrency" in o)
      );
      const fullyMet = hasName && hasDesc && hasProvider && hasPrice;
      const partials = [hasName, hasDesc, hasProvider, hasPrice].filter(Boolean).length;
      if (fullyMet) bestFull = true;
      if (partials > bestPartial) bestPartial = partials;
    }
    svcScore = bestFull ? 100 : bestPartial >= 2 ? 50 : 0;
    svcNote = `${services.length} Service/Product/Offer block(s); best match has ${bestPartial}/4 required fields`;
  }
  subs.push({
    id: "service_offer_schema",
    name: "Service / Product / Offer schema",
    weight: 20,
    score: svcScore,
    passed: svcScore >= 70,
    notes: svcNote,
  });

  // 4. faq_schema
  const faqPages = findByType(validBlocks, "FAQPage");
  const questions: string[] = [];
  for (const f of faqPages) {
    const me = f.mainEntity;
    const arr = Array.isArray(me) ? me : me ? [me] : [];
    for (const item of arr) {
      if (typeof item === "object" && item !== null) {
        const q = (item as Record<string, unknown>).name;
        if (typeof q === "string" && q.trim()) questions.push(q.trim());
      }
    }
  }
  const qCount = questions.length;
  let countScore = 0;
  if (qCount >= 5) countScore = 100;
  else if (qCount >= 3) countScore = 60;
  else if (qCount >= 1) countScore = 30;
  let conv = { score: 0, note: "skipped (no questions)" };
  if (qCount > 0) conv = await evalConversational(env, questions);
  const faqScore = Math.round(countScore * 0.6 + conv.score * 0.4);
  subs.push({
    id: "faq_schema",
    name: "FAQPage schema (count + conversational LLM eval)",
    weight: 20,
    score: faqScore,
    passed: faqScore >= 70,
    notes: `${qCount} Q&A pair(s); ${conv.note}`,
  });

  // 5. review_schema
  const reviews = [...findByType(validBlocks, "Review"), ...findByType(validBlocks, "AggregateRating")];
  let reviewScore = 0;
  let reviewNote = "no Review or AggregateRating (common for B2B SaaS — does not imply broken)";
  if (reviews.length > 0) {
    const wellFormed = reviews.some((r) => typeof r.ratingValue !== "undefined" || typeof r.reviewRating !== "undefined" || typeof r.author !== "undefined");
    reviewScore = wellFormed ? 100 : 50;
    reviewNote = `${reviews.length} Review/AggregateRating block(s); well-formed=${wellFormed}`;
  }
  subs.push({
    id: "review_schema",
    name: "Review / AggregateRating schema",
    weight: 15,
    score: reviewScore,
    passed: reviewScore >= 70,
    notes: reviewNote,
  });

  const score = dimensionScoreOrThrow(subs);
  return {
    dimension_id: 4,
    dimension_name: "Structured Capability Data",
    score,
    grade: gradeFor(score),
    sub_checks: subs,
  };
}
