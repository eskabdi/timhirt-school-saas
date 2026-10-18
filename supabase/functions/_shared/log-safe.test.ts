import { assertEquals } from "jsr:@std/assert@1";
import { logSafeError } from "./log-safe.ts";

Deno.test("Auth errors are logged by code only (they can quote the address)", () => {
  const e = Object.assign(new Error('Email address "a@b.test" is invalid'), { name: "AuthApiError", code: "email_address_invalid" });
  assertEquals(logSafeError(e), { auth_error: "email_address_invalid" });
  assertEquals(logSafeError(Object.assign(new Error("x a@b.test"), { name: "AuthRetryableFetchError" })), { auth_error: "unknown" });
});

Deno.test("other errors keep their message", () => {
  assertEquals(logSafeError(new Error("relation does not exist")), { message: "relation does not exist" });
  assertEquals(logSafeError("plain"), { message: "plain" });
});
