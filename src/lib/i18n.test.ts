// tField reads a jsonb {en, am, om} column: the locale first, then en, am, om;
// only strings ever come back, so a malformed value cannot reach React as a
// child (which throws and blanks the page).
import { describe, expect, it } from "vitest";
import { tField } from "./i18n";

const bad = (v: unknown) => v as Record<string, string>;

describe("tField", () => {
  it("prefers the locale, then en, am, om", () => {
    expect(tField({ en: "E", am: "A", om: "O" }, "am")).toBe("A");
    expect(tField({ en: "E", am: "A" }, "om")).toBe("E");
    expect(tField(bad({ am: "A", om: "O" }), "en")).toBe("A");
    expect(tField(bad({ om: "O" }), "en")).toBe("O");
  });

  it("keeps an empty string as it is", () => {
    expect(tField({ en: "", am: "A" }, "en")).toBe("");
  });

  it("skips non-string values and falls back to the next string", () => {
    expect(tField(bad({ en: { x: 1 }, am: "AM" }), "en")).toBe("AM");
    expect(tField(bad({ en: ["a"], am: 7, om: "OM" }), "am")).toBe("OM");
    expect(tField(bad({ en: { o: 1 }, am: [], om: 7 }), "en")).toBe("");
  });

  it("answers '' for a missing or non-object field", () => {
    expect(tField(null, "en")).toBe("");
    expect(tField(undefined, "en")).toBe("");
    expect(tField(bad("plain"), "en")).toBe("");
  });
});
