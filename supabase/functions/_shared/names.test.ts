import { assertEquals } from "jsr:@std/assert@1";
import { fullName } from "./names.ts";

Deno.test("fullName is First + Middle + Last", () => {
  assertEquals(fullName({ first_name: "Abebe", middle_name: "Kebede", last_name: "Tesfaye" }), "Abebe Kebede Tesfaye");
});

Deno.test("staff father_name counts as the middle name", () => {
  assertEquals(fullName({ first_name: "Almaz", father_name: "Haile", last_name: "Gebre" }), "Almaz Haile Gebre");
});

Deno.test("missing parts leave no double spaces", () => {
  assertEquals(fullName({ first_name: " Abebe ", middle_name: null, last_name: "Tesfaye" }), "Abebe Tesfaye");
  assertEquals(fullName(null), "");
});
