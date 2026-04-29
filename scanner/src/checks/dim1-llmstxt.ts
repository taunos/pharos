import type { DimensionResult, Env, SubCheck } from "../types";
import { dimensionScore, gradeFor } from "../scoring";
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

function isMarkdowny(body: string): boolean {
  // Crude heuristic: any markdown headings, lists, links, or > blockquotes.
  return /(^|\n)(#|>|\*|-|\d+\.)\s/.test(body) || /\]\(/.test(body);
}

function extractLinks(body: string): string[] {
  const out: string[] = [];
  const re = /^\s*[-*]\s*\[.+?\]\(([^)]+)\)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

function extractH1(body: string): string | null {
  for (const line of body.split(/\r?\n/, 50)) {
    const m = line.match(/^\s*#\s+(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

function extractBlockquote(body: string): string | null {
  for (const line of body.split(/\r?\n/, 10)) {
    const m = line.match(/^\s*>\s+(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

async function evalBlockquote(env: Env, blockquote: string): Promise<{ score: number; note: string }> {
  const prompt = `You are evaluating an llms.txt file's blockquote summary for an AI agent's consumption. Rate it 0-100 based on three criteria, equally weighted:

1. Clearly states what the site/product does
2. Clearly states who it's for
3. Length is between 50 and 250 words

Return ONLY a number 0-100, nothing else.

BLOCKQUOTE:
${blockquote}`;

  const { score, cached } = await evalWithCache(env, prompt);
  const tag = cached ? " (cached)" : "";
  return { score, note: `LLM rated blockquote ${score}/100${tag}` };
}

export async function runDim1(targetUrl: string, env: Env): Promise<DimensionResult> {
  const origin = new URL(targetUrl).origin;
  const llmsUrl = `${origin}/llms.txt`;
  const subs: SubCheck[] = [];

  // 1. presence
  const res = await timedFetch(llmsUrl, { headers: { "User-Agent": "AstrantScanner/0.1" } });
  const ct = res?.headers.get("content-type") ?? "";
  const presenceOk = !!res && res.status === 200;
  const ctOk = /^text\/(plain|markdown)/.test(ct);
  const presenceScore = presenceOk ? (ctOk ? 100 : 50) : 0;
  subs.push({
    id: "presence",
    name: "Presence",
    weight: 25,
    score: presenceScore,
    passed: presenceScore >= 70,
    notes: !res
      ? "fetch failed"
      : res.status !== 200
        ? `status=${res.status}`
        : `status=200, content-type="${ct}"`,
  });

  let body = "";
  if (presenceOk) {
    try {
      body = await res!.text();
    } catch {
      body = "";
    }
  }

  // 2. spec_compliance
  const h1 = body ? extractH1(body) : null;
  const blockquote = body ? extractBlockquote(body) : null;
  const specScore = h1 && blockquote ? 100 : h1 || blockquote ? 50 : 0;
  subs.push({
    id: "spec_compliance",
    name: "Spec compliance (H1 + blockquote)",
    weight: 25,
    score: specScore,
    passed: specScore >= 70,
    notes: `h1=${h1 ? "yes" : "no"}, blockquote=${blockquote ? "yes" : "no"}`,
  });

  // 3. linked_pages_quality
  const links = body ? extractLinks(body) : [];
  let linkedScore = 0;
  let linkedNote = "no links to sample";
  if (links.length > 0) {
    const sample = links.slice(0, 5);
    const results = await Promise.all(
      sample.map(async (l) => {
        try {
          const url = new URL(l, llmsUrl).toString();
          const r = await timedFetch(url, { headers: { Accept: "text/markdown,text/plain,*/*" } });
          if (!r) return false;
          if (r.status !== 200) return false;
          const t = await r.text();
          return isMarkdowny(t);
        } catch {
          return false;
        }
      })
    );
    const good = results.filter(Boolean).length;
    linkedScore = Math.round((good / sample.length) * 100);
    linkedNote = `${good}/${sample.length} sampled links return markdown-ish content`;
  }
  subs.push({
    id: "linked_pages_quality",
    name: "Linked pages return useful markdown",
    weight: 20,
    score: linkedScore,
    passed: linkedScore >= 70,
    notes: linkedNote,
  });

  // 4. curation_quality
  // Gate: if the file isn't there, or it loaded but has zero links, the
  // anti-pattern detection below is meaningless — there's nothing to curate.
  // Returning 100/"clean link list" in those cases (the old behavior) was
  // misleading. Instead, score 0 with honest notes so the per-dimension
  // breakdown reflects the missing-file reality.
  let curationScore = 0;
  let curationNotes = "";
  if (!presenceOk || !body) {
    curationNotes = "file missing — no link list to evaluate";
  } else if (links.length === 0) {
    curationNotes = "empty file — no links to evaluate";
  } else {
    curationScore = 100;
    const antipatterns: string[] = [];
    if (links.length > 100) {
      curationScore -= 20;
      antipatterns.push(`${links.length} links (>100)`);
    }
    if (links.some((l) => /\/tag\//i.test(l))) {
      curationScore -= 20;
      antipatterns.push("tag pages linked");
    }
    if (links.some((l) => /\/archive\//i.test(l))) {
      curationScore -= 20;
      antipatterns.push("archive pages linked");
    }
    if (links.some((l) => /\/search\?/i.test(l))) {
      curationScore -= 20;
      antipatterns.push("search-result URLs linked");
    }
    if (links.some((l) => /\?(?!_pharos_t=)/.test(l))) {
      curationScore -= 20;
      antipatterns.push("links contain query strings");
    }
    curationScore = Math.max(0, curationScore);
    curationNotes =
      antipatterns.length === 0 ? "clean link list" : antipatterns.join("; ");
  }
  subs.push({
    id: "curation_quality",
    name: "Curation quality",
    weight: 15,
    score: curationScore,
    passed: curationScore >= 70,
    notes: curationNotes,
  });

  // 5. blockquote_eval
  let bqScore = 0;
  let bqNote = "no blockquote to evaluate";
  if (blockquote) {
    const r = await evalBlockquote(env, blockquote);
    bqScore = r.score;
    bqNote = r.note;
  }
  subs.push({
    id: "blockquote_eval",
    name: "Blockquote elevator-pitch quality (LLM)",
    weight: 15,
    score: bqScore,
    passed: bqScore >= 70,
    notes: bqNote,
  });

  const score = dimensionScore(subs);
  return {
    dimension_id: 1,
    dimension_name: "llms.txt Quality",
    score,
    grade: gradeFor(score),
    sub_checks: subs,
  };
}
