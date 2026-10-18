import { assertEquals } from "jsr:@std/assert@1";
import { createdByThisCall, escapeLike, rollbackInvitedUser, type InviteRollbackClient } from "./invite-guard.ts";

Deno.test("escapeLike makes %, _ and \\ literal", () => {
  assertEquals(escapeLike("a_b%c\\d@x.et"), "a\\_b\\%c\\\\d@x.et");
});

Deno.test("createdByThisCall: only an account created during this call (with skew allowance)", () => {
  const start = Date.parse("2026-10-18T08:00:00Z");
  assertEquals(createdByThisCall("2026-10-18T08:00:01Z", start), true);
  assertEquals(createdByThisCall("2026-10-18T07:59:30Z", start), true);   // within 60 s skew
  assertEquals(createdByThisCall("2026-10-17T15:05:12Z", start), false);  // an existing account re-invited
  assertEquals(createdByThisCall(undefined, start), false);
  assertEquals(createdByThisCall("garbage", start), false);
});

function fakeDb(profile: unknown, opts: { profileErr?: unknown } = {}) {
  const calls: string[] = [];
  const db: InviteRollbackClient = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: opts.profileErr ?? null }) }) }),
      delete: () => ({ eq: async (_c: string, id: string) => { calls.push(`delete-profile:${id}`); return { error: null }; } }),
    }),
    auth: { admin: { deleteUser: async (id: string) => { calls.push(`delete-auth:${id}`); return { error: null }; } } },
  };
  return { db, calls };
}

Deno.test("rollback: our own profile and auth user are removed", async () => {
  const { db, calls } = fakeDb({ id: "u1" });
  assertEquals(await rollbackInvitedUser(db, "u1", true, "t"), "deleted");
  assertEquals(calls, ["delete-profile:u1", "delete-auth:u1"]);
});

Deno.test("rollback: an account whose profile is someone else's is kept (concurrent invite)", async () => {
  const { db, calls } = fakeDb({ id: "u1" });
  assertEquals(await rollbackInvitedUser(db, "u1", false, "t"), "kept");
  assertEquals(calls, []);
});

Deno.test("rollback: with no profile anywhere the new auth user is removed; an unknown lookup keeps it", async () => {
  const a = fakeDb(null);
  assertEquals(await rollbackInvitedUser(a.db, "u1", false, "t"), "deleted");
  assertEquals(a.calls, ["delete-auth:u1"]);
  const b = fakeDb(null, { profileErr: { message: "timeout" } });
  assertEquals(await rollbackInvitedUser(b.db, "u1", false, "t"), "kept");
  assertEquals(b.calls, []);
});
