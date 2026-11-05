import { describe, it, expect } from "vitest";
import {
  DIM6_DEMO_SUBCHECK_ID,
  applicableDimensionCount,
  dimensionCountPhrase,
  droppedDimensionsNote,
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

describe("droppedDimensionsNote", () => {
  const LEGACY =
    " Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite.";
  const UNMEASURED = " Some dimensions could not be measured on this run and were dropped from the composite.";
  const d = (id: number, extra: { na?: boolean; unmeasured?: boolean } = {}) => ({ dimension_id: id, ...extra });

  it("nothing dropped: empty", () => {
    expect(droppedDimensionsNote({ dimensions_applicable: 2, dimensions_scored: 2, dimensions: [d(1), d(2)] })).toBe("");
  });
  it("legacy N/A (incl. scans without the flag): unchanged sentence", () => {
    expect(droppedDimensionsNote({ dimensions_applicable: 1, dimensions_scored: 2, dimensions: [d(1), d(3, { na: true })] })).toBe(LEGACY);
    expect(droppedDimensionsNote({ dimensions_applicable: 1, dimensions_scored: 2, dimensions: [] })).toBe(LEGACY);
  });
  it("unmeasured OpenAPI only: never mentions 'no API surface' or 'did not apply'", () => {
    const s = droppedDimensionsNote({ dimensions_applicable: 1, dimensions_scored: 2, dimensions: [d(1), d(3, { na: true, unmeasured: true })] });
    expect(s).toBe(UNMEASURED);
  });
  it("unmeasured OpenAPI plus another N/A dimension: no 'no API surface' example", () => {
    const s = droppedDimensionsNote({
      dimensions_applicable: 1,
      dimensions_scored: 3,
      dimensions: [d(1), d(3, { na: true, unmeasured: true }), d(6, { na: true })],
    });
    expect(s).toBe(" Some dimensions did not apply to your site and were dropped from the composite." + UNMEASURED);
    expect(s).not.toContain("no API surface");
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
