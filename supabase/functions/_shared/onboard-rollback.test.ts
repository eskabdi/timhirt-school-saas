import { assertEquals } from "jsr:@std/assert@1";
import { rollbackTenant, type RollbackClient } from "./onboard-rollback.ts";

function fakeClient(failOn: string[] = []) {
  const calls: string[] = [];
  const res = (name: string) => Promise.resolve({ error: failOn.includes(name) ? { message: "boom" } : null });
  const client: RollbackClient = {
    from: (table) => ({ delete: () => ({ eq: (col, v) => { calls.push(`${table}.${col}=${v}`); return res(table); } }) }),
    auth: { admin: { deleteUser: (id) => { calls.push(`auth:${id}`); return res("auth_user"); } } },
  };
  return { client, calls };
}

Deno.test("rollbackTenant removes dependants before the tenant, then the invited auth user", async () => {
  const { client, calls } = fakeClient();
  assertEquals(await rollbackTenant(client, "t1", "u1"), []);
  assertEquals(calls, [
    "periods.tenant_id=t1", "tenant_configs.tenant_id=t1", "academic_years.tenant_id=t1", "users.tenant_id=t1",
    "tenants.id=t1", "auth:u1",
  ]);
});

Deno.test("rollbackTenant reports a failed step and still attempts the rest", async () => {
  const { client, calls } = fakeClient(["users"]);
  assertEquals(await rollbackTenant(client, "t1", "u1"), ["users"]);
  assertEquals(calls.length, 6);
});

Deno.test("rollbackTenant skips the auth user when none was invited", async () => {
  const { client, calls } = fakeClient();
  assertEquals(await rollbackTenant(client, "t1", undefined), []);
  assertEquals(calls.includes("auth:u1"), false);
});
