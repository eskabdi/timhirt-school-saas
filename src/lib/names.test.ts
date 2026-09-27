import { describe, expect, it } from "vitest";
import { fullName, shortName } from "./names";

describe("Ethiopian names (fix plan §0 Rule 8)", () => {
  it("renders First + Middle + Last", () => {
    expect(fullName({ first_name: "Abebe", middle_name: "Kebede", last_name: "Tesfaye" })).toBe("Abebe Kebede Tesfaye");
  });
  it("uses father_name as the middle name for staff rows", () => {
    expect(fullName({ first_name: "Almaz", father_name: "Haile", last_name: "Gebre" })).toBe("Almaz Haile Gebre");
  });
  it("short form is First + Middle", () => {
    expect(shortName({ first_name: "Abebe", middle_name: "Kebede", last_name: "Tesfaye" })).toBe("Abebe Kebede");
  });
  it("skips missing parts without double spaces", () => {
    expect(fullName({ first_name: " Abebe ", middle_name: null, last_name: "Tesfaye" })).toBe("Abebe Tesfaye");
    expect(fullName(null)).toBe("");
  });
});
