import { describe, expect, it } from "vitest";
import { httpsHref } from "./safeUrl";

describe("httpsHref (FS-1)", () => {
  it("keeps https links", () => {
    expect(httpsHref("https://apps.cbe.com.et/?id=FT1")).toBe("https://apps.cbe.com.et/?id=FT1");
  });
  it("drops every other scheme", () => {
    for (const v of ["javascript:alert(1)", " javascript:alert(1)", "data:text/html,x", "http://a.et", "", null, undefined]) {
      expect(httpsHref(v)).toBeNull();
    }
  });
});
