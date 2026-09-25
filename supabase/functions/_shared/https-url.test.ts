import { assert, assertFalse } from "jsr:@std/assert@1";
import { isHttpsUrl } from "./https-url.ts";

Deno.test("only https URLs pass (FS-1)", () => {
  assert(isHttpsUrl("https://apps.cbe.com.et:100/?id=FT123"));
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "http://a.et/", "//a.et", "not a url", "",
    " https://a.et/x", "\thttps://a.et", "https:\n//a.et", "https://a.et/x y", "https://"]) {
    assertFalse(isHttpsUrl(bad), bad);
  }
});
