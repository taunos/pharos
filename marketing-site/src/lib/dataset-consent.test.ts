import { describe, it, expect } from "vitest";
import {
  CONSENT_SELLABLE_TEXT,
  buildRightsRecord,
  parseConsentSellable,
  recordP1OptOut,
  rightsKey,
} from "./dataset-consent";
import { INTAKE_QUESTIONS } from "./dataset-intake";

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
    store.set(rightsKey("audit", "s1"), JSON.stringify(buildRightsRecord("audit", 1, 1)));
    expect(await recordP1OptOut(kv, "audit", "s1", 5)).toBe(true);
    expect(await recordP1OptOut(kv, "audit", "s1", 9)).toBe(true);
    const rec = JSON.parse(store.get("rights:audit:s1")!);
    expect(rec).toMatchObject({ p1_opt_out: 1, p1_opt_out_at: 5, consent_sellable: 1 });
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
