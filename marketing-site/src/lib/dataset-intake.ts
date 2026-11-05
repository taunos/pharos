// Dataset spec v2 §3 — post-purchase intake: 5 closed questions + 1 optional
// free-text box. Shared by the intake form (labels) and the intake route
// (server-side validation). Tier-agnostic; wired for the Audit only.
//
// Hostile-input rules: enum answers must be one of the fixed codes below
// (unknown → reject, never "other"); the free text is length-capped, stored
// only in the operational store (SESSIONS KV, order TTL), never logged, never
// sent to an LLM, never written to the corpus.

export const INTAKE_TAXONOMY_VERSION = "pain-v1";
export const INTAKE_NOTES_MAX = 1000;

export type IntakeOption = { code: string; label: string };
export type IntakeQuestion = {
  id: "trigger" | "pain" | "tried" | "owner" | "success";
  label: string;
  options: readonly IntakeOption[];
};

// Codes never change meaning; new categories get new codes and a new
// INTAKE_TAXONOMY_VERSION. Labels are the exact approved texts (spec §3).
export const INTAKE_QUESTIONS: readonly IntakeQuestion[] = [
  {
    id: "trigger",
    label: "What made you look at this now?",
    options: [
      { code: "competitor_in_chatgpt", label: "a competitor shows up in ChatGPT and we don't" },
      { code: "customer_found_via_ai", label: "a customer said they found us through AI" },
      { code: "search_traffic_dropping", label: "traffic from search is dropping" },
      { code: "investor_or_board_asked", label: "an investor or board asked" },
      { code: "launching_api", label: "we're launching an API" },
      { code: "other", label: "other" },
    ],
  },
  {
    id: "pain",
    label: "Where does it hurt most?",
    options: [
      { code: "not_mentioned", label: "AI answers don't mention us" },
      { code: "described_wrongly", label: "they describe us wrongly" },
      { code: "outdated_pricing", label: "they cite outdated pricing" },
      { code: "docs_unused_by_agents", label: "our docs aren't used by coding agents" },
      { code: "unknown_position", label: "we don't know where we stand" },
    ],
  },
  {
    id: "tried",
    label: "What have you tried?",
    options: [
      { code: "nothing", label: "nothing" },
      { code: "llms_txt", label: "llms.txt" },
      { code: "schema_markup", label: "schema markup" },
      { code: "aeo_tool", label: "an AEO tool" },
      { code: "agency", label: "an agency" },
      { code: "content_rewrite", label: "content rewrite" },
    ],
  },
  {
    id: "owner",
    label: "Who owns this internally?",
    options: [
      { code: "founder", label: "founder" },
      { code: "marketing", label: "marketing" },
      { code: "dev_rel", label: "dev rel" },
      { code: "engineering", label: "engineering" },
      { code: "seo_agency", label: "SEO agency" },
    ],
  },
  {
    id: "success",
    label: "How will you judge success?",
    options: [
      { code: "being_mentioned", label: "being mentioned" },
      { code: "correct_description", label: "correct description" },
      { code: "referral_traffic", label: "referral traffic" },
      { code: "sign_ups", label: "sign-ups" },
    ],
  },
];

export const INTAKE_NOTES_LABEL = "Anything else we should know?";
export const INTAKE_NOTES_HINT = "Please don't include personal or sensitive information.";

export type IntakeAnswers = Partial<Record<IntakeQuestion["id"], string>>;

export type IntakeRecord = {
  taxonomy_version: string;
  submitted_at: number;
  answers: IntakeAnswers;
  // Raw free text: operational store only (§3). Absent when not given, and
  // removed once coded (scripts/code-intake-notes.mjs).
  notes?: string;
  // Codes from INTAKE_NOTE_CODES assigned to earlier notes by a human coder.
  notes_codes?: string[];
  coded_by?: "human";
  // Submissions so far for this session (last write wins; capped).
  write_count: number;
};

// Per-session submission cap. Best-effort: KV read-then-write is not atomic,
// so concurrent submits can slip one extra write through. Only the session
// UUID holder can write at all, so an overwrite is never cross-user.
export const INTAKE_MAX_WRITES = 3;

