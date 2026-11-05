import { describe, it, expect, vi } from "vitest";
import {
  CONSENT_SELLABLE_TEXT,
  RIGHTS_WRITE_TIMEOUT_MS,
  buildRightsRecord,
  parseConsentSellable,
  readRightsFlags,
  recordP1OptOut,
  rightsFlagsFrom,
  optOutKey,
  rightsKey,
  scheduleRightsWrite,
  writeRightsRecord,
} from "./dataset-consent";
import {
  INTAKE_NOTE_CODES,
  INTAKE_QUESTIONS,
  applyNoteCoding,
  hasWritableTtl,
  intakeUnchanged,
  nextIntakeRecord,
  parseNoteCodes,
  toggleMultiAnswer,
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

  it("recordP1OptOut writes only the restriction key, once, keeping the first time", async () => {
    const { kv, store } = memKv();
    const consent = JSON.stringify(
      buildRightsRecord("audit", { consent_sellable: 1, consent_text_version: "v", consent_at: 1 }),
    );
    store.set(rightsKey("audit", "s1"), consent);
    await recordP1OptOut(kv, "audit", "s1", 5);
    await recordP1OptOut(kv, "audit", "s1", 9);
    expect(JSON.parse(store.get(optOutKey("audit", "s1"))!)).toEqual({ opted_out_at: 5, method: "email_request" });
    expect(store.get(rightsKey("audit", "s1"))).toBe(consent); // consent record untouched
    expect(await readRightsFlags(kv, "audit", "s1")).toEqual({ consent_sellable: 0, p1_opt_out: 1 });
  });

  it("recordP1OptOut on an order with no consent record: restriction only, no consent record created", async () => {
    const { kv, store } = memKv();
    await recordP1OptOut(kv, "audit", "lost", 5);
    expect(store.has(rightsKey("audit", "lost"))).toBe(false);
    expect(await readRightsFlags(kv, "audit", "lost")).toEqual({ consent_sellable: 0, p1_opt_out: 1 });
  });

  it("race: init read pending → opt-out → init write lands → reader says opt-out 1, consent 0", async () => {
    const { kv: base, store } = memKv();
    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => (releaseRead = r));
    const kv = {
      get: async (k: string) => {
        if (k === rightsKey("audit", "r1")) {
          const v = store.get(k) ?? null; // init reads "absent" now...
          await readGate; // ...and resumes later
          return v;
        }
        return base.get(k);
      },
      put: base.put,
    } as unknown as KVNamespace;
    const rec = buildRightsRecord("audit", { consent_sellable: 1, consent_text_version: "v", consent_at: 1 })!;
    const init = writeRightsRecord(kv, "r1", rec);
    await recordP1OptOut(kv, "audit", "r1", 5);
    releaseRead();
    await init;
    expect(JSON.parse(store.get(rightsKey("audit", "r1"))!).consent_sellable).toBe(1); // late init landed
    expect(await readRightsFlags(kv, "audit", "r1")).toEqual({ consent_sellable: 0, p1_opt_out: 1 });
  });

  it("fail-safe: an absent or unreadable consent record reads as consent 0, no opt-out", async () => {
    const { kv, store } = memKv();
    expect(await readRightsFlags(kv, "audit", "missing")).toEqual({ consent_sellable: 0, p1_opt_out: 0 });
    expect(rightsFlagsFrom(null, null)).toEqual({ consent_sellable: 0, p1_opt_out: 0 });
    expect(rightsFlagsFrom("{not json", null)).toEqual({ consent_sellable: 0, p1_opt_out: 0 });
    expect(rightsFlagsFrom(JSON.stringify({ consent_sellable: "1" }), null)).toEqual({
      consent_sellable: 0,
      p1_opt_out: 0,
    });
    // Any restriction value, even garbage, forces opt-out + consent 0.
    expect(rightsFlagsFrom(JSON.stringify({ consent_sellable: 1 }), "x")).toEqual({
      consent_sellable: 0,
      p1_opt_out: 1,
    });
    store.set("rights:audit:s9", JSON.stringify({ consent_sellable: 1 }));
    expect(await readRightsFlags(kv, "audit", "s9")).toEqual({ consent_sellable: 1, p1_opt_out: 0 });
  });

  it("scheduleRightsWrite: hands the promise to waitUntil and gives up on a hung write after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const hung = { get: () => new Promise(() => {}), put: vi.fn() } as unknown as KVNamespace;
      const waitUntil = vi.fn();
      const rec = buildRightsRecord("audit", { consent_text_version: "v", consent_at: 1 })!;
      let settled = false;
      const p = scheduleRightsWrite(hung, "s3", rec, waitUntil).then(() => {
        settled = true;
      });
      expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
      await vi.advanceTimersByTimeAsync(RIGHTS_WRITE_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(settled).toBe(true);
      expect(err.mock.calls.flat().join(" ")).toContain("RIGHTS_REGISTRY_WRITE_TIMEOUT");
      err.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("scheduleRightsWrite: a throwing waitUntil still runs the write", async () => {
    const { kv, store } = memKv();
    const rec = buildRightsRecord("audit", { consent_text_version: "v", consent_at: 1 })!;
    await scheduleRightsWrite(kv, "s4", rec, () => {
      throw new Error("no ctx");
    });
    expect(store.has("rights:audit:s4")).toBe(true);
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
    });
  });

  it("writeRightsRecord writes once, never overwrites, never touches the restriction key", async () => {
    const { kv, store } = memKv();
    const rec = buildRightsRecord("audit", { consent_sellable: 1, consent_text_version: "v", consent_at: 1 })!;
    await writeRightsRecord(kv, "s2", rec);
    store.set("rights:audit:s2", "existing");
    await writeRightsRecord(kv, "s2", rec);
    expect(store.get("rights:audit:s2")).toBe("existing");
    expect([...store.keys()].some((k) => k.startsWith("rights-optout:"))).toBe(false);
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
      taxonomy_version: "pain-v2",
      submitted_at: 9,
      answers: { pain: "not_mentioned" },
      notes_codes: ["owner.founder"],
      coded_by: "human",
      write_count: 3,
    });
    expect(nextIntakeRecord(null, { answers: {}, notes: "n" }, 1).write_count).toBe(1);
  });

  it("intakeUnchanged: skip when notes, answers or write_count moved, or the record is gone", () => {
    expect(intakeUnchanged(rec, { ...rec })).toBe(true);
    expect(intakeUnchanged(rec, null)).toBe(false);
    expect(intakeUnchanged(rec, { ...rec, notes: "edited" })).toBe(false);
    expect(intakeUnchanged(rec, { ...rec, answers: { owner: "marketing" } })).toBe(false);
    expect(intakeUnchanged(rec, { ...rec, write_count: 3 })).toBe(false);
  });

  it("hasWritableTtl: needs a numeric expiration more than 60 s ahead", () => {
    expect(hasWritableTtl(1061, 1000)).toBe(true);
    expect(hasWritableTtl(1060, 1000)).toBe(false);
    expect(hasWritableTtl(undefined, 1000)).toBe(false);
    expect(hasWritableTtl("2000", 1000)).toBe(false);
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

describe("intake multi-select", () => {
  const tried = INTAKE_QUESTIONS.find((q) => q.id === "tried")!;

  it("'What have you tried?' is the only multi-select, with 'nothing' exclusive", () => {
    expect(INTAKE_QUESTIONS.filter((q) => q.multi).map((q) => q.id)).toEqual(["tried"]);
    expect(tried.exclusive).toBe("nothing");
  });

  it("toggleMultiAnswer keeps option order and never yields 'nothing' with others", () => {
    let a = toggleMultiAnswer(tried, [], "agency", true);
    a = toggleMultiAnswer(tried, a, "llms_txt", true);
    expect(a).toEqual(["llms_txt", "agency"]);
    expect(toggleMultiAnswer(tried, a, "nothing", true)).toEqual(["nothing"]);
    expect(toggleMultiAnswer(tried, ["nothing"], "aeo_tool", true)).toEqual(["aeo_tool"]);
    expect(toggleMultiAnswer(tried, a, "agency", false)).toEqual(["llms_txt"]);
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
