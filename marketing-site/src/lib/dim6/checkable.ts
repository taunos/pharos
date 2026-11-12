// dim6:v6 scoring option A (Bruno, 2026-11-12): an answer we could not check
// against the site's own text is left out of the score instead of counting
// as 0, and the grade is shown only when enough answers were checkable.
//
// "Checkable" = a measured answer (the provider answered) whose verdict is one
// of: backed by the site's text (accuracy=CORRECT), the homepage address given
// for the URL question (url_only), linked to a different person or business
// (misidentified / possible_mixup_cut_off), contradicted by the site's text
// (facts_contradicted), the model did not show it knew the site (judge=DENY),
// or an answer that claims to know the site when the site's own description
// is missing, unreadable or carries text aimed at automated checkers
// (accuracy_not_checked / accuracy_blocked). Those keep their score: mix-ups,
// contradictions and the fail-closed answers stay 0. The site controls its
// own description, so leaving those answers out would let a site hide a weak
// Citation Visibility section by breaking or removing its description (Codex
// review 2026-11-12, MED).
//
// "Not checkable" = a measured answer we could not check:
//   - accuracy_unclear=true: not enough evidence in the site's text, cut off,
//     an unlisted street address, or one of our checks failed (accuracy_failed);
//   - affirmation_failed=true: the affirmation judge failed twice.
// Our own failed checks (accuracy_failed=..., affirmation_failed=true) are
// "not checkable" too, but they never decide a grade: runDim6.ts withholds the
// grade when counting them as 0 or as 100 would give a different grade.

import { ALL_MODEL_IDS, type CellEnvelope, type ModelId } from "./types";

/** Minimum checkable answers (of the 40) for a Citation Visibility grade. */
export const DIM6_MIN_CHECKABLE = 24;
/** Minimum checkable answers from each of the 4 AI providers. */
export const DIM6_MIN_CHECKABLE_PER_MODEL = 5;

const UNCHECKABLE_RE = /(?:^|; )(?:accuracy_unclear=true|affirmation_failed=true)(?:;|$)/;
const FAILED_RE = /(?:^|; )(?:accuracy_failed=[a-z_]+|affirmation_failed=true)(?:;|$)/;

type CellLike = { result: { unmeasurable: boolean; notes: string } };

/** A measured answer we could not check against the site's own text. */
export function isUncheckable(c: CellLike): boolean {
  return !c.result.unmeasurable && UNCHECKABLE_RE.test(c.result.notes);
}

/** A measured answer that counts in the score. */
export function isCheckable(c: CellLike): boolean {
  return !c.result.unmeasurable && !UNCHECKABLE_RE.test(c.result.notes);
}

/** An uncheckable answer because one of our own checks failed (not the answer's evidence). */
export function isFailedCheck(c: CellLike): boolean {
  return isUncheckable(c) && FAILED_RE.test(c.result.notes);
}

export interface CheckableCounts {
  checkable: number;
  uncheckable: number;
  /** Of the uncheckable: our own checks failed. */
  failed: number;
  /** Sum of the checkable answers' scores. */
  checkableScoreSum: number;
  perModel: Record<ModelId, number>;
  /** Models with fewer than DIM6_MIN_CHECKABLE_PER_MODEL checkable answers, in ALL_MODEL_IDS order. */
  thinModels: ModelId[];
  /** true when there are enough checkable answers for a grade. */
  meetsFloor: boolean;
}

export function checkableCounts(cells: Array<CellLike & { modelId: ModelId; result: { score: number } }>): CheckableCounts {
  const perModel = Object.fromEntries(ALL_MODEL_IDS.map((m) => [m, 0])) as Record<ModelId, number>;
  let checkable = 0;
  let uncheckable = 0;
  let failed = 0;
  let checkableScoreSum = 0;
  for (const c of cells) {
    if (isCheckable(c)) {
      checkable++;
      checkableScoreSum += c.result.score;
      if (c.modelId in perModel) perModel[c.modelId]++;
    } else if (isUncheckable(c)) {
      uncheckable++;
      if (isFailedCheck(c)) failed++;
    }
  }
  const thinModels = ALL_MODEL_IDS.filter((m) => perModel[m] < DIM6_MIN_CHECKABLE_PER_MODEL);
  return { checkable, uncheckable, failed, checkableScoreSum, perModel, thinModels, meetsFloor: checkable >= DIM6_MIN_CHECKABLE && thinModels.length === 0 };
}

/**
 * The score if our failed checks had been counted, at worst (each 0) and at
 * best (each 100). Equal to the checkable average when nothing failed.
 */
export function failedCheckBounds(counts: CheckableCounts): { low: number; high: number } {
  const n = counts.checkable + counts.failed;
  if (n === 0) return { low: 0, high: 0 };
  return { low: Math.round(counts.checkableScoreSum / n), high: Math.round((counts.checkableScoreSum + 100 * counts.failed) / n) };
}
