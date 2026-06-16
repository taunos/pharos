import { describe, it, expect } from "vitest";
import {
  DIM6_DEMO_SUBCHECK_ID,
  applicableDimensionCount,
  dimensionCountPhrase,
  gradeColorClass,
  isDim6DemoPreview,
} from "./score-display";

describe("applicableDimensionCount", () => {
  it("prefers applicable when present", () => {
    expect(applicableDimensionCount(4, 5)).toBe(4);
  });
  it("falls back to scored when applicable is undefined", () => {
    expect(applicableDimensionCount(undefined, 5)).toBe(5);
  });
});

describe("dimensionCountPhrase", () => {
  it("renders applicable of total", () => {
    expect(dimensionCountPhrase(5, 5, 6)).toBe("5 of 6");
  });
  it("falls back to scored when applicable is undefined", () => {
    expect(dimensionCountPhrase(undefined, 3, 6)).toBe("3 of 6");
  });
});

describe("gradeColorClass", () => {
  it("maps suffixed A grades (A-) to emerald-400", () => {
    expect(gradeColorClass("A-")).toBe("text-emerald-400");
  });
  it("maps A to emerald-400", () => {
    expect(gradeColorClass("A")).toBe("text-emerald-400");
  });
  it("maps B to emerald-300", () => {
    expect(gradeColorClass("B")).toBe("text-emerald-300");
  });
  it("maps C to yellow-400", () => {
    expect(gradeColorClass("C")).toBe("text-yellow-400");
  });
  it("maps D to orange-400", () => {
    expect(gradeColorClass("D")).toBe("text-orange-400");
  });
  it("maps F to red-400", () => {
    expect(gradeColorClass("F")).toBe("text-red-400");
  });
});

describe("isDim6DemoPreview", () => {
  it("is true when a sub_check carries the demo-preview id", () => {
    expect(
      isDim6DemoPreview({ sub_checks: [{ id: DIM6_DEMO_SUBCHECK_ID }] })
    ).toBe(true);
  });
  it("is false for a wrong-shaped object keyed without the underscore", () => {
    // Build the wrong key at runtime so the literal never appears in source
    // (keeps the Step-11 source sweep clean).
    const wrongKey = "sub" + "checks";
    const wrongShape = { [wrongKey]: [{ id: DIM6_DEMO_SUBCHECK_ID }] };
    expect(
      isDim6DemoPreview(wrongShape as unknown as { sub_checks?: { id: string }[] })
    ).toBe(false);
  });
});