// Last write wins for answers and notes; codes already assigned to earlier
// notes are kept.
export function nextIntakeRecord(
  prev: IntakeRecord | null,
  input: { answers: IntakeAnswers; notes?: string },
  now: number,
): IntakeRecord {
  return {
    taxonomy_version: INTAKE_TAXONOMY_VERSION,
    submitted_at: now,
    answers: input.answers,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(prev?.notes_codes ? { notes_codes: prev.notes_codes, coded_by: prev.coded_by } : {}),
    write_count: (prev?.write_count ?? 0) + 1,
  };
}

// Codes a human may assign to free text: "<question id>.<option code>" from
// the same pain taxonomy (spec §3: free text is coded into the same codes).
export const INTAKE_NOTE_CODES: readonly string[] = INTAKE_QUESTIONS.flatMap((q) =>
  q.options.map((o) => `${q.id}.${o.code}`),
);

// Parses a coder's input ("pain.not_mentioned, owner.founder", or empty for
// none). Any unknown code rejects the whole input.
export function parseNoteCodes(
  input: string,
): { ok: true; codes: string[] } | { ok: false; unknown: string[] } {
  const parts = input.split(/[\s,]+/).filter((p) => p.length > 0);
  const unknown = parts.filter((p) => !INTAKE_NOTE_CODES.includes(p));
  if (unknown.length > 0) return { ok: false, unknown };
  return { ok: true, codes: [...new Set(parts)] };
}

// For showing hostile free text in the operator's terminal: control
// characters (escape sequences included) become "?"; newlines and tabs stay.
export function terminalSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const control = (c < 32 && c !== 10 && c !== 9) || (c >= 127 && c <= 159);
    out += control ? "?" : ch;
  }
  return out;
}

// Operator script: true when the record re-read just before writing still
// holds what the coder was shown (else the buyer resubmitted; skip).
export function intakeUnchanged(shown: IntakeRecord, current: IntakeRecord | null): boolean {
  return (
    !!current &&
    current.notes === shown.notes &&
    current.write_count === shown.write_count &&
    JSON.stringify(current.answers ?? {}) === JSON.stringify(shown.answers ?? {})
  );
}

// KV refuses an expiration less than 60 s ahead.
export function hasWritableTtl(expiration: unknown, nowSec: number): expiration is number {
  return typeof expiration === "number" && expiration - nowSec > 60;
}

// The coded record: raw notes removed, codes merged with any earlier ones.
export function applyNoteCoding(record: IntakeRecord, codes: string[]): IntakeRecord {
  const { notes: _removed, ...rest } = record;
  void _removed;
  return {
    ...rest,
    notes_codes: [...new Set([...(record.notes_codes ?? []), ...codes])],
    coded_by: "human",
  };
}

// Standalone Audit sessions are crypto.randomUUID() (UUID v4); ap- and
// impl-day sessions are not eligible for the intake.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isIntakeSessionId(sessionId: unknown): sessionId is string {
  return typeof sessionId === "string" && UUID_V4_RE.test(sessionId);
}

export function intakeKey(tier: "audit" | "implementation", sessionId: string): string {
  return `intake:${tier}:${sessionId}`;
}

const ALLOWED_KEYS = new Set<string>([
  "session_id",
  "notes",
  ...INTAKE_QUESTIONS.map((q) => q.id),
]);

export type IntakeValidation =
  | { ok: true; answers: IntakeAnswers; notes?: string }
  | { ok: false; error: string };

// Validates the answer fields of a request body (session_id is checked by the
// route). Every field is optional; null / "" mean skipped.
export function validateIntake(body: Record<string, unknown>): IntakeValidation {
  for (const k of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(k)) return { ok: false, error: "UNKNOWN_FIELD" };
  }
  const answers: IntakeAnswers = {};
  for (const q of INTAKE_QUESTIONS) {
    const v = body[q.id];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string" || !q.options.some((o) => o.code === v)) {
      return { ok: false, error: "INVALID_ANSWER" };
    }
    answers[q.id] = v;
  }
  let notes: string | undefined;
  const n = body.notes;
  if (n !== undefined && n !== null) {
    if (typeof n !== "string") return { ok: false, error: "INVALID_NOTES" };
    if (n.length > INTAKE_NOTES_MAX) return { ok: false, error: "NOTES_TOO_LONG" };
    if (n.includes(String.fromCharCode(0))) return { ok: false, error: "INVALID_NOTES" };
    const trimmed = n.trim();
    if (trimmed.length > 0) notes = trimmed;
  }
  return { ok: true, answers, ...(notes !== undefined ? { notes } : {}) };
}
