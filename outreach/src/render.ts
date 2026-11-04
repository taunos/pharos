// §7.2 rendering: code skeleton + model fields + code-owned footer. Plain text.
import {
  BENCHMARK_LINE, CLOSING_LINE, COMMERCIAL_LINE, FOLLOWUP_BODY, FOLLOWUP_SIGNATURE, FOLLOWUP_SUBJECT_PREFIX,
  FOOTER_SEPARATOR, GREETING, OPTOUT_LINE, OPTOUT_REPLY_LINE, PRIVACY_LINE, SCORE_LINE, SIGNATURE, fill,
} from "./copy";
import type { FactSheet } from "./facts";
import type { DraftFields } from "./validator";
import { wordCount } from "./validator";

// The opt-out URL is per message and only known when the mailbox draft is created; D1 drafts carry this marker.
export const OPTOUT_URL_MARKER = "{optout_url}";
export const POSTAL_MARKER = "{postal_address}";

export type RenderCtx = { benchmarkUrl: string | null; privacyUrl: string };

export function bodyHead(f: DraftFields, sheet: FactSheet, ctx: RenderCtx): string[] {
  const lines = [
    fill(GREETING, { domain: sheet.domain }),
    f.opener,
    `1. ${f.finding_1}`,
    `2. ${f.finding_2}`,
    fill(SCORE_LINE, { score: sheet.score, score_url: sheet.score_url }),
  ];
  if (ctx.benchmarkUrl) lines.push(fill(BENCHMARK_LINE, { benchmark_url: ctx.benchmarkUrl }));
  lines.push(CLOSING_LINE, SIGNATURE);
  return lines;
}

export function bodyWords(f: DraftFields, sheet: FactSheet, ctx: RenderCtx): number {
  return wordCount(bodyHead(f, sheet, ctx).join(" "));
}

export function footer(ctx: RenderCtx): string[] {
  return [
    FOOTER_SEPARATOR,
    COMMERCIAL_LINE,
    POSTAL_MARKER,
    fill(OPTOUT_LINE, {}), // keeps {optout_url}
    OPTOUT_REPLY_LINE,
    fill(PRIVACY_LINE, { privacy_url: ctx.privacyUrl }),
  ];
}

/** Stored body (messages.body_text): opt-out URL and postal address are filled when the mailbox draft is created. */
export function renderInitialBody(f: DraftFields, sheet: FactSheet, ctx: RenderCtx): string {
  return [...bodyHead(f, sheet, ctx), "", ...footer(ctx)].join("\n");
}

export function renderFollowup(initialSubject: string, sheet: FactSheet, ctx: RenderCtx): { subject: string; body: string } {
  const subject = /^re:/i.test(initialSubject) ? initialSubject : FOLLOWUP_SUBJECT_PREFIX + initialSubject;
  const body = [
    FOLLOWUP_BODY,
    FOLLOWUP_SIGNATURE,
    "",
    fill(SCORE_LINE, { score: sheet.score, score_url: sheet.score_url }),
    "",
    ...footer(ctx),
  ].join("\n");
  return { subject, body };
}

/** Final fill when the mailbox draft is created. Throws if a marker is left over (never draft a placeholder). */
export function finalizeBody(stored: string, optoutUrl: string, postalAddress: string): string {
  const out = stored.split(OPTOUT_URL_MARKER).join(optoutUrl).split(POSTAL_MARKER).join(postalAddress.trim());
  if (/\{[a-z_]+\}/.test(out)) throw new Error("UNFILLED_PLACEHOLDER");
  return out;
}
