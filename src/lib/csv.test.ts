import { describe, expect, it } from "vitest";
import { csvCell } from "./csv";

describe("csvCell", () => {
  it("quotes separators and quotes", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("x\ny")).toBe('"x\ny"');
  });
  it("neutralises formula injection", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("+1+cmd|' /C calc'!A0")).toBe("'+1+cmd|' /C calc'!A0");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
  });
  it("leaves numbers and ordinary text alone", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell((-5).toFixed(2))).toBe("-5.00");
    expect(csvCell("+251911000000")).toBe("+251911000000");
    expect(csvCell("Abebe Kebede Tesfaye")).toBe("Abebe Kebede Tesfaye");
  });
});
