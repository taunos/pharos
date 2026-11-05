// ALL user-facing fixed copy lives here (LB5 / OQ-7: Bruno approves every
// string in this file before the first live send). Placeholders in {braces}
// are filled by code. The validator's number whitelist is derived from this
// file (APPROVED_COPY_STRINGS), never typed by hand.

export const SUBJECT_VARIANTS = [
  "Two fixes for {domain}",
  "{domain}: two things worth fixing",
  "A quick note on {domain}",
] as const;

// Bruno-approved 2026-11-04: ONE fixed opener (replaces the 3 variants). Inserted verbatim.
export const OPENER =
  "I'm Bruno, founder of Astrant. We help B2B software companies see how AI assistants find and describe their sites. We ran {domain} through the same checks we use on our own site, and two things came up that I think are worth fixing:";
export const OPENER_VARIANTS = [OPENER] as const;

export const GREETING = "Hi there,"; // Bruno-approved 2026-11-04
export const SCORE_LINE = "Your Astrant Score is {score}/100. Full result, no signup: {score_url}";
// D14: only rendered when BENCHMARK_URL is set and returns HTTP 200 at batch-build time.
export const BENCHMARK_LINE = "How other B2B SaaS sites compare: {benchmark_url}";
export const CLOSING_LINE = "Happy to answer questions here. No pitch beyond that.";
export const SIGNATURE = "Bruno, founder, Astrant · astrant.io";
export const FOOTER_SEPARATOR = "--";
// §10.1 commercial-message identification. Not "one-time": a follow-up exists.
export const COMMERCIAL_LINE = "This is a commercial message from Astrant.";
// Opt-out lives in the body: drafts can't carry List-Unsubscribe headers (spec §8.1 deviation).
export const OPTOUT_LINE = "Don't want these? {optout_url}";
export const OPTOUT_REPLY_LINE = "Or reply \"unsubscribe\" and I'll stop.";
export const PRIVACY_LINE = "Why you got this and how we handle your data: {privacy_url}";

// §7.2 follow-up: fixed template, same thread, no model call.
export const FOLLOWUP_SUBJECT_PREFIX = "Re: ";
export const FOLLOWUP_BODY =
  "Quick nudge in case this got buried. Happy to walk through the two fixes in a reply if useful.";
export const FOLLOWUP_SIGNATURE = "Bruno";

// §9.2 opt-out page.
export const OPTOUT_PAGE_TITLE = "Unsubscribe";
export const OPTOUT_CONFIRM_QUESTION = "Stop emails from Astrant to this address?";
export const OPTOUT_CONFIRM_BUTTON = "Stop emails";
export const OPTOUT_DONE = "Done. You won't hear from us again.";
export const OPTOUT_INVALID =
  "This link isn't valid. Reply \"unsubscribe\" to any email from us and we'll stop.";
export const OPTOUT_UNAVAILABLE =
  "Something went wrong on our side. Reply \"unsubscribe\" to any email from us and we'll stop.";

// §9.4 interested-reply mailbox draft (for Bruno to edit and send himself).
// v1 is a code-owned skeleton; the model-drafted answer needs the approved FAQ.
export const INTERESTED_DRAFT_BODY = [
  "Hi,",
  "",
  "Thanks for getting back to me.",
  "",
  "(Bruno: write your answer here. Their Score: {score_url})",
  "",
  "Bruno",
].join("\n");

// The §7.1 copy table (canonical gap sentences) lives in facts.ts and is
// included in APPROVED_COPY_STRINGS below.
import { COPY_TABLE_TEMPLATES } from "./facts";

export const APPROVED_NON_TABLE_COPY: readonly string[] = [
  ...SUBJECT_VARIANTS,
  ...OPENER_VARIANTS,
  GREETING,
  SCORE_LINE,
  BENCHMARK_LINE,
  CLOSING_LINE,
  SIGNATURE,
  COMMERCIAL_LINE,
  OPTOUT_LINE,
  OPTOUT_REPLY_LINE,
  PRIVACY_LINE,
  FOLLOWUP_BODY,
];

export const APPROVED_COPY_STRINGS: readonly string[] = [...APPROVED_NON_TABLE_COPY, ...COPY_TABLE_TEMPLATES];

export function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
