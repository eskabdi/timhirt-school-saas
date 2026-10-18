import { assertEquals } from "jsr:@std/assert@1";
import { isAccepted, isRateLimited, rateBucket, resendPlan, statusRow, type InviteState } from "./invite-state.ts";

const st = (o: Partial<InviteState>): InviteState =>
  ({ user_id: "u", password_set: false, sso_user: false, email_confirmed: false, invited_at: "2026-10-17T15:05:12Z", ...o });

Deno.test("accepted only with a password or SSO; an opened (or prefetched) link is not acceptance", () => {
  assertEquals(isAccepted(st({ password_set: true, email_confirmed: true })), true);
  assertEquals(isAccepted(st({ sso_user: true, email_confirmed: true })), true);
  assertEquals(isAccepted(st({ email_confirmed: true })), false); // link opened, no password
  assertEquals(isAccepted(st({})), false);
});

Deno.test("status row: pending is the inverse of accepted; no address or auth metadata", () => {
  assertEquals(statusRow(st({ email_confirmed: true })), { user_id: "u", pending: true, invited_at: "2026-10-17T15:05:12Z" });
  assertEquals(statusRow(st({ password_set: true })).pending, false);
  assertEquals(Object.keys(statusRow(st({}))).sort(), ["invited_at", "pending", "user_id"]);
});

Deno.test("resend: refused once accepted, invite when unconfirmed, recovery link when confirmed without a password", () => {
  assertEquals(resendPlan(st({ password_set: true, email_confirmed: true })), "already_accepted");
  assertEquals(resendPlan(st({ sso_user: true, email_confirmed: true })), "already_accepted");
  assertEquals(resendPlan(st({ email_confirmed: false })), "invite");
  assertEquals(resendPlan(st({ email_confirmed: true })), "recovery");
});

Deno.test("status has its own budget; invite and resend share the email one", () => {
  assertEquals(rateBucket("status", "p1"), { key: "invite-status:p1", limit: 60 });
  assertEquals(rateBucket("resend", "p1"), { key: "invite-admin:p1", limit: 10 });
  assertEquals(rateBucket(undefined, "p1"), { key: "invite-admin:p1", limit: 10 });
  assertEquals(rateBucket("STATUS", "p1").key, "invite-admin:p1"); // exact action only
});

Deno.test("GoTrue rate limits: by status 429 or by message, including the per-address cooldown", () => {
  assertEquals(isRateLimited({ status: 429, message: "anything" }), true);
  assertEquals(isRateLimited({ message: "Email rate limit exceeded" }), true);
  assertEquals(isRateLimited({ message: "For security purposes, you can only request this after 42 seconds." }), true);
  assertEquals(isRateLimited({ status: 500, message: "Database error" }), false);
});
