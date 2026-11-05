import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_PROBE_TARGETS, parseMaxProbeTargets } from "./probe-ceiling";

describe("parseMaxProbeTargets", () => {
  it("reads a configured value", () => {
    expect(parseMaxProbeTargets("30")).toBe(30);
    expect(parseMaxProbeTargets("5")).toBe(5);
    expect(parseMaxProbeTargets("0")).toBe(0); // deliberate "no new customers"
  });
  it("never yields NaN or a negative cap (NaN would disable the ceiling)", () => {
    for (const v of [undefined, "", "thirty", "NaN", "-1"]) expect(parseMaxProbeTargets(v)).toBe(DEFAULT_MAX_PROBE_TARGETS);
  });
});
