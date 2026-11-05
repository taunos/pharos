import { describe, it, expect } from "vitest";
import {
  CONSENT_SELLABLE_TEXT,
  buildRightsRecord,
  parseConsentSellable,
  recordP1OptOut,
  rightsKey,
  writeRightsRecord,
} from "./dataset-consent";
import {
  INTAKE_NOTE_CODES,
  INTAKE_QUESTIONS,
  applyNoteCoding,
  nextIntakeRecord,
  parseNoteCodes,
  terminalSafe,
  type IntakeRecord,
} from "./dataset-intake";

function memKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => void store.set(k, v),
    } as unknown as KVNamespace,
  };
}

describe("dataset consent", () => {
  it("checkbox text is the exact approved wording", () => {
    expect(CONSENT_SELLABLE_TEXT).toBe(
      'Let Astrant include my project in aggregate statistics it publishes or licenses to other companies (e.g. "7 companies that did X saw Y"). My company is never named and no individual record is shared. Optional — doesn\'t affect your price or service. I can withdraw at any time.',
    );
  });

  it("only literal true is opt-in", () => {
    expect(parseConsentSellable(true)).toBe(1);
    for (const v of [undefined, null, false, "true", 1, "1", "on", {}]) {
      expect(parseConsentSellable(v)).toBe(0);
    }
  });

  it("recordP1OptOut sets the flag once and keeps the first time", async () => {
    const { kv, store } = memKv();
    expect(await recordP1OptOut(kv, "audit", "s1", 5)).toBe(false);
    store.set(
      rightsKey("audit", "s1"),
      JSON.stringify(buildRightsRecord("audit", { consent_sellable: 1, consent_text_version: "v", consent_at: 1 })),
    );
    expect(await recordP1OptOut(kv, "audit", "s1", 5)).toBe(true);
    expect(await recordP1OptOut(kv, "audit", "s1", 9)).toBe(true);
    const rec = JSON.parse(store.get("rights:audit:s1")!);
    expect(rec).toMatchObject({ p1_opt_out: 1, p1_opt_out_at: 5, consent_sellable: 1 });
  });

  it("buildRightsRecord: null without consent evidence; flag only 1 when stamped 1", () => {
    expect(buildRightsRecord("audit", {})).toBeNull();
    expect(buildRightsRecord("audit", { consent_sellable: 1, consent_at: 1 })).toBeNull();
    expect(buildRightsRecord("audit", { consent_text_version: "v", consent_at: 3 })).toEqual({
      tier: "audit",
      consent_sellable: 0,
      consent_text_version: "v",
      consent_at: 3,
      consent_method: "checkout_checkbox",
      p1_opt_out: 0,
    });
  });

  it("writeRightsRecord writes once and never overwrites", async () => {
    const { kv, store } = memKv();
    const rec = buildRightsRecord("audit", { consent_sellable: 1, consent_text_version: "v", consent_at: 1 })!;
    await writeRightsRecord(kv, "s2", rec);
    store.set("rights:audit:s2", JSON.stringify({ ...rec, p1_opt_out: 1 }));
    await writeRightsRecord(kv, "s2", rec);
    expect(JSON.parse(store.get("rights:audit:s2")!).p1_opt_out).toBe(1);
  });
});

describe("intake note coding (operator script helpers)", () => {
  const rec: IntakeRecord = {
    taxonomy_version: "pain-v1",
    submitted_at: 1,
    answers: { owner: "founder" },
    notes: "raw text",
    notes_codes: ["owner.founder"],
    coded_by: "human",
    write_count: 2,
  };

  it("codes are <question>.<option> from the taxonomy", () => {
    expect(INTAKE_NOTE_CODES).toContain("pain.not_mentioned");
    expect(INTAKE_NOTE_CODES).toContain("tried.llms_txt");
    expect(INTAKE_NOTE_CODES.length).toBe(INTAKE_QUESTIONS.reduce((n, q) => n + q.options.length, 0));
  });

  it("parseNoteCodes: empty = none, dedupes, any unknown rejects the whole input", () => {
    expect(parseNoteCodes("   ")).toEqual({ ok: true, codes: [] });
    expect(parseNoteCodes("pain.not_mentioned, pain.not_mentioned owner.founder")).toEqual({
      ok: true,
      codes: ["pain.not_mentioned", "owner.founder"],
    });
    expect(parseNoteCodes("pain.not_mentioned, rm -rf")).toEqual({ ok: false, unknown: ["rm", "-rf"] });
    expect(parseNoteCodes("not_mentioned")).toEqual({ ok: false, unknown: ["not_mentioned"] });
  });

  it("applyNoteCoding removes notes, merges codes, marks human; nothing else changes", () => {
    const out = applyNoteCoding(rec, ["pain.not_mentioned", "owner.founder"]);
    expect(out).toEqual({
      taxonomy_version: "pain-v1",
      submitted_at: 1,
      answers: { owner: "founder" },
      notes_codes: ["owner.founder", "pain.not_mentioned"],
      coded_by: "human",
      write_count: 2,
    });
    expect("notes" in out).toBe(false);
    expect(JSON.stringify(applyNoteCoding(rec, []))).not.toContain("raw text");
  });

  it("nextIntakeRecord: last write wins, counter increments, earlier codes kept", () => {
    const out = nextIntakeRecord(rec, { answers: { pain: "not_mentioned" } }, 9);
    expect(out).toEqual({
      taxonomy_version: "pain-v1",
      submitted_at: 9,
      answers: { pain: "not_mentioned" },
      notes_codes: ["owner.founder"],
      coded_by: "human",
      write_count: 3,
    });
    expect(nextIntakeRecord(null, { answers: {}, notes: "n" }, 1).write_count).toBe(1);
  });

  it("terminalSafe neutralizes escape sequences, keeps newlines and tabs", () => {
    const esc = String.fromCharCode(27);
    const bell = String.fromCharCode(7);
    const c1 = String.fromCharCode(0x9b);
    expect(terminalSafe(`x${esc}]0;title${bell}y`)).toBe("x?]0;title?y");
    expect(terminalSafe("l1\nl2\tz")).toBe("l1\nl2\tz");
    expect(terminalSafe(`p${c1}q`)).toBe("p?q");
  });
});

describe("intake taxonomy", () => {
  it("has the 5 spec questions with unique codes", () => {
    expect(INTAKE_QUESTIONS.map((q) => q.label)).toEqual([
      "What made you look at this now?",
      "Where does it hurt most?",
      "What have you tried?",
      "Who owns this internally?",
      "How will you judge success?",
    ]);
    for (const q of INTAKE_QUESTIONS) {
      const codes = q.options.map((o) => o.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
});
