import { assertEquals } from "jsr:@std/assert@1";
import { isRateLimited, logSafeError } from "./auth-errors.ts";

Deno.test("Auth errors are logged by code only (they can quote the address)", () => {
  const e = Object.assign(new Error('Email address "a@b.test" is invalid'), { name: "AuthApiError", code: "email_address_invalid" });
  assertEquals(logSafeError(e), { auth_error: "email_address_invalid" });
  assertEquals(logSafeError(Object.assign(new Error("x"), { name: "AuthApiError", status: 503 })), { auth_error: "unknown", status: "503" });
  assertEquals(logSafeError(Object.assign(new Error("x a@b.test"), { name: "AuthRetryableFetchError" })), { auth_error: "unknown" });
});

Deno.test("other errors keep their message; odd thrown values never throw", () => {
  assertEquals(logSafeError(new Error("relation does not exist")), { message: "relation does not exist" });
  assertEquals(logSafeError("plain"), { message: "plain" });
  assertEquals(logSafeError({ name: 42, message: "m" }), { message: "m" });
  assertEquals(logSafeError(null), { message: "null" });
});

Deno.test("GoTrue rate limits: status 429, stable codes, or an Auth error's cooldown wording", () => {
  const auth = (message: string, extra: Record<string, unknown> = {}) => ({ name: "AuthApiError", message, ...extra });
  assertEquals(isRateLimited({ status: 429, message: "anything" }), true);
  assertEquals(isRateLimited(auth("x", { code: "over_email_send_rate_limit", status: 400 })), true);
  assertEquals(isRateLimited(auth("Email rate limit exceeded")), true);
  assertEquals(isRateLimited(auth("For security purposes, you can only request this after 42 seconds.")), true);
  assertEquals(isRateLimited({ name: "PostgrestError", message: "rate limit table locked" }), false); // not an Auth error
  assertEquals(isRateLimited({ status: 500, message: "Database error" }), false);
  assertEquals(isRateLimited(undefined), false);
});
