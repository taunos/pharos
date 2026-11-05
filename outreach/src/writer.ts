// §7.2 writer: DETERMINISTIC, no model (2026-11-04).
//
// Bruno approved one fixed opener, so the only remaining choice was the
// subject. A rotation over the 3 approved subjects replaces the model: no LLM
// is in the email-writing path at all. Every field is approved code-owned text
// filled with validated scan values; the validator still checks the result.
import { OPENER, SUBJECT_VARIANTS, fill } from "./copy";
import type { FactSheet } from "./facts";
import { bodyWords, type RenderCtx } from "./render";
import { validateFields, type DraftFields } from "./validator";

export type DraftOutcome =
  | { ok: true; fields: DraftFields; path: "rotation"; report: DraftReport }
  | { ok: false; report: DraftReport };
export type DraftReport = { path: string; attempts: { path: string; failures: string[] }[]; template_variant?: number };

export function templateFields(sheet: FactSheet, variant: number): DraftFields {
  const i = ((variant % SUBJECT_VARIANTS.length) + SUBJECT_VARIANTS.length) % SUBJECT_VARIANTS.length;
  return {
    subject: fill(SUBJECT_VARIANTS[i], { domain: sheet.domain }),
    opener: fill(OPENER, { domain: sheet.domain }),
    finding_1: sheet.gaps[0].canonical,
    finding_2: sheet.gaps[1].canonical,
  };
}

export async function draftEmail(opts: { sheet: FactSheet; ctx: RenderCtx; templateVariant: number }): Promise<DraftOutcome> {
  const { sheet, ctx } = opts;
  const words = (f: DraftFields) => bodyWords(f, sheet, ctx);
  const report: DraftReport = { path: "", attempts: [] };
  if (sheet.gaps.length < 2) {
    report.path = "failed";
    report.attempts.push({ path: "precheck", failures: ["grounding:lt_2_gaps"] });
    return { ok: false, report };
  }
  // Rotate from the requested subject; a long domain can push one subject past 60 chars.
  for (let k = 0; k < SUBJECT_VARIANTS.length; k++) {
    const variant = (opts.templateVariant + k) % SUBJECT_VARIANTS.length;
    const v = validateFields(templateFields(sheet, variant), sheet, words);
    if (v.ok) {
      report.path = "rotation";
      report.template_variant = variant;
      return { ok: true, fields: v.fields, path: "rotation", report };
    }
    report.attempts.push({ path: `rotation_v${variant}`, failures: v.failures });
  }
  report.path = "failed";
  return { ok: false, report };
}
