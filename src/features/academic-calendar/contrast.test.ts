import { describe, expect, it } from "vitest";
import { contrastRatio, safeColor, textOn } from "./contrast";
import { DAY_TYPES, DAY_TYPE_MARKS, OUT_OF_SESSION_FILL } from "./dayTypes";
const WEEKEND_FILL = DAY_TYPES.find((d) => d.code === "weekend")!.color;

describe("day-type colours", () => {
  it("every fill gets text at 4.5:1 or better (WCAG 1.4.3)", () => {
    for (const fill of [...DAY_TYPES.map((d) => d.color), OUT_OF_SESSION_FILL, WEEKEND_FILL]) {
      expect(contrastRatio(fill, textOn(fill)), fill).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every entered type has its own mark, so no type rests on colour alone", () => {
    const entered = DAY_TYPES.filter((d) => !d.derived).map((d) => d.code);
    const marks = entered.map((c) => DAY_TYPE_MARKS[c]);
    expect(marks.every(Boolean)).toBe(true);
    expect(new Set(marks).size).toBe(entered.length);
  });

  it("accepts only #rrggbb from the database", () => {
    expect(safeColor("#2E75b6")).toBe("#2E75b6");
    for (const bad of ["red", "red;background-image:url(x)", "url(x)", "#fff", null, 7]) expect(safeColor(bad)).toBe("#e7e6e6");
  });
});
