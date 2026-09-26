import { assertEquals } from "jsr:@std/assert@1";
import { rollbackTenant, type RollbackClient } from "./onboard-rollback.ts";

const NOW = Date.parse("2026-09-26T08:00:00Z");

function fakeClient(opts: { failOn?: string[]; ownedElsewhere?: boolean } = {}) {
  const calls: string[] = [];
  const res = (name: string) => Promise.resolve({ error: (opts.failOn ?? []).includes(name) ? { message: "boom" } : null });
  const client: RollbackClient = {
    from: (table) => ({
      delete: () => ({ eq: (col, v) => { calls.push(`${table}.${col}=${v}`); return res(table); } }),
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.ownedElsewhere ? { id: "u1" } : null, error: null }) }) }),
    }),
    auth: { admin: { deleteUser: (id) => { calls.push(`auth:${id}`); return res("auth_user"); } } },
  };
  return { client, calls };
}

const fresh = { id: "u1", createdAt: new Date(NOW + 1000).toISOString(), startedAt: NOW };

Deno.test("rollbackTenant removes dependants before the tenant, then the auth user this run created", async () => {
  const { client, calls } = fakeClient();
  assertEquals(await rollbackTenant(client, "t1", fresh), []);
  assertEquals(calls, [
    "periods.tenant_id=t1", "tenant_configs.tenant_id=t1", "academic_years.tenant_id=t1", "users.tenant_id=t1",
    "tenants.id=t1", "auth:u1",
  ]);
});

Deno.test("rollbackTenant reports a failed step and still attempts the rest", async () => {
  const { client, calls } = fakeClient({ failOn: ["users"] });
  assertEquals(await rollbackTenant(client, "t1", fresh), ["users"]);
  assertEquals(calls.length, 6);
});

Deno.test("rollbackTenant never deletes an auth user another school's profile still owns", async () => {
  const { client, calls } = fakeClient({ ownedElsewhere: true });
  await rollbackTenant(client, "t1", fresh);
  assertEquals(calls.includes("auth:u1"), false);
});

Deno.test("rollbackTenant never deletes an auth user created before this run (invite returned an existing account)", async () => {
  const { client, calls } = fakeClient();
  await rollbackTenant(client, "t1", { id: "u1", createdAt: "2026-01-01T00:00:00Z", startedAt: NOW });
  assertEquals(calls.includes("auth:u1"), false);
});

Deno.test("rollbackTenant skips the auth user when none was invited", async () => {
  const { client, calls } = fakeClient();
  assertEquals(await rollbackTenant(client, "t1", undefined), []);
  assertEquals(calls.some((c) => c.startsWith("auth:")), false);
});

Deno.test("rollbackTenant logs no tenant or user id", async () => {
  const logged: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    await rollbackTenant(fakeClient({ failOn: ["users", "auth_user"] }).client, "tenant-secret", { ...fresh, id: "user-secret" });
  } finally { console.error = orig; }
  const text = JSON.stringify(logged);
  assertEquals(text.includes("tenant-secret") || text.includes("user-secret"), false);
});
