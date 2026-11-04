// §7.2 writer, tightened after Codex review #1 (fact grounding).
//
// The model writes NO free text. It only chooses which approved subject and
// opener to use (by number). The findings are the approved per-finding
// sentences, filled with scan data only, inserted verbatim. So every claim in
// a draft provably comes from the scan, and the validator (which pins every
// field to approved text) is a second line of defence, not the only one.
// Model failure (bad JSON, out-of-range pick, error) ⇒ one retry ⇒ rotation.
//
// JSON mode: Cloudflare's JSON-mode model list (2026-11-04) does not include
// the -fp8 id, so this uses prompt-constrained JSON.
import { OPENER_VARIANTS, SUBJECT_VARIANTS, fill } from "./copy";
import type { FactSheet } from "./facts";
import { bodyWords, type RenderCtx } from "./render";
import { validateFields, type DraftFields } from "./validator";
import type { AiBinding } from "./types";

export const WRITER_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

export type DraftOutcome =
  | { ok: true; fields: DraftFields; path: "llm" | "llm_retry" | "template"; report: DraftReport }
  | { ok: false; report: DraftReport };
export type DraftReport = { path: string; attempts: { path: string; failures: string[] }[]; template_variant?: number; choice?: { subject: number; opener: number } };

const NL = String.fromCharCode(10);

export function systemPrompt(): string {
  return [
    "You pick the best-fitting subject line and opening line for a short email, from fixed numbered options.",
    'Return ONLY a JSON object: {"subject": <option number>, "opener": <option number>}. No other text.',
  ].join(NL);
}

/**
 * The model never sees outside-world data: no site text, no domain, no email
 * content. Only enumerated finding codes (from the code-owned copy table) and
 * the approved option texts with the {domain} slot left unfilled.
 */
export function userPrompt(sheet: FactSheet, retry = false): string {
  const subjects = SUBJECT_VARIANTS.map((t, i) => `${i}: ${t}`).join(NL);
  const openers = OPENER_VARIANTS.map((t, i) => `${i}: ${t}`).join(NL);
  const findings = sheet.gaps
    .slice(0, 2)
    .map((g) => `- ${g.id}`)
    .filter((l) => /^- [0-9]\.[a-z_]+\.[a-z_]+$/.test(l))
    .join(NL);
  let p = ["The email's two finding codes:", findings, "", "Subject options:", subjects, "", "Opener options:", openers].join(NL);
  if (retry) p += NL + NL + "Answer with only the JSON object, using option numbers from the lists.";
  return p;
}

/** Parses the model's pick. Anything but two in-range integers is a failure. */
export function parseChoice(raw: unknown): { subject: number; opener: number } | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const keys = Object.keys(o).sort().join(",");
  if (keys !== "opener,subject") return null;
  const { subject, opener } = o as { subject: unknown; opener: unknown };
  if (!Number.isInteger(subject) || !Number.isInteger(opener)) return null;
  if ((subject as number) < 0 || (subject as number) >= SUBJECT_VARIANTS.length) return null;
  if ((opener as number) < 0 || (opener as number) >= OPENER_VARIANTS.length) return null;
  return { subject: subject as number, opener: opener as number };
}

export function fieldsFor(sheet: FactSheet, subject: number, opener: number): DraftFields {
  return {
    subject: fill(SUBJECT_VARIANTS[subject], { domain: sheet.domain }),
    opener: fill(OPENER_VARIANTS[opener], { domain: sheet.domain }),
    finding_1: sheet.gaps[0].canonical,
    finding_2: sheet.gaps[1].canonical,
  };
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
    for (const path of ["llm", "llm_retry"] as const) {
      let choice: { subject: number; opener: number } | null = null;
      try {
        const res = await opts.ai.run(WRITER_MODEL, {
          messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: userPrompt(sheet, path === "llm_retry") },
          ],
          temperature: 0.2,
          max_tokens: 40,
        });
        choice = parseChoice(extractModelJson(res));
      } catch {
        report.attempts.push({ path, failures: ["model:error"] });
        break; // model down: straight to rotation
      }
      if (!choice) {
        report.attempts.push({ path, failures: ["model:bad_choice"] });
        continue;
      }
      const f = fieldsFor(sheet, choice.subject, choice.opener);
      const v = validateFields(f, sheet, words);
      if (v.ok) {
        report.path = path;
        report.choice = choice;
        return { ok: true, fields: v.fields, path, report };
      }
      // e.g. a long domain pushed that subject past 60 chars: try again, then rotate.
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
