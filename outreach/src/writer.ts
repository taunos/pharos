// §7.2 writer: Workers AI (llama-3.1-8b-instruct-fp8) → validator → one retry
// with the failed rules → template fallback → validator → else draft_failed.
//
// JSON mode: Cloudflare's JSON-mode model list (2026-11-04) does not include
// the -fp8 id, so this uses prompt-constrained JSON + the validator, per spec.
import { OPENER_VARIANTS, SUBJECT_VARIANTS, fill } from "./copy";
import type { FactSheet } from "./facts";
import { bodyWords, type RenderCtx } from "./render";
import { validateFields, validateRaw, type DraftFields } from "./validator";
import type { AiBinding } from "./types";

export const WRITER_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

export type DraftOutcome =
  | { ok: true; fields: DraftFields; path: "llm" | "llm_retry" | "template"; report: DraftReport }
  | { ok: false; report: DraftReport };
export type DraftReport = { path: string; attempts: { path: string; failures: string[] }[]; template_variant?: number };

export function systemPrompt(): string {
  return [
    "You write one short, plain cold email for Bruno, founder of Astrant, in the first person.",
    "Return ONLY a JSON object with exactly these keys: subject, opener, finding_1, finding_2. No other text.",
    "Rules:",
    "- Use ONLY the facts given. Do not add numbers, names, products, companies or URLs.",
    "- finding_1 rewrites gap 1's sentence and must contain its anchor term exactly; finding_2 the same for gap 2.",
    "- opener: one sentence introducing Bruno and Astrant, leading into two things worth fixing.",
    "- Never mention how the facts were found. Never say you looked, reviewed, noticed, spent time or browsed.",
    "- No compliments, no personal details, no praise, no urgency, no claims about traffic, rankings or AI citations.",
    "- subject: under 60 characters, plain, no exclamation marks, no Re:.",
    "- Plain text only: no markdown, no bullet characters, no line breaks inside a value.",
  ].join("\n");
}

export function userPrompt(sheet: FactSheet, failures?: string[]): string {
  const facts = {
    domain: sheet.domain,
    gap_1: { anchor: sheet.gaps[0].anchor, sentence: sheet.gaps[0].canonical },
    gap_2: { anchor: sheet.gaps[1].anchor, sentence: sheet.gaps[1].canonical },
  };
  let p = `Facts (the only facts you may use):\n${JSON.stringify(facts)}`;
  if (failures && failures.length) {
    p += `\n\nYour previous answer broke these rules: ${failures.join(", ")}. Fix them and answer again with only the JSON object.`;
  }
  return p;
}

/**
 * Workers AI returns { response } as an object (JSON mode) or a string. A string
 * is passed through trimmed and must parse as the bare JSON object: a preamble
 * around it is a failure signal, not something to strip.
 */
export function extractModelJson(res: unknown): unknown {
  const r = (res as { response?: unknown })?.response ?? res;
  if (r && typeof r === "object") return r;
  return typeof r === "string" ? r.trim() : null;
}

export function templateFields(sheet: FactSheet, variant: number): DraftFields {
  const i = ((variant % SUBJECT_VARIANTS.length) + SUBJECT_VARIANTS.length) % SUBJECT_VARIANTS.length;
  return {
    subject: fill(SUBJECT_VARIANTS[i], { domain: sheet.domain }),
    opener: fill(OPENER_VARIANTS[i % OPENER_VARIANTS.length], { domain: sheet.domain }),
    finding_1: sheet.gaps[0].canonical,
    finding_2: sheet.gaps[1].canonical,
  };
}

export async function draftEmail(opts: {
  sheet: FactSheet;
  ctx: RenderCtx;
  writerMode: "llm" | "template";
  ai: AiBinding | null; // null ⇒ model calls not allowed (mode gate)
  templateVariant: number;
}): Promise<DraftOutcome> {
  const { sheet, ctx } = opts;
  const words = (f: DraftFields) => bodyWords(f, sheet, ctx);
  const report: DraftReport = { path: "", attempts: [] };
  if (sheet.gaps.length < 2) {
    report.path = "failed";
    report.attempts.push({ path: "precheck", failures: ["grounding:lt_2_gaps"] });
    return { ok: false, report };
  }

  if (opts.writerMode === "llm" && opts.ai) {
    let failures: string[] | undefined;
    for (const path of ["llm", "llm_retry"] as const) {
      let raw: unknown;
      try {
        const res = await opts.ai.run(WRITER_MODEL, {
          messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: userPrompt(sheet, failures) },
          ],
          temperature: 0.2,
          max_tokens: 400,
        });
        raw = extractModelJson(res);
      } catch (e) {
        report.attempts.push({ path, failures: ["model:error"] });
        break; // model down: straight to template
      }
      const v = validateRaw(raw, sheet, words);
      if (v.ok) {
        report.path = path;
        return { ok: true, fields: v.fields, path, report };
      }
      failures = v.failures;
      report.attempts.push({ path, failures: v.failures });
    }
  }

  // Rotate from the requested variant; a long domain can push one subject past 60 chars.
  for (let k = 0; k < SUBJECT_VARIANTS.length; k++) {
    const variant = opts.templateVariant + k;
    const tf = templateFields(sheet, variant);
    const v = validateFields(tf, sheet, words);
    if (v.ok) {
      report.template_variant = variant % SUBJECT_VARIANTS.length;
      report.path = "template";
      return { ok: true, fields: v.fields, path: "template", report };
    }
    report.attempts.push({ path: `template_v${variant % SUBJECT_VARIANTS.length}`, failures: v.failures });
  }
  report.path = "failed";
  return { ok: false, report };
}
